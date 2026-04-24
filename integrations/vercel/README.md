# WAB on Vercel

> **License:** MIT (Open Source)

Deploy Web Agent Bridge to Vercel in one click — free tier available.

## Deploy in One Click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fabokenan444%2Fweb-agent-bridge&env=JWT_SECRET,JWT_SECRET_ADMIN&envDescription=Required%20security%20secrets%20for%20WAB&envLink=https%3A%2F%2Fgithub.com%2Fabokenan444%2Fweb-agent-bridge%23environment-variables&project-name=web-agent-bridge&repository-name=web-agent-bridge)

## Manual Deploy

```bash
# Install Vercel CLI
npm install -g vercel

# Clone and deploy
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
cp integrations/vercel/vercel.json .

# Set environment variables
vercel env add JWT_SECRET
vercel env add JWT_SECRET_ADMIN

# Deploy
vercel --prod
```

## Required Environment Variables

| Variable | Description | Generate |
|---|---|---|
| `JWT_SECRET` | User token signing secret | `openssl rand -base64 48` |
| `JWT_SECRET_ADMIN` | Admin token signing secret | `openssl rand -base64 48` |

## Optional Environment Variables

| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated allowed origins |
| `STRIPE_SECRET_KEY` | Stripe secret key (premium features) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `SMTP_HOST` | SMTP server for emails |

## Limitations on Vercel Free Tier

- Serverless functions: 10s timeout (upgrade for 30s)
- SQLite data does not persist between deployments (use external DB for production)
- For persistent data, set `DATABASE_URL` to a PlanetScale or Turso database

## Persistent Database (Recommended for Production)

```bash
# Use Vercel KV or external SQLite (Turso)
vercel env add DATABASE_URL  # turso://your-db.turso.io
```
