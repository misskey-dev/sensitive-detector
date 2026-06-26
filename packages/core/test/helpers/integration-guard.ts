import { existsSync } from 'node:fs';

const rawModelDir = process.env.SENSITIVE_DETECTOR_TEST_MODEL_DIR ?? './nsfw-model';

// createClassifier に渡す modelDir は末尾スラッシュ正規化済みであること（config.ts と同じ規約）。
export const TEST_MODEL_DIR = rawModelDir.endsWith('/') ? rawModelDir : `${rawModelDir}/`;

/**
 * 統合テストを実行できる環境か（ONNX モデルが存在する）。
 * モデルが無い環境では describe.skip させる。
 */
export async function integrationEnabled(): Promise<boolean> {
  return existsSync(TEST_MODEL_DIR);
}
