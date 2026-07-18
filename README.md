<p align="center"><img src="resources/icon.svg" alt="JSON Viewer" width="96" height="96"></p>

<h1 align="center">JSON Viewer</h1>

<div align="center">
  <strong>Turns any JSON response into a readable, navigable view.</strong><br>
  Expandable tree, syntax highlighting, search, keyboard navigation, light/dark themes, and a raw view.<br>
  <sub>Everything stays local: no host permissions, no network requests, no trackers.</sub>
</div>

<br>

<div align="center">
  <!-- Manifest V3 -->
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=chromewebstore&logoColor=white" alt="Manifest V3">
  <!-- Chrome version -->
  <img src="https://img.shields.io/badge/Chrome-129%2B-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome 129+">
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT">
  </a>
</div>

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Preferences](#preferences)
- [Architecture](#architecture)
- [Security and privacy](#security-and-privacy)
- [License](#license)

## Features

- **Automatic detection.** The content script is injected on every page (`<all_urls>`) but activates only when the `Content-Type` is `application/json`, `text/json`, or a variant with a `+json` suffix (e.g. `application/vnd.api+json`). On any other page it bails out immediately, without touching the DOM.
- **Navigable tree** with syntax highlighting: every object and array shows its item count and expands or collapses with a click.
- **Expand / collapse all** and **copy** the entire payload to the clipboard, from the toolbar.
- **Search** across keys and values with `Ctrl`/`⌘` + `Shift` + `F`: matching nodes stay visible, their ancestors open, and the result count is shown in real time.
- **Keyboard navigation** of the tree with the arrow keys `↑ ↓ ← →`, `Home`/`End`, and `Enter`/`Space`.
- **Raw view** one click away, to read the JSON exactly as it arrives from the server.
- **Clickable links**: string values that are an `http(s)` URL open in a new tab with `rel="noopener noreferrer"`.
- **Themes**: light, dark, or automatic (follows the system setting).
- **Five languages**: English (default), Italian, German, Spanish, French.
- **Synced preferences** to your Google account via `chrome.storage.sync`.

## Installation

### Developer mode

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `src` folder.
4. Open a JSON URL, for example `https://jsonplaceholder.typicode.com/photos`.

> Requires **Chrome 129** or later (`minimum_chrome_version: 129`).

## Usage

- Open any endpoint that serves JSON: the page is formatted automatically.
- Use the toolbar icon for the **popup**: it shows the version, opens the options, and lists the shortcuts.
- Customize the behavior from the **options page**, which opens in a dedicated tab. Every change is saved automatically.

### Shortcuts

| Action | Keys |
| --- | --- |
| Search across keys and values | `Ctrl`/`⌘` + `Shift` + `F` |
| Navigate the tree | `↑` `↓` `←` `→` · `Home` · `End` |
| Expand / collapse a node | `Enter` / `Space` or click the node |
| Move between the Formatted / Raw tabs | `←` `→` `↑` `↓` · `Home` · `End` (with a tab focused) |

Search is active in the formatted view; in the raw view the shortcut does not interfere with the browser's native find.

## Preferences

Configurable from the options page and synced via `chrome.storage.sync`:

| Preference | Values | Default |
| --- | --- | --- |
| Theme | automatic · light · dark | automatic |
| Default view | formatted · raw | formatted |
| Initial expansion depth | 0–10 | 2 |
| Font size | 10–24 px | 14 px |
| Raw view indentation | from server · 2 spaces · 4 spaces · tab | from server |
| Word wrap | on / off | on |
| Sort keys alphabetically | on / off | off |
| Maximum payload threshold | 1–100 MB | 10 MB |

Numeric values outside the allowed range are clamped back into bounds. The **Reset** button on the options page restores everything to the defaults.

## Architecture

```
json-viewer/
├── src/                     # the unpacked extension (load this folder in Chrome)
│   ├── manifest.json        # at the extension root, as Chrome requires
│   ├── i18n.js              # localizes the static pages (popup, options) from _locales
│   ├── _locales/            # interface translations: de, en (default), es, fr, it
│   ├── icons/               # PNG 16/32/48/128 used by the extension
│   ├── content/             # content script that formats the JSON (viewer.js + viewer.css)
│   ├── popup/               # toolbar popup (popup.html/.css/.js)
│   └── options/             # options page (options.html/.css/.js)
├── resources/               # source assets not shipped with the extension (icon.svg)
├── LICENSE
└── README.md
```

The extension itself lives in `src/`, which is the folder you load in Chrome; `manifest.json` and `_locales/` sit at that extension root (required by Chrome), with one folder per interface surface (`content/`, `popup/`, `options/`) and the PNG assets in `icons/`. The `resources/` folder holds source assets that are not shipped, such as `icon.svg` from which the PNG icons are generated. **There is no service worker**: the extension has no background logic, so it does not need one.

### How it gets the JSON

The content script runs at `document_start`. It reads the text already present in the DOM (typically a `<pre>` generated by the browser) and, if that is not enough, re-fetches the URL from cache (`fetch` with `cache: 'force-cache'`, `credentials: 'same-origin'`). The size is checked *before* parsing, so a huge response does not block the tab only to be discarded afterwards.

### System fonts, no CDN

Loading fonts from a CDN would require loosening the CSP and adding a network dependency on every open. The extension uses system fonts instead:

- **UI**: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …`): SF Pro on macOS, Segoe UI on Windows, Roboto on Linux/Android. Native look, zero bytes downloaded, instant rendering.
- **Monospace** (keys and values): `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Roboto Mono", …`.

## Security and privacy

The extension is designed to be auditable and to minimize the attack surface.

- **Manifest V3** with `minimum_chrome_version: 129`.
- **A single permission**: `storage`, to save the preferences. `host_permissions` is empty.
- **No external requests** to CDNs, fonts, analytics, or trackers: everything is served from the local package.
- **No web-accessible resources**: nothing in the package is exposed for web pages to load.
- **Restrictive CSP** for the extension pages:
  ```
  default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
  ```
- **No `innerHTML`, `insertAdjacentHTML`, `eval`, or `new Function`**: every DOM node is built with `createElement` + `textContent`.
- **Only `async`/`await`**, no `.then()` chains, in line with MV3 best practices.
- **Payload limit**: JSON larger than the configured threshold (10 MB by default) is not formatted.
- **Non-blocking tree building**: the DOM is built in time-boxed chunks (≤ 50 ms), yielding the main thread with `scheduler.yield()` (`setTimeout` fallback), so large payloads do not freeze the page.
- **Isolated content script**: it runs in an isolated world and exposes no global variables to the page.

JSON Viewer does **not** collect personal data, history, or page content. The JSON you open is processed locally and never leaves the device. The only data stored are the display preferences, synced via `chrome.storage.sync` to **your** Google account (the developer has no access to it). You can clear them from the **Reset** button or by removing the extension.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
