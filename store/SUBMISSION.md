# Publishing Price Per Dollar to the Chrome Web Store

Everything needed to submit, in the order the developer dashboard asks for it.
Text in blockquotes is meant to be pasted verbatim.

---

## 0. Before you start

| Requirement | Status |
| --- | --- |
| Chrome Web Store developer account | **You must create this** — <https://chrome.google.com/webstore/devconsole> |
| One-time registration fee (US $5) | **You must pay this** — the account cannot publish until you do |
| Verified contact email on the account | **You must do this** — Google requires it before publishing |
| A publicly reachable privacy policy URL | Done — see step 1 (repository is public) |
| Packaged extension `.zip` | `npm run package` |
| Listing images | `npm run store:assets` |

The first three rows are yours to do — they need a person, a card and an
inbox. Everything else is already prepared.

---

## 1. Privacy policy URL — already sorted

The store requires a privacy policy at a URL Google can load anonymously,
because the extension reads page content. `PRIVACY.md` is written, accurate,
and already public: the repository is public, so use

> https://github.com/devpatel535/price-per-dollar/blob/HEAD/PRIVACY.md

**Use the `HEAD` form, not `main`.** This repository's default branch is
`claude/price-per-dollar-extension-d8cldn`, so a `/blob/main/` URL returns 404
today — and a 404 policy URL is a guaranteed rejection. `HEAD` resolves to
whatever the default branch is, so the link keeps working if you later rename
it or merge to `main`.

Verified working at the time of writing:

```
$ curl -s -o /dev/null -w "%{http_code}\n" -L \
    https://github.com/devpatel535/price-per-dollar/blob/HEAD/PRIVACY.md
200
```

Re-run that before you submit, and also open it in a private window. If you
ever make the repository private, move the policy to a public Gist or GitHub
Pages and use that URL instead.

---

## 2. Build and verify the package

```bash
npm install
npm run package
```

This builds `dist/`, runs the pre-submission checks, and writes
`release/price-per-dollar-1.0.0.zip`. It refuses to package if any check fails,
so a clean run means the manifest, icons, file references, permissions and
packaging hygiene are all sound.

Generate the listing images too:

```bash
npm run store:assets     # writes store/assets/
```

Sanity-check the build by hand once before uploading: `chrome://extensions` →
Developer mode → Load unpacked → select `dist/` → open a shopping site → click
the toolbar icon.

---

## 3. Upload the package

Developer dashboard → **Add new item** → drag in
`release/price-per-dollar-1.0.0.zip`.

> ### Upload the built package, not the source
>
> **Do not upload GitHub's "Download ZIP".** That gives you the *repository* —
> README, tests, tooling, and a `src/manifest.base.json` — not the extension.
> The store scans it, decides some inner folder is the extension root, and
> rejects it with a wall of text listing every file in the repository:
>
> > *Files outside directory with manifest `…/src/` are not allowed: …*
>
> If you see that error, you uploaded the wrong zip.

The package you want is the one built by `npm run package`. You can tell them
apart in one look — the right zip has `manifest.json` at the **top level** and
contains 14 files:

```
$ unzip -l release/price-per-dollar-1.0.0.zip
    manifest.json          <- at the root, not inside any folder
    content/index.js
    popup/index.html
    popup/popup.js
    popup/popup.css
    background/service-worker.js
    icons/icon16.png … icon128.png
```

Three ways to get it, in order of convenience:

1. **Download it from the repository's Releases page** —
   <https://github.com/devpatel535/price-per-dollar/releases> — the asset named
   `price-per-dollar-<version>.zip`.
2. **Build it:** `npm install && npm run package`.
3. **From a CI run:** the `price-per-dollar-zip` artifact on any green build.

Upload the `.zip` itself — not a folder, and not a zip containing the zip.

## 4. Store listing tab

**Name**

> Price Per Dollar

**Short description** (132 character limit; this is 118)

> See the true cost per unit of everything on the page, and exactly what one dollar buys. Runs entirely in your browser.

**Detailed description** — paste the "Detailed description" section from
[`listing.md`](listing.md).

**Category:** Shopping
**Language:** English

**Store icon:** `store/assets/icon-128.png`

**Screenshots** (at least one required; all five are 1280×800):

1. `store/assets/screenshot-1-grid.png` — badges on a category page
2. `store/assets/screenshot-2-ranked.png` — the ranked popup
3. `store/assets/screenshot-3-analysis.png` — the value analysis
4. `store/assets/screenshot-4-calculator.png` — the manual calculator
5. `store/assets/screenshot-5-privacy.png` — settings and privacy

**Small promo tile (440×280):** `store/assets/promo-tile-440x280.png`
**Marquee promo tile (1400×560):** `store/assets/marquee-1400x560.png`

Both promo tiles are optional; supplying them makes the listing eligible for
more placements and costs nothing.

**Support URL:**

> https://github.com/devpatel535/price-per-dollar/issues

**Website** (optional):

> https://github.com/devpatel535/price-per-dollar

---

## 5. Privacy practices tab

This is where extensions most often stall. Every answer below is true of the
code as written, and `npm run verify:package` re-checks the load-bearing ones.

**Single purpose**

> Price Per Dollar has one purpose: to calculate and display the true cost per unit of products shown on a shopping page, so the user can compare their value.

**Permission justifications**

`activeTab`
> Reads the prices, titles and sizes on the page the user is looking at, only when the user clicks the toolbar icon or presses the keyboard shortcut. This is the extension's core function.

`scripting`
> Injects the page scanner into the active tab when the user invokes the extension, and registers an auto-run script for the specific sites a user has explicitly granted permanent access to.

`storage`
> Persists the user's own settings: badge visibility, comparison mode, grouping strictness, measurement system, and the list of sites they have switched the extension off for. No page or browsing data is stored.

**Host permission justification** (for `optional_host_permissions`)
> No host access is requested at install; the manifest contains no host_permissions. Broad host access is declared only as optional and is requested one origin at a time, when the user presses "Always run here" for a specific site, so the extension can rank that store without the user opening the popup first. Users can revoke it per site at any time.

**Are you using remote code?**
> No, I am not using remote code

All code is bundled in the package; there are no remotely hosted scripts, no
`eval`, and no remote configuration.

**Data usage** — tick **nothing**. The extension collects and transmits no data
of any kind. Page content is read inside the tab to compute unit prices and is
never sent anywhere or persisted.

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the URL from step 1.

---

## 6. Distribution tab

- **Visibility:** Public (or Unlisted if you want to trial it with a link first)
- **Distribution:** all regions, unless you have a reason to narrow it
- **Pricing:** free

---

## 7. Submit

**Submit for review.** First reviews commonly take a few days and can take
longer for a new developer account. You will be emailed the outcome.

### If it comes back rejected

The likely causes, in order:

| Rejection | Fix |
| --- | --- |
| Privacy policy URL not reachable | Use the `/blob/HEAD/` form, not `/blob/main/` — see step 1 |
| Permission not justified | Copy the wording from step 5 exactly |
| Data disclosures inconsistent with the code | The correct answer is "collects nothing"; make sure nothing is ticked |
| Screenshot wrong size | Regenerate with `npm run store:assets` — they are exactly 1280×800 |
| Requesting broad host access | The manifest asks for none up front; if a reviewer says otherwise, point at `optional_host_permissions` |

Reviewers respond to specifics. If asked why the extension needs to read page
content, the answer is that reading prices and sizes off the page *is* the
product, it happens locally, and nothing leaves the browser.

---

## 8. Shipping an update later

1. Bump `version` in `package.json` — the build stamps it into the manifest, so
   it is set in exactly one place.
2. Add a `CHANGELOG.md` entry.
3. `npm run verify && npm run package`
4. Upload the new zip to the same item and submit.

Tagging `v1.0.1` and pushing runs the release workflow, which builds, verifies,
packages and attaches the zip to a GitHub release. The workflow refuses to
publish if the tag and the manifest version disagree.
