/**
 * Example: Basic AI Agent using Puppeteer + WAB
 *
 * This agent connects to a website that has the Web Agent Bridge script installed,
 * discovers available actions, and executes them.
 *
 * Prerequisites:
 *   npm install puppeteer
 *
 * Usage:
 *   node examples/puppeteer-agent.js <url>
 */

const puppeteer = require('puppeteer');

const TARGET_URL = process.argv[2] || 'http://localhost:3000';

async function main() {
  console.log(`\n🤖 WAB Puppeteer Agent`);
  console.log(`   Target: ${TARGET_URL}\n`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to the target site
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
  console.log(`✓ Page loaded: ${await page.title()}`);

  // Wait for WAB bridge to be ready
  const hasBridge = await page.evaluate(() => {
    return new Promise((resolve) => {
      if (window.AICommands && window.AICommands._ready) {
        resolve(true);
      } else {
        // Wait up to 5 seconds for bridge
        const timeout = setTimeout(() => resolve(false), 5000);
        document.addEventListener('wab:ready', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      }
    });
  });

  if (!hasBridge) {
    console.log('✗ Web Agent Bridge not found on this page.');
    await browser.close();
    return;
  }

  console.log('✓ Web Agent Bridge detected\n');

  // Step 1: Get page info
  const pageInfo = await page.evaluate(() => window.AICommands.getPageInfo());
  console.log('📄 Page Info:');
  console.log(`   Title: ${pageInfo.title}`);
  console.log(`   URL: ${pageInfo.url}`);
  console.log(`   Bridge Version: ${pageInfo.bridgeVersion}`);
  console.log(`   Tier: ${pageInfo.tier}`);
  console.log(`   Actions Available: ${pageInfo.actionsCount}`);
  console.log(`   Rate Limit Remaining: ${pageInfo.rateLimitRemaining}\n`);

  // Step 2: Discover all available actions
  const actions = await page.evaluate(() => window.AICommands.getActions());
  console.log(`🔍 Discovered ${actions.length} actions:`);
  actions.forEach((action) => {
    console.log(`   • ${action.name} (${action.trigger}) — ${action.description}`);
    if (action.fields) {
      action.fields.forEach((f) => {
        console.log(`     └─ ${f.name}: ${f.type}${f.required ? ' (required)' : ''}`);
      });
    }
  });

  // Step 3: Read content from the page
  const content = await page.evaluate(() => {
    return window.AICommands.readContent('h1') || window.AICommands.readContent('title');
  });
  if (content && content.success) {
    console.log(`\n📖 Page heading: "${content.text}"`);
  }

  // Step 4: Execute a click action (first available)
  const clickAction = actions.find((a) => a.trigger === 'click');
  if (clickAction) {
    console.log(`\n▶ Executing action: "${clickAction.name}"`);
    const result = await page.evaluate(
      (name) => window.AICommands.execute(name),
      clickAction.name
    );
    console.log(`   Result: ${result.success ? '✓ Success' : '✗ ' + result.error}`);
  }

  // Step 5: List permissions
  const permissions = pageInfo.permissions;
  console.log('\n🔐 Permissions:');
  Object.entries(permissions).forEach(([key, value]) => {
    console.log(`   ${value ? '✓' : '✗'} ${key}`);
  });

  console.log('\n✓ Agent session complete.');
  await browser.close();
}

main().catch((err) => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
