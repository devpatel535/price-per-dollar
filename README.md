# Price Per Dollar

A Chrome extension that reads every price on a shopping page, works out what
each product actually costs per unit, and tells you what one dollar buys.

Honey finds coupons. This finds value — the warehouse-club shelf tag, on every
site, computed in your browser and shown next to the thing you are looking at.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Olive Oil 250 ml            │   │  Olive Oil 3 L               │
│  $6.49                       │   │  $32.99                      │
│                              │   │                              │
│  ┌────────────────────────┐  │   │  ┌────────────────────────┐  │
│  │ $2.60 / 100 mL         │  │   │  │ $1.10 / 100 mL         │  │
│  │ $1.00 = 38.5 mL        │  │   │  │ $1.00 = 90.9 mL        │  │
│  │ 2.36x THE BEST RATE    │  │   │  │ BEST VALUE             │  │
│  └────────────────────────┘  │   │  └────────────────────────┘  │
└──────────────────────────────┘   └──────────────────────────────┘
        cheapest sticker                    cheapest product
```

The $6.49 bottle is the cheaper thing to buy. The $32.99 bottle is the cheaper
oil, by a factor of 2.36. That gap is the entire point of the extension.

## What it does

- **Scans every product rendered on the page** — search results, category grids,
  product pages — and reads a price, a title and a size from each.
- **Normalises sizes to a common base** so a 1.5 lb bag and a 680 g bag are
  directly comparable, and so are `24 x 12 fl oz` and `2 L`.
- **Ranks by cost per unit, not sticker price**, and marks the best value in
  each group of comparable products.
- **Shows what one dollar buys** under each option, and the purchasing power
  multiplier of going bulk.
- **Never talks to the network.** No accounts, no analytics, no price database,
  nothing leaves the browser.

## The value analysis

Click any badge, or use the calculator in the popup, and you get the full
report. Given `Bulk Total Price`, `Number of Units in Case` and
`Single Item Price`:

### Unit Pricing Comparison Table

| Option | Total Volume / Quantity | Total Cost | Unit Cost (per item) | Cost per 100 mL |
| --- | --- | --- | --- | --- |
| **24-can case** (bulk) | 8,517 mL (24 × 354.9 mL) | $18.99 | $0.79 | $0.22 |
| **Single can** (single) | 354.9 mL | $1.79 | $1.79 | $0.50 |

### Dollar-for-Dollar Value Analysis

Spending the bulk total of **$18.99** on single items at $1.79 each buys
**10.61 items** (**10 whole items** in practice), against **24 items** in the case.

What $1.00 buys:

| Method | items per $1.00 | mL per $1.00 |
| --- | --- | --- |
| **24-can case** | 1.26 | 448.51 |
| **Single can** | 0.56 | 198.26 |

### Purchasing Power Yield

- **Purchasing power multiplier:** 2.26x — every dollar spent on the case goes
  2.26x as far as the same dollar spent on singles.
- **Value gained:** 126.22% more product for the same money.
- **Discount off the single-item rate:** 55.80%.
- **Saving per item:** $1.00.
- **Total saved across the 24-item case:** $23.97.
- **Extra items for the same spend:** 13.39.

Based on regular shelf pricing only — manufacturer coupons, seasonal flyers and
loyalty tier discounts are deliberately excluded.

When the two options do not hold the same individual unit — a 1.5 L bottle
against a 330 ml can — per-item savings go negative even though the pack is
much better value. The report notices, says so, and switches the whole
narrative to measure (saving per 100 mL, extra mL for the same spend) rather
than printing two figures that contradict each other.

Two figures in that last section are routinely confused and are reported
separately here: halving the unit cost is a **50% discount** but a **2.00x
multiplier**, or 100% more product for your money. Both are true; they answer
different questions.

## Install

No published store listing yet, so load it unpacked:

```bash
git clone https://github.com/devpatel535/price-per-dollar.git
cd price-per-dollar
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

Open any shopping page and click the toolbar icon (or press <kbd>Alt</kbd>
<kbd>Shift</kbd><kbd>P</kbd>).

To build an upload-ready archive for the Chrome Web Store:

```bash
npm run package   # writes release/price-per-dollar-<version>.zip
```

## Permissions, and why there are so few

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you are looking at, only when you invoke the extension |
| `scripting` | Inject the scanner into that tab |
| `storage` | Remember your settings |
| `optional_host_permissions` | Requested per site, only if you press **Always run here** |

There are no static `content_scripts` and no `host_permissions` in the
manifest. Out of the box the extension does nothing until you click the icon.
If you want it to run automatically on a site you use often, grant that one
site permanently from the popup's Settings tab — and revoke it there too.

## How it works

```
page ──► scan cascade ──► normalise ──► group ──► rank ──► overlay + popup
          │
          ├─ structured   schema.org JSON-LD, microdata, og/product meta
          ├─ adapters     selector maps for 11 large retailers
          └─ heuristic    selector-free DOM walk (the long tail)
```

All three tiers run and their findings are **merged**, not first-wins:
structured data usually has the best title and size, but only the DOM tiers
know which element to pin a badge to.

### Reading a size

This is where the accuracy lives, and it is deliberately conservative — it
returns nothing rather than inventing a size. It handles:

| Label | Reading |
| --- | --- |
| `24 x 12 fl oz` | 24 units, 8517.18 mL total |
| `12 fl oz Cans, 24 Pack` | same |
| `Pack of 6, 60 g each` | 6 units, 360 g |
| `2 lb 4 oz` | 1020.58 g (compound) |
| `1.5 lb (680 g)` | 680.39 g (parenthetical restatement, not multiplied) |
| `30 Rolls, 425 Sheets per Roll` | 12,750 sheets, pack of 30 |
| `24 Family Mega Rolls` | 24 rolls (count noun separated by adjectives) |
| `200 mg, 300 tablets` | 60 g, 200 mg a tablet |
| `8 packs, 42 wipes each` | 336 wipes, pack of 8 |
| `40 bottles, 16.9 fl oz` | 19992 mL — a bottle's capacity multiplies by the count |
| `48 pieces, 600 g` | 600 g — a box's weight does **not** multiply by the count |
| `154 fl oz (96 loads)` | 4554 mL — a usage yield is **not** a pack multiplier |
| `Wireless Mouse` | nothing; the item is listed but not ranked |

Whether a pack count multiplies a stated size is the crux of the whole parser,
and it turns on the noun. A size written before its count is per item
(`12 fl oz, 24 pack`), as is one marked `each`. Otherwise only a *container*
noun implies the measure describes one of the things: forty bottles of 16.9 fl
oz is forty times that, while forty-eight chocolates in a 600 g box is not.

### Deciding what compares with what

Items are bucketed by physical dimension, then clustered by title similarity,
so bulk rice never "beats" an avocado. Count nouns are kept distinct: a pack
measured in **rolls** is never ranked against one measured in **sheets**, even
though both are counts. When a label states both (`30 rolls, 425 sheets per
roll`), the group ranks in whichever basis the most members can express.

Switch to **Whole page** mode in Settings for a single leaderboard per unit
type when that is what you actually want.

### Choosing the unit prices are quoted in

Unit prices are always shown to exactly two decimals, so the quantum matters.
Quoting olive oil per millilitre prints `$0.01` for every bottle on the shelf —
non-zero, and useless. The display base climbs a ladder (`g` → `100 g` → `kg`)
until the cheapest item in the group reaches a dime, where two decimals still
carry two significant figures.

### Which price on the card is the price

Struck-through was-prices, printed unit prices (`$0.42/oz`), shipping, savings
and financing figures are all discarded before choosing. Of what remains the
lowest is taken, which lands on the sale price when a was/now pair carries no
markup to distinguish them.

## Site support

Structured data and the generic heuristic engine work anywhere. Tuned selector
maps additionally ship for Amazon, Walmart, Target, Costco, Sam's Club, Kroger
(and its banners), Best Buy, Instacart, Tesco and Sainsbury's.

Those selector maps are **best-effort and unverified against live sites** — large
retailers redesign constantly. They are additive hints: when one stops matching
it contributes nothing and the generic engine carries the page. If a site reads
badly, the fix is usually one entry in `src/extract/adapters/index.ts`.

## Currencies and units

Prices are parsed in any of ~40 currencies, including the awkward parts:
prefixed and suffixed symbols, `1,234.56` against `1.234,56`, space-grouped
`1 234,56`, and cents (`42¢`). Comparisons only ever happen within one
currency — there is no exchange-rate conversion and no pretending there is.

Units cover mass, volume, count, length and area. US and imperial customary
units share spellings but not values, so `fl oz`, `pint`, `quart` and `gallon`
resolve against the page: `.co.uk` and GBP pages read as imperial, and you can
force either system in Settings.

## Development

```bash
npm install
npm run build          # bundle into dist/
npm run build:watch    # rebuild on change
npm run test           # builds, then runs the suite
npm run typecheck      # tsc --noEmit
npm run verify         # typecheck + test
npm run e2e            # load the extension into real Chromium and drive it
npm run icons          # regenerate assets/icons from the vector mark
node tools/generate-icons.mjs --preview 32   # ASCII preview of the icon
```

### Testing in a real browser

`npm run e2e` serves a fixture storefront, installs the built extension into
Chromium and drives it, writing screenshots to `.e2e/screens/`. It runs in two
phases, because the privacy posture is as much a feature as the output:

- **Phase A** loads the shipped build with no site permission and asserts the
  extension registers nothing and injects nothing.
- **Phase B** loads the same build with localhost granted — exactly the state
  pressing *Always run here* produces — and asserts it scans, ranks, badges,
  outlines the winner, opens the analysis panel, reads a JSON-LD product page,
  and drives the popup, with no console errors.

Chrome has no API to grant an optional permission without a real click on the
toolbar icon, which no automation can drive, so phase B declares the origin in
a copy of the manifest. The extension's own code is untouched.

```
src/
  core/       pure domain logic — no DOM, no chrome APIs, fully unit-tested
    units       unit registry, dimensions, US/imperial resolution
    money       price parsing and separator disambiguation
    quantity    size parsing from real retail labels
    normalize   cost per base unit, display-base selection
    compare     the three-section value analysis
    group       dimension bucketing and title clustering
  extract/    turning a page into products (structured / adapters / heuristic)
  content/    the on-page overlay, in a shadow root
  popup/      results, calculator, settings
  background/ service worker: permissions and the toolbar badge
  ui/         DOM rendering shared by the overlay and the popup
```

`core/` is deliberately free of DOM and extension APIs — the arithmetic users
trust us with is testable in isolation from the messy business of scraping
retail pages.

## Limitations

- **Sizes are only as good as the label.** Products that state no size are
  listed but not ranked; the popup tells you how many those were.
- **Adapter selectors will rot.** By design this degrades to the generic engine
  rather than breaking.
- **No cross-store lookup.** The extension compares what is on your screen. It
  cannot tell you the same item is cheaper elsewhere — that would need a
  backend, which would end the "nothing leaves your browser" guarantee.
- **Shelf price only.** Coupons, loyalty tiers and flyer promotions are out of
  scope on purpose, so the comparison stays like-for-like.
- **Per-item cost across different unit sizes is flagged, not hidden.** A 12 oz
  can and a 20 oz bottle are not the same "unit"; the analysis says so and
  founds its verdict on cost per measure instead.

## Privacy

No network requests, no analytics, no remote code, no accounts. See
[PRIVACY.md](PRIVACY.md).

## Licence

MIT — see [LICENSE](LICENSE).
