import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { DetectErrorCode, Prediction } from './types.js';

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

// --- 実依存（onnxruntime-node）の最小構造型 ---
// テストでは fake を注入できる。

type OnnxSession = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array } | undefined>>;
};

type OnnxSessionOptions = {
  intraOpNumThreads?: number;
};

type OnnxInferenceSession = {
  create(path: string, options?: OnnxSessionOptions): Promise<OnnxSession>;
};

type OnnxTensorCtor = new (type: string, data: Float32Array, dims: number[]) => unknown;

type OnnxModule = {
  InferenceSession: OnnxInferenceSession;
  Tensor: OnnxTensorCtor;
};

const defaultLoadOnnx = async (): Promise<OnnxModule> =>
  (await import('onnxruntime-node')) as unknown as OnnxModule;

/**
 * ONNX Runtime を実行できる CPU/アーキテクチャかを判定する（参照: Misskey本体バックエンドのAiService.ts）。
 */
export async function computeIsSupportedCpu(
  arch: string = process.arch,
): Promise<boolean> {
  return arch === 'x64' || arch === 'arm64';
}

/** モデル入力サイズ（InceptionV3）。 */
const MODEL_SIZE = 299;
/** nsfwjs 互換の出力クラス名（softmax 出力順）。 */
const CLASS_NAMES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as const;
/** ONNX モデルの入力テンソル名。 */
const INPUT_NAME = 'input';
/** ONNX モデルの出力テンソル名。 */
const OUTPUT_NAME = 'dense_3';

/**
 * PNG バイト列をデコードし、299×299 RGB の Float32Array（[0, 1] 正規化済み）を返す。
 * デコード失敗・サイズ不一致は undefined を返す。
 */
function decodePngToFloat32(buffer: Buffer): Float32Array | undefined {
  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    return undefined;
  }
  if (png.width !== MODEL_SIZE || png.height !== MODEL_SIZE) {
    return undefined;
  }
  // PNG.sync.read は RGBA (4ch) を返す。RGB 3ch に変換しつつ [0, 1] に正規化する。
  const pixelCount = MODEL_SIZE * MODEL_SIZE;
  const float32 = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    float32[i * 3] = (png.data[i * 4] ?? 0) / 255;
    float32[i * 3 + 1] = (png.data[i * 4 + 1] ?? 0) / 255;
    float32[i * 3 + 2] = (png.data[i * 4 + 2] ?? 0) / 255;
  }
  return float32;
}

export type ClassifyResult =
  | { ok: true; predictions: Prediction[] }
  | { ok: false; code: Extract<DetectErrorCode, 'IMAGE_DECODE_FAILED' | 'DETECTION_FAILED' | 'MODEL_UNAVAILABLE'> };

export interface Classifier {
  /** モデルが利用可能か（起動時診断用）。false の場合 classify は常に MODEL_UNAVAILABLE を返す。 */
  readonly available: boolean;
  classify(buffer: Buffer): Promise<ClassifyResult>;
}

export type ClassifierDeps = {
  arch?: string;
  loadOnnx?: () => Promise<OnnxModule>;
  logger?: CoreLogger;
  intraOpNumThreads?: number;
};

function unavailableClassifier(): Classifier {
  return {
    available: false,
    classify: () => Promise.resolve({ ok: false, code: 'MODEL_UNAVAILABLE' }),
  };
}

function readyClassifier(session: OnnxSession, TensorCtor: OnnxTensorCtor): Classifier {
  return {
    available: true,
    classify: async (buffer: Buffer): Promise<ClassifyResult> => {
      const float32 = decodePngToFloat32(buffer);
      if (float32 === undefined) {
        return { ok: false, code: 'IMAGE_DECODE_FAILED' };
      }
      try {
        const inputTensor = new TensorCtor('float32', float32, [1, MODEL_SIZE, MODEL_SIZE, 3]);
        const results = await session.run({ [INPUT_NAME]: inputTensor });
        const output = results[OUTPUT_NAME];
        if (!output) {
          return { ok: false, code: 'DETECTION_FAILED' };
        }
        const data = output.data as Float32Array;
        const predictions: Prediction[] = CLASS_NAMES.map((className, i) => ({
          className,
          probability: data[i] ?? 0,
        }));
        // nsfwjs 互換: 確率降順でソートする。
        predictions.sort((a, b) => b.probability - a.probability);
        return { ok: true, predictions };
      } catch {
        return { ok: false, code: 'DETECTION_FAILED' };
      }
    },
  };
}

/**
 * 起動時に 1 回だけ ONNX モデルをロードする。
 * import 失敗・load 失敗はいずれも `MODEL_UNAVAILABLE` を返す classifier を返し、
 * 再試行しない（要件: 早期検出方針）。
 */
export async function createClassifier(modelDir: string, deps: ClassifierDeps = {}): Promise<Classifier> {
  const logger = deps.logger ?? noopLogger;

  const supported = await computeIsSupportedCpu(deps.arch);
  if (!supported) {
    logger.error(
      'ONNX Runtime is not supported on this CPU/architecture; /v1/detect-image will always return MODEL_UNAVAILABLE.',
    );
    return unavailableClassifier();
  }

  try {
    const loadOnnx = deps.loadOnnx ?? defaultLoadOnnx;
    const { InferenceSession, Tensor } = await loadOnnx();

    const modelPath = join(modelDir, 'nsfw_model.onnx');
    const sessionOptions: OnnxSessionOptions = {};
    if (deps.intraOpNumThreads !== undefined && deps.intraOpNumThreads > 0) {
      sessionOptions.intraOpNumThreads = deps.intraOpNumThreads;
    }
    const session = await InferenceSession.create(modelPath, sessionOptions);
    logger.info('ONNX model loaded successfully.');
    return readyClassifier(session, Tensor);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load ONNX model: ${message}`);
    return unavailableClassifier();
  }
}
