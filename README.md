<!-- coderlegion: https://coderlegion.com/user/WAB -->
<div align="center">
  <img src="https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/public/images/wab-logo-large.png" alt="Web Agent Bridge Logo" width="220" />
  <h1>Web Agent Bridge (WAB)</h1>
  <p><b>The Open AI ↔ Web Protocol & Agent Platform</b></p>
  <p><i>robots.txt told bots what NOT to do. WAB tells AI agents what they CAN do.</i></p>

  [![npm](https://img.shields.io/npm/v/web-agent-bridge?color=blue&style=flat-square)](https://www.npmjs.com/package/web-agent-bridge)
  [![License: Open Core](https://img.shields.io/badge/License-Open_Core-blue.svg?style=flat-square)](LICENSE)
  [![One-Click DNS Discovery](https://img.shields.io/badge/DNS%20Discovery-One--Click-6366f1?style=flat-square&logo=dns&logoColor=white)](https://webagentbridge.com/activate)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/NnbpJYEF)
  [![CoderLegion](https://img.shields.io/badge/CoderLegion-WAB-0ea5e9?style=flat-square&logo=dev.to&logoColor=white)](https://coderlegion.com/user/WAB)

  [![ShieldQR Trust](https://img.shields.io/badge/ShieldQR-Ed25519_signed-22c55e?style=flat-square&logo=letsencrypt&logoColor=white)](#-shieldqr--extended-trust-layer)
  [![ShieldLink](https://img.shields.io/badge/ShieldLink-Verified_Links-22d3a3?style=flat-square&logo=keybase&logoColor=white)](#-shieldlink--verified-links-for-banks--brands--new)
  [![SSL Monitor](https://img.shields.io/badge/SSL_Monitor-7--day_alerts-f59e0b?style=flat-square&logo=letsencrypt&logoColor=white)](#-shieldqr--extended-trust-layer)
  [![Zero-Config Adoption](https://img.shields.io/badge/Adoption-Zero--Config-a855f7?style=flat-square&logo=vercel&logoColor=white)](#-zero-config-adoption-layer)
  [![Tamper-Evident Audit](https://img.shields.io/badge/Audit-HMAC_Chain-0ea5e9?style=flat-square&logo=keybase&logoColor=white)](#-governance-layer--enterprise-security--compliance)
  [![Tests](https://img.shields.io/badge/Tests-293%2F293_passing-22c55e?style=flat-square&logo=jest&logoColor=white)](tests)

  <br />
  <a href="https://webagentbridge.com"><strong>Website</strong></a> ·
  <a href="https://webagentbridge.com/docs"><strong>Documentation</strong></a> ·
  <a href="https://webagentbridge.com/whitepaper"><strong>Whitepaper</strong></a> ·
  <a href="https://webagentbridge.com/activate"><strong>DNS Discovery</strong></a> ·
  <a href="https://coderlegion.com/user/WAB"><strong>CoderLegion</strong></a> ·
  <a href="README.ar.md"><strong>العربية</strong></a>
</div>

<br />

## Why WAB?

Currently, AI agents interact with the web by parsing the DOM, guessing selectors, or relying on fragile visual models. This is slow, error-prone, and breaks whenever a site's layout changes.

**WAB solves this by providing a standardized API for the web.** It creates a secure bridge between AI agents and websites, allowing agents to discover capabilities, execute commands, and interact with sites accurately — no DOM parsing, no scraping, no guesswork.

### For Website Owners 🏢
Control exactly how AI interacts with your site. Expose specific capabilities, set rate limits, and monitor agent activity.

### For AI Developers 🤖
Build reliable agents that work instantly on any WAB-enabled site. Stop writing custom scrapers and start using the `window.AICommands` standardized interface.

---

## ⚡ Quick Start

### 0. Zero-Config Initializer (30 seconds)
The fastest path. Auto-detects your stack (Next.js, Nuxt, SvelteKit, Astro, Laravel, WordPress, static…) and scaffolds `/.well-known/wab.json` plus the DNS instructions for your provider:

```bash
npx wab-init
# or non-interactive:
npx wab-init --site=https://yourdomain.com --name="Your Site" --yes
```

### 1. DNS Discovery (No Code)
Make your website instantly discoverable by AI agents by adding a single DNS TXT record. No code changes required.

```dns
_wab.yourdomain.com  TXT  "v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json"
```
👉 [**Watch the 40-second setup video & full guide**](https://webagentbridge.com/activate)

### 2. The Developer Way: Install via npm
```bash
npm install web-agent-bridge
```

```javascript
import { initWAB } from 'web-agent-bridge';

initWAB({
  siteId: 'your-site-id',
  capabilities: ['browse', 'api', 'commerce'],
});
```

### 3. The Edge Way: One-Click Edge Adoption
No origin changes needed. Drop in a Cloudflare Worker, Vercel Middleware, or Netlify Edge Function and `/.well-known/wab.json` is served from the edge:

```js
// Vercel — middleware.ts
import { handleRequest } from '@webagentbridge/edge';
export const config = { matcher: ['/.well-known/wab.json'] };
export default (req) => handleRequest(req, {
  siteName: 'Acme', siteUrl: 'https://acme.com'
});
```

Or for Next.js, wrap your config:

```js
// next.config.js
const { withWAB } = require('@webagentbridge/next');
module.exports = withWAB({}, {
  siteName: 'Acme', siteUrl: 'https://acme.com',
});
```

### 4. The Agent Builder Way: Governance-First Agents

If you're building an AI agent that touches Stripe, Gmail, ClickUp, or any sensitive API, wrap every action in the **Governance Layer**. Permissions, human-in-the-loop approvals, tamper-evident audit, kill-switch and spend caps — server-enforced and one call away:

```javascript
const { WABGovernance } = require('web-agent-bridge/sdk');

// 1) one-time: register the agent identity
const { agent_id, agent_token } = await WABGovernance.register({
  apiBase: 'https://webagentbridge.com',
  displayName: 'My Stripe Agent',
});

const gov = new WABGovernance({
  apiBase: 'https://webagentbridge.com',
  agentId: agent_id,
  agentToken: agent_token,
  onApprovalRequired: async (req) => {
    // post to Slack/Email; return 'approved' or 'rejected'
    return await askHuman(req);
  },
});

// 2) define boundaries
await gov.definePolicy({
  resource: 'stripe', action: 'write', scope: 'refunds',
  max_amount: 50, daily_cap: 200, currency: 'USD',
});
await gov.definePolicy({
  resource: 'stripe', action: 'write', scope: 'refunds-large',
  max_amount: 5000, requires_approval: true,
});

// 3) wrap every action
await gov.guard(
  { resource: 'stripe', action: 'write', scope: 'refunds', amount: 49.99 },
  async () => stripe.refunds.create({ charge: 'ch_x' }),
);
```

👉 **Run the full 9-step demo:** [`node examples/governance-agent.js`](examples/governance-agent.js) — walks register → policies → deny → allow → approval gate → audit → kill switch.

---

## ✨ Core Features

### 🔍 DNS Discovery Protocol
The fastest way to make your site AI-ready. AI agents can find your capabilities document via DNS over HTTPS (DoH) without any initial HTTP request.

### 🛡️ Sovereign Shield & Firewall
Protect your site from malicious bots while allowing verified AI agents. Includes IP rate-limiting, Intent Engine, and Human-Gate rollback.

### 💻 Agent OS & Workspace
A premium 4-panel workspace for non-technical users featuring an embedded browser, smart agent chat, real-time negotiation monitor, and results panel.

### 🌐 Universal Agent Mode
Works on any website, even those without the WAB script installed, using our advanced fallback heuristics.

### 🗣️ Multilingual Support
Full Arabic and English interface with auto-detection. The smart agent understands and responds in any language the user writes in.

---

## � ShieldQR & Extended Trust Layer

WAB ships an **end-to-end trust pipeline** that lets agents (and humans) verify a site is exactly who it claims to be — at the protocol level, not just the TLS level.

```
┌─────────────────────────────────────────────────────────────┐
│  /.well-known/wab.json   →  signed Ed25519 payload          │
│        ▲                                                    │
│  _wab.<host>  DNS TXT    →  pk + ssl_thumbprint + endpoint  │
│        ▲                                                    │
│  TLS certificate         →  fingerprint pinned in DNS       │
└─────────────────────────────────────────────────────────────┘
```

| Capability | What it does |
|---|---|
| **🪪 Ed25519-signed `wab.json`** | Every capability document is signed; the public key is published in DNS (`pk=ed25519:…`). Agents detect tampering or impersonation. |
| **🔐 SSL fingerprint pinning** | `ssl_thumbprint` (SHA-256) and `ssl_expires` are embedded in both `wab.json` and the DNS TXT record. Mismatch = automatic distrust. |
| **🩺 SSL Health Monitor** | A 24h cron sweep tracks every site's certificate; sends an email alert **7 days** before expiry so renewal never surprises you. |
| **📜 Certificate Transparency log** | A local CT log (`cert_history`) records every fingerprint observed per host — silent re-issuance is detectable. |
| **🛟 Fallback Trust mode** | If TLS is degraded but the Ed25519 signature still verifies, ShieldQR returns `partial trust` instead of failing closed. Never blocks a legitimate site over a single moving part. |
| **📱 ShieldQR Public Scanner** | `/shieldqr` lets users scan any QR code and instantly see if the destination is a verified WAB-trusted site (`green` / `yellow` / `red`). |
| **🛠 Admin Trust Monitor** | `/admin/trust-monitor` — dashboard for monitored hosts, SSL status pills, CT log entries, and one-click re-verification. |

**Sign your domain in one command:**
```bash
node scripts/sign-wab-domain.js
# → writes signed /.well-known/wab.json + prints the DNS TXT record to publish
```

Verify any site: <https://www.webagentbridge.com/check?host=YOUR_HOST>

---

## � ShieldLink — Verified Links for Banks & Brands ✨ NEW

**The first cryptographically-signed, anti-phishing link layer for the open web.** Premium customers (banks, payment processors, telcos, ecommerce) sign every link they send. Anyone who clicks sees a Trust Preview before reaching the destination — no app install, no browser extension required.

```
┌──────────────────────────────────────────────────────────────────┐
│  Sender (verified brand)                                         │
│    └── POST /api/customer/shieldlink/sites/:siteId/sign          │
│          { target_url, amount, payee, expires_in_sec }           │
│          → https://www.webagentbridge.com/l/<token>              │
│                                                                  │
│  Recipient (anyone with a browser)                               │
│    └── opens link → Trust Preview verifies Ed25519 signature     │
│        + DNS-anchored public key + brand status + reports        │
│        → green / yellow / red verdict before redirect            │
└──────────────────────────────────────────────────────────────────┘
```

| Capability | What it does |
|---|---|
| **🛂 Identity = domain ownership** | Only the proven owner of `bank.example` (DNS TXT verified) can sign links carrying brand "Bank Example". No CA, no paperwork — DNS + DNSSEC are the trust root. |
| **🪞 Lookalike-name protection** | Display names within Levenshtein distance ≤ 2 of an existing verified brand are auto-rejected. High-value targets (`mada`, `stcpay`, `paypal`, `visa`, …) are reserved by default. |
| **✍️ Cryptographic signing** | Every link is signed with Ed25519 over a canonical JSON payload (target, amount, payee, expiry). Tampering invalidates the signature. |
| **🎫 Trust Preview** | `/l/<token>` shows verified brand name, payee, amount, expiry, and a green/yellow/red verdict before redirect. Bilingual EN/AR with RTL. |
| **🚨 Community reporting** | One-click phishing report from the preview page. Multiple open reports flip the verdict to red and trigger admin review. |
| **🔁 Real-time revocation** | Customers revoke a single link or rotate signing keys from the dashboard — every future verification reflects it instantly. |
| **🛠 Admin moderation** | `/admin/shieldlink` — brand verification queue, signed-link monitor, phishing-report triage, reserved-name management. |
| **🧑‍💼 Customer dashboard** | `/dashboard/shieldlink` — apply for brand badge, sign links, view per-link analytics, revoke. |

**Plan gating:** ShieldLink is included on the **Pro** ($99/mo) and **Enterprise** plans. Free / Starter users can still verify and report links sent to them.

**Public landing:** <https://www.webagentbridge.com/shieldlink>

---

## 🧠 Advanced Features + ⚓ Truth Layer ✨ NEW (v3.6.0)

Two new layers that turn WAB from a discovery protocol into a **collective intelligence platform** for AI agents. **10 features · 25 endpoints · live now.**

### 🌐 Where to find them on the site

| Page | URL | What it has |
|------|-----|-------------|
| **Advanced Features showcase** | <https://www.webagentbridge.com/wab-features> | Interactive live demos for the 6 Advanced Features (bilingual EN/AR) |
| **Truth Layer showcase** | <https://www.webagentbridge.com/wab-truth> | Interactive live demos for the 4 Truth Layer features (bilingual EN/AR) |
| **Landing page nav** | <https://www.webagentbridge.com/> | New links: 🧠 Advanced Features · ⚓ Truth Layer |

### Layer 1 — WAB Advanced Features (6 modules)

| # | Module | What it does | Key endpoints |
|---|---|---|---|
| 1 | 🏆 **Reputation Score** | Multi-factor 0–100 score per domain (DNS stability, trust history, latency, agent reports, consistency). Includes leaderboard + 30-day trend. | `GET /api/reputation/:domain` · `GET /api/reputation/leaderboard` |
| 2 | 💾 **Memory Cache Layer** | Versioned manifest cache with `ETag` + conditional GET. 24h TTL. Batch validation up to 50 domains. | `GET /api/cache/manifest/:domain` · `POST /api/cache/validate` |
| 3 | 🎯 **Intent-Aware Routing** | Sites declare intent schemas; agents send natural-language intent and get a matched action. Scoring: exact key (85), label (80), keyword (65), synonym (60). | `POST /api/intent/resolve` · `POST /api/intent/register` |
| 4 | 🔒 **Privacy Budget** | Sites declare per-session data budgets (allowed/disallowed categories, max fields). GDPR / CCPA / LGPD compliance badges. | `GET /api/privacy/budget/:domain` · `POST /api/privacy/budget/check` |
| 5 | 🧠 **Collective Intelligence** | Anonymized network-wide insights. Agent IDs hashed daily with rotating salt — no PII. | `POST /api/collective/report` · `GET /api/collective/insights/:domain` |
| 6 | 📴 **Offline Mode + Sync** | Agents operate against cached manifests when offline, sync deltas (up to 30 domains) when back online. | `GET /api/offline/status/:domain` · `POST /api/offline/sync` |

### Layer 2 — WAB Truth Layer (4 unified ideas)

The Truth Layer solves the **LLM hallucination problem** and gives new agents instant access to collective knowledge.

| # | Module | What it does | Key endpoints |
|---|---|---|---|
| 1 | 🧬 **Semantic Memory Network** | Anonymized observations per intent category (`booking`, `payment`, `search`, `auth`, `checkout`, `support`, `navigation`, `content`, `other`). Outputs success rate, avg + p95 latency, reliability score. | `POST /api/truth/memory/observe` · `GET /api/truth/memory/:domain` |
| 2 | ⏳ **Temporal Trust** | Time-stability score. Classifies domains: 🌱 `new` → 📈 `emerging` → 🏛️ `established` → ⭐ `flagship`, or ⚠️ `suspect` on sudden structural changes / volatility / DNS failures. | `GET /api/truth/temporal/:domain` |
| 3 | 🗺️ **Intent → Action Graph** | Sites publish per-intent `ActionGraph`s — flowcharts of nodes (`start`/`action`/`requirement`/`choice`/`outcome`) and edges. Agents send natural-language intent → receive structured execution graph. | `POST /api/truth/action/register` · `POST /api/truth/action/resolve` |
| 4 | ⚓ **Reality Anchor** | Cross-site fact verification. Agents submit facts (`price`, `availability`, `rating`, `event`, `count`, `status`); verification returns weighted consensus (numeric: mean+median+stddev+confidence; categorical: vote+agreement). Weighted by source-domain reputation. | `POST /api/truth/reality/submit` · `GET /api/truth/reality/:fact_key` |
| ★ | 🌐 **Unified Truth Profile** | One call returns reputation + semantic + temporal + action graphs + reality contributions for a domain. | `GET /api/truth/profile/:domain` |

### 🛡️ Privacy & security guarantees

- **Anonymization:** All agent identifiers are hashed with a **daily-rotating SHA-256 salt** before storage. No PII is ever persisted.
- **Rate limiting:** 200 requests / 15 minutes on all `/api/*` routes.
- **Validation:** Strict domain regex, allow-listed intent / observation / fact-type values, JSON body size limits 4–64 KB depending on endpoint.
- **Universal scope:** Works for **all domain categories** — not just booking. Templates for common verticals are in `templates/`.

### 📚 Full reference

See the GitHub release for the complete 25-endpoint index, scoring algorithms, and DB schema:
👉 [**Release v3.6.0 — Advanced Features + Truth Layer**](https://github.com/abokenan444/web-agent-bridge/releases/tag/v3.6.0)

---

## �🚀 Zero-Config Adoption Layer

Drop-in adoption for every popular stack — **no origin changes, no PHP, no `.htaccess` edits**.

| Package | Use it for | Install |
|---|---|---|
| **`wab-init` CLI** | Auto-detect project (Next/Nuxt/SvelteKit/Astro/Laravel/WordPress/static) and scaffold `wab.json` + DNS instructions. | `npx wab-init` |
| **`@webagentbridge/next`** | Next.js plugin: `withWAB(nextConfig, { siteName, siteUrl })` adds rewrites + headers for `/.well-known/wab.json`. App Router + Pages Router supported. | `npm i @webagentbridge/next` |
| **`@webagentbridge/edge`** | Vercel Middleware & Netlify Edge Function — serve `wab.json` from the edge, configured by env vars. | `npm i @webagentbridge/edge` |
| **`@webagentbridge/cloudflare-worker`** | Standalone Cloudflare Worker that injects `/.well-known/wab.json` from KV or env vars. Optional reverse-proxy origin. | `wrangler deploy` |
| **SDK Auto-Discovery** | When a site has no `wab.json`, the SDK falls back through JSON-LD / Schema.org / OpenGraph / `sitemap.xml` / `robots.txt` and returns a **normalized capabilities envelope** so your agent still works. | `require('web-agent-bridge-sdk').discover(url)` |

```js
const { discover } = require('web-agent-bridge-sdk');

const env = await discover('https://example.com');
// env.source       → 'wab.json' | 'auto-discovery'
// env.site         → { name, description, url }
// env.actions      → [{ name, description, source }, …]
// env.products     → [ schema.org/Product nodes … ]
// env.sitemap      → [ url, … ]
// env.trust.signed → boolean
```

The result: any agent can do something useful on **any** website on day one, even before the site formally adopts WAB.

---

## �🛡️ Governance Layer — Enterprise Security & Compliance

The **WAB Governance Layer** sits *above* the protocol and turns any agent into a compliance-ready, auditable, kill-switch-controlled identity. It's the missing piece for agents that touch real money, mailboxes, or production systems.

```
┌──────────────────────────────────────────────┐
│  Layer 3: Governance  (permissions · audit)   │  ← /api/governance
├──────────────────────────────────────────────┤
│  Layer 2: WAB Protocol  (AICommands · trust)  │  ← /api/discovery
├──────────────────────────────────────────────┤
│  Layer 1: Dynamic Shield  (price · OCR)       │  ← /api/shield
└──────────────────────────────────────────────┘
```

| Capability | What it gives you |
|------------|-------------------|
| **🔐 Permission Boundaries** | Per-agent `resource × action × scope` policies with `effect=allow\|deny`. Most-specific match wins. |
| **🙋 Human-in-the-Loop Approvals** | Mark any policy `requires_approval: true` — sensitive actions are routed through async human gates with TTL. |
| **🧾 Tamper-Evident Audit** | Every event hash-chained with HMAC: `hash_n = HMAC(secret, prev_hash ‖ row)`. `verifyAuditChain()` detects any tampering. |
| **🛑 Kill Switch** | One call disables an agent globally and auto-cancels all pending approvals (no resurrection). |
| **💰 Spend & Rate Limits** | Per-call `max_amount`, rolling 24h `daily_cap`, per-minute `per_call_rate`. |
| **🕵️ Param Redaction** | `password`, `api_key`, `token`, `cookie`, `cvv`, `ssn` are automatically redacted before audit storage. |

**Verified end-to-end** — [293/293 tests passing](tests) including 26 governance, 10 ShieldQR, 36 server, plus the full integration suite.

Full demo: [`examples/governance-agent.js`](examples/governance-agent.js) · API surface: `/api/governance/*` · SDK: `WABGovernance` class.

---

## 🏗️ Architecture & Open Core Model

WAB uses an **Open Core** dual-license model to ensure the protocol remains free while supporting sustainable development.

| Component | License | Description |
|-----------|---------|-------------|
| **Core SDK & Protocol** | MIT | Discovery protocol, JS SDK, signing scripts, `wab-init` CLI. |
| **ShieldQR Verifier** | MIT | Open Ed25519 verifier — anyone can validate signatures and SSL pins. |
| **Adoption Packages** | MIT | `@webagentbridge/next`, `@webagentbridge/edge`, `@webagentbridge/cloudflare-worker`. |
| **WordPress Plugin** | GPL-2.0 | Full integration for WordPress sites. |
| **Engines (Firewall, Price, OCR)** | Proprietary (Free) | Advanced detection, scoring, and protection engines. |
| **ShieldQR Threat Intel** | Commercial | Curated impersonation-host blocklist + reputation feeds. |
| **API Gateway & Pro Modules** | Commercial | Enterprise features, data marketplace, SLA. |

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's fixing a bug, improving documentation, or proposing a new feature.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the terms described in the [LICENSE](LICENSE) file. The core protocol and SDKs are MIT licensed.

---

## 🌐 Community & Links

- **Website**: <https://webagentbridge.com>
- **Discord**: <https://discord.gg/NnbpJYEF>
- **CoderLegion**: <https://coderlegion.com/user/WAB>
- **Issues & PRs**: <https://github.com/abokenan444/web-agent-bridge/issues>
- **npm**: <https://www.npmjs.com/package/web-agent-bridge>

<div align="center">
  <i>© 2026 Web Agent Bridge. Built for the AI-first web.</i>
</div>
