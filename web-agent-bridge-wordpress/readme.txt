=== Web Agent Bridge ===
Contributors: webagentbridge
Tags: ai, automation, agents, bridge, headless
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embeds the Web Agent Bridge script: structured AI agent commands, license verification, permissions, and per-page controls.

== Description ==

Web Agent Bridge (WAB) exposes a standardized `window.AICommands` interface so AI agents can interact with your WordPress site using declared actions instead of fragile DOM scraping.

* License key verification against your WAB host (`/api/license/verify`)
* Inject bridge in `<head>`, footer, or via shortcode `[wab_bridge]`
* Granular permissions (click, fill forms, API access, etc.)
* Blocked selectors and rate limiting
* Stealth mode with ethical-use acknowledgement
* Disable on specific pages (metabox) or by post type / term IDs
* Developer hook `wab_register_actions` for custom actions
* Dashboard widget with plan summary and link to the hosted WAB dashboard

== Installation ==

1. Upload the `web-agent-bridge-wordpress` folder to `/wp-content/plugins/`, or zip and install via Plugins → Add New → Upload.
2. Activate the plugin through the **Plugins** screen.
3. Go to **Settings → Web Agent Bridge** and enter your license key and WAB API base URL (e.g. your self-hosted app or `https://webagentbridge.com`).

== Frequently Asked Questions ==

= Where do I get a license key? =

Create a site in the Web Agent Bridge dashboard; your license key is shown there.

= Does this work without a paid plan? =

The bridge runs in **free** tier mode; premium permissions are enforced by your WAB subscription after verification.

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
First public release.
