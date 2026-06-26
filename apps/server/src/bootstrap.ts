import { createAdaptorServer, serve } from '@hono/node-server';
import {
  createClassifier,
  InferenceHealth,
  type ResolvedConfig,
  SaturationMonitor,
  Semaphore,
  unknownConfigKeys,
  validateConfig,
} from '@misskey-sensitive-detector/core';
import type { Logger } from 'pino';
import { createApp } from './app.js';
import { loadConfigModule, resolveConfigPath } from './config/load-config.js';
import { createLogger } from './logger.js';

type RunningServer = ReturnType<typeof serve>;

// 受信（ヘッダ／リクエスト全体）の明示上限。Node 既定（headers 60s / request 300s）に依存せず
// slowloris・遅延ボディに対する姿勢を明示する。これは「受信」の上限であり、推論側のタイムアウト
// （core の detectImage が requestTimeoutMs で別管理）とは別物。同一ホスト/LAN の本体から ≤maxBodySize
// を受け取る前提なので短めで足りる。
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_RECEIVE_TIMEOUT_MS = 30_000;

// 全スロットが hung（推論タイムアウト後も解放されない）状態の監視間隔と、終了に至る連続回数。
// /health 503 だけでは plain docker-compose（restart は exit 契機）は再起動しないため、サチュレーションが
// 一定時間継続したら self-exit して supervisor の再起動に委ねる（全デプロイ形態で自動回復させる）。
// 一過性（待機キューの abort 等の microtask スケール）では落とさないよう、連続観測で確証を取る。
const SATURATION_CHECK_INTERVAL_MS = 10_000;
const SATURATION_EXIT_AFTER_CONSECUTIVE = 3; // ≒30s 継続でようやく exit

function onListenError(err: unknown, logger: Logger): void {
  logger.error({ err }, 'server failed to listen');
  process.exit(1);
}

/**
 * 致命的ではないが運用上望ましくない設定を起動時に警告する（起動は止めない）。
 * - 未知の（タイプミス等の）config キー。既定値で silent に効くのを防ぐ。
 * - maxBodySize が maxParts×maxBinarySize 未満だと、満杯のリクエストが bodyLimit で 413 になる。
 * - apiKey が短すぎる（推測されやすい）。
 */
function warnConfigCoherence(raw: unknown, config: ResolvedConfig, logger: Logger): void {
  const unknownKeys = unknownConfigKeys(raw);
  if (unknownKeys.length > 0) {
    logger.warn(
      { unknownKeys },
      'config has unknown keys (typo?); they are ignored and defaults apply. Check spelling against config.example.mjs',
    );
  }

  const capacity = config.maxParts * config.maxBinarySize;
  if (config.maxBodySize < capacity) {
    logger.warn(
      `config.maxBodySize (${config.maxBodySize}) < maxParts*maxBinarySize (${capacity}); ` +
        'full-size multipart requests will be rejected by the body limit before per-part checks run',
    );
  }
  if (config.apiKey !== undefined && config.apiKey.length < 16) {
    logger.warn('config.apiKey is shorter than 16 chars; use a long random secret (e.g. `openssl rand -hex 32`)');
  }
}

/** http.Server にのみ受信タイムアウトを設定する（ServerType の http2 派生には該当プロパティが無い）。 */
function applyReceiveTimeouts(server: RunningServer): void {
  if ('requestTimeout' in server) {
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_RECEIVE_TIMEOUT_MS;
  }
}

function startServer(app: ReturnType<typeof createApp>, config: ResolvedConfig, logger: Logger): RunningServer {
  if (config.listen.kind === 'port') {
    const { port, host } = config.listen;
    const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
      logger.info(`listening on http://${host}:${info.port}`);
    });
    server.on('error', (err) => onListenError(err, logger));
    return server;
  }

  const { socket } = config.listen;
  const server = createAdaptorServer({ fetch: app.fetch });
  server.on('error', (err) => onListenError(err, logger));
  server.listen({ path: socket }, () => {
    logger.info(`listening on unix socket ${socket}`);
  });
  return server;
}

function installRuntimeHandlers(server: RunningServer, logger: Logger, onShutdown?: () => void): void {
  const shutdown = (signal: string): void => {
    onShutdown?.(); // watchdog 等を止めてから閉じる（shutdown 中に self-exit(1) へ化けるのを防ぐ）。
    logger.info(`received ${signal}, shutting down`);
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'error while closing server');
        process.exit(1);
      }
      process.exit(0);
    });
    // 一定時間で強制終了（接続が掴まれて閉じない場合のフォールバック）。
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  // uncaughtException 後はプロセス状態が不定なので、ログを残して終了し再起動に委ねる
  // （compose の restart: unless-stopped / オーケストレータが復帰させる）。
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception; exiting for restart');
    process.exit(1);
  });
}

/**
 * hung 推論で全スロットが詰まった状態（health.saturated）が継続したら、プロセスを終了して
 * supervisor の再起動に委ねる。native 推論が hung のままなのでプロセス再生成だけが回復手段
 * （detectImage のコメント参照）。timer は unref して、これ自体がプロセスを生かし続けないようにする。
 * 戻り値は watchdog を止める関数（graceful shutdown 開始時に呼ぶ）。
 */
function installSaturationWatchdog(health: InferenceHealth, logger: Logger): () => void {
  const monitor = new SaturationMonitor(SATURATION_EXIT_AFTER_CONSECUTIVE);
  const timer = setInterval(() => {
    const shouldExit = monitor.observe(health.saturated);
    if (health.saturated) {
      logger.warn(
        { stuckCount: health.stuckCount, consecutive: monitor.consecutiveCount },
        'inference saturated; all slots stuck on hung jobs',
      );
    }
    if (shouldExit) {
      logger.error('inference saturated too long; exiting for supervisor restart');
      process.exit(1);
    }
  }, SATURATION_CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * サービスを起動する。
 * - config の未指定・不正、listen 失敗は致命的（呼び出し元が exit(1)）。
 * - モデルロード失敗は致命的ではない（unavailable な classifier として常駐し、毎回 503 を返す）。
 */
export async function bootstrap(argv: readonly string[], basedir = process.cwd()): Promise<void> {
  const logger = createLogger();

  const configPath = resolveConfigPath(argv);
  if (!configPath) {
    throw new Error('no config specified; pass --config <path> or set SENSITIVE_DETECTOR_CONFIG');
  }

  const raw = await loadConfigModule(configPath, basedir);
  const config = validateConfig(raw); // ConfigError は致命的
  logger.info(`loaded config from ${configPath}`);
  warnConfigCoherence(raw, config, logger);

  // 起動時に 1 回だけモデルをロードする（失敗しても常駐し続ける）。
  const intraOpNumThreads = parseInt(process.env.SENSITIVE_DETECTOR_THREADS ?? '1', 10) || undefined;
  const classifier = await createClassifier(config.modelDir, { logger, intraOpNumThreads });
  if (!classifier.available) {
    logger.warn('model is unavailable; every /v1/detect-image request will return MODEL_UNAVAILABLE (503)');
  }

  const semaphore = new Semaphore(config.maxConcurrentJobs);
  const health = new InferenceHealth(config.maxConcurrentJobs);
  const app = createApp({ config, classifier, semaphore, health, logger });

  const server = startServer(app, config, logger);
  applyReceiveTimeouts(server);
  const stopWatchdog = installSaturationWatchdog(health, logger);
  installRuntimeHandlers(server, logger, stopWatchdog);
}
