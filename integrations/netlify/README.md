# WAB on Netlify

> **License:** MIT (Open Source)

Deploy Web Agent Bridge to Netlify — free tier available with Edge Functions.

## Deploy in One Click

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/abokenan444/web-agent-bridge)

## Manual Deploy

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Clone and deploy
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
cp integrations/netlify/netlify.toml .
cp -r integrations/netlify/functions ./netlify/

# Set environment variables
netlify env:set JWT_SECRET "$(openssl rand -base64 48)"
netlify env:set JWT_SECRET_ADMIN "$(openssl rand -base64 48)"

# Deploy
netlify deploy --prod
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | User token signing secret |
| `JWT_SECRET_ADMIN` | Yes | Admin token signing secret |
| `WAB_SERVER_URL` | No | External WAB server URL (if not self-hosted) |
| `WAB_SITE_ID` | No | WAB site ID |

## Endpoints

| Path | Function | Description |
|---|---|---|
| `/.well-known/wab.json` | `wab-discovery` | WAB discovery document |
| `/wab/ping` | `wab-ping` | Health check |
| `/api/wab/*` | `wab-api` | WAB API proxy |
