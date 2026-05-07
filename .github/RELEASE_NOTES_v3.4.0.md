# v3.4.0 — Extended Trust Layer + Zero-Config Adoption Layer

Two major additions land in this release.

## 🔐 Extended Trust Layer

WAB sites are now verifiable end-to-end at the protocol level — not just at TLS.

- **Ed25519-signed `wab.json`** with `pk` published in DNS (`_wab.<host>`).
- **SSL fingerprint pinning** — `ssl_thumbprint` (SHA-256) + `ssl_expires` are embedded in both `wab.json` and the DNS TXT record. Mismatch = automatic distrust.
- **SSL Health Monitor** — 24h cron sweeps every monitored site and emails the owner **7 days** before expiry.
- **Certificate Transparency log** — local `cert_history` table records every fingerprint observed per host; silent re-issuance is detectable.
- **Fallback Trust mode** — if TLS is degraded but the Ed25519 signature still verifies, ShieldQR returns `partial trust` instead of failing closed.
- **`/admin/trust-monitor`** — admin dashboard with status pills, CT log, and one-click re-verification.

New files:
- `server/services/ssl-inspector.js`, `server/services/ssl-monitor.js`
- `server/migrations/010_extended_trust.sql` (`cert_history`, `ssl_monitor`)
- `server/routes/admin-trust-monitor.js`
- `public/admin/trust-monitor.html`
- `scripts/sign-wab-domain.js` (now embeds SSL block)

## 🚀 Zero-Config Adoption Layer

Drop-in adoption for every popular stack — no origin changes, no `.htaccess` edits.

- **`npx wab-init`** — auto-detects project type (Next.js / Nuxt / SvelteKit / Astro / Laravel / WordPress / static) and scaffolds `/.well-known/wab.json` with platform-specific DNS instructions.
- **`@wab/next`** — Next.js plugin: `withWAB(nextConfig, { siteName, siteUrl })`. App Router + Pages Router handlers shipped.
- **`@wab/edge`** — shared Vercel Middleware & Netlify Edge Function.
- **`@wab/cloudflare-worker`** — Worker that serves `/.well-known/wab.json` from KV or env vars.
- **SDK Auto-Discovery** — `discover(url)` falls back through JSON-LD / Schema.org / OpenGraph / `sitemap.xml` / `robots.txt` and returns a normalized capabilities envelope so agents work even on un-adopted sites.

New files:
- `bin/wab-init.js`
- `sdk/auto-discovery.js`
- `packages/cloudflare-worker/`
- `packages/edge/` (Vercel + Netlify examples)
- `packages/next/` (`withWAB`, App Router, Pages Router)

## 🧪 Tests

**293 / 293 passing** (10 ShieldQR, 26 governance, 36 server, plus the rest of the integration suite).

## 🔗 Community

- Discord: <https://discord.gg/NnbpJYEF>
- CoderLegion: <https://coderlegion.com/user/WAB>
- Verify any site: <https://www.webagentbridge.com/check?host=YOUR_HOST>

## ⬆️ Upgrade

```bash
npm install web-agent-bridge@latest
# Optionally, scaffold wab.json for your project:
npx wab-init
```
