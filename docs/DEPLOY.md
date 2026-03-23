# Deploying Web Agent Bridge to your server

The code is on GitHub (`master`). **You** deploy by SSH-ing into your VPS and pulling + restarting the app.

## Prerequisites

- Ubuntu/Debian (or similar) with Docker **or** Node.js 20+
- Firewall: open port **3000** (or your reverse proxy port 80/443)
- Strong `JWT_SECRET` and `JWT_SECRET_ADMIN` in production (never commit them)

---

## Option A — Docker Compose (recommended)

On the server, first time:

```bash
cd /opt   # or your preferred path
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
cp .env.example .env   # if present; else create .env with secrets and PORT
# Edit .env: JWT_SECRET=...  JWT_SECRET_ADMIN=...  PORT=3000
docker compose up -d --build
```

Updates:

```bash
cd /path/to/web-agent-bridge
git pull origin master
docker compose up -d --build
```

Data persists in the Docker volume `wab-data` (SQLite under `/app/data` in the container).

---

## Option B — Node.js (no Docker)

```bash
cd /path/to/web-agent-bridge
git pull origin master
npm ci --production
export NODE_ENV=production
export JWT_SECRET="your-long-random-secret"
export JWT_SECRET_ADMIN="your-different-long-random-secret"
export PORT=3000
node server/index.js
```

Use **systemd**, **PM2**, or **screen/tmux** to keep the process running.

Example **PM2**:

```bash
npm ci --production
pm2 start server/index.js --name wab
pm2 save
```

After `git pull`:

```bash
npm ci --production
pm2 restart wab
```

---

## Reverse proxy (HTTPS)

Put **Nginx** or **Caddy** in front of `127.0.0.1:3000` and obtain TLS certificates (Let’s Encrypt).

Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## WordPress plugin

Upload `web-agent-bridge-wordpress/` to the WordPress server (`wp-content/plugins/`) or sync via SFTP/rsync. Point **WAB API base URL** to your public URL (e.g. `https://wab.example.com`).

---

## Why we do **not** recommend auto-deploy from this public repo

This project is **open source**. Wiring GitHub Actions (or similar) so that every push to `main`/`master` deploys to your production server is **high risk**:

| Risk | Why it matters |
|------|----------------|
| **Supply chain** | Anyone who can merge code (or bypass reviews) can change what runs on your server. |
| **Fork / PR abuse** | CI that builds untrusted PRs with secrets in scope has led to credential theft. |
| **Secret leakage** | Deploy keys and SSH keys in CI are juicy targets; misconfiguration exposes them in logs or artifacts. |
| **Public visibility** | Attackers see your pipeline definition and know exactly how prod is updated. |

**Recommended for operators:** deploy **manually** after you review changes (SSH → `git pull` → rebuild), or use a **private** deployment path (e.g. internal CI, private mirror, or release artifacts you promote by hand).

**If you must automate** (enterprise, private fork only): use a **private** repo or private runners, **branch protection**, required reviews, **deploy only from signed tags** or approved releases—not raw `main`—and never store production SSH keys in workflows reachable from public PR builds.

This repository intentionally does **not** ship a “deploy to production on push” workflow.

---

## Checklist after deploy

- [ ] `curl -s https://your-domain/api/license/verify` returns JSON (POST with body) or app responds on `/`
- [ ] `https://your-domain/script/ai-agent-bridge.js` loads
- [ ] `.env` / `JWT_SECRET` / `JWT_SECRET_ADMIN` not exposed in git
