# WAB — Web Agent Bridge for VS Code

Turn VS Code into an **IDE for AI agents**. WAB ships an integrated panel,
IntelliSense, snippets and a local bridge runner so you can build, debug and
ship agents that drive any website using the [Web Agent Bridge](https://www.webagentbridge.com)
protocol.

## Features

- **Agent Monitor** — live side-panel that streams `AICommands` events from your local bridge runner and lists your published plans / actions.
- **AICommand IntelliSense** — completion for `AICommands.register / execute / readContent / getPageInfo` plus rich snippets (`wab-click`, `wab-form`, `wab-execute`, `wab-bootstrap`).
- **Code Actions** — right-click a `<button>` / `<a>` / `onClick` handler → *Wrap as AICommand* generates the boilerplate for you.
- **Embedded Browser** — open `http://localhost:3000` (or any URL) inside VS Code so you can iterate on the agent without leaving the editor.
- **DNS scaffolder** — generates the TXT / CAA / `.well-known/web-agent-bridge.json` snippets your domain needs.
- **Starter Kit** — *WAB: Scaffold Starter Kit* drops a working `wab.config.json`, `.well-known` pointer and example agent into your workspace.
- **Auto-detect** — the extension notices when your project depends on `web-agent-bridge-sdk` or ships `ai-agent-bridge.js` and offers to open the Monitor.

## Commands

| Command | Description |
|---|---|
| `WAB: Open Agent Monitor` | Show the live monitor webview |
| `WAB: Start / Stop Agent Bridge` | Run a localhost HTTP endpoint that captures bridge events |
| `WAB: Generate AICommand for Element…` | Snippet builder for the current selection |
| `WAB: Generate DNS Records` | Output TXT / CAA / well-known stubs for your domain |
| `WAB: Open Embedded Browser` | Iframe-based browser inside VS Code |
| `WAB: Sign In` | Stores a personal API token in VS Code SecretStorage |
| `WAB: Scaffold Starter Kit` | Creates `wab.config.json` + example agent |

## Settings

- `wab.endpoint` — control-plane URL (default `https://www.webagentbridge.com`).
- `wab.bridgePort` — local bridge runner port (default `7999`).
- `wab.autoMonitorOnDetect` — prompt to open the Monitor when the SDK is detected.
- `wab.intelliSense.enabled` — disable completions / code actions.
- `wab.apiToken` — optional plain-text token. Prefer `WAB: Sign In` (uses SecretStorage).

## Quick start

```bash
# 1. install
code --install-extension webagentbridge.wab

# 2. open your site project; the extension will auto-detect WAB SDK
# 3. ⌘⇧P → "WAB: Scaffold Starter Kit"
# 4. ⌘⇧P → "WAB: Open Agent Monitor"
# 5. ⌘⇧P → "WAB: Start Agent Bridge"
```

Then in your page:

```html
<script src="https://www.webagentbridge.com/v1/ai-agent-bridge.js"></script>
<script>
  AICommands.register({
    name: 'add_to_cart',
    trigger: 'click',
    selector: 'button.add-to-cart',
    description: 'Add the visible product to the cart',
  });

  // Forward events to the local VS Code bridge runner
  AICommands.events.on('execute', (e) =>
    fetch('http://localhost:7999/event', { method: 'POST', body: JSON.stringify(e) })
  );
</script>
```

## License

MIT © Web Agent Bridge
