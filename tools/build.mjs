import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, renderIcon } from './icon-render.mjs';

/**
 * Build the unpacked extension into `dist/`.
 *
 * Three separate bundles rather than one: the content script and popup are
 * IIFEs because they are loaded as classic scripts, while the service worker is
 * an ES module as its manifest entry declares.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const shared = {
  bundle: true,
  target: ['chrome102'],
  platform: 'browser',
  legalComments: 'none',
  loader: { '.css': 'text' },
  logLevel: 'info',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
};

const bundles = [
  { entry: 'src/content/index.ts', out: 'content/index.js', format: 'iife' },
  { entry: 'src/popup/popup.ts', out: 'popup/popup.js', format: 'iife' },
  { entry: 'src/background/service-worker.ts', out: 'background/service-worker.js', format: 'esm' },
];

function copyStatic() {
  fs.mkdirSync(path.join(dist, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });

  fs.copyFileSync(path.join(root, 'src/popup/index.html'), path.join(dist, 'popup/index.html'));
  fs.copyFileSync(path.join(root, 'src/popup/popup.css'), path.join(dist, 'popup/popup.css'));

  // Icons are rendered rather than copied, so a build never depends on a
  // committed binary being present or up to date.
  for (const size of [16, 32, 48, 128]) {
    fs.writeFileSync(path.join(dist, 'icons', `icon${size}.png`), encodePng(renderIcon(size), size));
  }

  // Deliberately not named `manifest.json`. GitHub's "Download ZIP" of this
  // repository would otherwise contain a file the Chrome Web Store mistakes for
  // an extension root, and the resulting rejection names every file in the repo
  // rather than saying the obvious thing: that is the source, not the package.
  // The manifest version is owned by package.json so a release only bumps once.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.base.json'), 'utf8'));
  manifest.version = pkg.version;
  fs.writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  copyStatic();

  const contexts = [];
  for (const bundle of bundles) {
    const options = {
      ...shared,
      entryPoints: [path.join(root, bundle.entry)],
      outfile: path.join(dist, bundle.out),
      format: bundle.format,
    };
    if (watch) {
      const context = await esbuild.context(options);
      await context.watch();
      contexts.push(context);
    } else {
      await esbuild.build(options);
    }
  }

  if (watch) {
    console.log('watching for changes — reload the unpacked extension after each build');
  } else {
    const bytes = bundles.reduce((total, bundle) => total + fs.statSync(path.join(dist, bundle.out)).size, 0);
    console.log(`built dist/ (${(bytes / 1024).toFixed(1)} kB of script)`);
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
