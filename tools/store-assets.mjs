import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodePng, renderIcon } from './icon-render.mjs';

/**
 * Generate the Chrome Web Store listing images.
 *
 * Screenshots are a hard requirement for submission and must be exactly
 * 1280x800 or 640x400. Rather than shrinking a whole browser window into that
 * box, the real UI is captured first and then composed onto a branded canvas at
 * the exact size, so the interface stays legible in the store's carousel.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tools', 'e2e', 'fixture');
const workDir = path.join(root, '.e2e');
const outDir = path.join(root, 'store', 'assets');
const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(PINNED_CHROME) ? PINNED_CHROME : undefined;

const MIME = { '.html': 'text/html' };

function serveFixture() {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/favicon.ico') return void res.writeHead(204).end();
    const file = path.join(fixtureDir, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(fixtureDir) || !fs.existsSync(file)) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'text/plain' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function stageGrantedExtension() {
  const target = path.join(workDir, 'extension-assets');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'dist'), target, { recursive: true });
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

async function waitForRegistration(context) {
  for (let i = 0; i < 60; i += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) {
      try {
        const ids = await worker.evaluate(
          async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
        );
        if (ids.includes('ppd-auto')) return worker;
      } catch { /* worker restarting */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return context.serviceWorkers()[0] ?? null;
}

const dataUri = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

/** Capture the raw UI shots the composites are built from. */
async function capture(url) {
  const extension = stageGrantedExtension();
  const profile = path.join(workDir, 'profile-assets');
  fs.rmSync(profile, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(profile, {
    ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const worker = await waitForRegistration(context);
  const id = worker ? new URL(worker.url()).host : null;
  if (!id) throw new Error('extension service worker never appeared');

  const shots = {};

  const shop = await context.newPage();
  await shop.goto(url, { waitUntil: 'load' });
  await shop.waitForFunction(
    () => (document.querySelector('[data-ppd-overlay]')?.shadowRoot?.querySelectorAll('.badge').length ?? 0) > 0,
    null,
    { timeout: 20000 },
  );
  await shop.waitForTimeout(1500);
  shots.grid = await shop.screenshot();

  // The analysis panel, cropped to itself so it stays readable when scaled.
  await shop.evaluate(() => {
    const shadow = document.querySelector('[data-ppd-overlay]').shadowRoot;
    shadow.querySelector('.badge').click();
  });
  await shop.waitForTimeout(900);
  const panelBox = await shop.evaluate(() => {
    const panel = document.querySelector('[data-ppd-overlay]').shadowRoot.querySelector('.panel');
    const rect = panel.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  // Clip to the panel exactly; any margin lets the page behind it bleed in.
  shots.panel = await shop.screenshot({
    clip: {
      x: panelBox.x,
      y: panelBox.y,
      width: panelBox.width,
      height: panelBox.height,
    },
  });

  // The popup, driven from a background tab with the storefront active so that
  // `chrome.tabs.query({active: true})` resolves to the shop, as it would for
  // the real toolbar popup.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 580 });
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.waitForTimeout(400);
  await shop.bringToFront();
  await popup.evaluate(() => document.getElementById('rescan').click());
  await popup.waitForFunction(() => document.querySelectorAll('.group .row').length > 0, null, { timeout: 15000 });
  await popup.waitForTimeout(600);
  shots.popupScan = await popup.screenshot();

  await popup.evaluate(() => {
    document.querySelector('[data-tab="calculator"]').click();
  });
  await popup.waitForTimeout(500);
  // Scroll to the worked answer rather than the empty form.
  await popup.evaluate(() => { document.querySelector('main').scrollTop = 596; });
  await popup.waitForTimeout(400);
  shots.popupCalculator = await popup.screenshot();

  await popup.evaluate(() => {
    document.querySelector('[data-tab="settings"]').click();
    document.querySelector('main').scrollTop = 0;
  });
  await popup.waitForTimeout(400);
  shots.popupSettings = await popup.screenshot();

  await context.close();
  return shots;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Compose one 1280x800 listing image.
 *
 * The frame takes whatever vertical space the headline leaves and the capture
 * is sized by height, so every screenshot fits the canvas whole rather than
 * running off the bottom edge.
 */
function composite({ headline, sub, image }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 1280px; height: 800px; overflow: hidden; }
    body {
      display: flex; flex-direction: column; align-items: center;
      padding: 44px 40px 34px;
      font-family: ${FONT};
      background: linear-gradient(160deg, #eef2ff 0%, #f0fdfa 55%, #ecfeff 100%);
      color: #0f172a;
    }
    h1 { font-size: 38px; font-weight: 800; letter-spacing: -0.02em; text-align: center; line-height: 1.15; }
    p { margin-top: 11px; font-size: 18px; color: #475569; text-align: center; max-width: 880px; line-height: 1.45; }
    .frame {
      flex: 1; min-height: 0; margin-top: 22px;
      border-radius: 14px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.12);
      border: 1px solid rgba(15, 23, 42, 0.09);
      background: #fff;
    }
    .frame img { display: block; height: 100%; width: auto; max-width: 1180px; }
  </style></head><body>
    <h1>${headline}</h1>
    <p>${sub}</p>
    <div class="frame"><img src="${image}"></div>
  </body></html>`;
}

function promoTile(icon) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 440px; height: 280px; overflow: hidden; }
    body {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; font-family: ${FONT};
      background: linear-gradient(150deg, #4f46e5 0%, #0f766e 100%);
      color: #f8fafc; text-align: center; padding: 24px;
    }
    img { width: 72px; height: 72px; border-radius: 18px; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
    h1 { font-size: 27px; font-weight: 800; letter-spacing: -0.01em; }
    p { font-size: 14px; line-height: 1.45; color: rgba(248,250,252,.86); max-width: 330px; }
  </style></head><body>
    <img src="${icon}">
    <h1>Price Per Dollar</h1>
    <p>The true cost per unit of everything on the page — and what one dollar really buys.</p>
  </body></html>`;
}

function marquee(icon) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 1400px; height: 560px; overflow: hidden; }
    body {
      display: flex; align-items: center; justify-content: center; gap: 56px; padding: 0 90px;
      font-family: ${FONT};
      background: linear-gradient(140deg, #4f46e5 0%, #0f766e 100%);
      color: #f8fafc;
    }
    img { width: 168px; height: 168px; border-radius: 40px; box-shadow: 0 18px 48px rgba(0,0,0,.3); flex: none; }
    h1 { font-size: 62px; font-weight: 800; letter-spacing: -0.02em; }
    p { margin-top: 18px; font-size: 25px; line-height: 1.45; color: rgba(248,250,252,.9); max-width: 720px; }
    .tag { margin-top: 22px; display: inline-block; padding: 8px 16px; border-radius: 999px;
           background: rgba(15,23,42,.28); font-size: 17px; font-weight: 600; }
  </style></head><body>
    <img src="${icon}">
    <div>
      <h1>Price Per Dollar</h1>
      <p>Sticker price tells you what something costs. This tells you what it is worth — the warehouse-club shelf tag, on every store.</p>
      <span class="tag">Runs entirely in your browser · no tracking</span>
    </div>
  </body></html>`;
}

async function renderHtml(page, html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  const size = fs.statSync(file).size;
  console.log(`  ${path.relative(root, file)}  ${width}x${height}  ${(size / 1024).toFixed(0)} kB`);
}

async function main() {
  if (!fs.existsSync(path.join(root, 'dist', 'manifest.json'))) {
    console.error('dist/ is not built — run `npm run build` first.');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { server, port } = await serveFixture();
  let shots;
  try {
    console.log('capturing the interface…');
    shots = await capture(`http://127.0.0.1:${port}/`);
  } finally {
    server.close();
  }

  const icon = dataUri(encodePng(renderIcon(256), 256));

  const pages = [
    {
      file: 'screenshot-1-grid.png',
      headline: 'See what a dollar actually buys',
      sub: 'Every product on the page gets its true cost per unit, and the best value is marked — even when it is the most expensive thing on the shelf.',
      image: dataUri(shots.grid),
    },
    {
      file: 'screenshot-2-ranked.png',
      headline: 'Ranked by value, not by price',
      sub: 'Products are grouped by what they actually are, so olive oil competes with olive oil — and rolls are never ranked against sheets.',
      image: dataUri(shots.popupScan),
    },
    {
      file: 'screenshot-3-analysis.png',
      headline: 'The full value analysis, one click away',
      sub: 'Unit pricing, what one dollar buys under each option, and the purchasing power yield of going bulk.',
      image: dataUri(shots.panel),
    },
    {
      file: 'screenshot-4-calculator.png',
      headline: 'Compare any two options by hand',
      sub: 'Bulk total price, units in the case, single item price. Works on a page that cannot be read — or while you are standing in the aisle.',
      image: dataUri(shots.popupCalculator),
    },
    {
      file: 'screenshot-5-privacy.png',
      headline: 'Nothing ever leaves your browser',
      sub: 'No accounts, no analytics, no price database, no network requests at all. It does not even run on a page until you ask it to.',
      image: dataUri(shots.popupSettings),
    },
  ];

  const context = await chromium.launchPersistentContext(path.join(workDir, 'profile-render'), {
    ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await context.newPage();

  console.log('\nwriting store assets:');
  for (const spec of pages) {
    await renderHtml(page, composite(spec), 1280, 800, path.join(outDir, spec.file));
  }
  await renderHtml(page, promoTile(icon), 440, 280, path.join(outDir, 'promo-tile-440x280.png'));
  await renderHtml(page, marquee(icon), 1400, 560, path.join(outDir, 'marquee-1400x560.png'));

  fs.writeFileSync(path.join(outDir, 'icon-128.png'), encodePng(renderIcon(128), 128));
  console.log(`  ${path.relative(root, path.join(outDir, 'icon-128.png'))}  128x128`);

  await context.close();
  console.log(`\nstore assets in ${path.relative(root, outDir)}/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
