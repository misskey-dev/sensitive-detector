import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  sourcemap: true,
  clean: true,
});
