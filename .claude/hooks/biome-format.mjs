#!/usr/bin/env node
// PostToolUse(Edit|Write) hook: 編集されたファイルを Biome で整形＋import 整理する（非ブロッキング）。
import { execFileSync } from 'node:child_process';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const file = await readFilePath();
if (!file || !/\.(tsx?|jsx?|mjs|cjs|jsonc?)$/.test(file)) {
  process.exit(0);
}

try {
  execFileSync('pnpm', ['exec', 'biome', 'check', '--write', file], {
    cwd: projectDir,
    stdio: 'ignore',
  });
} catch {
  // 整形に失敗してもツール結果はブロックしない。
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
