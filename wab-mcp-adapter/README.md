# WAB-MCP Adapter

**MCP adapter for Web Agent Bridge** — exposes every capability of a WAB-enabled website as a set of [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) tools so that any MCP-compatible AI agent (Claude, GPT, Gemini, open-source LLMs, etc.) can discover, read, and interact with the site through a single, standardised interface.

## Quick Start

```js
const { WABMCPAdapter } = require('wab-mcp-adapter');

const adapter = new WABMCPAdapter({
  siteUrl: 'https://example.com',
  transport: 'http',       // 'http' | 'websocket' | 'direct'
  apiKey: 'sk-optional',   // optional API key
});

// 1. Discover site capabilities
const doc = await adapter.discover();

// 2. Get MCP tool definitions for the AI agent
const tools = await adapter.getTools();

// 3. Execute a tool call
const result = await adapter.executeTool('wab_execute_action', {
  name: 'signup',
  params: { email: 'user@example.com' },
});

// 4. Clean up
adapter.close();
```

## API Reference

### `new WABMCPAdapter(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `siteUrl` | `string` | — | Target WAB site URL (required for `http` transport) |
| `siteId` | `string` | `null` | WAB site identifier |
| `apiKey` | `string` | `null` | API key for authenticated requests |
| `transport` | `string` | `'http'` | Transport type: `http`, `websocket`, or `direct` |
| `registryUrl` | `string` | `https://registry.webagentbridge.com` | WAB fairness registry URL |
| `page` | `object` | — | Puppeteer/Playwright page (required for `direct`) |
| `wsUrl` | `string` | auto | WebSocket URL (required for `websocket` if no `siteUrl`) |
| `timeout` | `number` | `15000` | Request timeout in milliseconds |

### Methods

| Method | Returns | Description |
|---|---|---|
| `discover(url?)` | `Promise<object>` | Fetch the WAB discovery document |
| `getTools()` | `Promise<object[]>` | Return MCP tool definitions (built-in + site-specific) |
| `executeTool(name, input)` | `Promise<object>` | Execute an MCP tool call |
| `close()` | `void` | Release transport resources |

## Built-in Tools

These tools are always available, regardless of which site actions are discovered:

| Tool | Description |
|---|---|
| `wab_discover` | Fetch the WAB discovery document from a site |
| `wab_get_actions` | List available actions, optionally filtered by category |
| `wab_execute_action` | Execute any WAB action by name and params |
| `wab_read_content` | Read page element text by CSS selector |
| `wab_get_page_info` | Return page metadata and bridge configuration |
| `wab_fairness_search` | Search the WAB registry with fairness-weighted results |
| `wab_authenticate` | Authenticate with the site using an API key |

Site-specific actions are exposed as additional tools named `wab_<action_name>` and are generated automatically from the discovery document.

## Transport Options

| Transport | When to use | Requirements |
|---|---|---|
| **http** | Server-to-server or CLI tools calling a WAB site over REST | `siteUrl` |
| **websocket** | Real-time bidirectional communication with low latency | `wsUrl` or `siteUrl` |
| **direct** | In-browser automation with Puppeteer/Playwright | `page` object |

## Fairness Protocol

The WAB discovery registry uses a **fairness-weighted ranking** algorithm that prevents large, high-traffic sites from monopolising search results. When you call `wab_fairness_search`, the registry applies:

- **Inverse-popularity weighting** — smaller sites receive a ranking boost.
- **Recency bonus** — newly registered or recently updated sites surface sooner.
- **Category balancing** — results are distributed across categories to avoid domination by a single vertical.

This ensures a level playing field so every WAB-enabled site has equitable visibility to AI agents.

## Integration with Claude / MCP

Pass the tools returned by `getTools()` as the `tools` parameter when calling the Anthropic Messages API and route any `tool_use` blocks back through `executeTool`:

```js
const Anthropic = require('@anthropic-ai/sdk');
const { WABMCPAdapter } = require('wab-mcp-adapter');

const client = new Anthropic();
const adapter = new WABMCPAdapter({ siteUrl: 'https://shop.example.com' });
const tools = await adapter.getTools();

let messages = [{ role: 'user', content: 'Find the signup form and register me.' }];

while (true) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools,
    messages,
  });

  if (res.stop_reason === 'end_turn') break;

  const toolBlocks = res.content.filter((b) => b.type === 'tool_use');
  if (!toolBlocks.length) break;

  messages.push({ role: 'assistant', content: res.content });

  const toolResults = [];
  for (const block of toolBlocks) {
    const result = await adapter.executeTool(block.name, block.input);
    toolResults.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(result.content),
    });
  }
  messages.push({ role: 'user', content: toolResults });
}

adapter.close();
```

## License

MIT — see [LICENSE](../LICENSE).
