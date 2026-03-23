#!/usr/bin/env bash
# Run ON THE SERVER inside the project directory after git clone.
# Usage: bash scripts/server-update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Pulling latest code..."
git pull origin master

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "==> Rebuilding and restarting Docker Compose..."
  docker compose up -d --build
  echo "Done. Check: docker compose ps && docker compose logs -f --tail=50"
  exit 0
fi

echo "==> Installing npm dependencies..."
npm ci --production

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting PM2 app 'wab' (create with: pm2 start server/index.js --name wab)..."
  pm2 restart wab || { echo "PM2 app 'wab' not found; start manually."; exit 1; }
else
  echo "No Docker or PM2. Start manually: NODE_ENV=production node server/index.js"
fi
