import { bootstrap } from './bootstrap.js';

// pnpm/npm は子スクリプトを実行するディレクトリを変えるため、process.cwd() はパッケージ内を指す。
// INIT_CWD には pnpm/npm を実行した元のディレクトリが入るので、相対 --config パスの基準にする。
const invocationCwd = process.env.INIT_CWD ?? process.cwd();

bootstrap(process.argv.slice(2), invocationCwd).catch((err: unknown) => {
  // 起動失敗（config 未指定/不正など）はロガー確立前のことがあるため console に出して終了する。
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`failed to start sensitive-detector: ${message}\n`);
  process.exit(1);
});
