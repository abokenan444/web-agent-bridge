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

### v2.0 — Digital Fortress Features

- **Real-time Negotiation Engine** — AI agents negotiate prices directly with WAB-enabled sites using multi-round sessions, 8 condition types, and 4 discount types
- **Anti-Hallucination Shield** — Cross-verification engine comparing DOM vs vision screenshots, market benchmark validation, temporal consistency checks, and Levenshtein text similarity scoring
- **Decentralized Reputation System** — Cryptographic trust attestations from the agent network with weighted scoring, trust levels (emerging → verified → exemplary), and global leaderboard
- **Sovereign Dashboard** — Real-time command center with fairness radar, privacy shield, negotiation logs, verification checks, and AI model switcher
- **Community Agent Hub** — 11 pre-built YAML agent templates (hotel booking, grocery comparison, artisan marketplace, flight deals, etc.) with CLI runner: `npx wab-agent run template.yaml`
- **AI Brain Swapping** — Switch between Llama 3, GPT-4, Claude, Gemini, Mistral, or Ollama (local) without reconfiguration

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
├── server/                 # Express.js backend
│   ├── index.js            # Server entry point
│   ├── routes/
│   │   ├── auth.js         # Authentication (register/login)
│   │   ├── api.js          # Sites, config, analytics API
│   │   ├── license.js      # License verification, token exchange & tracking
│   │   ├── admin.js        # Admin dashboard API
│   │   ├── billing.js      # Stripe billing integration
│   │   └── sovereign.js    # v2.0: negotiation, reputation, verification
│   ├── services/
│   │   ├── negotiation.js  # Real-time negotiation engine
│   │   ├── verification.js # Anti-hallucination shield
│   │   └── reputation.js   # Decentralized reputation system
│   ├── middleware/
│   │   └── auth.js         # JWT authentication middleware
│   ├── models/
│   │   └── db.js           # SQLite database & operations
│   ├── migrations/         # Numbered SQL migrations
│   └── utils/
│       ├── cache.js        # In-memory cache + analytics queue
│       └── migrate.js      # Migration runner
├── public/                 # Frontend
│   ├── index.html          # Landing page
│   ├── dashboard.html      # Management dashboard
│   ├── docs.html           # Documentation
│   ├── login.html          # Sign in
│   ├── register.html       # Sign up
│   ├── admin/              # Admin panel
│   ├── js/
│   │   └── ws-client.js    # WebSocket client with auto-reconnect
│   └── css/styles.css      # Design system
├── script/
│   └── ai-agent-bridge.js  # The bridge script (embed in websites)
├── examples/               # Agent examples (Puppeteer, BiDi, Vision)
├── packages/               # Framework wrappers
│   ├── react/              # @web-agent-bridge/react
│   ├── vue/                # @web-agent-bridge/vue
│   ├── svelte/             # @web-agent-bridge/svelte
│   └── langchain/          # @web-agent-bridge/langchain
├── sdk/                    # Agent SDK for Puppeteer/Playwright
├── bin/
│   ├── cli.js              # CLI entry point (wab-agent)
│   └── agent-runner.js     # YAML template runner
├── templates/              # Community Agent Hub YAML templates
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

## License

MIT — Free to use, modify, and distribute.
