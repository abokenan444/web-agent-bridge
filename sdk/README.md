# WAB Agent SDK

SDK for building AI agents that interact with [Web Agent Bridge](https://github.com/abokenan444/web-agent-bridge).

## Quick Start

```javascript
const puppeteer = require('puppeteer');
const { WABAgent } = require('web-agent-bridge/sdk');

const browser = await puppeteer.launch();
const page = await browser.newPage();

const agent = new WABAgent(page);
await agent.navigateAndWait('https://example.com');

// Discover available actions
const actions = await agent.getActions();
console.log(actions);

// Execute an action
const result = await agent.execute('signup', { email: 'user@example.com' });

// Read page content
const content = await agent.readContent('h1');

await browser.close();
```

## BiDi Mode

```javascript
const agent = new WABAgent(page, { useBiDi: true });
await agent.waitForBridge();

const context = await agent.getBiDiContext();
const actions = await agent.getActions();
await agent.execute('click-login');
```

## API

| Method | Description |
|---|---|
| `waitForBridge()` | Wait for WAB to load on the page |
| `hasBridge()` | Check if WAB is available |
| `getActions(category?)` | List available actions |
| `getAction(name)` | Get a specific action |
| `execute(name, params?)` | Execute an action |
| `readContent(selector)` | Read element text content |
| `getPageInfo()` | Get page metadata |
| `authenticate(apiKey, meta?)` | Authenticate the agent |
| `navigateAndWait(url)` | Navigate and wait for bridge |
| `executeSteps(steps)` | Execute multiple actions in sequence |
| `executeParallel(actions)` | Execute multiple actions in parallel |
| `getBiDiContext()` | Get BiDi context (BiDi mode only) |

## Cross-Site Agent Orchestration

Manage multiple WAB-enabled sites simultaneously with `WABMultiAgent`:

```javascript
const { WABMultiAgent } = require('web-agent-bridge-sdk');

const multiAgent = new WABMultiAgent([
  'https://site1.com',
  'https://site2.com',
  'https://site3.com'
]);

await multiAgent.launch();

// Compare prices across all sites
const comparison = await multiAgent.comparePrices('product-sku');
console.log(comparison.cheapest);  // { site, price, currency }
console.log(`You save: $${comparison.savings}`);

// Execute any action on all sites in parallel
const infos = await multiAgent.executeAll('getPageInfo');

// Discover capabilities across all sites
const discoveries = await multiAgent.discoverAll();

await multiAgent.close();
```

### WABMultiAgent API

| Method | Description |
|---|---|
| `launch()` | Connect to all sites |
| `discoverAll()` | Discover actions on all sites |
| `executeAll(action, params?)` | Run action on all sites in parallel |
| `comparePrices(sku)` | Compare prices and find cheapest deal |
| `compareAction(action, params?, rankFn?)` | Compare action results with custom ranking |
| `navigateAll(path)` | Navigate all sessions to a path |
| `screenshotAll(opts?)` | Screenshot all sites |
| `status()` | Get connection summary |
| `close()` | Close all browser sessions |
