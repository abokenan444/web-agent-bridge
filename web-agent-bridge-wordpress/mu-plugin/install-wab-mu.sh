#!/usr/bin/env bash
# =============================================================================
#  Web Agent Bridge — WordPress Must-Use Plugin Installer
#
#  Installs WAB as a Must-Use plugin that cannot be deactivated.
#  Requires WP-CLI (https://wp-cli.org) and WordPress installation.
#
#  Usage:
#    bash install-wab-mu.sh [--wp-path /var/www/html] [--api-base https://wab.yourdomain.com]
#
#  LICENSE: GPL-2.0-or-later (Open Source)
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

WP_PATH="${WP_PATH:-/var/www/html}"
WAB_API_BASE="${WAB_API_BASE:-https://webagentbridge.com}"
MU_PLUGIN_SRC="$(dirname "$0")/web-agent-bridge-mu.php"
WPCLI_URL="https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar"

echo -e "${BOLD}Web Agent Bridge — WordPress MU Plugin Installer${NC}"
echo ""

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wp-path)   WP_PATH="$2"; shift 2 ;;
    --api-base)  WAB_API_BASE="$2"; shift 2 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

# ── Check WordPress installation ──────────────────────────────────────────────
if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
  echo -e "${RED}✗ WordPress not found at: $WP_PATH${NC}"
  echo "  Set WP_PATH or use --wp-path /path/to/wordpress"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} WordPress found at: $WP_PATH"

# ── Ensure WP-CLI is available ────────────────────────────────────────────────
if ! command -v wp &>/dev/null; then
  echo -e "  ${YELLOW}▶${NC} Installing WP-CLI..."
  curl -fsSL "$WPCLI_URL" -o /tmp/wp-cli.phar
  chmod +x /tmp/wp-cli.phar
  mv /tmp/wp-cli.phar /usr/local/bin/wp
  echo -e "  ${GREEN}✓${NC} WP-CLI installed"
fi

# ── Create mu-plugins directory ───────────────────────────────────────────────
MU_DIR="$WP_PATH/wp-content/mu-plugins"
mkdir -p "$MU_DIR"
echo -e "  ${GREEN}✓${NC} mu-plugins directory: $MU_DIR"

# ── Copy MU plugin ────────────────────────────────────────────────────────────
if [[ ! -f "$MU_PLUGIN_SRC" ]]; then
  echo -e "${RED}✗ MU plugin source not found: $MU_PLUGIN_SRC${NC}"
  echo "  Run this script from the mu-plugin/ directory."
  exit 1
fi

# Replace API base URL if custom
if [[ "$WAB_API_BASE" != "https://webagentbridge.com" ]]; then
  sed "s|https://webagentbridge.com|${WAB_API_BASE}|g" "$MU_PLUGIN_SRC" > "$MU_DIR/web-agent-bridge-mu.php"
else
  cp "$MU_PLUGIN_SRC" "$MU_DIR/web-agent-bridge-mu.php"
fi

echo -e "  ${GREEN}✓${NC} MU plugin installed: $MU_DIR/web-agent-bridge-mu.php"

# ── Flush rewrite rules ───────────────────────────────────────────────────────
cd "$WP_PATH"
wp rewrite flush --allow-root 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Rewrite rules flushed"

# ── Also install main plugin if not present ───────────────────────────────────
if ! wp plugin is-installed web-agent-bridge --allow-root 2>/dev/null; then
  echo -e "  ${YELLOW}▶${NC} Installing Web Agent Bridge plugin from WordPress.org..."
  wp plugin install web-agent-bridge --activate --allow-root 2>/dev/null || \
    echo -e "  ${YELLOW}⚠${NC}  Could not install from WordPress.org — MU plugin will run in minimal mode"
else
  wp plugin activate web-agent-bridge --allow-root 2>/dev/null || true
  echo -e "  ${GREEN}✓${NC} Web Agent Bridge plugin activated"
fi

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ WAB Must-Use Plugin installed!${NC}"
echo ""
echo -e "  Discovery endpoint: ${YELLOW}$(wp option get siteurl --allow-root 2>/dev/null || echo 'your-site')/.well-known/wab.json${NC}"
echo -e "  MU Plugin file:     ${YELLOW}$MU_DIR/web-agent-bridge-mu.php${NC}"
echo ""
echo -e "  The plugin is now ${BOLD}always active${NC} and cannot be deactivated from the admin panel."
echo ""
