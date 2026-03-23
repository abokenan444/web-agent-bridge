# Deploying Web Agent Bridge to your server

The code is on GitHub (`master`). **You** deploy by SSH-ing into your VPS and pulling + restarting the app.

## Prerequisites

- Ubuntu/Debian (or similar) with Docker **or** Node.js 20+
- Firewall: open port **3000** (or your reverse proxy port 80/443)
- A strong `JWT_SECRET` in production (never commit it)

---

## Option A — Docker Compose (recommended)

On the server, first time:

```bash
cd /opt   # or your preferred path
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge
cp .env.example .env   # if present; else create .env with JWT_SECRET and PORT
# Edit .env: JWT_SECRET=...  PORT=3000
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

## Automated deploy from GitHub (optional)

Add repository secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_PATH`, then use a workflow that SSHs and runs `git pull` + `docker compose up -d --build` (template can be added on request).

---

## Checklist after deploy

- [ ] `curl -s https://your-domain/api/license/verify` returns JSON (POST with body) or app responds on `/`
- [ ] `https://your-domain/script/ai-agent-bridge.js` loads
- [ ] `.env` / `JWT_SECRET` not exposed in git
