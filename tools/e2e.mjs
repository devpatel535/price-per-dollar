import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * End-to-end test in a real Chromium with the extension actually installed.
 *
 * Two phases, because the extension's privacy posture is as much a feature as
 * its output:
 *
 *   A. the shipped build, with no site permission — it must do nothing at all
 *   B. the same build with localhost granted, exactly as pressing
 *      "Always run here" grants it — it must scan, rank and badge the page
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tools', 'e2e', 'fixture');
const workDir = path.join(root, '.e2e');
const shotDir = path.join(workDir, 'screens');
/**
 * The full Chromium build. The headless shell cannot load extensions, so an
 * explicit path is used where one is pre-installed, and Playwright's own
 * resolution is used otherwise (CI, a developer machine).
 */
const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(PINNED_CHROME) ? PINNED_CHROME : undefined;

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function serveFixture() {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/favicon.ico') {
      // Not serving one would 404 into the console and fail the strict
      // "no console errors" check with noise the extension did not cause.
      res.writeHead(204).end();
      return;
    }
    const file = path.join(fixtureDir, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(fixtureDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'text/plain' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Copy the built extension, optionally granting an origin up front. */
function stageExtension(name, grantedOrigins) {
  const target = path.join(workDir, name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'dist'), target, { recursive: true });
  if (grantedOrigins) {
    const manifestPath = path.join(target, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // Chrome has no API to grant an optional permission without a real click on
    // the toolbar icon, which Playwright cannot drive. Declaring the origin puts
    // the extension in exactly the state it reaches after "Always run here":
    // permissions.getAll() reports it, and the service worker registers its
    // auto-run script from that. The extension's own code is untouched.
    manifest.host_permissions = grantedOrigins;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return target;
}

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function launch(extensionPath, debugPort) {
  const profile = path.join(workDir, `profile-${path.basename(extensionPath)}`);
  fs.rmSync(profile, { recursive: true, force: true });
  return chromium.launchPersistentContext(profile, {
    ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
    ],
  });
}

/**
 * The registration the service worker performs for granted origins.
 *
 * On a brand-new profile the first navigation can beat `onInstalled`, so the
 * test waits for the registration rather than racing it. Chrome persists these
 * across sessions, so a real install only pays this once.
 */
async function registeredScriptIds(context, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const worker = context.serviceWorkers()[0];
    if (worker) {
      try {
        const ids = await worker.evaluate(
          async () => (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id),
        );
        if (ids.length > 0 || Date.now() > deadline) return ids;
      } catch {
        // The worker can be mid-restart; try again.
      }
    }
    if (Date.now() > deadline) return [];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function extensionId(context) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) return new URL(worker.url()).host;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const overlay = (page) => page.locator('[data-ppd-overlay]');

/**
 * Everything the extension draws lives in an open shadow root. Reaching into
 * it directly is unambiguous, where a selector engine's shadow-piercing rules
 * are a second thing that can be wrong.
 */
const inShadow = (page, selector, action) => page.evaluate(
  ({ sel, act }) => {
    const shadow = document.querySelector('[data-ppd-overlay]')?.shadowRoot;
    if (!shadow) return act === 'count' ? 0 : null;
    if (act === 'count') return shadow.querySelectorAll(sel).length;
    if (act === 'text') return shadow.querySelector(sel)?.textContent ?? null;
    if (act === 'texts') return [...shadow.querySelectorAll(sel)].map((node) => node.textContent);
    if (act === 'click') {
      const node = shadow.querySelector(sel);
      if (!node) return null;
      node.click();
      return true;
    }
    return null;
  },
  { sel: selector, act: action },
);

const countIn = (page, selector) => inShadow(page, selector, 'count');
const textIn = (page, selector) => inShadow(page, selector, 'text');
const badges = (page) => ({ count: () => countIn(page, '.badge') });

async function waitInShadow(page, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await countIn(page, selector) > 0) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(200);
  }
}

async function phaseA(url) {
  console.log('\nPhase A — shipped build, no site permission granted');
  const extension = stageExtension('extension-default', null);
  const debugPort = await freePort();
  const context = await launch(extension, debugPort);
  try {
    const id = await extensionId(context);
    check('service worker booted', !!id, 'no service worker appeared');

    const registered = await registeredScriptIds(context, 4000);
    check('no auto-run script registered without a granted origin',
      registered.length === 0, `registered: ${JSON.stringify(registered)}`);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    check('no overlay injected on an unpermitted site', await overlay(page).count() === 0);
    check('no badges drawn', await badges(page).count() === 0);

    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    check('shipped manifest declares no host permissions', manifest.host_permissions === undefined);
    await page.screenshot({ path: path.join(shotDir, '1-before-untouched.png') });

    // The popup opened programmatically does not receive `activeTab` — only a
    // genuine click on the toolbar icon does — so injection fails here. What is
    // being checked is that the popup says something true and actionable about
    // that, rather than claiming this is not a shopping page. Chrome hides
    // `tab.url` until the extension is invoked, and an earlier version read
    // that absence as "not a web page" and gave up on real storefronts.
    await page.bringToFront();
    const worker = context.serviceWorkers()[0];
    const opened = await worker.evaluate(async () => {
      if (!chrome.action.openPopup) return 'unsupported';
      try {
        await chrome.action.openPopup();
        return 'opened';
      } catch (error) {
        return `error: ${String(error)}`;
      }
    });

    if (opened === 'opened') {
      await page.waitForTimeout(2500);
      let remote = null;
      try {
        remote = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
        const popup = remote.contexts()
          .flatMap((ctx) => ctx.pages())
          .find((candidate) => candidate.url().includes('/popup/index.html'));
        if (popup) {
          const status = (await popup.locator('#scan-status').textContent()) ?? '';
          check('popup does not mistake a storefront for an unscannable page',
            !/Open a shopping page/i.test(status), status);
          check('popup explains how to grant access instead',
            /Always run here|toolbar icon/i.test(status), status);
        } else {
          console.log('  · popup target not reachable; diagnostic check skipped');
        }
      } catch (error) {
        console.log(`  · popup target not reachable (${String(error).split('\n')[0]})`);
      } finally {
        await remote?.close().catch(() => undefined);
      }
    } else {
      console.log(`  · chrome.action.openPopup unavailable (${opened}); diagnostic check skipped`);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function phaseB(url, productUrl) {
  console.log('\nPhase B — same build with localhost granted ("Always run here")');
  const extension = stageExtension('extension-granted', ['http://127.0.0.1/*', 'http://localhost/*']);
  const context = await launch(extension, null);
  try {
    const id = await extensionId(context);
    check('service worker booted', !!id);

    const registered = await registeredScriptIds(context);
    check('auto-run script registered for the granted origin',
      registered.includes('ppd-auto'), `registered: ${JSON.stringify(registered)}`);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(url, { waitUntil: 'load' });
    // The overlay host is deliberately a zero-size anchor at the document
    // origin, so it is attached but never "visible" in Playwright's sense.
    await overlay(page).first().waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForFunction(
      () => (document.querySelector('[data-ppd-overlay]')?.shadowRoot?.querySelectorAll('.badge').length ?? 0) > 0,
      null,
      { timeout: 15000 },
    );
    await page.waitForTimeout(1200);

    const count = await badges(page).count();
    check('badges drawn on the grid', count >= 10, `only ${count}`);

    const bestText = await textIn(page, '.badge.best');
    check('a best-value badge is present', !!bestText, 'none found');

    // The 3 L tin at $32.99 is $1.10 / 100 mL — the cheapest oil on the page.
    const oilBest = await inShadow(page, '.badge.best', 'texts');
    check('olive oil ranks the 3 L tin best at $1.10 / 100 mL',
      oilBest.some((text) => text.includes('$1.10') && text.includes('100 mL')),
      JSON.stringify(oilBest));

    check('the struck-through was-price was ignored',
      oilBest.join(' ').includes('$1.10'));

    const outlines = await countIn(page, '.outline');
    check('best-value cards are outlined', outlines >= 2, `${outlines} outlines`);

    const pill = await countIn(page, '.pill');
    check('summary pill rendered', pill === 1, `${pill} pills`);

    check('page produced no console errors', errors.length === 0, errors.join(' | '));

    await page.screenshot({ path: path.join(shotDir, '2-grid-badges.png') });
    await page.screenshot({ path: path.join(shotDir, '3-grid-badges-full.png'), fullPage: true });

    // Open the value analysis panel from a badge.
    await inShadow(page, '.badge', 'click');
    check('clicking a badge opens the analysis panel', await waitInShadow(page, '.panel', 5000));
    const panelText = await textIn(page, '.panel');
    check('panel shows the unit pricing section', /Unit pricing comparison/i.test(panelText));
    check('panel shows the dollar-for-dollar section', /Dollar-for-dollar value/i.test(panelText));
    check('panel shows the purchasing power section', /Purchasing power yield/i.test(panelText));
    check('panel quotes a purchasing power multiplier', /\d+\.\d\dx/.test(panelText), panelText?.slice(0, 200));
    await page.screenshot({ path: path.join(shotDir, '4-analysis-panel.png') });

    // A product detail page, where the item comes from JSON-LD.
    const pdp = await context.newPage();
    await pdp.goto(productUrl, { waitUntil: 'load' });
    await pdp.waitForTimeout(2500);
    const pdpBadges = await badges(pdp).count();
    check('product page scanned via JSON-LD', pdpBadges >= 1, `${pdpBadges} badges`);
    await pdp.screenshot({ path: path.join(shotDir, '5-product-page.png') });
    await pdp.close();

    // The real toolbar popup is browser UI that Playwright cannot attach to, so
    // the popup page is opened in a background tab instead and the storefront
    // is brought to the front. `chrome.tabs.query({active: true})` then returns
    // the storefront exactly as it would for the real popup, and pressing the
    // popup's own Rescan button drives the genuine scan path.
    const scanTab = await context.newPage();
    await scanTab.setViewportSize({ width: 400, height: 580 });
    await scanTab.goto(`chrome-extension://${id}/popup/index.html`);
    await scanTab.waitForTimeout(500);
    await page.bringToFront();
    await scanTab.evaluate(() => document.getElementById('rescan').click());
    await scanTab.waitForFunction(
      () => document.querySelectorAll('.group .row').length > 0,
      null,
      { timeout: 10000 },
    ).catch(() => undefined);

    const rows = await scanTab.locator('.group .row').count();
    check('popup lists the ranked results for the page', rows >= 8, `${rows} rows`);
    const scanStatus = await scanTab.locator('#scan-status').textContent();
    check('popup reports what could not be ranked',
      /without a readable size/.test(scanStatus ?? ''), scanStatus ?? '');
    await scanTab.screenshot({ path: path.join(shotDir, '6-popup-scan-tab.png'), fullPage: true });
    await scanTab.close();

    // The popup, rendered as a page.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 580 });
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await popup.waitForTimeout(1200);

    await popup.getByRole('tab', { name: 'Calculator' }).click();
    await popup.waitForTimeout(600);
    const calcText = await popup.locator('#calculator-output').textContent();
    check('calculator computes on open', /Purchasing power yield/i.test(calcText ?? ''), calcText?.slice(0, 120));
    check('calculator reports the 24-can case multiplier',
      /2\.26x/.test(calcText ?? ''), calcText?.slice(0, 200));
    await popup.screenshot({ path: path.join(shotDir, '7-popup-calculator.png'), fullPage: true });

    await popup.getByRole('tab', { name: 'Settings' }).click();
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(shotDir, '8-popup-settings.png'), fullPage: true });
    await popup.close();
  } finally {
    await context.close();
  }
}

async function main() {
  if (!fs.existsSync(path.join(root, 'dist', 'manifest.json'))) {
    console.error('dist/ is not built — run `npm run build` first.');
    process.exit(1);
  }
  fs.rmSync(shotDir, { recursive: true, force: true });
  fs.mkdirSync(shotDir, { recursive: true });

  const { server, port } = await serveFixture();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`fixture storefront at ${url}`);

  try {
    await phaseA(url);
    await phaseB(url, `${url}product.html`);
  } finally {
    server.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  console.log(`screenshots in ${path.relative(root, shotDir)}/`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
