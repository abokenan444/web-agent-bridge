# WAB Must-Use WordPress Plugin

> **License:** GPL-2.0-or-later (Open Source)

A Must-Use (MU) plugin version of Web Agent Bridge that is **automatically loaded on every WordPress request** and **cannot be deactivated** from the admin panel — making WAB a permanent part of your WordPress infrastructure.

## Why Must-Use?

Regular WordPress plugins can be deactivated by any admin. Must-Use plugins live in `wp-content/mu-plugins/` and are loaded by WordPress core before any regular plugin — they are always active.

This mirrors how Apache modules or PHP extensions work: they are part of the infrastructure, not optional add-ons.

## Install in 30 Seconds

```bash
# Using the installer script (requires WP-CLI)
bash install-wab-mu.sh --wp-path /var/www/html

# Or manually
cp web-agent-bridge-mu.php /path/to/wp-content/mu-plugins/
wp rewrite flush
```

## What it does

When the full plugin is installed and active, this MU loader ensures it stays active. When the full plugin is absent or deactivated, the MU plugin runs a **minimal fallback** that:

- Adds `X-WAB-*` HTTP headers to every response
- Serves `/.well-known/wab.json` discovery document
- Injects WAB script into `<head>`
- Adds WAB `<meta>` tags for NoScript agents

## Configuration (wp-config.php)

```php
// Custom WAB server URL (default: https://webagentbridge.com)
define( 'WAB_MU_API_BASE', 'https://wab.yourdomain.com' );

// Custom script URL (default: WAB_MU_API_BASE + /script/ai-agent-bridge.js)
define( 'WAB_MU_SCRIPT_URL', 'https://cdn.yourdomain.com/wab.js' );

// Discovery document cache TTL in seconds (default: 300)
define( 'WAB_MU_DISCOVERY_CACHE_TTL', 600 );
```

## Hosting Provider Integration

For hosting providers (cPanel, Plesk, DirectAdmin), add this to your WordPress auto-installer:

```bash
# After WordPress installation
cp web-agent-bridge-mu.php "$WP_CONTENT_DIR/mu-plugins/"
wp rewrite flush
```

This makes WAB available on **every WordPress site** created on your hosting platform.
