#!/usr/bin/env bash
#
# Deploy AI Bill to the production server.
#
# Usage:
#   ./deploy.sh              # sync app files and restart the pm2 process
#   ./deploy.sh --full       # also run "npm install --omit=dev" on the server
#
# Run from Git Bash / WSL on Windows, or any bash shell.
# You will be prompted for the SSH password unless you use an SSH key.

set -euo pipefail

# ----- Configuration -----
SSH_HOST="${SSH_HOST:-root@72.60.99.225}"
APP_DIR="${APP_DIR:-/var/www/ai-billing}"
PM2_APP="${PM2_APP:-ai-billing}"

# Directory of this script (the local app root).
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FULL_INSTALL=false
if [[ "${1:-}" == "--full" ]]; then
  FULL_INSTALL=true
fi

echo "==> Deploying to ${SSH_HOST}:${APP_DIR}"

# ----- Sync files (exclude local-only artifacts) -----
if command -v rsync >/dev/null 2>&1; then
  echo "==> Syncing files with rsync..."
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'env_production' \
    --exclude 'deploy.sh' \
    "${LOCAL_DIR}/" "${SSH_HOST}:${APP_DIR}/"
else
  echo "==> rsync not found, falling back to scp..."
  scp -r \
    "${LOCAL_DIR}/app.js" \
    "${LOCAL_DIR}/server.js" \
    "${LOCAL_DIR}/package.json" \
    "${LOCAL_DIR}/config" \
    "${LOCAL_DIR}/middleware" \
    "${LOCAL_DIR}/models" \
    "${LOCAL_DIR}/routes" \
    "${LOCAL_DIR}/services" \
    "${LOCAL_DIR}/public" \
    "${SSH_HOST}:${APP_DIR}/"
fi

# ----- Optional dependency install -----
if [[ "${FULL_INSTALL}" == true ]]; then
  echo "==> Installing production dependencies on the server..."
  ssh "${SSH_HOST}" "cd ${APP_DIR} && npm install --omit=dev"
fi

# ----- Restart the app -----
echo "==> Restarting pm2 process '${PM2_APP}'..."
ssh "${SSH_HOST}" "pm2 restart ${PM2_APP} --update-env && pm2 describe ${PM2_APP} | grep -E 'status|uptime|restarts'"

echo "==> Deploy complete."
