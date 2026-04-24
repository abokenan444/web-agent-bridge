# WAB Platform — Interactive Demo

A fully isolated, professional interactive demo for the [Web Agent Bridge](https://www.webagentbridge.com) platform. Designed to be embedded on the main website or deployed as a standalone showcase.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Docker Compose Stack               │
│                                                 │
│  ┌─────────────────┐    ┌─────────────────────┐ │
│  │  wab-demo-      │    │  wab-demo-backend   │ │
│  │  frontend       │───▶│  (Node.js/Express)  │ │
│  │  (Nginx)        │    │  Port: 3001         │ │
│  │  Port: 8080     │    │  In-memory only     │ │
│  └─────────────────┘    └─────────────────────┘ │
│                                                 │
│  Network: wab-demo-network (isolated)           │
│  NO connection to production databases          │
└─────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone / copy this directory to your server
cd wab-demo

# 2. Copy environment file
cp .env.example .env

# 3. Build and start
docker compose up -d --build

# 4. Open in browser
open http://localhost:8080
```

## Demo Features

| Feature | Description |
|---------|-------------|
| **AI Agent Chat** | Natural language interface with intent detection |
| **Fairness System** | Real-time platform fairness scoring (15+ signals) |
| **Scam Shield** | URL threat detection against 47 security databases |
| **Deals Engine** | Cross-platform price comparison with commission transparency |
| **Architecture Diagram** | Interactive platform architecture visualization |
| **Code Integration** | Copy-ready integration snippets |

## API Endpoints

All endpoints are served at `/api/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check + live stats |
| GET | `/api/demo/stats` | Platform statistics |
| POST | `/api/demo/agent` | AI Agent Chat |
| POST | `/api/demo/fairness` | Fairness analysis |
| POST | `/api/demo/shield` | Scam Shield check |
| POST | `/api/demo/deals` | Deals search |
| GET | `/api/demo/architecture` | Platform architecture info |

## Embedding in Main Website

### Option 1: iFrame Embed
```html
<iframe
  src="https://demo.webagentbridge.com"
  width="100%"
  height="900px"
  frameborder="0"
  style="border-radius: 16px;"
></iframe>
```

### Option 2: Subdomain Deployment
Deploy this Docker stack on a subdomain (e.g., `demo.webagentbridge.com`) and link to it from the main site.

### Option 3: Same-Server Deployment
Run on port 8080 and proxy through Nginx/Caddy on the main server.

## Security

- **Fully isolated** from production databases
- **In-memory only** — no data persistence
- **Rate limited** — 120 requests/minute per IP
- **No API keys required** for demo usage
- **Separate Docker network** — cannot access other containers

## Stopping the Demo

```bash
docker compose down
```

## Updating

```bash
docker compose down
docker compose up -d --build
```
