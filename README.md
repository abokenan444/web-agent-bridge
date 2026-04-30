<div align="center">
  <img src="https://raw.githubusercontent.com/abokenan444/web-agent-bridge/main/public/images/wab-logo-large.png" alt="Web Agent Bridge Logo" width="200" />
  <h1>Web Agent Bridge (WAB)</h1>
  <p><b>The Open AI ↔ Web Protocol & Agent Platform</b></p>
  <p><i>robots.txt told bots what NOT to do. WAB tells AI agents what they CAN do.</i></p>

  [![npm](https://img.shields.io/npm/v/web-agent-bridge?color=blue&style=flat-square)](https://www.npmjs.com/package/web-agent-bridge)
  [![License: Open Core](https://img.shields.io/badge/License-Open_Core-blue.svg?style=flat-square)](LICENSE)
  [![One-Click DNS Discovery](https://img.shields.io/badge/DNS%20Discovery-One--Click-6366f1?style=flat-square&logo=dns&logoColor=white)](https://webagentbridge.com/activate)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/NnbpJYEF)

  <br />
  <a href="https://webagentbridge.com"><strong>Website</strong></a> ·
  <a href="https://webagentbridge.com/docs"><strong>Documentation</strong></a> ·
  <a href="https://webagentbridge.com/activate"><strong>DNS Discovery</strong></a> ·
  <a href="README.ar.md"><strong>العربية</strong></a>
</div>

<br />

## Why WAB?

Currently, AI agents interact with the web by parsing the DOM, guessing selectors, or relying on fragile visual models. This is slow, error-prone, and breaks whenever a site's layout changes.

**WAB solves this by providing a standardized API for the web.** It creates a secure bridge between AI agents and websites, allowing agents to discover capabilities, execute commands, and interact with sites accurately — no DOM parsing, no scraping, no guesswork.

### For Website Owners 🏢
Control exactly how AI interacts with your site. Expose specific capabilities, set rate limits, and monitor agent activity.

### For AI Developers 🤖
Build reliable agents that work instantly on any WAB-enabled site. Stop writing custom scrapers and start using the `window.AICommands` standardized interface.

---

## ⚡ Quick Start

### 1. The Easiest Way: DNS Discovery (No Code)
Make your website instantly discoverable by AI agents by adding a single DNS TXT record. No code changes required.

```dns
_wab.yourdomain.com  TXT  "v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json"
```
👉 [**Watch the 40-second setup video & full guide**](https://webagentbridge.com/activate)

### 2. The Developer Way: Install via npm
```bash
npm install web-agent-bridge
```

```javascript
import { initWAB } from 'web-agent-bridge';

initWAB({
  siteId: 'your-site-id',
  capabilities: ['browse', 'api', 'commerce'],
});
```

---

## ✨ Core Features

### 🔍 DNS Discovery Protocol
The fastest way to make your site AI-ready. AI agents can find your capabilities document via DNS over HTTPS (DoH) without any initial HTTP request.

### 🛡️ Sovereign Shield & Firewall
Protect your site from malicious bots while allowing verified AI agents. Includes IP rate-limiting, Intent Engine, and Human-Gate rollback.

### 💻 Agent OS & Workspace
A premium 4-panel workspace for non-technical users featuring an embedded browser, smart agent chat, real-time negotiation monitor, and results panel.

### 🌐 Universal Agent Mode
Works on any website, even those without the WAB script installed, using our advanced fallback heuristics.

### 🗣️ Multilingual Support
Full Arabic and English interface with auto-detection. The smart agent understands and responds in any language the user writes in.

---

## 🏗️ Architecture & Open Core Model

WAB uses an **Open Core** dual-license model to ensure the protocol remains free while supporting sustainable development.

| Component | License | Description |
|-----------|---------|-------------|
| **Core SDK & Protocol** | MIT | The fundamental building blocks, discovery protocol, and SDKs. |
| **WordPress Plugin** | GPL-2.0 | Full integration for WordPress sites. |
| **Engines (Firewall, Price, etc.)** | Proprietary (Free) | Advanced detection, scoring, and protection engines. |
| **API Gateway & Pro Modules** | Commercial | Enterprise features, data marketplace, and advanced SLA. |

---


---

## 🔌 Live Integrations

The following platforms have active WAB DNS records and are live on the AI-agent discovery network:

| Company | Industry | WAB Feature Used |
|---------|----------|-----------------|
| **Build Repair Pro** | Construction & Repair | DNS Discovery |
| **Take Your Appointment** | Booking & Scheduling | DNS Discovery |
| **Cultural Translate** | Translation Services | DNS Discovery |
| **Stars Group** | Business Services | DNS Discovery |
| **Bookings Here** | Travel & Hospitality | DNS Discovery |
| **Candles Fashion** | Lifestyle & Retail | DNS Discovery |
| **Sandex** | E-Commerce | DNS Discovery |
| **Beauty Services** | Beauty & Wellness | DNS Discovery |
| **Farmers Unity** | Agriculture & Community | DNS Discovery |
| **Shield Messenger** | Secure Communications | DNS Discovery |

> All platforms have active `_wab` DNS TXT records and are live on the WAB discovery network right now.

---
## 🤝 Contributing

We welcome contributions from the community! Whether it's fixing a bug, improving documentation, or proposing a new feature.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the terms described in the [LICENSE](LICENSE) file. The core protocol and SDKs are MIT licensed.

<div align="center">
  <i>© 2026 Web Agent Bridge. Built for the AI-first web.</i>
</div>
