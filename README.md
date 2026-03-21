# Web Agent Bridge (WAB)

**Open-source middleware that bridges AI agents and websites — providing a standardized command interface for intelligent automation.**

WAB gives website owners a script they embed in their pages that exposes a `window.AICommands` interface. AI agents read this interface to discover available actions, execute commands, and interact with sites accurately — without parsing raw DOM.

---

## Features

- **Auto-Discovery** — Automatically detects buttons, forms, and navigation on the page
- **Permission System** — Granular control over what AI agents can do (click, fill forms, API access, etc.)
- **Standardized Interface** — Unified `window.AICommands` object any agent can consume
- **Rate Limiting** — Built-in abuse protection with configurable limits
- **Analytics Dashboard** — Track how AI agents interact with your site
- **Custom Actions** — Register your own actions with custom handlers
- **Subscription Tiers** — Free core + paid premium features (API access, analytics, automated login)
- **Event System** — Subscribe to bridge events for monitoring
- **Security First** — Selector blocking, agent authentication, HTTPS verification

---

## Quick Start

### 1. Install & Run the Server

```bash
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
npm install
cp .env.example .env
npm start
```

The server starts at `http://localhost:3000`.

### 2. Create an Account

Visit `http://localhost:3000/register` and create an account, then add your site from the dashboard.

### 3. Add the Script to Your Website

```html
<script>
window.AIBridgeConfig = {
  licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",
  agentPermissions: {
    readContent: true,
    click: true,
    fillForms: true,
    scroll: true
  }
};
</script>
<script src="http://localhost:3000/script/ai-agent-bridge.js"></script>
```

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
│   │   └── license.js      # License verification & tracking
│   ├── middleware/
│   │   └── auth.js         # JWT authentication middleware
│   └── models/
│       └── db.js           # SQLite database & operations
├── public/                 # Frontend
│   ├── index.html          # Landing page
│   ├── dashboard.html      # Management dashboard
│   ├── docs.html           # Documentation
│   ├── login.html          # Sign in
│   ├── register.html       # Sign up
│   └── css/styles.css      # Design system
├── script/
│   └── ai-agent-bridge.js  # The bridge script (embed in websites)
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
| `/api/license/verify` | POST | Verify license key for domain |
| `/api/license/track` | POST | Record analytics event |

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
  licenseKey: "WAB-XXXXX-XXXXX-XXXXX-XXXXX",
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

- **Backend**: Node.js + Express
- **Database**: SQLite (via better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: Vanilla HTML/CSS/JS (no framework dependencies)
- **Security**: Helmet, CORS, rate limiting

---

## Environment Variables

```
PORT=3000
JWT_SECRET=your-secret-here
NODE_ENV=development
```

---

## License

MIT — Free to use, modify, and distribute.
