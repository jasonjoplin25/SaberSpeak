/**
 * Copies renderer static assets (HTML, CSS) into dist/renderer/
 * so Electron can load them in production.
 */
import { copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const assets = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css'],
];

await mkdir(join(ROOT, 'dist/renderer'), { recursive: true });
for (const [src, dst] of assets) {
  await copyFile(join(ROOT, src), join(ROOT, dst));
}
console.log('Assets copied to dist/renderer/');
