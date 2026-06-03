import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `--config <path>` / `--config=<path>` または環境変数 SENSITIVE_DETECTOR_CONFIG から
 * config ファイルのパスを解決する。見つからなければ undefined。
 */
export function resolveConfigPath(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      return argv[i + 1];
    }
    if (arg?.startsWith('--config=')) {
      return arg.slice('--config='.length);
    }
  }
  const fromEnv = env.SENSITIVE_DETECTOR_CONFIG;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * config モジュール（.mjs/.cjs）を dynamic import し、その default export を返す。
 * default export が無い場合はエラー。
 * basedir: 相対パスを解決する基準ディレクトリ。省略時は process.cwd()。
 * CLI 経由で使う場合はコマンド実行時の cwd を渡すこと（サーバープロセス自体の cwd ではなく）。
 */
export async function loadConfigModule(configPath: string, basedir = process.cwd()): Promise<unknown> {
  const absolute = isAbsolute(configPath) ? configPath : resolve(basedir, configPath);
  const moduleUrl = pathToFileURL(absolute).href;
  const imported = (await import(moduleUrl)) as { default?: unknown };
  if (imported.default === undefined) {
    throw new Error(`config module "${configPath}" must have a default export`);
  }
  return imported.default;
}
