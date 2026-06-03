import { existsSync } from 'node:fs';
import { computeIsSupportedCpu } from '../../src/classifier.js';

const rawModelDir =
  process.env.SENSITIVE_DETECTOR_TEST_MODEL_DIR ?? '/home/osamu/develop/misskey/packages/backend/nsfw-model';

// createClassifier に渡す modelDir は末尾スラッシュ正規化済みであること（config.ts と同じ規約）。
export const TEST_MODEL_DIR = rawModelDir.endsWith('/') ? rawModelDir : `${rawModelDir}/`;

/**
 * 統合テストを実行できる環境か（実モデルが存在し、CPU/アーキが TensorFlow に対応している）。
 * どちらか欠ければ describe.skip させる。
 */
export async function integrationEnabled(): Promise<boolean> {
  if (!existsSync(TEST_MODEL_DIR)) {
    return false;
  }
  return computeIsSupportedCpu();
}
