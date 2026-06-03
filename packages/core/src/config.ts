export const DEFAULT_MAX_BINARY_SIZE = 1_048_576; // 1MB
export const DEFAULT_MAX_IMAGE_WIDTH = 299;
export const DEFAULT_MAX_IMAGE_HEIGHT = 299;
export const DEFAULT_MAX_IMAGE_PIXELS = DEFAULT_MAX_IMAGE_WIDTH * DEFAULT_MAX_IMAGE_HEIGHT;
export const DEFAULT_MAX_CONCURRENT_JOBS = 2;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_PARTS = 10;
export const DEFAULT_MAX_BODY_SIZE = 12_582_912; // 12MB (10 parts × 1MB + boundary/header 余白)
export const DEFAULT_HOST = '127.0.0.1';

// setTimeout の遅延上限（符号付き 32bit, ms）。これを超える値は Node が 1ms に丸めて即時発火するため、
// requestTimeoutMs に設定されると「全リクエストが即タイムアウト」になる。検証で弾く。
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * config ファイル（.mjs/.cjs）が default export する設定。
 */
export type Config = {
  /**
   * 設定するとHTTPとしてListenする。
   * port と socket はどちらか一方が必須（両方指定・両方未指定はエラー）。
   */
  port?: number;
  /**
   * 設定するとUnixドメインソケットとしてListenする。
   * port と socket はどちらか一方が必須（両方指定・両方未指定はエラー）。
   */
  socket?: string;
  /**
   * port 待ち受け時の bind ホスト。デフォルト 127.0.0.1（ローカルのみ）。
   * コンテナ等で外部公開する場合のみ '0.0.0.0' を明示する。socket 待ち受けでは無視される。
   */
  host?: string;
  /** nsfwjs モデルディレクトリ（必須）。 */
  modelDir: string;
  /** 静的な共有シークレット（設定者が決めて、リクエスト元と共有する）。設定すると `Authorization: Bearer <この値>` ヘッダーが必須になる。 */
  apiKey?: string;
  /** TCP 待ち受けで apiKey 未設定を許すためのフラグ。Unix socket では不要。外部から到達不能な開発環境向け。 */
  allowUnauthenticatedTcp?: boolean;
  /** バイナリ入力の上限バイト数。デフォルト 1MB。 */
  maxBinarySize?: number;
  /** デコード後画像幅の上限。デフォルト 299px。 */
  maxImageWidth?: number;
  /** デコード後画像高さの上限。デフォルト 299px。 */
  maxImageHeight?: number;
  /** デコード後総ピクセル数の上限。デフォルト 299×299。 */
  maxImagePixels?: number;
  /** multipart リクエストの最大パーツ数。デフォルト 10。 */
  maxParts?: number;
  /** multipart リクエストの総 body 上限バイト数。デフォルト 12MB。 */
  maxBodySize?: number;
  /** モデル推論の同時実行上限。デフォルト 2。 */
  maxConcurrentJobs?: number;
  /** リクエストタイムアウト（ms）。デフォルト 60000。 */
  requestTimeoutMs?: number;
};

export type ResolvedListen = { kind: 'port'; port: number; host: string } | { kind: 'socket'; socket: string };

/**
 * 全デフォルトを適用し、不変条件を満たした設定。
 */
export type ResolvedConfig = {
  listen: ResolvedListen;
  modelDir: string;
  apiKey?: string;
  allowUnauthenticatedTcp: boolean;
  maxBinarySize: number;
  maxImageWidth: number;
  maxImageHeight: number;
  maxImagePixels: number;
  maxParts: number;
  maxBodySize: number;
  maxConcurrentJobs: number;
  requestTimeoutMs: number;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Config の全キーを 1 箇所で列挙する（値の true はダミー）。`satisfies Record<keyof Config, true>` により
// Config 型と乖離しなくなる: フィールドを足すと「列挙漏れ」、タイポを書くと「未知プロパティ」で typecheck が落ちる。
const CONFIG_KEYS = {
  port: true,
  socket: true,
  host: true,
  modelDir: true,
  apiKey: true,
  allowUnauthenticatedTcp: true,
  maxBinarySize: true,
  maxImageWidth: true,
  maxImageHeight: true,
  maxImagePixels: true,
  maxParts: true,
  maxBodySize: true,
  maxConcurrentJobs: true,
  requestTimeoutMs: true,
} satisfies Record<keyof Config, true>;

/** 受理する config キー一覧（Config 型と一致。CONFIG_KEYS の型チェックで網羅・タイポを担保）。未知キー検出に使う。 */
export const KNOWN_CONFIG_KEYS = Object.keys(CONFIG_KEYS) as readonly (keyof Config)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * config オブジェクトに含まれる未知の（タイプミス等の）トップレベルキーを返す。
 * 検証は通すが、`maxBinarySie` のようなタイポが既定値で silent に効くのを起動時に警告するために使う。
 * raw がオブジェクトでなければ空配列（その場合 validateConfig が ConfigError を投げる）。
 */
export function unknownConfigKeys(raw: unknown): string[] {
  if (!isPlainObject(raw)) {
    return [];
  }
  const known = new Set<string>(KNOWN_CONFIG_KEYS);
  return Object.keys(raw).filter((key) => !known.has(key));
}

function requirePositiveInt(value: unknown, field: string, max: number = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > max) {
    const bound = max === Number.MAX_SAFE_INTEGER ? '' : ` and ≤ ${max}`;
    throw new ConfigError(`config.${field} must be a positive integer${bound}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * 生の設定値を検証し、デフォルトを適用した `ResolvedConfig` を返す。
 * 検証に失敗した場合は `ConfigError` を throw する（起動時に process.exit(1) させる想定）。
 */
export function validateConfig(raw: unknown): ResolvedConfig {
  if (!isPlainObject(raw)) {
    throw new ConfigError('config must be an object (the default export of the config module)');
  }

  // --- modelDir（必須） ---
  const { modelDir } = raw;
  if (typeof modelDir !== 'string' || modelDir.length === 0) {
    throw new ConfigError('config.modelDir is required and must be a non-empty string');
  }
  const normalizedModelDir = modelDir.endsWith('/') ? modelDir : `${modelDir}/`;

  // --- listen（port XOR socket） ---
  const hasPort = raw.port !== undefined;
  const hasSocket = raw.socket !== undefined;
  if (hasPort && hasSocket) {
    throw new ConfigError('config must set exactly one of port or socket, but both are set');
  }
  if (!hasPort && !hasSocket) {
    throw new ConfigError('config must set exactly one of port or socket, but neither is set');
  }

  let listen: ResolvedListen;
  if (hasPort) {
    const { port } = raw;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError(`config.port must be an integer between 1 and 65535, got ${JSON.stringify(port)}`);
    }
    let host = DEFAULT_HOST;
    if (raw.host !== undefined) {
      if (typeof raw.host !== 'string' || raw.host.length === 0) {
        throw new ConfigError(`config.host must be a non-empty string when set, got ${JSON.stringify(raw.host)}`);
      }
      host = raw.host;
    }
    listen = { kind: 'port', port, host };
  } else {
    const { socket } = raw;
    if (typeof socket !== 'string' || socket.length === 0) {
      throw new ConfigError('config.socket must be a non-empty string');
    }
    if (raw.host !== undefined) {
      throw new ConfigError('config.host is only valid with a port listener, not socket');
    }
    listen = { kind: 'socket', socket };
  }

  // --- apiKey（任意） ---
  let apiKey: string | undefined;
  if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== 'string' || raw.apiKey.length === 0) {
      throw new ConfigError('config.apiKey must be a non-empty string when set');
    }
    apiKey = raw.apiKey;
  }
  let allowUnauthenticatedTcp = false;
  if (raw.allowUnauthenticatedTcp !== undefined) {
    if (typeof raw.allowUnauthenticatedTcp !== 'boolean') {
      throw new ConfigError(
        `config.allowUnauthenticatedTcp must be a boolean when set, got ${JSON.stringify(raw.allowUnauthenticatedTcp)}`,
      );
    }
    allowUnauthenticatedTcp = raw.allowUnauthenticatedTcp;
  }
  if (listen.kind === 'port' && apiKey === undefined && !allowUnauthenticatedTcp) {
    throw new ConfigError(
      'config.apiKey is required when using port; set allowUnauthenticatedTcp: true to explicitly allow unauthenticated TCP',
    );
  }

  // --- 数値系（任意、デフォルトあり） ---
  const maxBinarySize =
    raw.maxBinarySize === undefined ? DEFAULT_MAX_BINARY_SIZE : requirePositiveInt(raw.maxBinarySize, 'maxBinarySize');
  const maxImageWidth =
    raw.maxImageWidth === undefined ? DEFAULT_MAX_IMAGE_WIDTH : requirePositiveInt(raw.maxImageWidth, 'maxImageWidth');
  const maxImageHeight =
    raw.maxImageHeight === undefined
      ? DEFAULT_MAX_IMAGE_HEIGHT
      : requirePositiveInt(raw.maxImageHeight, 'maxImageHeight');
  const maxImagePixels =
    raw.maxImagePixels === undefined
      ? DEFAULT_MAX_IMAGE_PIXELS
      : requirePositiveInt(raw.maxImagePixels, 'maxImagePixels');
  const maxParts = raw.maxParts === undefined ? DEFAULT_MAX_PARTS : requirePositiveInt(raw.maxParts, 'maxParts');
  const maxBodySize =
    raw.maxBodySize === undefined ? DEFAULT_MAX_BODY_SIZE : requirePositiveInt(raw.maxBodySize, 'maxBodySize');
  const maxConcurrentJobs =
    raw.maxConcurrentJobs === undefined
      ? DEFAULT_MAX_CONCURRENT_JOBS
      : requirePositiveInt(raw.maxConcurrentJobs, 'maxConcurrentJobs');
  const requestTimeoutMs =
    raw.requestTimeoutMs === undefined
      ? DEFAULT_REQUEST_TIMEOUT_MS
      : requirePositiveInt(raw.requestTimeoutMs, 'requestTimeoutMs', MAX_TIMEOUT_MS);

  return {
    listen,
    modelDir: normalizedModelDir,
    apiKey,
    allowUnauthenticatedTcp,
    maxBinarySize,
    maxImageWidth,
    maxImageHeight,
    maxImagePixels,
    maxParts,
    maxBodySize,
    maxConcurrentJobs,
    requestTimeoutMs,
  };
}
