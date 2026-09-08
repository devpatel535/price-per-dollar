# Changelog

All notable changes to Price Per Dollar are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-08

First release.

### Added

- Scans every product rendered on a shopping page and ranks it by true cost
  per unit rather than sticker price.
- Three-tier extraction: schema.org structured data, tuned selector maps for
  eleven large retailers, and a selector-free DOM engine for everywhere else.
- Size parsing for real retail labels — multipliers (`24 x 12 fl oz`), pack
  counts, compound sizes (`2 lb 4 oz`), parenthetical restatements, and stated
  per-container yields (`30 rolls, 425 sheets per roll`).
- Price parsing across ~40 currencies, including comma-decimal and
  space-grouped notation, and cent suffixes.
- On-page badges showing cost per display unit, what one currency unit buys,
  and how each item compares with the best in its group.
- Full value analysis on demand: unit pricing comparison table,
  dollar-for-dollar value, and purchasing power yield, copyable as Markdown.
- Manual calculator in the popup for pages that cannot be read.
- Smart grouping so only comparable products are ranked against each other,
  with a whole-page mode as an alternative.
- US and imperial customary unit resolution, inferred from the page or forced
  in settings.
- Per-site controls: grant permanent access, or switch the extension off.

### Security and privacy

- No network requests, analytics, remote code or accounts.
- Manifest requests only `storage`, `activeTab` and `scripting`; broad host
  access is optional and requested per site.
