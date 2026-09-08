import { beforeAll, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/extract/scan.ts';

/**
 * jsdom performs no layout, so every rect is zero and the extractor's
 * "is this actually rendered" check would reject the whole page. Give elements
 * a plausible box so the rest of the pipeline can be exercised honestly.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function fakeRect(this: Element) {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 260, width: 200, height: 260 };
    return { ...rect, toJSON: () => rect } as DOMRect;
  };
});

function render(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const GRID = `
  <div class="grid">
    <div class="card">
      <a class="title" href="/p/1">Extra Virgin Olive Oil 250 ml</a>
      <span class="price">$4.99</span>
    </div>
    <div class="card">
      <a class="title" href="/p/2">Extra Virgin Olive Oil 1 L</a>
      <span class="price">$12.99</span>
    </div>
    <div class="card">
      <a class="title" href="/p/3">Extra Virgin Olive Oil 3 L</a>
      <span class="price">$29.99</span>
    </div>
    <div class="card">
      <a class="title" href="/p/4">Bounty Paper Towels 12 Rolls</a>
      <span class="price">$24.49</span>
    </div>
  </div>
`;

describe('scanDocument — product grid', () => {
  it('finds one item per card', () => {
    const { summary } = scanDocument(render(GRID));
    expect(summary.items).toHaveLength(4);
    expect(summary.items.map((i) => i.price.amount).sort((a, b) => a - b))
      .toEqual([4.99, 12.99, 24.49, 29.99]);
  });

  it('does not treat the grid container as a product', () => {
    const { summary } = scanDocument(render(GRID));
    expect(summary.items.every((item) => !item.title.includes('Paper Towels 12 Rolls$'))).toBe(true);
    expect(summary.items.filter((item) => item.title.includes('Olive Oil'))).toHaveLength(3);
  });

  it('groups the oils together and leaves paper towels out of it', () => {
    const { summary } = scanDocument(render(GRID));
    const oil = summary.groups.find((g) => g.members.length === 3);
    expect(oil).toBeDefined();
    expect(oil!.members.every((m) => m.item.title.includes('Olive Oil'))).toBe(true);
  });

  it('names the 3 L bottle best value even though it costs the most', () => {
    const { summary } = scanDocument(render(GRID));
    const oil = summary.groups.find((g) => g.members.length === 3)!;
    expect(oil.best.item.title).toContain('3 L');
    expect(oil.display.label).toBe('100 mL');
  });

  it('keeps a handle on the element each item came from', () => {
    const { scanned } = scanDocument(render(GRID));
    expect(scanned).toHaveLength(4);
    expect(scanned.every((item) => item.element.classList.contains('card'))).toBe(true);
  });
});

describe('scanDocument — price disambiguation', () => {
  const card = (inner: string) => `<div class="grid"><div class="card">${inner}</div><div class="card"></div></div>`;

  it('ignores a struck-through was-price and the printed unit price', () => {
    const { summary } = scanDocument(render(card(`
      <a class="title" href="/p/1">Kirkland Almond Butter 27 oz</a>
      <del class="was">$14.99</del>
      <span class="price">$9.99</span>
      <span class="unit">($0.42/oz)</span>
    `)));
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]!.price.amount).toBe(9.99);
    expect(summary.items[0]!.siteUnitPrice).toContain('0.42');
  });

  it('ignores shipping and savings figures', () => {
    const { summary } = scanDocument(render(card(`
      <a class="title" href="/p/1">Organic Maple Syrup 500 ml</a>
      <span class="price">$18.50</span>
      <span class="ship">+ $5.99 shipping</span>
      <span class="save">Save $3.00</span>
    `)));
    expect(summary.items[0]!.price.amount).toBe(18.5);
  });

  it('takes the sale price when a was/now pair carries no markup', () => {
    const { summary } = scanDocument(render(card(`
      <a class="title" href="/p/1">Coffee Beans 1 kg</a>
      <span class="old">$24.99</span>
      <span class="price">$19.99</span>
    `)));
    expect(summary.items[0]!.price.amount).toBe(19.99);
  });
});

describe('scanDocument — structured data', () => {
  it('reads a JSON-LD product and pins it to the rendered price', () => {
    const doc = render(`
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Kirkland Signature Almond Butter, 27 oz',
        offers: { '@type': 'Offer', price: '13.49', priceCurrency: 'USD' },
      })}</script>
      <div class="grid">
        <div class="card">
          <h1 class="title">Kirkland Signature Almond Butter, 27 oz</h1>
          <span class="price">$13.49</span>
        </div>
        <div class="card"></div>
      </div>
    `);
    const { summary, scanned } = scanDocument(doc);
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({ source: 'structured', price: { amount: 13.49 } });
    expect(summary.items[0]!.quantity?.dimension).toBe('mass');
    // Structured data supplied the item; the DOM tier supplied somewhere to pin it.
    expect(scanned).toHaveLength(1);
  });

  it('survives malformed JSON-LD without losing the page', () => {
    const doc = render(`
      <script type="application/ld+json">{ not valid json </script>
      ${GRID}
    `);
    expect(scanDocument(doc).summary.items).toHaveLength(4);
  });
});

describe('scanDocument — nothing to find', () => {
  it('returns an empty scan rather than throwing', () => {
    const { summary } = scanDocument(render('<div><p>No prices here at all.</p></div>'));
    expect(summary.items).toHaveLength(0);
    expect(summary.groups).toHaveLength(0);
  });

  it('counts items whose size could not be read', () => {
    const { summary } = scanDocument(render(`
      <div class="grid">
        <div class="card"><a class="title" href="/p/1">Wireless Mouse Model X</a><span>$24.99</span></div>
        <div class="card"><a class="title" href="/p/2">Mechanical Keyboard Pro</a><span>$89.99</span></div>
      </div>
    `));
    expect(summary.items).toHaveLength(2);
    expect(summary.unsizedCount).toBe(2);
    expect(summary.groups).toHaveLength(0);
  });
});
