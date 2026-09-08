import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zip `dist/` into an upload-ready archive for the Chrome Web Store.
 *
 * The archive is written into `store/package/` and committed, alongside the
 * listing images and copy, because it is a deliverable rather than a build
 * by-product: without it in the repository the only way to obtain the package
 * is to build it, and GitHub's source download is the wrong thing to upload.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const releaseDir = path.join(root, 'store', 'package');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/ is not built — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.mkdirSync(releaseDir, { recursive: true });
const archive = path.join(releaseDir, `price-per-dollar-${pkg.version}.zip`);
fs.rmSync(archive, { force: true });

try {
  execFileSync('zip', ['-r', '-q', '-X', archive, '.'], { cwd: dist, stdio: 'inherit' });
} catch (error) {
  console.error('Packaging needs the `zip` command on PATH.');
  console.error(error.message);
  process.exit(1);
}

const size = fs.statSync(archive).size;
console.log(`packaged ${path.relative(root, archive)} (${(size / 1024).toFixed(1)} kB)`);
