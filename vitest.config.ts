import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ユニット/統合テストは core をビルド済み dist ではなくソースから直接解決する
// （テスト実行前のビルドを不要にする）。core 内の onnxruntime-node は
// 実行時に本物が読み込まれるため、統合テストでも問題ない。
const coreSrc = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));
const alias = { '@misskey-sensitive-detector/core': coreSrc };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts', 'apps/*/test/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          // onnxruntime-node のネイティブバイナリ安定動作のため、forks プールで直列実行する。
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
