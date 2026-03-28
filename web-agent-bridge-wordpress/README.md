# Web Agent Bridge — WordPress Plugin

WordPress integration for [Web Agent Bridge](https://webagentbridge.com) — the open protocol for AI agent-website interaction. Injects the bridge script, serves the WAB Discovery Protocol document, exposes REST API endpoints, and provides NoScript fallback for HTTP-only agents.

## Features

- **WAB Discovery Protocol** — Serves `agent-bridge.json` and `/.well-known/wab.json` automatically
- **REST API** — `/wp-json/wab/v1/discover`, `/actions`, `/page-info`, `/ping`
- **Protocol metadata** — Injects `window.__wab_protocol` with version, discovery URL, API base
- **NoScript fallback** — `<meta>` and `<link>` tags for agents that don't execute JavaScript
- **MCP compatible** — Works with `wab-mcp-adapter` for MCP-enabled AI agents
- **License verification** — Validates against your WAB host
- **Granular permissions** — Click, fill forms, navigate, API access, etc.
- **Per-page control** — Disable bridge on specific pages via metabox
- **Developer hooks** — Register custom actions via PHP

## Installation

1. Copy `web-agent-bridge-wordpress` to `wp-content/plugins/` (or zip and upload).
2. Activate **Web Agent Bridge** in **Plugins**.
3. Open **Settings → Web Agent Bridge** and set:
   - **License key** (from your WAB dashboard)
   - **WAB API base URL** (e.g. `https://yoursite.com` where the Node app is served)
4. Verify discovery is live: `https://yoursite.com/agent-bridge.json`

## Discovery Protocol

Once activated, your site automatically serves a WAB discovery document at three URLs:

```
https://yoursite.com/agent-bridge.json
https://yoursite.com/.well-known/wab.json
https://yoursite.com/wp-json/wab/v1/discover
```

The document describes your site's capabilities, available actions, permissions, restrictions, and the WAB lifecycle.

## REST API Endpoints

| Endpoint | Description |
|---|---|
| `GET /wp-json/wab/v1/discover` | Full discovery document |
| `GET /wp-json/wab/v1/actions` | Available agent actions |
| `GET /wp-json/wab/v1/page-info` | Site metadata |
| `GET /wp-json/wab/v1/ping` | Health check |

## Custom Actions (PHP)

```php
add_action( 'wab_register_actions', function ( $action_registrar ) {
    $action_registrar->add(
        array(
            'name'        => 'woo_add_to_cart',
            'description' => 'Add product to cart',
            'selector'    => '.single_add_to_cart_button',
            'trigger'     => 'click',
            'category'    => 'woocommerce',
        )
    );
} );
```

Custom actions appear in both the discovery document and the `/wp-json/wab/v1/actions` endpoint.

## Shortcode

When **Include method** is set to **Shortcode only**, add `[wab_bridge]` to a page to load the bridge script on that page only.

## Filters

- `wab_should_load` — `(bool $load, array $opts)` — Control whether to load the bridge
- `wab_bridge_config` — `(array $config, array $opts)` — Modify the config object
- `wab_bridge_script_url` — `(string $url, array $opts)` — Override script URL

## MCP Integration

Use the `wab-mcp-adapter` npm package to convert WAB commands into MCP tools:

```bash
npm install wab-mcp-adapter
```

Any MCP-enabled agent (Claude, LangChain, etc.) can interact with your WAB-enabled WordPress site.

## Uninstall

Deleting the plugin runs `uninstall.php` and removes `wab_options` and `wab_license_cache`.

## Translations

Text domain: `web-agent-bridge`. Generate/update POT from the plugin directory:

```bash
wp i18n make-pot . languages/web-agent-bridge.pot
```

## Version

Current: **1.2.0** — WAB Protocol 1.0
