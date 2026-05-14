<!-- coderlegion: https://coderlegion.com/user/WAB -->
<div align="center">
  <img src="https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/public/images/wab-logo-large.png" alt="Web Agent Bridge Logo" width="180" />

  <h1>Web Agent Bridge (WAB)</h1>
  <p><b>The open AI ↔ Web protocol & agent platform.</b></p>
  <p><i>robots.txt told bots what NOT to do. WAB tells AI agents what they CAN do.</i></p>

  [![npm](https://img.shields.io/npm/v/web-agent-bridge?color=blue&style=flat-square)](https://www.npmjs.com/package/web-agent-bridge)
  [![License: Open Core](https://img.shields.io/badge/License-Open_Core-blue.svg?style=flat-square)](LICENSE)
  [![Tests](https://img.shields.io/badge/Tests-428%2F428_passing-22c55e?style=flat-square&logo=jest&logoColor=white)](tests)
  [![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/NnbpJYEF)

  <br />
  <a href="https://webagentbridge.com"><b>Website</b></a> ·
  <a href="https://webagentbridge.com/docs"><b>Docs</b></a> ·
  <a href="docs/ARCHITECTURE.md"><b>Architecture</b></a> ·
  <a href="docs/SPEC.md"><b>Spec</b></a> ·
  <a href="https://webagentbridge.com/whitepaper"><b>Whitepaper</b></a> ·
  <a href="README.ar.md"><b>العربية</b></a>
</div>

---

## Why WAB?

AI agents today guess their way through the web — DOM scraping, brittle selectors, fragile vision models. **WAB replaces guesswork with a contract.** Sites declare what agents can do; agents call it like an API; everything is signed, rate-limited, and auditable.

- **For site owners** — control exactly how AI interacts with you. Permissions, rate limits, audit trail.
- **For agent builders** — one stable interface for any WAB-enabled site. No more custom scrapers.

---

## Quick start (60 seconds)

```bash
# 1. Make your site discoverable (zero code)
npx wab-init --site=https://yourdomain.com --yes

# 2. Or install the protocol package
npm install web-agent-bridge
```

```html
<script src="https://cdn.webagentbridge.com/wab.min.js"></script>
<script>
  WAB.declare({
    intents: { search: { handler: (q) => /* … */ } },
    privacy: { allowed: ['public'], disallowed: ['payment'] }
  });
</script>
```

Then any agent can do `window.AICommands.search("…")` reliably — forever.

> **Full quickstart, SDKs, and integrations:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## What's inside

| Layer | What it gives you | More |
|---|---|---|
| **🔌 Core protocol** | DNS discovery · `wab.json` manifest · `window.AICommands` interface | [Spec](docs/SPEC.md) |
| **🧬 SDKs** | JS · React · Vue · Svelte · Next.js · LangChain · MCP adapter | [Architecture](docs/ARCHITECTURE.md) |
| **🛡️ Trust & Safety** | Ring 4 handshake · ShieldQR · ShieldLink · Phone Shield · SSL monitor | [Architecture](docs/ARCHITECTURE.md) |
| **🧠 Advanced layer** | Reputation · Memory cache · Intent routing · Privacy budget · Offline | [Architecture](docs/ARCHITECTURE.md) |
| **⚓ Truth layer** | Semantic memory · Temporal trust · Refusal history · Collective insights | [Architecture](docs/ARCHITECTURE.md) |
| **🏛️ Governance** | HMAC-chained audit log · EU AI Act Article 12 export · multi-tenant | [Architecture](docs/ARCHITECTURE.md) |
| **💼 Commercial** | Partner Program · Trust Graph API · Governance SaaS · Enterprise Mesh | [Architecture](docs/ARCHITECTURE.md) |

---

## Commercial foundations (v3.8.0)

Four production-ready monetization pillars on top of the open protocol — all admin-gated, env-configured, and zero billing logic in the routes:

- **🤝 [Certified Partner Program](https://webagentbridge.com/partners)** — Basic (free) / Verified (€499/yr) / Premium (€2.9k+/yr)
- **📊 [Trust Graph API](https://webagentbridge.com/trust-graph-api)** — Free (1k/mo) / Pro (€10/mo, 100k/mo) / Enterprise (5M+/mo)
- **🏛️ [Governance SaaS](https://webagentbridge.com/governance)** — Team (€99) / Business (€499) / Enterprise (€2.5k+)
- **🕸️ [Enterprise Mesh](https://webagentbridge.com/enterprise-mesh)** — Self-hosted, air-gappable, Ed25519-signed licenses

> **Endpoint tables, tier specs, and security model:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Install

```bash
# Core SDK
npm install web-agent-bridge

# Framework adapters
npm install @web-agent-bridge/react
npm install @web-agent-bridge/vue
npm install @web-agent-bridge/svelte
npm install @web-agent-bridge/langchain

# Server (self-host)
git clone https://github.com/abokenan444/web-agent-bridge
npm install && npm start
```

Docker: `docker compose up -d` · Production: see [docs/DEPLOY.md](docs/DEPLOY.md)

---

## Documentation map

| Document | What it covers |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Full feature reference: every layer, every endpoint |
| **[docs/SPEC.md](docs/SPEC.md)** | Protocol specification (formal) |
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Production deployment guide |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to contribute |
| **[examples/](examples/)** | Live agent examples — Puppeteer, MCP, Vision, LangChain… |
| **[templates/](templates/)** | Starter manifests — restaurant, hotel, ecommerce, freelancer… |

---

## Community

- 💬 **Discord:** <https://discord.gg/NnbpJYEF>
- 🌐 **Website:** <https://webagentbridge.com>
- 📦 **npm:** <https://www.npmjs.com/package/web-agent-bridge>
- 🐛 **Issues:** <https://github.com/abokenan444/web-agent-bridge/issues>
- 👥 **CoderLegion:** <https://coderlegion.com/user/WAB>

---

## License

MIT (core protocol & SDKs). Commercial tiers under separate terms — see [LICENSE](LICENSE).

<div align="center">
  <sub>Built for the AI-first web · 428/428 tests passing · v3.8.0</sub>
</div>
