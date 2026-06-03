import { pathToFileURL } from 'node:url';
import type { PredictionType } from 'nsfwjs/core';
import type { DetectErrorCode } from './types.js';

/**
 * core が利用する最小ロガー。server の pino Logger は構造的にこの型へ代入できる。
 */
export type CoreLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

const noopLogger: CoreLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// --- 実依存（tfjs-node / nsfwjs / systeminformation）の最小構造型 ---
// 実モジュールはこれらへ `as unknown as` でキャストして代入する。テストでは fake を注入できる。

type DecodedImage = { dispose: () => void };

type TfNodeModule = {
  env: () => { global: Record<string, unknown> };
  node: {
    decodeImage: (bytes: Uint8Array, channels?: number, dtype?: string, expandAnimations?: boolean) => DecodedImage;
  };
};

type NsfwModel = {
  classify: (image: unknown) => Promise<PredictionType[]>;
};

type NsfwModule = {
  load: (modelUrl: string, options?: { size?: number }) => Promise<NsfwModel>;
};

const REQUIRED_CPU_FLAGS_X64 = ['avx2', 'fma'] as const;

const defaultLoadCpuFlags = async (): Promise<string[]> => {
  const si = await import('systeminformation');
  const flags = await si.cpuFlags();
  return flags.split(/\s+/).filter((flag) => flag.length > 0);
};

const defaultLoadTfNode = async (): Promise<TfNodeModule> =>
  (await import('@tensorflow/tfjs-node')) as unknown as TfNodeModule;

const defaultLoadNsfw = async (): Promise<NsfwModule> => (await import('nsfwjs/core')) as unknown as NsfwModule;

/**
 * TensorFlow を実行できる CPU/アーキテクチャかを判定する（参照: Misskey本体バックエンドのAiService.ts）。
 * x64 は avx2 と fma の両方が必要。arm64 は常に対応。それ以外は非対応。
 * CPU フラグの取得に失敗した場合も非対応として扱う（要件: フラグ確認不能 → MODEL_UNAVAILABLE）。
 */
export async function computeIsSupportedCpu(
  deps: { arch?: string; loadCpuFlags?: () => Promise<string[]> } = {},
): Promise<boolean> {
  const arch = deps.arch ?? process.arch;
  switch (arch) {
    case 'x64': {
      try {
        const loadCpuFlags = deps.loadCpuFlags ?? defaultLoadCpuFlags;
        const flags = await loadCpuFlags();
        return REQUIRED_CPU_FLAGS_X64.every((required) => flags.includes(required));
      } catch {
        return false;
      }
    }
    case 'arm64':
      return true;
    default:
      return false;
  }
}

export type ClassifyResult =
  | { ok: true; predictions: PredictionType[] }
  | { ok: false; code: Extract<DetectErrorCode, 'IMAGE_DECODE_FAILED' | 'DETECTION_FAILED' | 'MODEL_UNAVAILABLE'> };

export interface Classifier {
  /** モデルが利用可能か（起動時診断用）。false の場合 classify は常に MODEL_UNAVAILABLE を返す。 */
  readonly available: boolean;
  classify(buffer: Buffer): Promise<ClassifyResult>;
}

export type ClassifierDeps = {
  arch?: string;
  loadCpuFlags?: () => Promise<string[]>;
  loadTfNode?: () => Promise<TfNodeModule>;
  loadNsfw?: () => Promise<NsfwModule>;
  fetchImpl?: unknown;
  logger?: CoreLogger;
};

function unavailableClassifier(): Classifier {
  return {
    available: false,
    classify: () => Promise.resolve({ ok: false, code: 'MODEL_UNAVAILABLE' }),
  };
}

function readyClassifier(tf: TfNodeModule, model: NsfwModel): Classifier {
  return {
    available: true,
    classify: async (buffer: Buffer): Promise<ClassifyResult> => {
      let image: DecodedImage;
      try {
        // 正規化済みバイトを RGB 3ch でデコードする。GIF は先頭フレームだけにし、frame-count DoS を防ぐ。
        image = tf.node.decodeImage(buffer, 3, 'int32', false);
      } catch {
        return { ok: false, code: 'IMAGE_DECODE_FAILED' };
      }
      try {
        const predictions = await model.classify(image);
        return { ok: true, predictions };
      } catch {
        return { ok: false, code: 'DETECTION_FAILED' };
      } finally {
        image.dispose(); // Tensor を解放（参照: AiService.ts:63）。
      }
    },
  };
}

/**
 * 起動時に 1 回だけモデルをロードする（参照実装の遅延ロードとは異なり Mutex 不要）。
 * CPU 非対応・import 失敗・load 失敗はいずれも `MODEL_UNAVAILABLE` を返す classifier を返し、
 * 再試行しない（要件: 早期検出方針）。
 */
export async function createClassifier(modelDir: string, deps: ClassifierDeps = {}): Promise<Classifier> {
  const logger = deps.logger ?? noopLogger;

  const supported = await computeIsSupportedCpu({ arch: deps.arch, loadCpuFlags: deps.loadCpuFlags });
  if (!supported) {
    logger.error(
      'TensorFlow is not supported on this CPU/architecture; /v1/detect-image will always return MODEL_UNAVAILABLE.',
    );
    return unavailableClassifier();
  }

  try {
    const loadTfNode = deps.loadTfNode ?? defaultLoadTfNode;
    const loadNsfw = deps.loadNsfw ?? defaultLoadNsfw;

    const tf = await loadTfNode();
    // TensorFlow の fetch を Node の global fetch に差し替える（参照: AiService.ts:47）。
    tf.env().global.fetch = deps.fetchImpl ?? globalThis.fetch;

    const nsfw = await loadNsfw();
    const model = await nsfw.load(pathToFileURL(modelDir).toString(), { size: 299 });

    logger.info('nsfwjs model loaded successfully.');
    return readyClassifier(tf, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load nsfwjs model: ${message}`);
    return unavailableClassifier();
  }
}
