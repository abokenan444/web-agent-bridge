# WAB Cloudflare Worker

> **License:** MIT (Open Source) — Full source available

Deploy Web Agent Bridge as a Cloudflare Edge Worker — no server required. Your WAB runs at the edge, globally distributed across 300+ Cloudflare data centers.

## Deploy in One Click

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/abokenan444/web-agent-bridge)

## What it does

- Serves `/.well-known/wab.json` discovery document at the edge (cached, fast)
- Proxies `/api/wab/*` requests to your WAB server
- Adds `X-WAB-*` headers to all responses from your origin
- Rate limiting per IP (configurable)
- CORS headers for AI agent access
- Zero cold starts (Cloudflare Workers run on V8 isolates)

## Manual Deploy

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Clone and deploy
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge/integrations/cloudflare-worker

# Set required secrets
wrangler secret put WAB_SERVER_URL    # e.g. https://wab.yourdomain.com
wrangler secret put WAB_SITE_ID       # from WAB dashboard
wrangler secret put WAB_API_KEY       # from WAB dashboard
wrangler secret put ORIGIN_URL        # e.g. https://yourdomain.com

# Deploy
wrangler deploy
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WAB_SERVER_URL` | Yes | Your WAB server URL |
| `WAB_SITE_ID` | Yes | Site ID from WAB dashboard |
| `WAB_API_KEY` | Yes | API key from WAB dashboard |
| `ORIGIN_URL` | Yes | Your website origin URL |
| `RATE_LIMIT_RPM` | No | Requests/minute per IP (default: 60) |
| `ALLOWED_AGENTS` | No | Comma-separated allowed user-agents |

## Routes

| Path | Description |
|---|---|
| `/.well-known/wab.json` | WAB discovery document (cached 5min) |
| `/api/wab/*` | Proxied to WAB server |
| `/wab/ping` | Health check |
| `/*` | Proxied to origin with WAB headers |

## Free Tier Limits

Cloudflare Workers free tier includes:
- 100,000 requests/day
- 10ms CPU time per request
- Global edge deployment

For higher limits, upgrade to Workers Paid ($5/month).
