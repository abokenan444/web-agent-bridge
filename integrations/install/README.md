# WAB Universal Installer

> **License:** MIT (Open Source) — Full source available

## One-line Install

```bash
curl -fsSL https://raw.githubusercontent.com/abokenan444/web-agent-bridge/master/integrations/install/install.sh | sudo bash
```

## What it does

1. Detects your OS (Ubuntu, Debian, CentOS, RHEL, Alpine)
2. Installs Node.js 20 LTS if not present
3. Installs build dependencies (python3, make, g++)
4. Creates a dedicated `wab` system user
5. Installs `web-agent-bridge` from npm
6. Generates secure JWT secrets automatically
7. Writes `/var/lib/wab/.env` with your configuration
8. Installs and starts a `systemd` service (`wab.service`)
9. Opens firewall port (ufw/firewalld auto-detected)
10. Runs a health check

## Options

```bash
sudo bash install.sh --port 4000 --data-dir /srv/wab --version 3.2.0
```

| Option | Default | Description |
|---|---|---|
| `--port PORT` | `3000` | Server port |
| `--data-dir DIR` | `/var/lib/wab` | Data & config directory |
| `--install-dir DIR` | `/opt/wab` | npm install prefix |
| `--version VERSION` | `latest` | Specific WAB version |
| `--no-service` | — | Skip systemd service |
| `--skip-node` | — | Skip Node.js check |

## After Install

```bash
# Check status
systemctl status wab

# View logs
journalctl -u wab -f

# Edit config
nano /var/lib/wab/.env
systemctl restart wab
```

## Supported Systems

| OS | Versions | Package Manager |
|---|---|---|
| Ubuntu | 20.04, 22.04, 24.04 | apt |
| Debian | 11, 12 | apt |
| CentOS | 8, 9 | yum/dnf |
| RHEL | 8, 9 | dnf |
| Alpine | 3.14+ | apk |
