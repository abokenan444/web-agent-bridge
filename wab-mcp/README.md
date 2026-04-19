# WAB MCP Server

> Model Context Protocol (MCP) server for [Web Agent Bridge](https://www.webagentbridge.com) — AI-native browser automation, scam protection, fairness scoring & deals intelligence.

Works with **Cursor**, **Claude Desktop**, **Cline**, **Windsurf**, and any MCP-compatible AI tool.

## Quick Start

```bash
npx wab-mcp-server
```

## Configuration

### Cursor IDE

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wab": {
      "command": "npx",
      "args": ["-y", "wab-mcp-server"]
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wab": {
      "command": "npx",
      "args": ["-y", "wab-mcp-server"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `wab_scan_url` | Scan URLs against 47 threat databases for phishing, malware, and scams |
| `wab_fairness_check` | Score platform transparency (0-100) across 15 signals |
| `wab_find_deals` | Cross-platform price intelligence with fairness filtering |
| `wab_agent_query` | Natural language web automation queries |
| `wab_generate_snippet` | Generate WAB integration code (JS, Python, React, Next.js, Docker) |
| `wab_get_docs` | Retrieve WAB documentation and API reference |

## Example Usage (in AI Chat)

> "Scan https://example.com for phishing threats"

The AI tool will call `wab_scan_url` and return a risk assessment with threat details.

> "Generate a React component that uses WAB scam shield"

The AI tool will call `wab_generate_snippet` and return ready-to-use code with WAB integration.

> "Check if Amazon is a fair platform"

The AI tool will call `wab_fairness_check` and return a transparency score with detailed signals.

## SDK

The WAB SDK is also available for direct integration:

```bash
npm install @wab/sdk     # JavaScript/Node.js
pip install wab-sdk       # Python
```

```javascript
import { WAB } from '@wab/sdk';
const wab = new WAB({ apiKey: process.env.WAB_API_KEY });

// Scan a URL
const scan = await wab.shield.scan('https://example.com');

// Check platform fairness
const score = await wab.fairness.check('amazon.com');

// Find deals
const deals = await wab.deals.search('laptop');
```

## Links

- **Website**: https://www.webagentbridge.com
- **Documentation**: https://www.webagentbridge.com/docs
- **GitHub**: https://github.com/abokenan444/web-agent-bridge
- **npm (main)**: https://www.npmjs.com/package/web-agent-bridge

## License

MIT
