#!/usr/bin/env bash
# =============================================================================
#  Web Agent Bridge — Universal Install Script
#  Usage: curl -fsSL https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/integrations/install/install.sh | bash
#  Or:    bash install.sh [--port 3000] [--data-dir /var/lib/wab] [--no-service]
#
#  Supports: Ubuntu 20+, Debian 11+, CentOS 8+, RHEL 8+, Alpine 3.14+
#  Requires: Node.js 18+ (auto-installed if missing), npm, curl
#  License: MIT (Open Source) — https://github.com/abokenan444/web-agent-bridge
# =============================================================================
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Defaults ─────────────────────────────────────────────────────────────────
WAB_PORT="${WAB_PORT:-3000}"
WAB_DATA_DIR="${WAB_DATA_DIR:-/var/lib/wab}"
WAB_INSTALL_DIR="${WAB_INSTALL_DIR:-/opt/wab}"
WAB_USER="${WAB_USER:-wab}"
WAB_VERSION="${WAB_VERSION:-latest}"
INSTALL_SERVICE=true
SKIP_NODE_CHECK=false

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)        WAB_PORT="$2"; shift 2 ;;
    --data-dir)    WAB_DATA_DIR="$2"; shift 2 ;;
    --install-dir) WAB_INSTALL_DIR="$2"; shift 2 ;;
    --version)     WAB_VERSION="$2"; shift 2 ;;
    --no-service)  INSTALL_SERVICE=false; shift ;;
    --skip-node)   SKIP_NODE_CHECK=true; shift ;;
    --help|-h)
      echo "Usage: install.sh [options]"
      echo "  --port PORT          Server port (default: 3000)"
      echo "  --data-dir DIR       Data directory (default: /var/lib/wab)"
      echo "  --install-dir DIR    Install directory (default: /opt/wab)"
      echo "  --version VERSION    WAB version to install (default: latest)"
      echo "  --no-service         Skip systemd service installation"
      echo "  --skip-node          Skip Node.js installation check"
      exit 0 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ██╗    ██╗ █████╗ ██████╗ "
echo "  ██║    ██║██╔══██╗██╔══██╗"
echo "  ██║ █╗ ██║███████║██████╔╝"
echo "  ██║███╗██║██╔══██║██╔══██╗"
echo "  ╚███╔███╔╝██║  ██║██████╔╝"
echo "   ╚══╝╚══╝ ╚═╝  ╚═╝╚═════╝ "
echo -e "${NC}"
echo -e "${BOLD}  Web Agent Bridge — Universal Installer${NC}"
echo -e "  ${BLUE}https://github.com/abokenan444/web-agent-bridge${NC}"
echo ""

# ── Root check ────────────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  echo -e "${RED}✗ This script must be run as root (use sudo).${NC}"
  exit 1
fi

# ── OS Detection ──────────────────────────────────────────────────────────────
detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-0}"
  elif [[ -f /etc/alpine-release ]]; then
    OS_ID="alpine"
    OS_VERSION=$(cat /etc/alpine-release)
  else
    OS_ID="unknown"
    OS_VERSION="0"
  fi
}

detect_os
echo -e "  ${BLUE}ℹ${NC}  Detected OS: ${BOLD}${OS_ID} ${OS_VERSION}${NC}"

# ── Package manager detection ─────────────────────────────────────────────────
if command -v apt-get &>/dev/null; then
  PKG_MANAGER="apt"
elif command -v yum &>/dev/null; then
  PKG_MANAGER="yum"
elif command -v dnf &>/dev/null; then
  PKG_MANAGER="dnf"
elif command -v apk &>/dev/null; then
  PKG_MANAGER="apk"
else
  echo -e "${RED}✗ No supported package manager found (apt/yum/dnf/apk).${NC}"
  exit 1
fi

# ── Install Node.js 20 LTS ────────────────────────────────────────────────────
install_nodejs() {
  echo -e "\n  ${YELLOW}▶${NC} Installing Node.js 20 LTS..."
  case "$PKG_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      apt-get install -y nodejs >/dev/null 2>&1
      ;;
    yum|dnf)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      $PKG_MANAGER install -y nodejs >/dev/null 2>&1
      ;;
    apk)
      apk add --no-cache nodejs npm >/dev/null 2>&1
      ;;
  esac
  echo -e "  ${GREEN}✓${NC} Node.js $(node --version) installed"
}

if [[ "$SKIP_NODE_CHECK" == "false" ]]; then
  if ! command -v node &>/dev/null; then
    install_nodejs
  else
    NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VER" -lt 18 ]]; then
      echo -e "  ${YELLOW}⚠${NC}  Node.js ${NODE_VER} found — upgrading to v20 LTS..."
      install_nodejs
    else
      echo -e "  ${GREEN}✓${NC} Node.js $(node --version) already installed"
    fi
  fi
fi

# ── Install build tools (for better-sqlite3) ──────────────────────────────────
echo -e "\n  ${YELLOW}▶${NC} Installing build dependencies..."
case "$PKG_MANAGER" in
  apt)   apt-get install -y python3 make g++ curl >/dev/null 2>&1 ;;
  yum)   yum install -y python3 make gcc-c++ curl >/dev/null 2>&1 ;;
  dnf)   dnf install -y python3 make gcc-c++ curl >/dev/null 2>&1 ;;
  apk)   apk add --no-cache python3 make g++ curl >/dev/null 2>&1 ;;
esac
echo -e "  ${GREEN}✓${NC} Build dependencies installed"

# ── Create WAB system user ────────────────────────────────────────────────────
echo -e "\n  ${YELLOW}▶${NC} Creating system user '${WAB_USER}'..."
if ! id "$WAB_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /sbin/nologin "$WAB_USER" 2>/dev/null || \
  adduser -S -H -s /sbin/nologin "$WAB_USER" 2>/dev/null || true
  echo -e "  ${GREEN}✓${NC} User '${WAB_USER}' created"
else
  echo -e "  ${GREEN}✓${NC} User '${WAB_USER}' already exists"
fi

# ── Install WAB package ───────────────────────────────────────────────────────
echo -e "\n  ${YELLOW}▶${NC} Installing Web Agent Bridge..."
mkdir -p "$WAB_INSTALL_DIR" "$WAB_DATA_DIR"

if [[ "$WAB_VERSION" == "latest" ]]; then
  npm install -g web-agent-bridge --prefix "$WAB_INSTALL_DIR" --omit=dev 2>&1 | tail -3
else
  npm install -g "web-agent-bridge@${WAB_VERSION}" --prefix "$WAB_INSTALL_DIR" --omit=dev 2>&1 | tail -3
fi

WAB_BIN="$WAB_INSTALL_DIR/bin/wab"
if [[ ! -f "$WAB_BIN" ]]; then
  # Fallback: find the actual binary
  WAB_BIN=$(find "$WAB_INSTALL_DIR" -name "cli.js" -path "*/web-agent-bridge/*" 2>/dev/null | head -1)
  if [[ -z "$WAB_BIN" ]]; then
    echo -e "${RED}✗ WAB binary not found after install. Check npm output above.${NC}"
    exit 1
  fi
fi

chown -R "$WAB_USER:$WAB_USER" "$WAB_DATA_DIR"
echo -e "  ${GREEN}✓${NC} Web Agent Bridge installed"

# ── Generate secrets ──────────────────────────────────────────────────────────
echo -e "\n  ${YELLOW}▶${NC} Generating secure secrets..."
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_SECRET_ADMIN=$(openssl rand -base64 48 | tr -d '\n')

# ── Write .env file ───────────────────────────────────────────────────────────
ENV_FILE="$WAB_DATA_DIR/.env"
cat > "$ENV_FILE" <<EOF
# Web Agent Bridge — Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# DO NOT share this file — it contains secret keys

PORT=${WAB_PORT}
NODE_ENV=production
DATA_DIR=${WAB_DATA_DIR}

# JWT Secrets — auto-generated, change only if you know what you're doing
JWT_SECRET=${JWT_SECRET}
JWT_SECRET_ADMIN=${JWT_SECRET_ADMIN}

# Optional: Set your domain for CORS
# ALLOWED_ORIGINS=https://yourdomain.com

# Optional: Stripe keys for premium features (leave empty for free tier)
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...

# Optional: SMTP for email notifications
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=you@gmail.com
# SMTP_PASS=yourpassword
EOF

chmod 600 "$ENV_FILE"
chown "$WAB_USER:$WAB_USER" "$ENV_FILE"
echo -e "  ${GREEN}✓${NC} Configuration written to ${ENV_FILE}"

# ── Install systemd service ───────────────────────────────────────────────────
if [[ "$INSTALL_SERVICE" == "true" ]] && command -v systemctl &>/dev/null; then
  echo -e "\n  ${YELLOW}▶${NC} Installing systemd service..."

  # Resolve the actual node binary path
  NODE_BIN=$(command -v node)
  # Resolve WAB main entry point
  WAB_MAIN=$(find "$WAB_INSTALL_DIR" -name "index.js" -path "*/web-agent-bridge/server/*" 2>/dev/null | head -1)
  if [[ -z "$WAB_MAIN" ]]; then
    WAB_MAIN=$(find "$WAB_INSTALL_DIR" -name "cli.js" -path "*/web-agent-bridge/*" 2>/dev/null | head -1)
  fi

  cat > /etc/systemd/system/wab.service <<EOF
[Unit]
Description=Web Agent Bridge — AI-to-Web Protocol Server
Documentation=https://github.com/abokenan444/web-agent-bridge
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${WAB_USER}
Group=${WAB_USER}
WorkingDirectory=${WAB_DATA_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${WAB_MAIN} start
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wab
# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${WAB_DATA_DIR}
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable wab >/dev/null 2>&1
  systemctl start wab

  # Wait for startup
  sleep 3
  if systemctl is-active --quiet wab; then
    echo -e "  ${GREEN}✓${NC} WAB service started and enabled on boot"
  else
    echo -e "  ${YELLOW}⚠${NC}  WAB service installed but not running — check: journalctl -u wab -n 20"
  fi
fi

# ── Configure firewall (optional) ─────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow "$WAB_PORT/tcp" >/dev/null 2>&1 && \
    echo -e "  ${GREEN}✓${NC} UFW rule added for port ${WAB_PORT}" || true
elif command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port="${WAB_PORT}/tcp" >/dev/null 2>&1 && \
  firewall-cmd --reload >/dev/null 2>&1 && \
    echo -e "  ${GREEN}✓${NC} firewalld rule added for port ${WAB_PORT}" || true
fi

# ── Health check ──────────────────────────────────────────────────────────────
echo -e "\n  ${YELLOW}▶${NC} Running health check..."
sleep 2
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${WAB_PORT}/api/wab/ping" 2>/dev/null || echo "000")
if [[ "$HTTP_STATUS" == "200" ]]; then
  echo -e "  ${GREEN}✓${NC} Health check passed — WAB is responding on port ${WAB_PORT}"
else
  echo -e "  ${YELLOW}⚠${NC}  Health check returned HTTP ${HTTP_STATUS} — WAB may still be starting"
fi

# ── Print summary ─────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

echo ""
echo -e "${GREEN}${BOLD}  ✓ Web Agent Bridge installed successfully!${NC}"
echo ""
echo -e "  ${BOLD}Access:${NC}"
echo -e "    Dashboard:  ${CYAN}http://${SERVER_IP}:${WAB_PORT}${NC}"
echo -e "    API:        ${CYAN}http://${SERVER_IP}:${WAB_PORT}/api/wab/ping${NC}"
echo -e "    Discovery:  ${CYAN}http://${SERVER_IP}:${WAB_PORT}/.well-known/wab.json${NC}"
echo ""
echo -e "  ${BOLD}Management:${NC}"
echo -e "    Status:   ${BLUE}systemctl status wab${NC}"
echo -e "    Logs:     ${BLUE}journalctl -u wab -f${NC}"
echo -e "    Restart:  ${BLUE}systemctl restart wab${NC}"
echo -e "    Config:   ${BLUE}${ENV_FILE}${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. Open ${CYAN}http://${SERVER_IP}:${WAB_PORT}${NC} in your browser"
echo -e "    2. Create your first site and get your API key"
echo -e "    3. Add WAB to your website: ${CYAN}npx web-agent-bridge init${NC}"
echo ""
echo -e "  ${BOLD}Documentation:${NC} ${BLUE}https://github.com/abokenan444/web-agent-bridge${NC}"
echo -e "  ${BOLD}Discord:${NC}       ${BLUE}https://discord.gg/NnbpJYEF${NC}"
echo ""
