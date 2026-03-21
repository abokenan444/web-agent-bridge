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
| `getBiDiContext()` | Get BiDi context (BiDi mode only) |
