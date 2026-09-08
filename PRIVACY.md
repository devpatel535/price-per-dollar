# Privacy Policy — Price Per Dollar

**Last updated: 8 September 2026**

Price Per Dollar collects nothing, transmits nothing, and stores nothing about
you or the pages you visit.

## What the extension does with page data

When you invoke it, the extension reads the prices, product titles and sizes
rendered on the page you are looking at. That reading happens entirely inside
your browser tab. The results are used to draw badges on the page and to fill
the popup, and they are discarded when the tab is closed.

## What leaves your device

Nothing. The extension makes no network requests of any kind. It contains no
analytics, no telemetry, no crash reporting, no advertising or affiliate code,
no remotely hosted code, and no remote configuration. There is no server
component and no account to create.

You can verify this: the source contains no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call, and the manifest requests no permission that
would allow one.

## What is stored

Only your own settings — badge visibility, comparison mode, grouping
strictness, measurement system, and the list of sites you have switched the
extension off for. These live in Chrome's extension storage. If you are signed
into Chrome with sync enabled, Chrome may sync them across your own devices as
it does for any extension's settings; that transfer is between you and Google
and is not visible to this extension's authors.

The most recent scan of a tab is held in Chrome's session storage so the popup
can show results without rescanning. It is cleared when the tab closes or the
browser restarts.

## Permissions

| Permission | What it is for |
| --- | --- |
| `activeTab` | Read the current page, only when you click the toolbar icon or press the shortcut |
| `scripting` | Inject the scanner into that page |
| `storage` | Save your settings |
| `optional_host_permissions` | Requested only when you press "Always run here" for a specific site, so the extension can run there without you clicking first |

The extension declares no static content scripts and no host permissions. Until
you invoke it, it does not run on any page. Site permissions you grant can be
revoked from the popup's Settings tab or from `chrome://extensions`.

## Data sharing and sale

There is no data to share or sell, and none is shared or sold.

## Children

The extension is not directed at children and collects no personal information
from anyone.

## Changes

Any change to this policy will be published in this file, with the version of
the extension it applies from noted in `CHANGELOG.md`.

## Contact

Open an issue at
<https://github.com/devpatel535/price-per-dollar/issues>.
