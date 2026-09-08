import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end smoke test against the built artefact.
 *
 * The unit tests cover the engine; this one proves the bundle Chrome actually
 * loads boots, scans, and draws badges, with only the extension APIs stubbed.
 */

const distDir = path.resolve(__dirname, '..', 'dist');
const contentBundle = path.join(distDir, 'content', 'index.js');

let bundleSource = '';
let sentMessages: unknown[] = [];

beforeAll(() => {
  if (!fs.existsSync(contentBundle)) {
    throw new Error('dist/ is not built — run `npm run build` before the tests.');
  }
  bundleSource = fs.readFileSync(contentBundle, 'utf8');

  Element.prototype.getBoundingClientRect = function fakeRect(this: Element) {
    const rect = { x: 0, y: 0, top: 10, left: 10, right: 210, bottom: 270, width: 200, height: 260 };
    return { ...rect, toJSON: () => rect } as DOMRect;
  };
});

beforeEach(() => {
  sentMessages = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: { get: async () => ({}), set: async () => undefined },
      local: { get: async () => ({}), set: async () => undefined },
    },
    runtime: {
      onMessage: { addListener: () => undefined },
      sendMessage: (message: unknown) => { sentMessages.push(message); },
    },
  };
  document.body.innerHTML = '';
  document.documentElement.querySelectorAll('[data-ppd-overlay]').forEach((node) => node.remove());
  delete (window as unknown as Record<string, unknown>)['__pricePerDollarRuntime'];
});

function runBundle(): void {
  // The bundle is an IIFE, so evaluating it runs the content script.
  new Function(bundleSource)();
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SHOP = `
  <div class="grid">
    <div class="card">
      <a class="title" href="/p/1">Kirkland Extra Virgin Olive Oil 250 ml</a>
      <span class="price">$6.49</span>
    </div>
    <div class="card">
      <a class="title" href="/p/2">Kirkland Extra Virgin Olive Oil 1 L</a>
      <span class="price">$14.99</span>
    </div>
    <div class="card">
      <a class="title" href="/p/3">Kirkland Extra Virgin Olive Oil 3 L</a>
      <span class="price">$32.99</span>
    </div>
  </div>
`;

describe('built content script', () => {
  it('boots, scans and draws a badge on every ranked product', async () => {
    document.body.innerHTML = SHOP;
    runBundle();
    await flush();

    const host = document.documentElement.querySelector('[data-ppd-overlay]');
    expect(host).not.toBeNull();
    const badges = host!.shadowRoot!.querySelectorAll('.badge');
    expect(badges).toHaveLength(3);
  });

  it('marks the largest bottle best value and quotes a per-100 mL rate', async () => {
    document.body.innerHTML = SHOP;
    runBundle();
    await flush();

    const shadow = document.documentElement.querySelector('[data-ppd-overlay]')!.shadowRoot!;
    const best = shadow.querySelector('.badge.best');
    expect(best).not.toBeNull();
    expect(best!.textContent).toContain('/ 100 mL');
    // $32.99 for 3 L is $1.10 per 100 mL and the cheapest rate on the page.
    expect(best!.textContent).toContain('$1.10');
    expect(shadow.querySelectorAll('.badge .tag')[0]?.textContent).toBe('Best value');
  });

  it('reports the scan to the background page', async () => {
    document.body.innerHTML = SHOP;
    runBundle();
    await flush();

    expect(sentMessages).toHaveLength(1);
    const message = sentMessages[0] as { type: string; summary: { items: unknown[] } };
    expect(message.type).toBe('PPD_SCAN_RESULT');
    expect(message.summary.items).toHaveLength(3);
  });

  it('does not stack a second overlay when injected twice', async () => {
    document.body.innerHTML = SHOP;
    runBundle();
    await flush();
    runBundle();
    await flush();

    expect(document.documentElement.querySelectorAll('[data-ppd-overlay]')).toHaveLength(1);
    expect(document.documentElement.querySelector('[data-ppd-overlay]')!
      .shadowRoot!.querySelectorAll('.badge')).toHaveLength(3);
  });

  it('stays quiet on a page with no products', async () => {
    document.body.innerHTML = '<main><h1>About us</h1><p>We sell things.</p></main>';
    runBundle();
    await flush();

    const host = document.documentElement.querySelector('[data-ppd-overlay]');
    expect(host!.shadowRoot!.querySelectorAll('.badge')).toHaveLength(0);
    expect(host!.shadowRoot!.querySelector('.pill')).toBeNull();
  });
});

describe('built manifest', () => {
  it('declares a valid, minimal-permission MV3 extension', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Price Per Dollar');
    expect(manifest.description.length).toBeLessThanOrEqual(132);

    // Broad host access is optional and requested per site, never granted upfront.
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['*://*/*']);
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('ships every file the manifest points at', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
    const referenced = [
      manifest.background.service_worker,
      manifest.action.default_popup,
      ...Object.values(manifest.icons) as string[],
      'content/index.js',
      'popup/popup.js',
      'popup/popup.css',
    ];
    for (const file of referenced) {
      expect(fs.existsSync(path.join(distDir, file)), `missing ${file}`).toBe(true);
    }
  });
});
