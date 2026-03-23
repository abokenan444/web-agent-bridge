# Web Agent Bridge — WordPress Plugin

WordPress integration for [Web Agent Bridge](https://webagentbridge.com): injects `ai-agent-bridge.js`, syncs `window.AIBridgeConfig`, verifies your license, and exposes developer hooks for custom actions.

## Installation

1. Copy `web-agent-bridge-wordpress` to `wp-content/plugins/` (or zip and upload).
2. Activate **Web Agent Bridge** in **Plugins**.
3. Open **Settings → Web Agent Bridge** and set:
   - **License key** (from your WAB dashboard)
   - **WAB API base URL** (e.g. `https://yoursite.com` where the Node app is served)

## Custom actions (PHP)

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

`callback` in the array is for future server-side use only; it is **not** sent to the browser. Implement WordPress REST or AJAX for server logic.

## Shortcode

When **Include method** is set to **Shortcode only**, add `[wab_bridge]` to a page (or in a widget that processes shortcodes) so the script loads on that page only.

## Filters

- `wab_should_load` — `(bool $load, array $opts)`
- `wab_bridge_config` — `(array $config, array $opts)`
- `wab_bridge_script_url` — `(string $url, array $opts)`

## Uninstall

Deleting the plugin runs `uninstall.php` and removes `wab_options` and `wab_license_cache`.

## Translations

Text domain: `web-agent-bridge`. Generate/update POT from the plugin directory:

```bash
wp i18n make-pot . languages/web-agent-bridge.pot
```
