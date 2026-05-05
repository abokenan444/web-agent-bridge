# Changelog

## 0.1.1 — 2026-05-05
- Embedded Browser now shows a clear toolbar + warning banner.
- External (non-localhost) URLs display a friendly explainer instead of a blank
  iframe (production sites block embedding via X-Frame-Options / CSP
  frame-ancestors). Banner exposes an "Open in external browser" action.

## 0.1.0 — 2026-05-05
- Initial release.
- Agent Monitor webview with live `/api/plans` integration.
- AICommands IntelliSense + code actions + snippets (click / form / execute / bootstrap).
- Local bridge runner (`WAB: Start Agent Bridge`) for capturing browser events.
- Embedded Browser webview.
- DNS scaffolder (TXT / CAA / .well-known).
- Workspace auto-detection of `web-agent-bridge-sdk` or `ai-agent-bridge.js`.
- `WAB: Scaffold Starter Kit` for one-click project bootstrap.
