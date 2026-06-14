#!/usr/bin/env node
// PreToolUse(Edit|Write) hook:
//  - pnpm-lock.yaml の直接編集をブロック（依存変更は pnpm 経由 → lockfile は自動再生成）。
//  - pnpm-workspace.yaml(catalog) / Dockerfile の編集時はネイティブ固定制約の確認を促す（非ブロッキング）。
import { basename } from 'node:path';

const file = await readFilePath();
const name = basename(file);

if (name === 'pnpm-lock.yaml') {
  console.error(
    'pnpm-lock.yaml は直接編集しないでください。依存は package.json / catalog を変更し、pnpm install で lockfile を再生成してください。',
  );
  process.exit(2); // ブロック。stderr が Claude に渡る。
}

if (name === 'pnpm-workspace.yaml' || name === 'Dockerfile') {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        '[native-deps-guard] catalog / Dockerfile を編集します。tfjs-node 4.22(N-API v8) / Node22 / avx2+fma / glibc 固定との整合を /native-deps-guard で確認してください。',
    }),
  );
  process.exit(0); // 許可（リマインドのみ）。
}

process.exit(0);

async function readFilePath() {
  const raw = await readStdin();
  try {
    return JSON.parse(raw)?.tool_input?.file_path ?? '';
  } catch {
    return '';
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}
