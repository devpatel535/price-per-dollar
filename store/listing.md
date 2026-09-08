# Chrome Web Store listing

Copy for the store submission, kept in the repository so it stays in step with
what the extension actually does.

## Name

Price Per Dollar

## Short description (132 characters max)

> See the true cost per unit of everything on the page, and exactly what one dollar buys. Runs entirely in your browser.

(118 characters.)

## Category

Shopping

## Detailed description

**Sticker price tells you what something costs. It does not tell you what it is
worth.**

Price Per Dollar reads every product on the page you are looking at, works out
what each one really costs per unit, and marks the best value in each group of
comparable products — the warehouse-club shelf tag, on every store.

**What you get**

• A badge on every product showing its cost per unit — per 100 mL, per kg, per
sheet, whatever suits the shelf.
• What one dollar actually buys under each option.
• The best value in each group of comparable products, highlighted.
• A full value analysis on demand: unit pricing comparison table,
dollar-for-dollar value, and purchasing power yield — copyable as a report.
• A calculator for comparing two options by hand, wherever you are.

**It compares like with like**

Ranking every price on a page against every other produces confident nonsense.
Price Per Dollar buckets products by what they are measured in, clusters them
by what they are, and only then names a winner. A pack counted in rolls is
never ranked against one counted in sheets. Bulk rice never "beats" an avocado.

**It reads real labels**

24 x 12 fl oz. Pack of 6, 60 g each. 2 lb 4 oz. 1.5 lb (680 g). 30 rolls, 425
sheets per roll. 154 fl oz (96 loads) — which is a usage yield, not a pack
multiplier, and is not multiplied.

**Nothing leaves your browser**

No accounts. No analytics. No tracking. No price database. No network requests
of any kind. Every calculation happens locally, and the extension does not run
on any page until you click the icon — there are no host permissions in the
manifest at all. If you want it to run automatically on a store you use often,
grant that one site permanently, and revoke it whenever you like.

Works anywhere, with additional tuning for Amazon, Walmart, Target, Costco,
Sam's Club, Kroger, Best Buy, Instacart, Tesco and Sainsbury's.

Regular shelf pricing only — coupons, flyers and loyalty tiers are excluded so
the comparison stays honest.

Open source, MIT licensed.

## Permission justifications

**activeTab** — Reads the prices, titles and sizes on the page the user is
looking at, only when the user clicks the toolbar icon or presses the keyboard
shortcut. This is what the extension exists to do.

**scripting** — Injects the page scanner into the active tab on user
invocation, and registers an auto-run script for sites the user has explicitly
granted permanent access to.

**storage** — Persists the user's own settings: badge visibility, comparison
mode, grouping strictness, measurement system, and the list of sites they have
switched the extension off for.

**Optional host permissions (`*://*/*`)** — Never granted at install. Requested
one site at a time, only when the user presses "Always run here", so the
extension can rank that store without the user opening the popup first.

**Remote code** — None. All code is bundled in the package.

## Data usage disclosures

- Does the extension collect personally identifiable information? **No.**
- Health information? **No.**
- Financial and payment information? **No.**
- Authentication information? **No.**
- Personal communications? **No.**
- Location? **No.**
- Web history? **No.**
- User activity? **No.**
- Website content? **No data is collected or transmitted.** Page content is
  read in the tab to compute unit prices and is never sent anywhere or stored.

Certifications:

- Data is not sold to third parties. **Confirmed.**
- Data is not used or transferred for purposes unrelated to the item's single
  purpose. **Confirmed.**
- Data is not used or transferred to determine creditworthiness or for lending
  purposes. **Confirmed.**

## Single purpose

Price Per Dollar has one purpose: to calculate and display the true cost per
unit of products shown on a shopping page, so the user can compare their value.

## Privacy policy URL

https://github.com/devpatel535/price-per-dollar/blob/main/PRIVACY.md

## Screenshot plan (1280x800)

1. A grocery category grid with badges on every product and the best value
   outlined.
2. The value analysis panel open over a product, showing all three sections.
3. The popup's "This page" tab with grouped, ranked results.
4. The popup's calculator with a worked bulk-versus-single comparison.
5. The popup's settings tab, showing the per-site permission controls.
