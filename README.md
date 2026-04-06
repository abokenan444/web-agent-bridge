# Web Agent Bridge (WAB)

[![npm](https://img.shields.io/npm/v/web-agent-bridge)](https://www.npmjs.com/package/web-agent-bridge)
[![CI](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://hub.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> **robots.txt told bots what NOT to do. WAB tells AI agents what they CAN do.**

**English** | **[العربية](README.ar.md)**

WAB is an open-source middleware layer that bridges AI agents and websites — like **OpenAPI for human-facing pages**. Website owners embed a script that exposes a standardized `window.AICommands` interface. AI agents discover available actions, execute commands, and interact with sites accurately — no DOM parsing, no scraping, no guesswork.

### Three Paths to WAB

| Path | For | How |
|---|---|---|
| **🏢 Website Owner** | Control how AI interacts with your site | Embed the script, configure permissions |
| **🤖 Agent Developer** | Build reliable agents that work on any WAB-enabled site | Use `window.AICommands` or the Agent SDK |
| **🔧 Self-Hosting** | Run the full WAB platform for your organization | Clone, deploy, manage licenses & analytics |
| **WordPress** | Sites powered by WP | Use the **[Web Agent Bridge WordPress plugin](web-agent-bridge-wordpress/README.md)** (settings, shortcode, per-page disable, hooks) |

---

## Features

- **Auto-Discovery** — Automatically detects buttons, forms, and navigation on the page
- **Structured Auto-Discovery** — Detects schema.org JSON-LD + microdata products/offers and exposes read actions
- **Commerce + Booking Intents** — Detects common actions like add-to-cart, checkout, and booking/reservation flows
- **Permission System** — Granular control over what AI agents can do (click, fill forms, API access, etc.)
- **Standardized Interface** — Unified `window.AICommands` object any agent can consume
- **Secure License Exchange** — Embed uses public `siteId` + `/api/license/token`; long-lived license keys stay in the owner dashboard, not in HTML
- **Rate Limiting** — Multi-dimensional abuse protection (IP + license key + site)
- **Analytics Dashboard** — Track how AI agents interact with your site
- **Real-Time Analytics** — WebSocket-based live event streaming with auto-reconnection
- **In-Memory Caching** — TTL-based cache layer reduces DB reads on hot paths
- **Analytics Queue** — Batched writes with transaction support for high-throughput tracking
- **WebDriver BiDi Compatible** — Standard protocol support via `window.__wab_bidi`
- **CDN Versioning** — Serve scripts via versioned URLs (`/v1/ai-agent-bridge.js`, `/latest/ai-agent-bridge.js`)
- **Docker Ready** — One-command deployment with Docker Compose
- **DB Migrations** — Numbered SQL migration runner with tracking table
- **Custom Actions** — Register your own actions with custom handlers
- **Subscription Tiers** — Free core + paid premium features (API access, analytics, automated login)
- **Event System** — Subscribe to bridge events for monitoring
- **Security Sandbox** — Origin validation, session tokens, command signing, audit logging, auto-lockdown
- **Self-Healing Selectors** — Resilient element resolution with fuzzy matching for dynamic SPAs
- **Stealth Mode** — Human-like interaction patterns (requires explicit consent)
- **Multi-Database** — SQLite (default), PostgreSQL, MySQL via pluggable adapters
- **Agent SDK** — Built-in SDK for building AI agents with Puppeteer/Playwright
- **React Package** — `@web-agent-bridge/react` with `WABProvider`, `useWAB`, `useWABAction`, and `useWABActions`
- **Vue Package** — `@web-agent-bridge/vue` composables (`useWAB`, `useWABAction`, `useWABActions`) for Vue 3+
- **Svelte Package** — `@web-agent-bridge/svelte` stores (`createWAB`, `createWABAction`) for Svelte 3+
- **LangChain Adapter** — `@web-agent-bridge/langchain` wraps WAB actions as LangChain tools for LLM agents
- **GDPR/CCPA Consent** — Optional `wab-consent.js` banner with `WABConsent.showBanner()` and `hasConsent()` gate
- **Admin Dashboard** — User management, tier grants, system analytics
- **Stripe Integration** — Payment processing with customer portal
- **Plugin Architecture** — Dynamic plugin system with hook-based execution, per-site installation, priority ordering, ratings, and audit logging
- **Vision Analysis Service** — Multi-provider screenshot analysis (local Moondream, OpenAI, Anthropic, Ollama) with interactive element detection, bounding box extraction, and AES-256-GCM encrypted API keys
- **Fairness Engine** — Neutrality layer ensuring AI agents give equal opportunity to small and large sites with fairness-weighted search, commission transparency tracking, and trust signature validation
- **Agent Memory System** — Persistent behavioral memory with 4 memory types, 5 categories, semantic associations, importance scoring, and TTL-based expiration
- **Premium Traffic Intelligence** — Advanced bot detection (30+ agent types), behavioral profiling, anomaly/spike detection, security exploit detection (SQLi, XSS), and webhook alerting
- **E-Mail Service** — SMTP-based transactional emails (welcome, registration, password reset, contact) with branded HTML templates
- **NoScript Fallback** — 1×1 tracking pixel endpoint for analytics collection when JavaScript is unavailable
- **WAB-MCP Adapter** — Expose WAB site capabilities as MCP tools for Claude, GPT, Gemini, and other MCP-compatible AI agents
- **WordPress Plugin** — Native WordPress plugin with settings page, per-page action meta boxes, discovery document generation, and dashboard widget
- **WAB Browser (Desktop)** — Standalone Electron desktop browser with built-in ad blocker (80+ domains), scam shield, fairness ranking, agent chat, bookmarks, history, and WAB protocol support
- **PWA Browser (Mobile)** — Progressive Web App browser for Android/iOS with ad blocking, DuckDuckGo search, scam detection, big-tech filtering, and offline-first service worker
- **Schema Discovery SDK** — Server-side extraction of schema.org JSON-LD Product nodes from HTML with automatic WAB action hint generation

### v2.0 — Digital Fortress Features

- **Real-time Negotiation Engine** — AI agents negotiate prices directly with WAB-enabled sites using multi-round sessions. 8 condition types (bulk, loyalty, time-based, first-purchase, cart-value, seasonal, membership, referral) and 4 discount types (percentage, fixed, free-shipping, bonus-item). Includes daily usage limits, minimum order values, and full audit trail of all offers
- **Anti-Hallucination Shield** — Cross-verification engine comparing DOM vs vision screenshots, market benchmark validation, temporal consistency checks, and Levenshtein text similarity scoring. 4 severity levels (minor → fraud) and 5 response actions (warn, halt, confirm-human, auto-correct, block)
- **Decentralized Reputation System** — HMAC-signed trust attestations from the agent network covering 6 attestation types (purchase, booking, query, form, navigation, verification). 7 trust levels (unknown → blacklisted), temporal decay, Sybil resistance, global leaderboard, and challenge/dispute system
- **Sovereign Dashboard** — Real-time command center with fairness radar, privacy shield, negotiation logs, verification checks, and AI model switcher. Exposes `/api/sovereign/dashboard/sovereign` aggregate endpoint
- **Community Agent Hub** — 11 pre-built YAML agent templates (hotel booking, grocery comparison, artisan marketplace, flight deals, etc.) with CLI runner: `npx wab-agent run template.yaml`
- **AI Brain Swapping** — Local AI runtime that auto-discovers Ollama and llama.cpp endpoints plus custom OpenAI-compatible APIs. Model capability tracking for text/vision, context window management, latency-based routing, and inference logging with token metrics
- **Cross-Site Agent Orchestration** — One agent manages multiple WAB-enabled sites simultaneously via `WABMultiAgent`. Compare prices across stores, aggregate data, run parallel actions, and find the best deal automatically

### v2.3 — Private Agent Mesh (Distributed Mind)

- **Inter-Agent Protocol** — Agents communicate through a private mesh with 5 built-in channels (alerts, discoveries, tactics, negotiations, votes). 6 message types with confidence scoring, auto-expiring stale agents via heartbeat, peer verification of shared knowledge. All communication stays local — no external transmission
- **Local Reinforcement Learning** — Agents learn from every user decision using UCB1 multi-armed bandit action selection, gradient-descent policy updates with sigmoid activation, temporal discounting, and sequential pattern mining. Zero external API calls — all learning is local
- **Symphony Orchestrator** — Four specialized agents (Researcher, Analyst, Negotiator, Guardian) collaborate autonomously through rule-based engines. 5 templates, 6-phase pipeline (analyze → research → negotiate → guard → synthesize → decide), Guardian veto for safety, weighted consensus. Full phase logging with duration tracking. No external LLM dependency
- **Agent Mesh Dashboard** — Real-time visualization of your agent mesh: active agents, communication channels, shared knowledge base, symphony compositions, and learning performance metrics

### v2.4 — Commander & Edge Intelligence

- **Commander Agent System** — Local-first mission orchestration engine that decomposes high-level goals into task DAGs. Agent registry with capabilities tracking, parallel execution engine, learning integration for outcome feedback, and edge coordination for distributed work
- **Edge Compute System** — Transforms every user device into a sovereign AI node. Hardware profiling (CPU, RAM, GPU), AES-256-GCM encrypted inter-node communication, weighted load balancing, heartbeat-based health monitoring with auto-failover, and swarm formation with capability-based clustering
- **Swarm Execution Engine** — Launch multiple agents in parallel to solve a single task. Configurable strategies (parallel, sequential, hybrid), result merging with best-score selection, role specialization, fairness-weighted aggregation, and per-agent confidence scoring

---

## Quick Start

### 1. Install & Run the Server

```bash
# Option A: Clone and run
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
cp .env.example .env
npm start

# Option B: npx (one command)
npx web-agent-bridge start

# Option C: Docker
docker compose up -d
```

### 2. Create an Account

Visit `http://localhost:3000/register` and create an account, then add your site from the dashboard.

### 3. Add the Script to Your Website

```html
<!-- Recommended: copy the snippet from your dashboard (uses siteId only) -->
<script>
window.AIBridgeConfig = {
  siteId: "your-site-uuid-from-dashboard",
  configEndpoint: "https://yourserver.com/api/license/token",
  agentPermissions: {
    readContent: true,
    click: true,
    fillForms: true,
    scroll: true
  }
};
</script>
<script src="https://yourserver.com/script/ai-agent-bridge.js"></script>
```

The server matches **Origin** to your registered site domain, then returns a short-lived **session token**. Analytics (`/api/license/track`) require that session — not the long-lived license key. Keep the license key in the dashboard only.

### 4. AI Agents Can Now Interact

```javascript
// From the AI agent's side
const bridge = window.AICommands;
const actions = bridge.getActions();        // discover actions
await bridge.execute("signup");             // execute an action
const info = bridge.getPageInfo();          // get page metadata
```

---

## Project Structure

```
web-agent-bridge/
├── server/                         # Express.js backend
│   ├── index.js                    # Server entry point
│   ├── ws.js                       # WebSocket server (live analytics)
│   ├── routes/
│   │   ├── auth.js                 # Authentication (register/login)
│   │   ├── api.js                  # Sites, config, analytics API
│   │   ├── license.js              # License verification, token exchange & tracking
│   │   ├── admin.js                # Admin dashboard API
│   │   ├── admin-premium.js        # Admin premium analytics (memory, vision, swarm, plugins)
│   │   ├── billing.js              # Stripe billing integration
│   │   ├── sovereign.js            # v2.0: negotiation, reputation, verification, dashboard
│   │   ├── mesh.js                 # v2.3: agent mesh protocol routes
│   │   ├── commander.js            # v2.4: mission orchestration routes
│   │   ├── premium.js              # Premium features
│   │   ├── premium-v2.js           # v2 premium (memory, vision, healing, swarm, plugins)
│   │   ├── discovery.js            # WAB discovery + fairness-weighted search
│   │   ├── wab-api.js              # WAB HTTP transport (alternative to JS/WS)
│   │   └── noscript.js             # NoScript tracking pixel fallback
│   ├── services/
│   │   ├── negotiation.js          # Real-time negotiation engine
│   │   ├── verification.js         # Anti-hallucination shield
│   │   ├── reputation.js           # Decentralized reputation system
│   │   ├── agent-mesh.js           # Inter-agent protocol (mesh)
│   │   ├── agent-learning.js       # Local reinforcement learning (UCB1)
│   │   ├── agent-symphony.js       # Symphony orchestrator (4 roles, 6 phases)
│   │   ├── agent-memory.js         # Persistent agent memory with associations
│   │   ├── commander.js            # Mission orchestration & task DAGs
│   │   ├── edge-compute.js         # Edge computing / sovereign AI nodes
│   │   ├── swarm.js                # Swarm execution engine
│   │   ├── fairness.js             # Fairness & neutrality engine
│   │   ├── vision.js               # Vision analysis (multi-provider)
│   │   ├── self-healing.js         # Self-healing selector corrections
│   │   ├── local-ai.js             # Local AI model runtime
│   │   ├── plugins.js              # Plugin architecture (hooks, registry)
│   │   ├── premium.js              # Premium traffic intelligence & bot detection
│   │   ├── email.js                # SMTP email service
│   │   └── stripe.js               # Stripe payment integration
│   ├── middleware/
│   │   ├── auth.js                 # JWT authentication middleware
│   │   ├── adminAuth.js            # Admin authentication
│   │   └── rateLimits.js           # Multi-layer rate limiting
│   ├── models/
│   │   ├── db.js                   # Database operations
│   │   └── adapters/              # SQLite, PostgreSQL, MySQL adapters
│   ├── migrations/                 # Numbered SQL migrations
│   └── utils/
│       ├── cache.js                # In-memory TTL cache + analytics queue
│       ├── migrate.js              # Migration runner
│       └── secureFields.js         # Field-level encryption utilities
├── public/                         # Frontend
│   ├── index.html                  # Landing page
│   ├── dashboard.html              # Management dashboard
│   ├── premium-dashboard.html      # Premium analytics dashboard
│   ├── docs.html                   # Documentation
│   ├── login.html / register.html  # Auth pages
│   ├── admin/                      # Admin panel
│   ├── pwa/                        # Progressive Web App (mobile browser)
│   │   ├── manifest.json           # PWA manifest
│   │   ├── sw.js                   # Service worker (offline-first)
│   │   ├── index.html              # Mobile browser UI
│   │   ├── app.js                  # Ad blocker, scam shield, fairness
│   │   ├── app.css                 # Mobile-optimized dark theme
│   │   └── icons/                  # PWA icons (192x192, 512x512)
│   ├── script/
│   │   ├── wab.min.js              # Minified WAB client library
│   │   ├── wab-consent.js          # GDPR/CCPA consent banner
│   │   ├── wab-schema.js           # Schema.org discovery
│   │   ├── wab.d.ts                # TypeScript definitions
│   │   └── wab-consent.d.ts        # Consent TypeScript definitions
│   ├── js/                         # Dashboard frontend JS
│   └── css/                        # Stylesheets
├── script/
│   └── ai-agent-bridge.js          # The bridge script (embed in websites)
├── examples/                       # Agent examples
│   ├── puppeteer-agent.js          # Puppeteer + window.AICommands
│   ├── bidi-agent.js               # WebDriver BiDi protocol
│   ├── vision-agent.js             # Vision/NLP intent resolution
│   ├── mcp-agent.js                # MCP adapter usage for Claude/GPT
│   ├── cross-site-agent.js         # Multi-domain orchestration
│   ├── next-app-router/            # Next.js App Router integration
│   ├── shopify-hydrogen/           # Shopify Hydrogen storefront
│   ├── wordpress-elementor/        # WordPress + Elementor setup
│   └── saas-dashboard/             # SaaS dashboard actions
├── packages/                       # Framework wrappers
│   ├── react/                      # @web-agent-bridge/react
│   ├── vue/                        # @web-agent-bridge/vue
│   ├── svelte/                     # @web-agent-bridge/svelte
│   └── langchain/                  # @web-agent-bridge/langchain
├── sdk/                            # Agent SDK
│   ├── index.js                    # WABAgent for Puppeteer/Playwright
│   └── schema-discovery.js         # Server-side schema.org extraction
├── wab-mcp-adapter/                # MCP adapter for Claude/GPT/Gemini
│   ├── index.js                    # MCP tool definitions
│   └── package.json
├── wab-browser/                    # Electron desktop browser
│   ├── main.js                     # Electron main process
│   ├── preload.js                  # Bridge preload
│   └── package.json
├── web-agent-bridge-wordpress/     # WordPress plugin
│   ├── web-agent-bridge.php        # Plugin entry point
│   ├── includes/                   # PHP classes (API, Actions, Dashboard)
│   └── assets/                     # Plugin CSS/JS
├── bin/
│   ├── cli.js                      # CLI entry point (wab-agent)
│   └── wab.js                      # Agent runner
├── templates/                      # 11 Community Agent Hub YAML templates
├── docs/
│   ├── SPEC.md                     # WAB Protocol Specification
│   └── DEPLOY.md                   # Deployment guide
├── demo-store/                     # Demo store for testing
├── deploy/                         # Nginx configs
├── tests/                          # Jest + Supertest test suite
├── .env                            # Environment variables
└── package.json
```

---

## API Endpoints

### Authentication
| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/register` | POST | Create account |
| `/api/auth/login` | POST | Sign in, receive JWT |
| `/api/auth/me` | GET | Get current user |

### Sites
| Endpoint | Method | Description |
|---|---|---|
| `/api/sites` | GET | List your sites |
| `/api/sites` | POST | Add a new site |
| `/api/sites/:id` | GET | Get site details |
| `/api/sites/:id/config` | PUT | Update configuration |
| `/api/sites/:id/tier` | PUT | Change subscription tier |
| `/api/sites/:id` | DELETE | Delete a site |
| `/api/sites/:id/snippet` | GET | Get install code snippet |
| `/api/sites/:id/analytics` | GET | Get analytics data |

### License (Public)
| Endpoint | Method | Description |
|---|---|---|
| `/api/license/verify` | POST | Verify license key for domain (cached) |
| `/api/license/token` | POST | Exchange `siteId` (Origin must match domain) or `licenseKey` for session token |
| `/api/license/session` | POST | Validate session token (domain-locked) |
| `/api/license/track` | POST | Record analytics (`sessionToken` + Origin) |

### Sovereign (v2.0)
| Endpoint | Method | Description |
|---|---|---|
| `/api/sovereign/reputation/agents` | POST | Register a new agent |
| `/api/sovereign/reputation/attestations` | POST | Submit a trust attestation |
| `/api/sovereign/reputation/sites/:siteId` | GET | Get site reputation |
| `/api/sovereign/reputation/leaderboard` | GET | Get reputation leaderboard |
| `/api/sovereign/negotiation/rules` | POST | Create negotiation rule |
| `/api/sovereign/negotiation/rules/:siteId` | GET | Get rules for a site |
| `/api/sovereign/negotiation/sessions` | POST | Open negotiation session |
| `/api/sovereign/negotiation/sessions/:id/propose` | POST | Submit counter-offer |
| `/api/sovereign/negotiation/sessions/:id/confirm` | POST | Confirm a deal |
| `/api/sovereign/verify/price` | POST | Verify price (DOM vs vision) |
| `/api/sovereign/verify/text` | POST | Verify text accuracy |
| `/api/sovereign/verify/page` | POST | Full page verification |
| `/api/sovereign/dashboard/sovereign` | GET | Dashboard aggregate data |

### Agent Mesh (v2.3)
| Endpoint | Method | Description |
|---|---|---|
| `/api/mesh/agents` | POST | Register agent in mesh |
| `/api/mesh/agents` | GET | List mesh agents |
| `/api/mesh/channels` | GET | List communication channels |
| `/api/mesh/messages` | POST | Publish message to channel |
| `/api/mesh/messages/:channel` | GET | Get messages from channel |
| `/api/mesh/knowledge` | POST | Share knowledge to mesh |
| `/api/mesh/knowledge` | GET | Query knowledge base |
| `/api/mesh/votes` | POST | Start a vote |
| `/api/mesh/votes/:id/cast` | POST | Cast a vote |
| `/api/mesh/votes/:id/tally` | GET | Get vote results |

### Commander (v2.4)
| Endpoint | Method | Description |
|---|---|---|
| `/api/commander/missions` | POST | Create a new mission |
| `/api/commander/missions/:id/launch` | POST | Launch mission execution |
| `/api/commander/missions/:id` | GET | Get mission status |
| `/api/commander/missions` | GET | List all missions |
| `/api/commander/agents` | POST | Register an agent |
| `/api/commander/agents` | GET | List registered agents |
| `/api/commander/edge/nodes` | POST | Register edge node |
| `/api/commander/edge/nodes` | GET | List edge nodes |
| `/api/commander/ai/models` | GET | Discover local AI models |
| `/api/commander/ai/infer` | POST | Run local AI inference |
| `/api/commander/stats` | GET | Unified platform statistics |

### Premium v2
| Endpoint | Method | Description |
|---|---|---|
| `/api/premium/v2/memory` | POST | Store agent memory |
| `/api/premium/v2/memory/:agentId` | GET | Recall agent memories |
| `/api/premium/v2/memory/associate` | POST | Create memory association |
| `/api/premium/v2/memory/:id` | DELETE | Forget a memory |
| `/api/premium/v2/memory/consolidate` | POST | Consolidate old memories |
| `/api/premium/v2/vision/analyze` | POST | Analyze screenshot |
| `/api/premium/v2/vision/elements` | POST | Extract interactive elements |
| `/api/premium/v2/healing/corrections` | POST | Register selector correction |
| `/api/premium/v2/healing/resolve` | POST | Resolve broken selector |
| `/api/premium/v2/swarm/execute` | POST | Launch swarm task |
| `/api/premium/v2/swarm/:id` | GET | Get swarm results |
| `/api/premium/v2/plugins` | GET | List available plugins |
| `/api/premium/v2/plugins/:id/install` | POST | Install plugin for site |
| `/api/premium/v2/plugins/:id/hooks` | POST | Execute plugin hook |

### Discovery & Fairness
| Endpoint | Method | Description |
|---|---|---|
| `/api/discovery` | GET | WAB discovery document |
| `/api/discovery/search` | GET | Fairness-weighted site search |
| `/api/discovery/register` | POST | Register site in WAB directory |

### WAB Protocol (HTTP Transport)
| Endpoint | Method | Description |
|---|---|---|
| `/api/wab/session` | POST | Exchange session token |
| `/api/wab/actions` | GET | Get available actions |
| `/api/wab/execute` | POST | Execute action via HTTP |

### NoScript Fallback
| Endpoint | Method | Description |
|---|---|---|
| `/noscript/pixel.gif` | GET | 1×1 tracking pixel for non-JS environments |

---

## Bridge Script API

Once loaded, `window.AICommands` exposes:

| Method | Description |
|---|---|
| `getActions(category?)` | List available actions |
| `getAction(name)` | Get a specific action |
| `execute(name, params?)` | Execute an action |
| `readContent(selector)` | Read element content |
| `getPageInfo()` | Get page and bridge metadata |
| `waitForElement(selector, timeout?)` | Wait for DOM element |
| `waitForNavigation(timeout?)` | Wait for URL change |
| `registerAction(def)` | Register a custom action |
| `authenticate(key, meta?)` | Authenticate an agent |
| `refresh()` | Re-scan the page |
| `onReady(callback)` | Callback when bridge is ready |
| `events.on(event, cb)` | Subscribe to events |

---

## Configuration

```javascript
window.AIBridgeConfig = {
  // Recommended — copy siteId from dashboard snippet (no license key in HTML)
  siteId: "uuid-from-dashboard",
  configEndpoint: "/api/license/token",

  // Legacy: token exchange via license key (avoid embedding in public pages)
  // licenseKey: "WAB-...",

  agentPermissions: {
    readContent: true,      // Read page text
    click: true,            // Click elements
    fillForms: false,       // Fill/submit forms
    scroll: true,           // Scroll page
    navigate: false,        // Navigate pages
    apiAccess: false,       // Internal API calls (Pro+)
    automatedLogin: false,  // Auto login (Starter+)
    extractData: false      // Data extraction (Pro+)
  },
  restrictions: {
    allowedSelectors: [],
    blockedSelectors: [".private", "[data-private]"],
    requireLoginForActions: ["apiAccess"],
    rateLimit: { maxCallsPerMinute: 60 }
  },
  logging: { enabled: false, level: "basic" }
};
```

---

## Subscription Tiers

| Feature | Free | Starter | Pro | Enterprise |
|---|:---:|:---:|:---:|:---:|
| Auto-discovery | ✓ | ✓ | ✓ | ✓ |
| Click/Scroll | ✓ | ✓ | ✓ | ✓ |
| Form filling | ✓ | ✓ | ✓ | ✓ |
| Basic logging | ✓ | ✓ | ✓ | ✓ |
| Automated login | ✗ | ✓ | ✓ | ✓ |
| Analytics dashboard | ✗ | ✓ | ✓ | ✓ |
| API access | ✗ | ✗ | ✓ | ✓ |
| Data extraction | ✗ | ✗ | ✓ | ✓ |
| Custom rate limits | ✗ | ✗ | ✗ | ✓ |
| Webhooks | ✗ | ✗ | ✗ | ✓ |

---

## Tech Stack

- **Backend**: Node.js + Express + WebSocket (ws)
- **Database**: SQLite (via better-sqlite3) with migration runner
- **Auth**: JWT + bcrypt + session tokens (domain-locked)
- **Caching**: In-memory TTL cache + batched analytics queue
- **Payments**: Stripe integration with billing portal
- **Frontend**: Vanilla HTML/CSS/JS (no framework dependencies)
- **Framework Wrappers**: React, Vue 3, Svelte (optional)
- **LLM Integration**: LangChain adapter, MCP adapter
- **Security**: Helmet, CORS, CSP, multi-layer rate limiting
- **Containers**: Docker + Docker Compose
- **CI/CD**: GitHub Actions (test + auto-publish to npm)
- **Testing**: Jest + Supertest

---

## WebDriver BiDi Compatibility

WAB exposes a `window.__wab_bidi` interface for agents using standardized WebDriver BiDi protocol:

```javascript
// Get BiDi context
const context = window.__wab_bidi.getContext();

// Send BiDi command
const result = await window.__wab_bidi.send({
  id: 1,
  method: 'wab.executeAction',
  params: { name: 'signup', data: {} }
});

// Supported methods:
// wab.getContext, wab.getActions, wab.executeAction, wab.readContent, wab.getPageInfo
```

---

## Real-Time Analytics (WebSocket)

Connect to `ws://localhost:3000/ws/analytics` for live analytics. Use the built-in `WABWebSocket` client for automatic reconnection with exponential backoff:

```javascript
// Recommended: use the auto-reconnecting client
import { WABWebSocket } from './js/ws-client.js';

const ws = new WABWebSocket('jwt-token', 'site-id');
ws.on('analytic', (data) => console.log(data));
ws.on('reconnecting', ({ attempt, delay }) => console.log(`Reconnecting #${attempt}...`));
ws.connect();
```

```javascript
// Or connect manually
const ws = new WebSocket('ws://localhost:3000/ws/analytics');
ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: 'jwt-token', siteId: 'site-id' }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### WebSocket Message Protocol

**Client → Server Messages:**

| Message | Fields | Description |
|---|---|---|
| `auth` | `type`, `token`, `siteId` | Authenticate and subscribe to a site's events |

```json
{ "type": "auth", "token": "eyJhbGciOi...", "siteId": "uuid-of-site" }
```

**Server → Client Messages:**

| Message Type | Fields | Description |
|---|---|---|
| `auth:success` | `type`, `siteId` | Authentication succeeded |
| `analytic` | `type`, `timestamp`, `actionName`, `agentId`, `success` | Real-time analytics event |
| `error` | `type`, `message` | Error (invalid auth, malformed message) |

```json
// Success response
{ "type": "auth:success", "siteId": "uuid-of-site" }

// Analytics event
{
  "type": "analytic",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "actionName": "click-signup",
  "agentId": "agent-123",
  "triggerType": "click",
  "success": true
}

// Error
{ "type": "error", "message": "Invalid message or auth failed" }
```

**Connection Lifecycle:**
1. Connect to `ws://host:port/ws/analytics`
2. Send `auth` message with valid JWT and site ID
3. Receive `auth:success` confirmation
4. Receive `analytic` events as they occur
5. Server sends heartbeat pings every 30 seconds — dead connections are cleaned up automatically

---

## CDN & Versioning

Scripts are served at versioned URLs for cache-safe deployments:

| URL | Description |
|---|---|
| `/script/ai-agent-bridge.js` | Default path |
| `/v1/ai-agent-bridge.js` | Version-pinned (recommended) |
| `/latest/ai-agent-bridge.js` | Always latest (use with caution) |

---

## Docker

```bash
# Quick start
docker compose up -d

# Or build manually
docker build -t web-agent-bridge .
docker run -p 3000:3000 -e JWT_SECRET=your-secret -e JWT_SECRET_ADMIN=your-admin-secret web-agent-bridge
```

---

## Testing

```bash
npm test
```

Tests cover: authentication, site CRUD, config management, license verification, analytics tracking, and static pages.

---

## Agent SDK

WAB includes a built-in SDK for building AI agents. See [`sdk/README.md`](sdk/README.md) for full documentation.

```javascript
const puppeteer = require('puppeteer');
const { WABAgent } = require('web-agent-bridge/sdk');

const browser = await puppeteer.launch();
const page = await browser.newPage();
const agent = new WABAgent(page);

await agent.navigateAndWait('https://example.com');
const actions = await agent.getActions();
await agent.execute('signup', { email: 'user@test.com' });
await browser.close();
```

### SDK Extras

The SDK now includes additional helpers for advanced agent workflows:

```javascript
// Wait for GDPR consent before proceeding
await agent.waitForConsent();

// Discover all actions + page meta
const disc = await agent.discover();
console.log(disc.actions, disc.meta);

// Run a sequence of actions (stops on first failure by default)
const results = await agent.runPipeline([
  { name: 'login', params: { email: 'a@b.com', pass: 'secret' } },
  { name: 'addToCart', params: { sku: 'ABC123' } },
  { name: 'checkout' }
]);

// Run actions in parallel
const parallel = await agent.executeParallel([
  { name: 'getCartCount' },
  { name: 'getWishlistCount' }
]);

// Capture screenshot (base64) for vision agents
const b64 = await agent.screenshot({ fullPage: true });
```

---

## Framework Packages

### Vue 3

```bash
npm install @web-agent-bridge/vue
```

```javascript
import { useWAB, useWABAction } from '@web-agent-bridge/vue';

// In setup()
const { ready, execute } = useWAB({ siteUrl: 'https://example.com' });
const cart = useWABAction('addToCart');

// In template handler
await cart.run({ sku: 'ABC123' });
console.log(cart.result.value);
```

### Svelte

```bash
npm install @web-agent-bridge/svelte
```

```svelte
<script>
  import { createWAB, createWABAction } from '@web-agent-bridge/svelte';

  const wab = createWAB();
  const cart = createWABAction('addToCart');

  async function add() {
    await cart.run({ sku: 'ABC123' });
  }
</script>

{#if $cart.loading}Adding...{/if}
{#if $cart.result}Added!{/if}
<button on:click={add}>Add to Cart</button>
```

### LangChain / LangGraph

```bash
npm install @web-agent-bridge/langchain
```

```javascript
const { WABToolkit } = require('@web-agent-bridge/langchain');
const { ChatOpenAI } = require('@langchain/openai');
const { AgentExecutor, createOpenAIToolsAgent } = require('langchain/agents');

// HTTP mode — discover + execute via the WAB server
const toolkit = new WABToolkit({ siteUrl: 'https://shop.example.com' });
const tools = await toolkit.getTools();

// Browser mode — use with Puppeteer/Playwright
const { WABAgent } = require('web-agent-bridge/sdk');
const toolkit2 = new WABToolkit({ agent: new WABAgent(page) });
const tools2 = await toolkit2.getTools();

// Pass tools to any LangChain agent
const llm = new ChatOpenAI({ model: 'gpt-4o' });
const agent = await createOpenAIToolsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });
await executor.invoke({ input: 'Add the first product to my cart' });
```

---

## GDPR / CCPA Consent

Load the consent script after `wab.min.js` to gate agent actions behind user consent:

```html
<script src="/script/wab.min.js"></script>
<script src="/script/wab-consent.js"></script>
<script>
  WABConsent.showBanner({
    policyUrl: '/privacy',
    message: 'Allow AI agents to interact with this page?',
    onAccept: () => WAB.init({ siteUrl: location.origin }),
    onDecline: () => console.log('Agent access declined')
  });
</script>
```

SDK agents can check consent programmatically:

```javascript
const agent = new WABAgent(page);
const ok = await agent.hasConsent();      // true | false
await agent.waitForConsent();             // blocks until Allow is clicked
```

---

## Agent Examples

Ready-to-run agent examples in the [`examples/`](examples/) directory:

| File | Description |
|---|---|
| `puppeteer-agent.js` | Basic agent using Puppeteer + `window.AICommands` |
| `bidi-agent.js` | Agent using WebDriver BiDi protocol via `window.__wab_bidi` |
| `vision-agent.js` | Vision/NLP agent — resolves natural language intents to actions using a local keyword-based resolver (no external API) |
| `mcp-agent.js` | MCP adapter usage for Claude and GPT with tool discovery and execution |
| `cross-site-agent.js` | Multi-domain orchestration — compare prices across stores, aggregate data, find best deals |

## Framework + CMS Examples

Additional integration examples are available in:

| Path | Description |
|---|---|
| `examples/next-app-router/` | Next.js App Router integration with `@web-agent-bridge/react` |
| `examples/shopify-hydrogen/` | Hydrogen storefront integration with practical cart actions |
| `examples/wordpress-elementor/` | WordPress + Elementor setup with schema-assisted actions |
| `examples/saas-dashboard/` | Notion-style SaaS dashboard actions for KPI read + workflow triggers |

```bash
node examples/puppeteer-agent.js http://localhost:3000
node examples/bidi-agent.js http://localhost:3000
node examples/vision-agent.js http://localhost:3000
```

---

## Multi-Database Support

WAB defaults to SQLite but supports PostgreSQL and MySQL via database adapters.

```bash
# SQLite (default — no setup needed)
npm start

# PostgreSQL
npm install pg
DB_ADAPTER=postgresql DATABASE_URL=postgres://user:pass@localhost:5432/wab npm start

# MySQL
npm install mysql2
DB_ADAPTER=mysql DATABASE_URL=mysql://user:pass@localhost:3306/wab npm start
```

### When to Choose Which Database

| Scenario | Recommended DB | Why |
|---|---|---|
| Local dev / prototyping | SQLite | Zero setup, single file, instant |
| Small production (< 100 sites) | SQLite | Fast, no external dependencies |
| Medium production (100-10K sites) | PostgreSQL | Better concurrency, JSONB support |
| Large / enterprise production | PostgreSQL | Replication, backups, scalability |
| Existing MySQL infrastructure | MySQL | Integrate with what you already use |

See [`server/models/adapters/`](server/models/adapters/) for adapter implementations.

---

## Security Architecture

WAB implements defense-in-depth to protect the bridge from misuse:

### Secure License Exchange

1. **Dashboard snippet (recommended):** `siteId` + `configEndpoint`. The browser sends `POST /api/license/token` with `{ siteId }`; the server checks **Origin** against the site’s registered domain and issues a session token.
2. **Legacy:** `licenseKey` + `configEndpoint` (or deprecated `_licenseKey`) still works for token exchange but should not be embedded in public HTML.
3. **Session** is domain-locked (1h TTL); **analytics** use `sessionToken` on `POST /api/license/track` (not the license key).
4. **WebSocket** `/ws/analytics`: user JWT must **own** the `siteId`; admin JWT may observe any site.

```
Client                          Server
  │── POST /api/license/token ──→│  { siteId } + Origin header
  │                              │  domain match → sessionToken
  │←── { sessionToken, tier } ──│
  │── POST /api/license/track ─→│  { sessionToken, actionName } + Origin
```

**Production:** set `JWT_SECRET`, `JWT_SECRET_ADMIN`, `STRIPE_WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, and create the first admin via `BOOTSTRAP_ADMIN_*` or `node scripts/create-admin.js`.

### Security Sandbox

Every bridge instance runs inside a `SecuritySandbox` that provides:

- **Session tokens** — Unique cryptographic token per session prevents replay attacks
- **Origin validation** — Only whitelisted origins can interact with the bridge
- **Command validation** — All commands are validated for format, length, and blocklist
- **Audit logging** — Every action is logged with timestamp, agent fingerprint, and status
- **Escalation protection** — Attempts to access higher-tier features trigger automatic lockdown after 5 violations
- **Auto-lockdown** — Bridge becomes read-only when security violations are detected

```javascript
// Get security status
const info = bridge.getPageInfo();
console.log(info.security);
// { sandboxActive: true, locked: false, sessionToken: "a3f2..." }

// View audit log
const audit = bridge.security.getAuditLog(20);
```

### Selector Restrictions

Block sensitive page sections from agent access:

```javascript
window.AIBridgeConfig = {
  restrictions: {
    blockedSelectors: [".private", "[data-private]", "#payment-form"],
    allowedSelectors: [".public-content"]
  }
};
```

---

## Self-Healing Selectors

Modern SPAs frequently change their DOM structure. WAB's self-healing system ensures selectors keep working even when the page changes:

### How It Works

1. **Fingerprinting** — When actions are discovered, WAB stores a rich fingerprint of each element (tag, id, classes, text, ARIA attributes, position)
2. **7-Strategy Resolution** — When a selector breaks, WAB tries these strategies in order:
   - `data-wab-id` attribute (most stable — add to your HTML)
   - `data-testid` attribute
   - Element ID
   - `aria-label` (semantic, usually survives redesigns)
   - `name` attribute
   - Fuzzy text matching (bigram similarity > 70%)
   - Role + position heuristic
3. **SPA Observer** — A `MutationObserver` watches for DOM changes and automatically re-discovers actions with a 500ms debounce

```javascript
// Check healing stats
const info = bridge.getPageInfo();
console.log(info.selfHealing);
// { tracked: 12, healed: 3, failed: 0 }

// Listen for healing events
bridge.events.on('selector:healed', (data) => {
  console.log(`Healed: ${data.action} via ${data.strategy}`);
});
```

### Best Practices for Site Owners

Add `data-wab-id` attributes to critical elements for maximum stability:

```html
<button data-wab-id="signup-btn">Sign Up</button>
<form data-wab-id="login-form">...</form>
```

---

## Stealth Mode

For sites with anti-bot protection, WAB can simulate human-like interaction patterns. **Stealth mode requires explicit consent** to ensure ethical use.

```javascript
window.AIBridgeConfig = {
  stealth: {
    enabled: true,
    consent: true  // Required — confirms site owner authorizes human-like patterns
  }
};
```

> **⚠️ Ethical Use Policy:** Stealth mode is designed for accessibility and testing on your own websites. Using it to bypass security controls on sites you do not own may violate terms of service and applicable laws.

When enabled, all interactions use:

| Feature | Description |
|---|---|
| **Mouse event chain** | `mouseover → mouseenter → mousemove → mousedown → mouseup → click` with natural coordinates |
| **Typing simulation** | Character-by-character input with 30-120ms delays per keystroke |
| **Scroll easing** | Multi-step scrolling with variable speed |
| **Random delays** | 50-400ms natural pauses between actions |

```javascript
// Enable/disable at runtime (consent required)
bridge.stealth.enable(true);   // true = consent granted
bridge.stealth.disable();
```

---

## CLI

Install globally or use via npx:

```bash
# Run the server
npx web-agent-bridge start
npx web-agent-bridge start --port 8080

# Initialize a new project
npx web-agent-bridge init
```

---

## Environment Variables

See `.env.example`. Important:

```
PORT=3000
NODE_ENV=development
JWT_SECRET=long-random-user-signing-secret
JWT_SECRET_ADMIN=long-random-admin-signing-secret   # required in production
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.com
STRIPE_WEBHOOK_SECRET=whsec_...                     # Stripe webhook verify
CREDENTIALS_ENCRYPTION_KEY=...                      # optional SMTP password encryption
DB_ADAPTER=sqlite
DATABASE_URL=
```

First admin: set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` when the `admins` table is empty, or run `node scripts/create-admin.js <email> <password>`.

---

## Real-time Negotiation Engine

Site owners define negotiation rules. AI agents negotiate prices in multi-round sessions:

```javascript
// Agent opens a negotiation session
const session = await fetch('/api/sovereign/negotiation/sessions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteId: 'site-uuid',
    agentId: 'agent-id',
    originalPrice: 49.99,
    itemId: 'product-123',
    itemName: 'Olive Oil 1L'
  })
}).then(r => r.json());

// Agent makes a counter-offer
const counter = await fetch(`/api/sovereign/negotiation/sessions/${session.sessionId}/propose`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 'agent-id',
    proposedPrice: 39.99
  })
}).then(r => r.json());
// → { status: 'accepted', finalPrice: 42.49, message: 'Deal! ...' }
```

### Condition Types
| Condition | Description |
|---|---|
| `bulk_quantity` | Discounts based on order quantity |
| `loyalty` | Rewards for repeat customers |
| `time_based` | Happy hour / flash sale windows |
| `first_purchase` | Welcome discount for new buyers |
| `cart_value` | Minimum cart value threshold |
| `seasonal` | Date-range seasonal promotions |
| `membership` | Member-only pricing |
| `referral` | Referral-based discounts |

---

## Anti-Hallucination Shield

Cross-verification engine that catches AI hallucinations before they reach users:

```javascript
// Verify a price
const result = await fetch('/api/sovereign/verify/price', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteId: 'site-uuid',
    domValue: 29.99,
    visionValue: 29.99,
    category: 'electronics',
    itemName: 'USB Cable'
  })
}).then(r => r.json());
// → { verified: true, confidence: 0.98, severity: 'none', layers: { dom_vision: { match: true }, ... } }

// Verify text content
const textResult = await fetch('/api/sovereign/verify/text', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteId: 'site-uuid',
    source: 'dom',
    value: 'Free shipping on orders over $50',
    expected: 'Free shipping on orders over $50'
  })
}).then(r => r.json());
// → { verified: true, similarity: 1.0 }
```

### Verification Layers
1. **DOM vs Vision** — Compares DOM-extracted price with screenshot OCR value
2. **Market Benchmark** — Validates against historical price benchmarks for the category
3. **Temporal Consistency** — Checks if price changed suspiciously since last verification
4. **Composite Score** — Weighted combination of all layers with severity classification

---

## Community Agent Hub

Pre-built YAML agent templates for common use cases. Run any template from the CLI:

```bash
# List available templates
npx wab-agent templates

# Run a template
npx wab-agent run olive-oil-tunisia --budget 50 --region tunis

# Run with custom server
npx wab-agent run hotel-direct-booking --server https://yourserver.com --checkin 2025-01-15
```

### Available Templates
| Template | Description |
|---|---|
| `olive-oil-tunisia` | Find olive oil from small Tunisian farms |
| `hotel-direct-booking` | Book hotels directly, bypass aggregators |
| `artisan-marketplace` | Handmade products from independent artisans |
| `grocery-price-compare` | Compare grocery prices across local stores |
| `freelancer-direct` | Find freelancers without platform fees |
| `restaurant-direct` | Order from restaurants without delivery apps |
| `book-price-scout` | Find books from indie bookstores |
| `flight-deal-hunter` | Find flights direct from airlines |
| `electronics-price-tracker` | Track electronics prices with history |
| `local-services` | Find local service providers |
| `organic-farm-fresh` | Organic produce direct from farms |

### Create Your Own Template

```yaml
name: my-custom-agent
description: My custom agent template
goal: Find the best deals on custom products
version: "1.0"
target_sites:
  - https://example.com
parameters:
  budget:
    type: number
    default: 100
    description: Maximum budget
actions:
  - name: discover
    wab_action: discover
  - name: search
    wab_action: execute
    action_name: search
    params:
      query: "{{keyword}}"
  - name: negotiate
    wab_action: negotiate
    params:
      item_id: "{{item_id}}"
      max_price: "{{budget}}"
negotiation:
  enabled: true
  max_rounds: 3
  accept_threshold: 0.85
fairness_rules:
  - Prefer independent sellers over large platforms
  - Verify all prices before purchase
```

---

## Commander Agent System

The Commander is a local-first mission orchestration engine that decomposes high-level goals into task DAGs and distributes work across specialized agents:

```javascript
// Create a mission
const mission = await fetch('/api/commander/missions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: 'Find the cheapest olive oil across 5 stores',
    strategy: 'parallel',
    agents: ['researcher-1', 'analyst-1', 'negotiator-1']
  })
}).then(r => r.json());

// Launch mission
await fetch(`/api/commander/missions/${mission.id}/launch`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });

// Check status
const status = await fetch(`/api/commander/missions/${mission.id}`, { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json());
// → { status: 'completed', tasks: [...], result: { bestPrice: 12.99, store: 'farm-direct' } }
```

### Commander Capabilities
| Feature | Description |
|---|---|
| **Mission Decomposition** | Breaks high-level goals into task DAGs with dependency tracking |
| **Agent Registry** | Tracks agent capabilities, availability, and performance history |
| **Parallel Execution** | Runs independent tasks concurrently across multiple agents |
| **Learning Integration** | Records outcomes for reinforcement learning feedback |
| **Edge Coordination** | Distributes compute-heavy tasks to edge nodes |

---

## Edge Compute System

Transform every user device into a sovereign AI node — no central cloud required:

```javascript
// Register a device as an edge node
const node = await fetch('/api/commander/edge/nodes', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'my-laptop',
    capabilities: { cpu: 8, ram: 16384, gpu: true },
    supportedTasks: ['text-inference', 'vision-analysis', 'price-comparison']
  })
}).then(r => r.json());

// List available edge nodes
const nodes = await fetch('/api/commander/edge/nodes', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json());
```

| Feature | Description |
|---|---|
| **Hardware Profiling** | Detects CPU, RAM, GPU capabilities per node |
| **AES-256-GCM Encryption** | All inter-node data is encrypted end-to-end |
| **Weighted Load Balancing** | Routes tasks based on hardware + availability scores |
| **Heartbeat Health Monitoring** | Auto-failover when nodes become unresponsive |
| **Swarm Formation** | Capability-based clustering of nodes for distributed tasks |

---

## Swarm Execution Engine

Launch multiple agents in parallel to solve a single task, then intelligently merge their outputs:

```javascript
// Launch a swarm task
const swarm = await fetch('/api/premium/v2/swarm/execute', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task: 'Find best laptop deals under $1000',
    strategy: 'parallel',        // parallel | sequential | hybrid
    agentCount: 4,
    roles: ['researcher', 'analyst', 'price-checker', 'reviewer'],
    mergeStrategy: 'best-score'  // best-score | fairness-weighted | consensus
  })
}).then(r => r.json());
// → { swarmId: '...', agents: 4, status: 'running' }

// Get merged results
const results = await fetch(`/api/premium/v2/swarm/${swarm.swarmId}`, {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());
// → { status: 'completed', merged: { bestDeal: {...}, confidence: 0.94 } }
```

---

## Fairness Engine

A neutrality layer ensuring AI agents give equal opportunity to small and large sites, preventing monopolistic concentration of agent traffic:

```javascript
// Fairness-weighted search (instead of pure relevance)
const results = await fetch('/api/discovery/search?q=olive+oil&fairness=true', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());
// Small farms ranked alongside Amazon — weighted by neutrality score, not just SEO

// Register site in WAB directory
await fetch('/api/discovery/register', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    domain: 'small-farm.example.com',
    category: 'food',
    commissionRate: 0,        // Direct — no middleman
    independentSeller: true
  })
}).then(r => r.json());
```

### How Neutrality Scoring Works
| Factor | Weight | Description |
|---|---|---|
| **Configuration completeness** | 25% | How well the site has configured WAB |
| **Trust score** | 25% | Reputation attestations from the agent network |
| **Transparency** | 25% | Commission disclosure, pricing clarity |
| **Responsiveness** | 25% | API response time, uptime, action success rate |

Small independent sites with good WAB configuration can outrank large platforms on fairness-weighted searches.

---

## Agent Memory System

Persistent behavioral memory allowing agents to remember user preferences, learn patterns, and build associations:

```javascript
// Store a memory
await fetch('/api/premium/v2/memory', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 'agent-1',
    type: 'preference',         // preference | interaction | correction | pattern
    category: 'purchase',       // navigation | purchase | search | form | custom
    key: 'preferred-brand',
    value: 'organic-only',
    importance: 0.9
  })
}).then(r => r.json());

// Recall memories
const memories = await fetch('/api/premium/v2/memory/agent-1?category=purchase&limit=10', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());

// Create associations
await fetch('/api/premium/v2/memory/associate', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceId: 'memory-1',
    targetId: 'memory-2',
    relationship: 'leads_to'   // leads_to | similar_to | replaces | depends_on
  })
}).then(r => r.json());
```

---

## Vision Analysis Service

Multi-provider screenshot analysis for interactive element detection and data extraction:

```javascript
// Analyze a screenshot
const analysis = await fetch('/api/premium/v2/vision/analyze', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    screenshot: 'base64-encoded-image...',
    provider: 'auto',          // auto | local | openai | anthropic | ollama
    extractElements: true
  })
}).then(r => r.json());
// → { elements: [{ type: 'button', text: 'Add to Cart', selector: '#add-btn', confidence: 0.95, bbox: [120, 340, 200, 40] }] }

// Extract interactive elements only
const elements = await fetch('/api/premium/v2/vision/elements', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ screenshot: 'base64...', types: ['button', 'input', 'link'] })
}).then(r => r.json());
```

### Supported Vision Providers
| Provider | Local? | Description |
|---|---|---|
| **Moondream** | ✅ | Lightweight local vision model |
| **Ollama** | ✅ | Local models via Ollama (llava, bakllava) |
| **OpenAI** | ❌ | GPT-4 Vision |
| **Anthropic** | ❌ | Claude Vision |

---

## Plugin Architecture

Dynamic plugin system allowing third-party extensions:

```javascript
// List available plugins
const plugins = await fetch('/api/premium/v2/plugins', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());

// Install a plugin for your site
await fetch('/api/premium/v2/plugins/price-alert/install', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ siteId: 'site-uuid', config: { threshold: 10 } })
}).then(r => r.json());

// Execute a plugin hook
await fetch('/api/premium/v2/plugins/price-alert/hooks', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ hook: 'onPriceChange', data: { oldPrice: 49.99, newPrice: 39.99 } })
}).then(r => r.json());
```

---

## Premium Traffic Intelligence

Advanced bot detection and traffic profiling for premium sites:

| Capability | Description |
|---|---|
| **30+ Bot Types** | Detects Google, Bing, ChatGPT, Claude, Perplexity, and more |
| **Behavioral Profiling** | Classifies agent behavior by signature, platform, and type |
| **Anomaly Detection** | Spike detection and pattern analysis for unusual traffic |
| **Security Exploit Detection** | Flags SQL injection, XSS patterns, and rate anomalies |
| **Webhook Alerting** | Triggers webhooks on suspicious activity |
| **Compliance Audit Logging** | Full audit trail for regulatory compliance |

---

## WAB-MCP Adapter

Expose WAB site capabilities as [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools for Claude, GPT, Gemini, and other MCP-compatible AI agents:

```javascript
const { WABMCPAdapter } = require('wab-mcp-adapter');

// Create adapter for a WAB-enabled site
const adapter = new WABMCPAdapter({
  siteUrl: 'https://shop.example.com',
  transport: 'http'           // http | websocket | direct
});

// Get MCP tool definitions
const tools = await adapter.getTools();
// → [{ name: 'discover', description: '...', inputSchema: {...} }, ...]

// Execute via MCP
const result = await adapter.executeTool('execute_action', {
  name: 'addToCart',
  params: { sku: 'ABC123' }
});
```

### Built-in MCP Tools
| Tool | Description |
|---|---|
| `discover` | Auto-discover available actions on a WAB site |
| `get_actions` | Get list of all actions with parameters |
| `execute_action` | Execute a specific action |
| `read_content` | Read content from the page |
| `get_page_info` | Get page metadata |
| `fairness_search` | Search the WAB directory with fairness weighting |
| `authenticate` | Authenticate an agent with the site |

---

## WAB Browser (Desktop)

Standalone Electron desktop browser with built-in privacy and fairness features:

- **Ad Blocker** — 80+ blocked ad domains + URL pattern matching + cosmetic CSS rules
- **Scam Shield** — Detects suspicious TLDs and brand-name spoofing in URLs
- **Fairness Ranking** — Prioritizes independent sites, flags big-tech concentration
- **Agent Chat** — Built-in AI assistant panel for browsing help
- **Notifications** — Page analysis with safety and fairness alerts
- **Ghost Mode** — Privacy-first browsing with no tracking
- **Smart Search** — DuckDuckGo integration for private search
- **Desktop/Mobile Toggle** — Switch user-agent for responsive testing

```bash
# Run the WAB Browser
cd wab-browser
npm install
npx electron .

# Build installer (Windows NSIS)
npm run build:win
```

---

## PWA Browser (Mobile)

Progressive Web App browser for Android and iOS — installable from any mobile browser:

- **Ad Blocker** — 45+ ad domain blacklist + URL pattern matching
- **Scam Detection** — Suspicious TLD alerts and brand-name spoofing checks
- **Fairness Mode** — Filters big-tech sites to promote independent alternatives
- **Offline-First** — Service worker caches shell assets for offline launch
- **Private Search** — DuckDuckGo integration (no Google tracking)
- **Agent Chat** — AI assistant with remote + local fallback

Install at: `https://yourserver.com/pwa/`

---

## WordPress Plugin

Native WordPress plugin for adding WAB support to any WordPress site:

```bash
# Install
cp -r web-agent-bridge-wordpress/ /wp-content/plugins/web-agent-bridge/
```

| Feature | Description |
|---|---|
| **Settings Page** | Configure API base URL, site ID, permissions |
| **Per-Page Actions** | Meta box for adding custom WAB actions per page/post |
| **Discovery Document** | Auto-generates WAB discovery endpoint |
| **Dashboard Widget** | Shows WAB status and agent interaction stats |
| **Shortcode** | `[wab_bridge]` shortcode for embedding WAB on specific pages |
| **Hooks API** | `wab_before_action` / `wab_after_action` for custom logic |

See [`web-agent-bridge-wordpress/README.md`](web-agent-bridge-wordpress/README.md) for full documentation.

---

## WAB Protocol Specification

The full normative specification is available at [`docs/SPEC.md`](docs/SPEC.md):

| Layer | Description |
|---|---|
| **Protocol Layer** | Discovery document format, command protocol, fairness protocol |
| **Runtime Layer** | `window.AICommands` interface, auto-discovery engine, security sandbox |
| **Transport Layer** | JavaScript global, WebSocket, HTTP, WebDriver BiDi, MCP |

### 5-Phase Lifecycle
1. **Discover** — Agent finds WAB discovery document (`.well-known/wab.json` or script tag)
2. **Authenticate** — Agent exchanges `siteId` for session token
3. **Plan** — Agent reads available actions and page metadata
4. **Execute** — Agent runs actions through the bridge
5. **Confirm** — Results are verified via Anti-Hallucination Shield

---

## License

MIT — Free to use, modify, and distribute.
