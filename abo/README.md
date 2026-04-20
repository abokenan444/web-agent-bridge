# WAB Advanced Modules — `abo/`

This directory contains all 10 advanced WAB platform modules developed by the core team.
Each module is self-contained with its own backend, frontend, Docker setup, and integration guide.

## Modules

| # | Module | Port | Status |
|---|--------|------|--------|
| 01 | [Agent Firewall](./01-agent-firewall/) | 8888 | ✅ Ready |
| 02 | [Notary](./02-notary/) | 3002 | ✅ Ready |
| 03 | [Dark Pattern Detector](./03-dark-pattern/) | 3003 | ✅ Ready |
| 04 | [Collective Bargaining](./04-collective-bargaining/) | 3004 | 🔄 Building |
| 05 | [Gov & Intelligence](./05-gov-intelligence/) | 3005 | 🔄 Building |
| 06 | [Price Time Machine](./06-price-time-machine/) | 3006 | 🔄 Building |
| 07 | [WAB Neural](./07-neural/) | 3007 | 🔄 Building |
| 08 | [WAB Protocol](./08-protocol/) | — | 🔄 Building |
| 09 | [Bounty Network](./09-bounty-network/) | 3009 | 🔄 Building |
| 10 | [Affiliate Intelligence](./10-affiliate-intelligence/) | 3010 | 🔄 Building |

## Quick Start

```bash
# Run all modules with Docker Compose
cd abo && docker compose up -d

# Or run a specific module
cd abo/01-agent-firewall && docker compose up -d
```

## Integration Guide
See [INTEGRATION.md](./INTEGRATION.md) for full integration instructions.

---
*Powered by WAB — Web Agent Bridge | https://www.webagentbridge.com*
