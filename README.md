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
- **Permission System** — Granular control over what AI agents can do (click, fill forms, API access, etc.)
- **Standardized Interface** — Unified `window.AICommands` object any agent can consume
- **Secure License Exchange** — Server-side token exchange; license keys never exposed in page source
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
- **Admin Dashboard** — User management, tier grants, system analytics
- **Stripe Integration** — Payment processing with customer portal

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
<!-- Secure Mode (recommended): license key is exchanged server-side -->
<script>
window.AIBridgeConfig = {
  configEndpoint: "https://yourserver.com/api/license/token",
  _licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",
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

The `_licenseKey` is sent via POST to your server and exchanged for a short-lived session token — it is **never exposed in the page source** at runtime.

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
│   │   └── billing.js      # Stripe billing integration
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
| `/api/license/token` | POST | Exchange license key for session token |
| `/api/license/session` | POST | Validate session token (domain-locked) |
| `/api/license/track` | POST | Record analytics event (batched) |

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
  // Secure mode (recommended) — license exchanged server-side
  configEndpoint: "/api/license/token",
  _licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",

  // Legacy mode — direct license key (less secure)
  // licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",

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
docker run -p 3000:3000 -e JWT_SECRET=your-secret web-agent-bridge
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
| `vision-agent.js` | Vision/NLP agent — resolves natural language intents to actions using a local keyword-based resolver (no external API) |

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

### Secure License Exchange (NEW)

License keys are **never exposed in page source**. The bridge uses a server-side token exchange flow:

1. Client sends `_licenseKey` via POST to `configEndpoint`
2. Server validates and returns a domain-locked session token (1 hour TTL)
3. Client deletes `_licenseKey` from memory and uses session token for all subsequent calls
4. Token auto-refreshes at 80% TTL — no interruptions

```
Client                          Server
  │── POST /api/license/token ──→│  (licenseKey in body, not URL)
  │                              │  verifyLicense(domain, key)
  │←── { sessionToken, tier } ──│  domain-locked, 1hr TTL
  │                              │
  │── POST /api/license/session →│  (sessionToken + origin check)
  │←── { valid, tier } ─────────│
```

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

```
PORT=3000
JWT_SECRET=your-secret-here
NODE_ENV=development
DB_ADAPTER=sqlite          # sqlite | postgresql | mysql
DATABASE_URL=              # Required for postgresql/mysql
```

---

## License

MIT — Free to use, modify, and distribute.
