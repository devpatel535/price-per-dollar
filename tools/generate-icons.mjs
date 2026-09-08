import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, previewIcon, renderIcon } from './icon-render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

if (process.argv.includes('--preview')) {
  console.log(previewIcon(Number(process.argv[process.argv.indexOf('--preview') + 1]) || 48));
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(renderIcon(size), size));
  console.log(`wrote ${path.relative(root, file)}`);
}
