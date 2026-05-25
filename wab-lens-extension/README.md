# WAB Lens — browser extension

A Manifest V3 Chrome / Edge / Brave extension that detects, verifies and badges Web Agent Bridge discovery on every page you visit.

## Status

`v0.1.0` — reference implementation. Not yet published to the Chrome Web Store.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`wab-lens-extension/`).

## What it does

- On every committed navigation, the background service worker fetches the visited site's `/.well-known/wab.json`.
- The toolbar icon shows a badge:
  - `✓` green  → verified (Ed25519-signed manifest)
  - `•` amber  → enabled (manifest present, unsigned)
  - _empty_   → missing / not WAB-enabled
- Click the toolbar icon to inspect the manifest and jump to the Observatory / Notary.

## Icons

This scaffold does not yet include PNG icons. Drop `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` into `icons/` before submitting to the Web Store. Sources are in the main repo under `public/assets/`.

## Privacy

- No telemetry by default.
- Optional Observatory auto-submission (off-by-default in the public build) sends only bare hostnames.

## License

MIT — see repository root.
