#!/usr/bin/env node
/**
 * bundle-python.mjs
 *
 * Downloads python-build-standalone (Windows x64, Python 3.12) into ./bundled-python/.
 * Run once from WSL2/Linux before building the installer.
 *
 * Usage:
 *   node scripts/bundle-python.mjs
 */

import { createWriteStream, existsSync } from 'fs';
import { mkdir, rm, readdir, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { execSync } from 'child_process';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_DIR   = join(ROOT, 'bundled-python');
const TARBALL   = join(ROOT, '_python-standalone.tar.gz');
const TMP_DIR   = join(ROOT, '_python-extract-tmp');

// python-build-standalone Windows x64 Python 3.12 "install_only" build
const PYTHON_URL =
  'https://github.com/indygreg/python-build-standalone/releases/download/20241016/' +
  'cpython-3.12.7+20241016-x86_64-pc-windows-msvc-install_only.tar.gz';

// ── Download ─────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}`);
    const file = createWriteStream(dest);
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        res.on('data', (c) => {
          received += c.length;
          if (total > 0) {
            process.stdout.write(`\r  ${Math.round(received / total * 100)}% (${(received / 1e6).toFixed(1)} MB)  `);
          }
        });
        pipeline(res, file).then(() => { process.stdout.write('\n'); resolve(); }).catch(reject);
      }).on('error', reject);
    }
    get(url);
  });
}

// ── Extract ──────────────────────────────────────────────────────────────────

async function extract(tarball, outDir) {
  console.log('Extracting...');
  await mkdir(TMP_DIR, { recursive: true });

  // Use system tar (available on Linux/macOS/WSL2)
  execSync(`tar -xzf "${tarball}" -C "${TMP_DIR}"`, { stdio: 'inherit' });

  // The tarball contains a top-level `python/` directory
  const entries = await readdir(TMP_DIR);
  const pyDir   = entries.find((e) => e.toLowerCase().startsWith('python'));
  if (!pyDir) throw new Error(`No python/ dir found in tarball. Got: ${entries.join(', ')}`);

  await rm(outDir, { recursive: true, force: true });
  await rename(join(TMP_DIR, pyDir), outDir);
  await rm(TMP_DIR, { recursive: true, force: true });
  console.log('Extraction complete.');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (existsSync(join(OUT_DIR, 'python.exe'))) {
    console.log('bundled-python/python.exe already exists — delete bundled-python/ to re-download.');
    return;
  }

  if (!existsSync(TARBALL)) {
    await download(PYTHON_URL, TARBALL);
  } else {
    console.log('Tarball already present, skipping download.');
  }

  await extract(TARBALL, OUT_DIR);
  await rm(TARBALL, { force: true });

  console.log('\nDone! bundled-python/ contains a self-contained Windows Python 3.12.');
  console.log('moonshine-voice will be pip-installed automatically on first app launch.');
}

main().catch((err) => { console.error('bundle-python failed:', err.message); process.exit(1); });
