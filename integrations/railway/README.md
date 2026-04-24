# WAB on Railway

> **License:** MIT (Open Source)

Deploy Web Agent Bridge to Railway — persistent storage, always-on, $5 free credit/month.

## Deploy in One Click

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/web-agent-bridge?referralCode=wab)

## Manual Deploy

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Clone and deploy
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
cp integrations/railway/railway.json .

# Initialize Railway project
railway init

# Set environment variables
railway variables set JWT_SECRET="$(openssl rand -base64 48)"
railway variables set JWT_SECRET_ADMIN="$(openssl rand -base64 48)"
railway variables set NODE_ENV=production

# Deploy
railway up
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | User token signing secret |
| `JWT_SECRET_ADMIN` | Yes | Admin token signing secret |
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Auto | Railway sets this automatically |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed origins |
| `STRIPE_SECRET_KEY` | No | Stripe key for premium features |

## Why Railway?

- **Persistent storage**: SQLite data survives restarts (unlike Vercel/Netlify)
- **Always-on**: No cold starts
- **$5 free credit/month**: Enough for a small WAB instance
- **Custom domains**: Free SSL certificates
- **Automatic deploys**: Push to GitHub → auto-deploy

## Persistent Volume (Recommended)

In Railway dashboard, add a volume mounted at `/data` to persist your SQLite database across deployments.
