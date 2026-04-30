#!/usr/bin/env bash
# ============================================================
#  WAB Quick Setup — One-liner installer
#  Version: 1.0.0
#  © 2026 Web Agent Bridge — All Rights Reserved
# ============================================================
#
#  Usage:
#    curl -fsSL https://webagentbridge.com/install | bash -s -- --domain example.com
#    curl -fsSL https://webagentbridge.com/install | bash -s -- --domain example.com --registrar cloudflare --token YOUR_TOKEN
#
# ============================================================

set -euo pipefail

INSTALL_URL="https://webagentbridge.com/downloads/setup-wab-discovery.sh"
TMP_SCRIPT=$(mktemp /tmp/setup-wab-XXXXXX.sh)

echo ""
echo "  WAB Discovery — Quick Installer"
echo "  Downloading setup script..."
echo ""

curl -fsSL "$INSTALL_URL" -o "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"

exec "$TMP_SCRIPT" "$@"
