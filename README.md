# Web Agent Bridge (WAB)

[![npm](https://img.shields.io/npm/v/web-agent-bridge)](https://www.npmjs.com/package/web-agent-bridge)
[![CI](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/abokenan444/web-agent-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://hub.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Socket](https://img.shields.io/badge/Socket-Verified-brightgreen.svg)](https://socket.dev/npm/package/web-agent-bridge)

> **robots.txt told bots what NOT to do. WAB tells AI agents what they CAN do.**

**English** | **[العربية](README.ar.md)** | **[Protocol Spec](docs/SPEC.md)** | **[Socket Report](https://socket.dev/npm/package/web-agent-bridge)**

WAB is an **open protocol + runtime** for AI agents to interact with websites — the **OpenAPI for human-facing pages**. It provides a standardized discovery format (`agent-bridge.json`), a command protocol, and a fairness layer that ensures small businesses get equal visibility alongside large platforms.

WAB transforms websites from opaque HTML into **agent-readable endpoints** with declared capabilities, permissions, and actions. AI agents discover what a site offers, authenticate, and execute commands through a uniform protocol — no DOM scraping, no guesswork, no bias toward big brands.

### Architecture: Protocol + Runtime + Ecosystem

```
┌──────────────────────────────────────────────────────────┐
│                    WAB Protocol (Spec)                    │
│  agent-bridge.json · Commands · Lifecycle · Fairness     │
├────────────┬───────────────────┬─────────────────────────┤
│ JS Runtime │  HTTP Transport   │  MCP Adapter            │
│ AICommands │  REST + WebSocket │  WAB → MCP Tools        │
├────────────┴───────────────────┴─────────────────────────┤
│               Discovery Registry + Fairness Engine       │
└──────────────────────────────────────────────────────────┘
```

### Three Paths to WAB

| Path | For | How |
|---|---|---|
| **🏢 Website Owner** | Control how AI interacts with your site | Embed the script, publish `agent-bridge.json` |
| **🤖 Agent Developer** | Build reliable agents that work on any WAB-enabled site | Use `window.AICommands`, the Agent SDK, or the MCP Adapter |
| **🔧 Self-Hosting** | Run the full WAB platform for your organization | Clone, deploy, manage licenses & analytics |
| **🔌 MCP Integration** | Connect WAB to Claude, GPT, or any MCP-compatible agent | Use `wab-mcp-adapter` |
| **WordPress** | Sites powered by WP | Use the **[Web Agent Bridge WordPress plugin](web-agent-bridge-wordpress/README.md)** |

---

## What's New in v1.1.0

- **WAB Protocol Specification v1.0** — Formal protocol spec (`docs/SPEC.md`) with discovery format, command protocol, lifecycle, and fairness layer
- **Discovery Protocol** — Sites publish `agent-bridge.json` or `/.well-known/wab.json` for agent discovery
- **MCP Adapter** — `wab-mcp-adapter` converts WAB actions into MCP tools for Claude/GPT integration
- **Fairness Engine** — Neutrality layer ensures equal visibility for small businesses and independent sites
- **Discovery Registry** — Public searchable directory of WAB-enabled sites with fairness-weighted results
- **9 Protocol Commands** — `wab.discover`, `wab.getContext`, `wab.getActions`, `wab.executeAction`, `wab.readContent`, `wab.getPageInfo`, `wab.authenticate`, `wab.subscribe`, `wab.ping`

---

## Features

### Protocol Layer
- **WAB Specification v1.0** — Formal protocol spec defining discovery, commands, lifecycle, and fairness ([docs/SPEC.md](docs/SPEC.md))
- **Discovery Protocol** — Sites declare capabilities via `agent-bridge.json` or `/.well-known/wab.json`
- **Command Protocol** — 9 standard methods with request/response format (transport-agnostic)
- **Lifecycle Protocol** — Discover → Authenticate → Plan → Execute → Confirm
- **MCP Compatibility** — Full adapter for Model Context Protocol (Claude, GPT, LangChain)

### Fairness & Neutrality
- **Fairness Engine** — Neutrality scoring ensures small businesses get equal agent visibility
- **Discovery Registry** — Public directory of WAB-enabled sites with anti-bias ranking
- **Commission Transparency** — Sites declare commission rates; agents can favor direct providers
- **Independent Business Priority** — Self-declared independent sites get fairness scoring boost

### Runtime
- **Auto-Discovery** — Automatically detects buttons, forms, and navigation on the page
- **Permission System** — Granular control over what AI agents can do (click, fill forms, API access, etc.)
- **Standardized Interface** — Unified `window.AICommands` object any agent can consume
- **Self-Healing Selectors** — Resilient element resolution with 7-strategy fuzzy matching for SPAs
- **Security Sandbox** — Origin validation, session tokens, command signing, audit logging, auto-lockdown
- **Stealth Mode** — Human-like interaction patterns (requires explicit consent)
- **NoJS Fallback** — CSS tracking, pixel tracking, and SSR bridge for JavaScript-disabled environments

### Infrastructure
- **Secure License Exchange** — Embed uses `siteId` + token exchange; keys stay in the dashboard
- **Rate Limiting** — Multi-dimensional abuse protection (IP + license key + site)
- **Analytics Dashboard** — Track how AI agents interact with your site
- **Real-Time Analytics** — WebSocket-based live event streaming with auto-reconnection
- **WebDriver BiDi Compatible** — Standard protocol support via `window.__wab_bidi`
- **CDN Versioning** — Serve scripts via versioned URLs (`/v1/ai-agent-bridge.js`, `/latest/ai-agent-bridge.js`)
- **Docker Ready** — One-command deployment with Docker Compose
- **Multi-Database** — SQLite (default), PostgreSQL, MySQL via pluggable adapters
- **Agent SDK** — Built-in SDK for building AI agents with Puppeteer/Playwright
- **Admin Dashboard** — User management, tier grants, system analytics
- **Stripe Integration** — Payment processing with customer portal

---

## Premium Services (webagentbridge.com)

The open-source core is free forever. For teams and businesses that need more, **[webagentbridge.com](https://webagentbridge.com/premium)** offers paid add-ons and higher-tier plans:

| # | Service | Plans |
|---|---------|-------|
| 1 | **Agent Traffic Intelligence** — Deep analytics: agent type, platform, country, behavioral classification, anomaly alerts | Starter+ |
| 2 | **Advanced Exploit Shield** — Behavioral fingerprint blocking, unauthorized command detection, periodic security reports | Pro+ |
| 3 | **Pre-built Smart Actions Library** — Ready-made action packs for WooCommerce, Shopify, WordPress, Salesforce with auto-updates | Starter+ |
| 4 | **Custom AI Agents as a Service** — Visual agent builder, task scheduling, cloud-based execution | Pro+ |
| 5 | **CRM & Cloud Integrations** — Salesforce, HubSpot, Zoho; export to BigQuery/Snowflake/Datadog; custom webhooks | Pro+ |
| 6 | **Multi-Tenant Permission Management** — Sub-users, per-user quotas, central control panel for agencies | Enterprise |
| 7 | **AI-Powered Priority Support** — Smart chatbot, live video sessions, SLA from 15 min (Enterprise) to same-day (Starter) | Starter+ |
| 8 | **Custom Bridge Script** — Plugin-based custom actions, performance optimization, automatic zero-day patches | Pro+ |
| 9 | **Stealth Mode Pro** — Customizable human-like behavior profiles, anti-detection bypass, monthly fingerprint updates | Pro+ |
| 10 | **Private CDN** — Global edge network, custom domain (`bridge.yoursite.com`), geo performance stats | Pro+ |
| 11 | **Extended Audit Logs & Compliance** — 7-year retention, HIPAA/GDPR/SOC2 settings, signed PDF/CSV exports | Enterprise |
| 12 | **Virtual Sandbox Environment** — Isolated test environment, simulated agent traffic, before/after benchmarks | Enterprise |

Plans: **Free** (open source) → **Starter $9/mo** → **Pro $29/mo** → **Enterprise (custom)**. Visit [webagentbridge.com/premium](https://webagentbridge.com/premium) for details.

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

## Discovery Protocol (`agent-bridge.json`)

Any website can declare its WAB capabilities by serving a discovery document at `/agent-bridge.json` or `/.well-known/wab.json`. AI agents fetch this file to understand what a site offers before interacting.

```json
{
  "wab_version": "1.0",
  "provider": {
    "name": "Local Bookshop",
    "domain": "localbookshop.com",
    "category": "e-commerce",
    "description": "Independent bookshop"
  },
  "capabilities": {
    "commands": ["readContent", "click", "fillForms"],
    "permissions": { "readContent": true, "click": true, "fillForms": true },
    "tier": "starter",
    "transport": ["js_global", "http"]
  },
  "agent_access": {
    "bridge_script": "/script/ai-agent-bridge.js",
    "api_base": "/api/license",
    "selectors": { "search": "#search-input", "cart": ".add-to-cart" }
  },
  "fairness": {
    "is_independent": true,
    "commission_rate": 0,
    "direct_benefit": "Owner is the producer",
    "neutrality_score": 85
  },
  "security": {
    "session_required": true,
    "origin_validation": true,
    "rate_limit": 60,
    "sandbox": true
  }
}
```

WAB servers auto-generate this document from each site's configuration. No manual file creation needed — register your site and the discovery endpoint is live.

### Discovery API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/.well-known/wab.json` | GET | Discovery document (domain-matched) |
| `/agent-bridge.json` | GET | Alternative discovery location |
| `/api/discovery/:siteId` | GET | Discovery document for a specific site |
| `/api/discovery/registry` | GET | Public directory of WAB-enabled sites |
| `/api/discovery/search` | GET | Fairness-weighted site search |
| `/api/discovery/register` | POST | Register site in directory (authenticated) |

---

## MCP Adapter (Model Context Protocol)

The `wab-mcp-adapter` converts WAB capabilities into MCP tools, so Claude, GPT, LangChain, or any MCP-compatible agent can interact with WAB-enabled sites.

```javascript
const { WABMCPAdapter } = require('web-agent-bridge/wab-mcp-adapter');

const adapter = new WABMCPAdapter({
  siteUrl: 'https://example.com',
  transport: 'http'
});

// Discover site capabilities
const discovery = await adapter.discover();

// Get all available MCP tools
const tools = await adapter.getTools();
// → [{ name: 'wab_discover', ... }, { name: 'wab_click_signup', ... }, ...]

// Execute a tool (just like any MCP tool call)
const result = await adapter.executeTool('wab_execute_action', {
  name: 'signup',
  data: { email: 'user@test.com' }
});
```

### Built-in MCP Tools

| Tool | Description |
|---|---|
| `wab_discover` | Discover site capabilities and fairness data |
| `wab_get_actions` | List all available actions |
| `wab_execute_action` | Execute any action by name |
| `wab_read_content` | Read page content by CSS selector |
| `wab_get_page_info` | Get page metadata and bridge status |
| `wab_fairness_search` | Search WAB registry with fairness-weighted results |
| `wab_authenticate` | Authenticate with a WAB site |

See [`wab-mcp-adapter/README.md`](wab-mcp-adapter/README.md) for the full API reference.

---

## Fairness Engine

WAB includes a **Neutrality Layer** — a fairness engine that prevents AI agents from systematically favoring large platforms over small businesses.

### How It Works

1. **Neutrality Scoring** — Each site gets a score (0-100) based on config quality, trust signatures, and commission transparency — not brand recognition
2. **Anti-Bias Ranking** — Search results are fairness-weighted: independent businesses get +15%, transparent commission sites get +10%
3. **Position Rotation** — Top results are shuffled to prevent position lock-in
4. **Monopoly Prevention** — No single provider can dominate more than 30% of top results

### Register Your Site

```bash
# Register in the WAB discovery directory
curl -X POST https://yourserver.com/api/discovery/register \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "your-site-uuid",
    "category": "e-commerce",
    "is_independent": true,
    "commission_rate": 0,
    "direct_benefit": "Products from local artisans",
    "tags": ["handmade", "local", "organic"]
  }'
```

---

## Advanced Premium Features

The following capabilities extend WAB with AI-powered intelligence layers. They require a **premium subscription** — see [webagentbridge.com/premium](https://webagentbridge.com/premium) for plans.

### Agent Memory System

Long-term memory for AI agents using vector embeddings. Agents remember user preferences, past interactions, and successful navigation paths across sessions.

| Capability | Description |
|---|---|
| **Vector Embeddings** | TF-IDF based similarity search for intelligent recall |
| **Memory Consolidation** | Auto-merges duplicate memories and decays stale ones |
| **Session Tracking** | Maintains context across multiple agent sessions |
| **Preference Management** | Stores and retrieves user preferences for personalized interactions |

### Self-Healing Selectors (Premium)

Automatic CSS/XPath selector repair when websites change their DOM structure. Goes beyond the built-in 7-strategy resolution with community-powered healing.

| Strategy | Description |
|---|---|
| **Attribute Match** | Finds elements by matching known attributes |
| **ID Match** | Resolves elements by ID similarity |
| **Text Similarity** | Levenshtein-based fuzzy text matching |
| **Structural Match** | Compares DOM tree position and hierarchy |
| **Class Match** | Identifies elements by CSS class patterns |
| **Community Corrections** | Shared selector fixes across the WAB ecosystem |

Includes DOM drift detection and element snapshot comparison for proactive repair before selectors break.

### Multimodal Vision

Integrates local and cloud vision models so AI agents can "see" web pages as images instead of parsing raw DOM.

| Model | Type |
|---|---|
| **Moondream** | Local (lightweight) |
| **LLaVA** | Local (high quality) |
| **GPT-4V** | Cloud (OpenAI) |
| **Claude Vision** | Cloud (Anthropic) |

- Automatic UI element extraction with bounding boxes and suggested selectors
- Screenshot comparison for visual regression detection
- Encrypted API key storage (AES-256-GCM)

### Agent Swarm

Multi-agent orchestration for complex tasks that benefit from parallel or collaborative execution.

| Strategy | Description |
|---|---|
| **Parallel** | Run multiple agents simultaneously on independent subtasks |
| **Sequential** | Chain agents in order, passing results forward |
| **Competitive** | Race agents against each other, take the fastest result |
| **Collaborative** | Agents share findings and build on each other's work |

- Built-in fairness weighting to surface small/indie sites in swarm results
- Real-time task monitoring and result merging
- Automatic price/content extraction from target URLs
- Consensus-based result validation across multiple agents

### Plugin Marketplace

Extensible hook system with 16 integration points for customizing WAB behavior.

| Official Plugin | Description |
|---|---|
| `fairness-boost` | Amplifies fairness scoring for indie sites |
| `security-monitor` | Real-time threat detection and alerts |
| `analytics-enhanced` | Extended analytics with behavioral classification |
| `auto-healer` | Proactive selector repair using DOM monitoring |
| `memory-optimizer` | Memory consolidation and cleanup scheduling |

- JSON Schema config validation for all plugins
- Community plugin ratings and download tracking
- Sandboxed handler execution via `Function()` constructor

### Premium API Endpoints

| Route Group | Feature | Endpoints |
|---|---|---|
| `/api/premium/memory/*` | Agent Memory | 13 |
| `/api/premium/healing/*` | Self-Healing | 9 |
| `/api/premium/vision/*` | Vision Inference | 9 |
| `/api/premium/swarm/*` | Agent Swarm | 10 |
| `/api/premium/plugins/*` | Plugin Marketplace | 12 |

---

## Project Structure

```
web-agent-bridge/
├── docs/
│   └── SPEC.md             # WAB Protocol Specification v1.0
├── server/                 # Express.js backend
│   ├── index.js            # Server entry point
│   ├── routes/
│   │   ├── auth.js         # Authentication (register/login)
│   │   ├── api.js          # Sites, config, analytics API
│   │   ├── license.js      # License verification & token exchange
│   │   ├── discovery.js    # Discovery protocol endpoints
│   │   ├── noscript.js     # NoJS fallback (pixel, CSS, SSR)
│   │   ├── admin.js        # Admin dashboard API
│   │   └── billing.js      # Stripe billing integration
│   ├── services/
│   │   └── fairness.js     # Fairness engine & neutrality layer
│   ├── middleware/
│   │   └── auth.js         # JWT authentication middleware
│   ├── models/
│   │   └── db.js           # SQLite database & operations
│   ├── migrations/         # Numbered SQL migrations
│   └── utils/
│       ├── cache.js        # In-memory cache + analytics queue
│       └── migrate.js      # Migration runner
├── wab-mcp-adapter/        # MCP adapter for WAB → Claude/GPT
│   ├── index.js            # WABMCPAdapter class
│   ├── package.json
│   └── README.md
├── public/                 # Frontend
│   ├── index.html          # Landing page
│   ├── dashboard.html      # Management dashboard
│   ├── docs.html           # Documentation
│   ├── admin/              # Admin panel
│   ├── js/                 # Client-side utilities
│   └── css/styles.css      # Design system
├── script/
│   └── ai-agent-bridge.js  # The bridge script (embed in websites)
├── examples/               # Agent examples (Puppeteer, BiDi, MCP, Vision)
├── sdk/                    # Agent SDK for Puppeteer/Playwright
├── .env                    # Environment variables
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
| `/api/license/track` | POST | Record analytics (`sessionToken` + Origin; legacy `licenseKey` only if `ALLOW_LEGACY_LICENSE_TRACK`) |

### Discovery Protocol (Public)
| Endpoint | Method | Description |
|---|---|---|
| `/.well-known/wab.json` | GET | Discovery document for the requesting domain |
| `/agent-bridge.json` | GET | Alternative discovery location |
| `/api/discovery/:siteId` | GET | Discovery document for a specific site |
| `/api/discovery/registry` | GET | Public directory of WAB-enabled sites |
| `/api/discovery/search?q=&category=` | GET | Fairness-weighted site search |
| `/api/discovery/register` | POST | Register site in directory (authenticated) |

---

## Bridge Script API

Once loaded, `window.AICommands` exposes:

| Method | Description |
|---|---|
| `discover()` | Get full discovery document with protocol info and fairness data |
| `ping()` | Health check — returns version, protocol, ready state |
| `getActions(category?)` | List available actions |
| `getAction(name)` | Get a specific action |
| `execute(name, params?)` | Execute an action |
| `readContent(selector)` | Read element content |
| `getPageInfo()` | Get page and bridge metadata |
| `subscribe(event, callback)` | Subscribe to events with subscription ID |
| `unsubscribe(subscriptionId)` | Unsubscribe from events |
| `waitForElement(selector, timeout?)` | Wait for DOM element |
| `waitForNavigation(timeout?)` | Wait for URL change |
| `registerAction(def)` | Register a custom action |
| `authenticate(key, meta?)` | Authenticate an agent |
| `refresh()` | Re-scan the page |
| `onReady(callback)` | Callback when bridge is ready |
| `events.on(event, cb)` | Subscribe to raw events |

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

- **Protocol**: WAB Specification v1.0 with RFC 2119 conformance levels
- **Backend**: Node.js + Express + WebSocket (ws)
- **Database**: SQLite (via better-sqlite3) with migration runner
- **Auth**: JWT + bcrypt + session tokens (domain-locked)
- **MCP**: WAB-to-MCP adapter for Claude, GPT, LangChain integration
- **Fairness**: Neutrality engine with anti-bias ranking and monopoly prevention
- **Discovery**: Auto-generated `agent-bridge.json` + public registry
- **Caching**: In-memory TTL cache + batched analytics queue
- **Payments**: Stripe integration with billing portal
- **Frontend**: Vanilla HTML/CSS/JS (no framework dependencies)
- **Security**: Helmet, CORS, CSP, multi-layer rate limiting, sandbox
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
// wab.discover, wab.getContext, wab.getActions, wab.executeAction,
// wab.readContent, wab.getPageInfo, wab.authenticate, wab.subscribe, wab.ping
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

---

## Agent Examples

Ready-to-run agent examples in the [`examples/`](examples/) directory:

| File | Description |
|---|---|
| `puppeteer-agent.js` | Basic agent using Puppeteer + `window.AICommands` |
| `bidi-agent.js` | Agent using WebDriver BiDi protocol via `window.__wab_bidi` |
| `mcp-agent.js` | MCP adapter demo — WAB actions as MCP tools for Claude/GPT |
| `vision-agent.js` | Vision/NLP agent — resolves natural language intents to actions using a local keyword-based resolver (no external API) |

```bash
node examples/puppeteer-agent.js http://localhost:3000
node examples/bidi-agent.js http://localhost:3000
node examples/mcp-agent.js http://localhost:3000
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

## License

MIT — Free to use, modify, and distribute.
