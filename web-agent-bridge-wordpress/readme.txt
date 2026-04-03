=== Web Agent Bridge ===
Contributors: webagentbridge
Tags: ai, automation, agents, bridge, protocol, mcp, discovery
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 2.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Open protocol for AI agent-website interaction. Exposes WAB Discovery, REST API endpoints, structured commands, and NoScript fallback for your WordPress site.

== Description ==

Web Agent Bridge (WAB) is an open protocol that lets AI agents interact with your WordPress site using structured commands instead of fragile DOM scraping.

**Protocol Features:**

* **WAB Discovery Protocol** — Auto-serves `agent-bridge.json` and `/.well-known/wab.json` so AI agents can discover your site's capabilities
* **REST API** — Four endpoints at `/wp-json/wab/v1/` for discover, actions, page-info, and ping
* **Protocol Metadata** — Injects `window.__wab_protocol` with version, discovery URL, and API base
* **NoScript Fallback** — Meta tags and link elements expose discovery to HTTP-only agents when JS is disabled
* **MCP Compatible** — Works with the `wab-mcp-adapter` so any MCP-enabled agent can interact with your site

**Site Owner Features:**

* License key verification against your WAB host (`/api/license/verify`)
* Inject bridge in `<head>`, footer, or via shortcode `[wab_bridge]`
* Granular permissions (click, fill forms, API access, etc.)
* Blocked selectors and rate limiting
* Stealth mode with ethical-use acknowledgement
* Disable on specific pages (metabox) or by post type / term IDs
* Developer hook `wab_register_actions` for custom actions
* Dashboard widget with protocol status, plan summary, and discovery URLs

== Installation ==

1. Upload the `web-agent-bridge-wordpress` folder to `/wp-content/plugins/`, or zip and install via Plugins → Add New → Upload.
2. Activate the plugin through the **Plugins** screen.
3. Go to **Settings → Web Agent Bridge** and enter your license key and WAB API base URL (e.g. your self-hosted app or `https://webagentbridge.com`).
4. Verify your discovery document is live by visiting `yoursite.com/agent-bridge.json`.

== Frequently Asked Questions ==

= Where do I get a license key? =

Create a site in the Web Agent Bridge dashboard; your license key is shown there.

= Does this work without a paid plan? =

The bridge runs in **free** tier mode; premium permissions are enforced by your WAB subscription after verification.

= What is agent-bridge.json? =

It's a discovery document (like robots.txt for AI) that tells agents what your site supports, what commands are available, and how to interact with it.

= Does it work without JavaScript? =

Yes. The NoScript fallback injects `<meta>` tags and `<link>` elements pointing to your discovery document, so HTTP-only agents can still find and interact with your site via the REST API.

= Is it compatible with MCP? =

Yes. Use the `wab-mcp-adapter` npm package to convert WAB commands into MCP tools. Any MCP-enabled AI agent will work with your WAB-enabled site.

== Changelog ==

= 1.2.0 =
* WAB Protocol v1.0 support — discovery document, lifecycle, transport layers.
* Discovery Protocol — auto-serves `/agent-bridge.json`, `/.well-known/wab.json`, and `/wp-json/wab/v1/discover`.
* REST API — four new endpoints: discover, actions, page-info, ping.
* Protocol metadata injection (`window.__wab_protocol`).
* NoScript fallback — meta tags and link elements for HTTP-only agents.
* Discovery `<link>` tag in `<head>` on all front-end pages.
* Dashboard widget updated with protocol version, discovery URLs, and API info.
* Settings page updated with Protocol & Discovery section showing all endpoints.
* Updated description to "Open protocol for AI agent-website interaction."
* Version bump across all files.

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.2.0 =
Major protocol update. Adds WAB Discovery Protocol, REST API, NoScript fallback, and MCP compatibility. Recommended for all users.

= 1.0.0 =
First public release.
