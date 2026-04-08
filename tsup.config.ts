import { defineConfig } from 'tsup';

export default defineConfig([
  // Electron main process — must be CommonJS
  {
    entry: {
      index: 'src/main/index.ts',
      preload: 'src/main/preload.ts',
    },
    format: ['cjs'],
    target: 'node22',
    outDir: 'dist/main',
    external: ['electron'],
    sourcemap: true,
    clean: true,
  },
  // Renderer — IIFE bundle loaded by Chromium
  {
    entry: {
      renderer: 'src/renderer/index.ts',
    },
    format: ['iife'],
    globalName: 'SaberSpeak',
    target: 'chrome120',
    outDir: 'dist/renderer',
    sourcemap: true,
    loader: { '.css': 'copy' },
  },
]);
