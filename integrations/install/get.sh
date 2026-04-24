#!/usr/bin/env bash
# =============================================================================
#  Web Agent Bridge — Quick Install (one-liner)
#  curl -fsSL https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/integrations/install/get.sh | bash
#
#  This script downloads and runs the full installer.
#  License: MIT — https://github.com/abokenan444/web-agent-bridge
# =============================================================================
set -euo pipefail

INSTALLER_URL="https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/integrations/install/install.sh"
TMP_FILE=$(mktemp /tmp/wab-install-XXXXXX.sh)

echo "Downloading Web Agent Bridge installer..."
curl -fsSL "$INSTALLER_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
bash "$TMP_FILE" "$@"
rm -f "$TMP_FILE"
