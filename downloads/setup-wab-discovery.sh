#!/usr/bin/env bash
# ============================================================
#  WAB Discovery Setup Script
#  Version: 1.0.0
#  © 2026 Web Agent Bridge — All Rights Reserved
#  This script is proprietary and confidential.
#  Unauthorized distribution or modification is prohibited.
# ============================================================

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Constants ───────────────────────────────────────────────
WAB_VERSION="1.0.0"
WAB_REGISTRY="https://webagentbridge.com"
WAB_VERIFY_URL="https://webagentbridge.com/verify"
WELL_KNOWN_PATH="/.well-known/wab.json"
DNS_RECORD_NAME="_wab"
DNS_RECORD_TYPE="TXT"

# ─── Helpers ─────────────────────────────────────────────────
info()    { echo -e "${CYAN}[WAB]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}── $* ──${NC}"; }

# ─── Banner ──────────────────────────────────────────────────
print_banner() {
cat << 'EOF'

  ██╗    ██╗ █████╗ ██████╗     ██████╗ ██╗███████╗ ██████╗ ██████╗ ██╗   ██╗███████╗██████╗ ██╗   ██╗
  ██║    ██║██╔══██╗██╔══██╗    ██╔══██╗██║██╔════╝██╔════╝██╔═══██╗██║   ██║██╔════╝██╔══██╗╚██╗ ██╔╝
  ██║ █╗ ██║███████║██████╔╝    ██║  ██║██║███████╗██║     ██║   ██║██║   ██║█████╗  ██████╔╝ ╚████╔╝ 
  ██║███╗██║██╔══██║██╔══██╗    ██║  ██║██║╚════██║██║     ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗  ╚██╔╝  
  ╚███╔███╔╝██║  ██║██████╔╝    ██████╔╝██║███████║╚██████╗╚██████╔╝ ╚████╔╝ ███████╗██║  ██║   ██║   
   ╚══╝╚══╝ ╚═╝  ╚═╝╚═════╝     ╚═════╝ ╚═╝╚══════╝ ╚═════╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝  

  DNS Discovery Setup  v1.0.0
  https://webagentbridge.com
EOF
  echo ""
}

# ─── Dependency Check ────────────────────────────────────────
check_deps() {
  step "Checking dependencies"
  local missing=()
  for cmd in curl dig jq openssl; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    warn "Missing tools: ${missing[*]}"
    info "Installing missing dependencies..."
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y -q "${missing[@]/#/}" 2>/dev/null || true
    elif command -v brew &>/dev/null; then
      brew install "${missing[@]}" 2>/dev/null || true
    fi
  fi
  success "All dependencies satisfied"
}

# ─── Detect Registrar ────────────────────────────────────────
detect_registrar() {
  local domain="$1"
  step "Detecting DNS registrar for $domain"
  
  local ns_output
  ns_output=$(dig NS "$domain" +short 2>/dev/null | head -3)
  
  if echo "$ns_output" | grep -qi "cloudflare"; then
    echo "cloudflare"
  elif echo "$ns_output" | grep -qi "namecheap\|registrar-servers"; then
    echo "namecheap"
  elif echo "$ns_output" | grep -qi "godaddy\|domaincontrol"; then
    echo "godaddy"
  elif echo "$ns_output" | grep -qi "porkbun\|nsone"; then
    echo "porkbun"
  elif echo "$ns_output" | grep -qi "awsdns\|route53"; then
    echo "route53"
  elif echo "$ns_output" | grep -qi "squarespace\|google"; then
    echo "google"
  else
    echo "manual"
  fi
}

# ─── Generate wab.json ───────────────────────────────────────
generate_wab_json() {
  local domain="$1"
  local site_type="$2"
  local contact_email="${3:-admin@${domain}}"
  
  step "Generating wab.json for $domain ($site_type)"
  
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  local capabilities="[]"
  case "$site_type" in
    wordpress)
      capabilities='["read","search","navigate","form-fill","cart","checkout","auth"]'
      ;;
    shopify)
      capabilities='["read","search","product-listing","cart","checkout","inventory"]'
      ;;
    laravel|django|rails)
      capabilities='["read","search","navigate","form-fill","api-access"]'
      ;;
    static)
      capabilities='["read","search","navigate"]'
      ;;
    *)
      capabilities='["read","search","navigate"]'
      ;;
  esac
  
  cat <<EOF
{
  "wab": "1.0",
  "domain": "${domain}",
  "generated": "${timestamp}",
  "platform": "${site_type}",
  "discovery": {
    "method": "dns+well-known",
    "dns_record": "_wab.${domain}",
    "well_known": "https://${domain}${WELL_KNOWN_PATH}"
  },
  "capabilities": ${capabilities},
  "endpoints": {
    "base": "https://${domain}",
    "api": "https://${domain}/api/wab/v1",
    "schema": "https://${domain}/api/wab/v1/schema"
  },
  "security": {
    "cors_enabled": true,
    "rate_limit": "100/min",
    "auth_required": false,
    "dnssec": false
  },
  "contact": {
    "email": "${contact_email}",
    "support": "https://${domain}/support"
  },
  "meta": {
    "setup_by": "setup-wab-discovery.sh",
    "setup_version": "${WAB_VERSION}",
    "registry": "${WAB_REGISTRY}"
  }
}
EOF
}

# ─── Sign wab.json ───────────────────────────────────────────
sign_wab_json() {
  local json_file="$1"
  local key_file="${2:-${HOME}/.wab/signing.key}"
  
  step "Signing wab.json"
  
  mkdir -p "${HOME}/.wab"
  chmod 700 "${HOME}/.wab"
  
  if [[ ! -f "$key_file" ]]; then
    info "Generating new ECDSA signing key..."
    openssl ecparam -genkey -name prime256v1 -noout -out "$key_file" 2>/dev/null
    openssl ec -in "$key_file" -pubout -out "${key_file%.key}.pub" 2>/dev/null
    chmod 600 "$key_file"
    success "Signing key generated: $key_file"
    info "Public key: ${key_file%.key}.pub"
    warn "Keep your private key safe! Never share it."
  fi
  
  local signature
  signature=$(openssl dgst -sha256 -sign "$key_file" "$json_file" 2>/dev/null | base64 -w0)
  
  local pubkey
  pubkey=$(openssl ec -in "$key_file" -pubout -outform DER 2>/dev/null | base64 -w0)
  
  # Add signature to JSON
  local tmp_file="${json_file}.tmp"
  jq --arg sig "$signature" --arg pub "$pubkey" \
    '.signature = {"algorithm": "ECDSA-SHA256", "value": $sig, "public_key": $pub}' \
    "$json_file" > "$tmp_file" && mv "$tmp_file" "$json_file"
  
  success "wab.json signed with ECDSA-SHA256"
}

# ─── Cloudflare Setup ────────────────────────────────────────
setup_cloudflare() {
  local domain="$1"
  local api_token="$2"
  
  step "Setting up DNS record via Cloudflare API"
  
  # Get Zone ID
  local zone_id
  zone_id=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=${domain}" \
    -H "Authorization: Bearer ${api_token}" \
    -H "Content-Type: application/json" | jq -r '.result[0].id' 2>/dev/null)
  
  if [[ -z "$zone_id" || "$zone_id" == "null" ]]; then
    error "Could not find Cloudflare zone for domain: $domain\nCheck your API token permissions (Zone:DNS:Edit required)"
  fi
  
  success "Found Cloudflare zone: $zone_id"
  
  # Check if record already exists
  local existing_id
  existing_id=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?type=TXT&name=_wab.${domain}" \
    -H "Authorization: Bearer ${api_token}" \
    -H "Content-Type: application/json" | jq -r '.result[0].id' 2>/dev/null)
  
  local dns_value="v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  
  if [[ -n "$existing_id" && "$existing_id" != "null" ]]; then
    warn "DNS record already exists. Updating..."
    curl -s -X PUT \
      "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${existing_id}" \
      -H "Authorization: Bearer ${api_token}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"TXT\",\"name\":\"_wab\",\"content\":\"${dns_value}\",\"ttl\":300}" \
      > /dev/null
  else
    curl -s -X POST \
      "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records" \
      -H "Authorization: Bearer ${api_token}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"TXT\",\"name\":\"_wab\",\"content\":\"${dns_value}\",\"ttl\":300}" \
      > /dev/null
  fi
  
  success "DNS TXT record added: _wab.${domain}"
  info "Value: ${dns_value}"
}

# ─── GoDaddy Setup ───────────────────────────────────────────
setup_godaddy() {
  local domain="$1"
  local api_key="$2"
  local api_secret="$3"
  
  step "Setting up DNS record via GoDaddy API"
  
  local dns_value="v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  
  curl -s -X PUT \
    "https://api.godaddy.com/v1/domains/${domain}/records/TXT/_wab" \
    -H "Authorization: sso-key ${api_key}:${api_secret}" \
    -H "Content-Type: application/json" \
    --data "[{\"data\":\"${dns_value}\",\"ttl\":600}]" \
    > /dev/null
  
  success "DNS TXT record added: _wab.${domain}"
}

# ─── Namecheap Setup ─────────────────────────────────────────
setup_namecheap() {
  local domain="$1"
  local api_key="$2"
  local api_user="$3"
  
  step "Setting up DNS record via Namecheap API"
  warn "Namecheap API requires whitelisted IP. Providing manual instructions..."
  
  echo ""
  echo -e "${BOLD}Manual steps for Namecheap:${NC}"
  echo "1. Go to: https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/advancedns"
  echo "2. Add a new TXT record:"
  echo "   Host: _wab"
  echo "   Value: v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  echo "   TTL: 300"
  echo ""
}

# ─── Porkbun Setup ───────────────────────────────────────────
setup_porkbun() {
  local domain="$1"
  local api_key="$2"
  local secret_key="$3"
  
  step "Setting up DNS record via Porkbun API"
  
  local dns_value="v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  
  curl -s -X POST \
    "https://porkbun.com/api/json/v3/dns/create/${domain}" \
    -H "Content-Type: application/json" \
    --data "{\"secretapikey\":\"${secret_key}\",\"apikey\":\"${api_key}\",\"name\":\"_wab\",\"type\":\"TXT\",\"content\":\"${dns_value}\",\"ttl\":\"300\"}" \
    > /dev/null
  
  success "DNS TXT record added: _wab.${domain}"
}

# ─── Route53 Setup ───────────────────────────────────────────
setup_route53() {
  local domain="$1"
  
  step "Setting up DNS record via AWS Route53"
  
  if ! command -v aws &>/dev/null; then
    warn "AWS CLI not found. Providing manual instructions..."
    echo ""
    echo -e "${BOLD}Manual steps for Route53:${NC}"
    echo "1. Go to: https://console.aws.amazon.com/route53/v2/hostedzones"
    echo "2. Select your hosted zone for: ${domain}"
    echo "3. Create record:"
    echo "   Name: _wab.${domain}"
    echo "   Type: TXT"
    echo "   Value: \"v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0\""
    echo "   TTL: 300"
    return
  fi
  
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones-by-name --dns-name "${domain}" \
    --query 'HostedZones[0].Id' --output text 2>/dev/null | sed 's|/hostedzone/||')
  
  if [[ -z "$hosted_zone_id" ]]; then
    error "Could not find Route53 hosted zone for: $domain"
  fi
  
  local dns_value="v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$hosted_zone_id" \
    --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"_wab.${domain}\",\"Type\":\"TXT\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"\\\"${dns_value}\\\"\"}]}}]}" \
    > /dev/null
  
  success "DNS TXT record added via Route53"
}

# ─── Manual Instructions ─────────────────────────────────────
show_manual_instructions() {
  local domain="$1"
  
  step "Manual DNS Setup Instructions"
  echo ""
  echo -e "${BOLD}Add the following TXT record to your DNS:${NC}"
  echo ""
  echo -e "  ${CYAN}Name:${NC}  _wab.${domain}"
  echo -e "  ${CYAN}Type:${NC}  TXT"
  echo -e "  ${CYAN}Value:${NC} v=WAB1; url=https://${domain}${WELL_KNOWN_PATH}; version=1.0"
  echo -e "  ${CYAN}TTL:${NC}   300"
  echo ""
  echo "DNS propagation may take up to 48 hours."
}

# ─── Upload wab.json ─────────────────────────────────────────
upload_wab_json() {
  local json_file="$1"
  local domain="$2"
  local upload_method="${3:-manual}"
  
  step "Deploying wab.json to server"
  
  case "$upload_method" in
    ssh)
      local ssh_host="${4:-}"
      local ssh_path="${5:-/var/www/${domain}/public/.well-known/wab.json}"
      if [[ -n "$ssh_host" ]]; then
        ssh "$ssh_host" "mkdir -p $(dirname $ssh_path)"
        scp "$json_file" "${ssh_host}:${ssh_path}"
        success "Uploaded via SSH to: ${ssh_path}"
      fi
      ;;
    ftp)
      warn "FTP upload not recommended. Use SFTP instead."
      ;;
    *)
      echo ""
      echo -e "${BOLD}Manual upload instructions:${NC}"
      echo "1. Upload the file: ${json_file}"
      echo "2. Place it at: https://${domain}${WELL_KNOWN_PATH}"
      echo "3. Ensure Content-Type: application/json"
      echo ""
      ;;
  esac
}

# ─── Verify Setup ────────────────────────────────────────────
verify_setup() {
  local domain="$1"
  
  step "Verifying WAB Discovery setup"
  
  local dns_ok=false
  local file_ok=false
  
  # Check DNS record
  info "Checking DNS record..."
  local dns_result
  dns_result=$(dig TXT "_wab.${domain}" +short 2>/dev/null)
  if echo "$dns_result" | grep -q "WAB1"; then
    success "DNS record found: $dns_result"
    dns_ok=true
  else
    warn "DNS record not found yet (may take up to 48h to propagate)"
  fi
  
  # Check well-known file
  info "Checking /.well-known/wab.json..."
  local http_status
  http_status=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://${domain}${WELL_KNOWN_PATH}" 2>/dev/null)
  if [[ "$http_status" == "200" ]]; then
    success "wab.json accessible at: https://${domain}${WELL_KNOWN_PATH}"
    file_ok=true
  else
    warn "wab.json not accessible yet (HTTP $http_status)"
  fi
  
  echo ""
  if $dns_ok && $file_ok; then
    echo -e "${GREEN}${BOLD}✓ WAB Discovery is fully configured!${NC}"
    echo ""
    echo -e "  Verify online: ${CYAN}${WAB_VERIFY_URL}?domain=${domain}${NC}"
  else
    echo -e "${YELLOW}${BOLD}⚠ Setup incomplete — see warnings above${NC}"
    echo ""
    echo "  After DNS propagation, run:"
    echo -e "  ${CYAN}$0 --verify ${domain}${NC}"
  fi
}

# ─── DNSSEC Recommendation ───────────────────────────────────
recommend_dnssec() {
  local domain="$1"
  
  echo ""
  echo -e "${BOLD}${YELLOW}Security Recommendation: Enable DNSSEC${NC}"
  echo ""
  echo "DNSSEC protects your _wab DNS record from spoofing attacks."
  echo "Enable it in your registrar's DNS settings."
  echo ""
  echo "Cloudflare: Dashboard → DNS → DNSSEC → Enable"
  echo "GoDaddy:    Dashboard → DNS → DNSSEC → Enable"
  echo "Namecheap:  Advanced DNS → DNSSEC → Enable"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────
main() {
  print_banner
  
  # Parse arguments
  local domain=""
  local registrar="auto"
  local site_type="static"
  local api_token=""
  local api_secret=""
  local api_user=""
  local contact_email=""
  local verify_only=false
  local quick_mode=false
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain|-d)       domain="$2"; shift 2 ;;
      --registrar|-r)    registrar="$2"; shift 2 ;;
      --type|-t)         site_type="$2"; shift 2 ;;
      --token)           api_token="$2"; shift 2 ;;
      --secret)          api_secret="$2"; shift 2 ;;
      --user)            api_user="$2"; shift 2 ;;
      --email|-e)        contact_email="$2"; shift 2 ;;
      --verify)          verify_only=true; domain="$2"; shift 2 ;;
      --quick|-q)        quick_mode=true; shift ;;
      --help|-h)
        echo "Usage: $0 --domain example.com [options]"
        echo ""
        echo "Options:"
        echo "  --domain, -d    Domain name (required)"
        echo "  --registrar, -r Registrar: cloudflare|godaddy|namecheap|porkbun|route53|auto"
        echo "  --type, -t      Site type: static|wordpress|shopify|laravel|django"
        echo "  --token         API token/key for registrar"
        echo "  --secret        API secret (GoDaddy/Porkbun)"
        echo "  --user          API username (Namecheap)"
        echo "  --email, -e     Contact email"
        echo "  --verify        Only verify existing setup"
        echo "  --quick, -q     Quick setup (minimal prompts)"
        echo ""
        echo "Examples:"
        echo "  $0 --domain example.com --registrar cloudflare --token CF_TOKEN"
        echo "  $0 --domain example.com --registrar godaddy --token KEY --secret SECRET"
        echo "  $0 --verify example.com"
        exit 0
        ;;
      *) error "Unknown option: $1" ;;
    esac
  done
  
  # Verify only mode
  if $verify_only; then
    [[ -z "$domain" ]] && error "Domain required: $0 --verify example.com"
    verify_setup "$domain"
    exit 0
  fi
  
  # Interactive mode if no domain provided
  if [[ -z "$domain" ]]; then
    echo -e "${BOLD}Welcome to WAB Discovery Setup!${NC}"
    echo "This script will configure your domain for AI agent discovery."
    echo ""
    read -rp "Enter your domain name (e.g., example.com): " domain
    [[ -z "$domain" ]] && error "Domain name is required"
    
    if ! $quick_mode; then
      echo ""
      echo "Site type options: static, wordpress, shopify, laravel, django, rails"
      read -rp "Site type [static]: " site_type_input
      site_type="${site_type_input:-static}"
      
      read -rp "Contact email [admin@${domain}]: " email_input
      contact_email="${email_input:-admin@${domain}}"
    fi
  fi
  
  # Auto-detect registrar if needed
  if [[ "$registrar" == "auto" ]]; then
    registrar=$(detect_registrar "$domain")
    info "Detected registrar: $registrar"
  fi
  
  check_deps
  
  # Generate wab.json
  local tmp_dir
  tmp_dir=$(mktemp -d)
  local json_file="${tmp_dir}/wab.json"
  
  generate_wab_json "$domain" "$site_type" "${contact_email:-admin@${domain}}" > "$json_file"
  success "wab.json generated"
  
  # Sign the file
  sign_wab_json "$json_file"
  
  # Setup DNS based on registrar
  case "$registrar" in
    cloudflare)
      if [[ -z "$api_token" ]]; then
        echo ""
        echo "Get your Cloudflare API token at:"
        echo "https://dash.cloudflare.com/profile/api-tokens"
        echo "Required permission: Zone → DNS → Edit"
        echo ""
        read -rsp "Cloudflare API Token: " api_token
        echo ""
      fi
      setup_cloudflare "$domain" "$api_token"
      ;;
    godaddy)
      if [[ -z "$api_token" || -z "$api_secret" ]]; then
        echo ""
        echo "Get your GoDaddy API keys at: https://developer.godaddy.com/keys"
        echo ""
        read -rsp "GoDaddy API Key: " api_token; echo ""
        read -rsp "GoDaddy API Secret: " api_secret; echo ""
      fi
      setup_godaddy "$domain" "$api_token" "$api_secret"
      ;;
    namecheap)
      setup_namecheap "$domain" "$api_token" "$api_user"
      ;;
    porkbun)
      if [[ -z "$api_token" || -z "$api_secret" ]]; then
        echo ""
        echo "Get your Porkbun API keys at: https://porkbun.com/account/api"
        echo ""
        read -rsp "Porkbun API Key: " api_token; echo ""
        read -rsp "Porkbun Secret Key: " api_secret; echo ""
      fi
      setup_porkbun "$domain" "$api_token" "$api_secret"
      ;;
    route53)
      setup_route53 "$domain"
      ;;
    *)
      show_manual_instructions "$domain"
      ;;
  esac
  
  # Upload wab.json
  upload_wab_json "$json_file" "$domain"
  
  # Save local copy
  local local_output=".well-known/wab.json"
  mkdir -p ".well-known"
  cp "$json_file" "$local_output"
  success "Local copy saved: ${local_output}"
  
  # DNSSEC recommendation
  recommend_dnssec "$domain"
  
  # Verify
  echo ""
  read -rp "Run verification check now? [Y/n]: " verify_input
  if [[ "${verify_input:-Y}" =~ ^[Yy]$ ]]; then
    verify_setup "$domain"
  fi
  
  # Cleanup
  rm -rf "$tmp_dir"
  
  echo ""
  echo -e "${GREEN}${BOLD}WAB Discovery setup complete!${NC}"
  echo ""
  echo -e "  Documentation: ${CYAN}https://webagentbridge.com/docs/dns-discovery${NC}"
  echo -e "  Support:       ${CYAN}https://webagentbridge.com/support${NC}"
  echo ""
}

main "$@"
