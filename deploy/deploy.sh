#!/usr/bin/env bash
# Production deploy helper — run on Linux EC2 from repo root (GPT-Indira-New-main).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"

echo "==> Installing dependencies..."
cd "$BACKEND"
npm run install:all

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "ERROR: $BACKEND/.env not found. Copy .env.example to .env and configure secrets."
  exit 1
fi

echo "==> Building frontend..."
npm run build

mkdir -p "$BACKEND/logs" "$BACKEND/uploads"

echo "==> Restarting PM2..."
if pm2 describe indira-gpt-api &>/dev/null; then
  pm2 restart "$ROOT/deploy/ecosystem.config.cjs"
else
  pm2 start "$ROOT/deploy/ecosystem.config.cjs"
fi
pm2 save

echo "==> Done. Verify: pm2 logs indira-gpt-api --lines 30"
echo "    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5005/"
