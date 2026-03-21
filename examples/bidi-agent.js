/**
 * Example: AI Agent using WebDriver BiDi Protocol via WAB
 *
 * This agent connects to a website using the __wab_bidi interface,
 * which follows WebDriver BiDi conventions for standardized communication.
 *
 * Prerequisites:
 *   npm install puppeteer
 *
 * Usage:
 *   node examples/bidi-agent.js <url>
 */

const puppeteer = require('puppeteer');

const TARGET_URL = process.argv[2] || 'http://localhost:3000';

let commandId = 0;

function bidiCommand(method, params = {}) {
  return { id: ++commandId, method, params };
}

async function main() {
  console.log(`\n🔗 WAB BiDi Agent`);
  console.log(`   Target: ${TARGET_URL}\n`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
  console.log(`✓ Page loaded: ${await page.title()}`);

  // Check for BiDi interface
  const hasBiDi = await page.evaluate(() => {
    return typeof window.__wab_bidi !== 'undefined' && typeof window.__wab_bidi.send === 'function';
  });

  if (!hasBiDi) {
    console.log('✗ WAB BiDi interface not found on this page.');
    await browser.close();
    return;
  }

  console.log('✓ WAB BiDi interface detected\n');

  // Step 1: Get BiDi context
  const context = await page.evaluate(() => window.__wab_bidi.getContext());
  console.log('📋 BiDi Context:');
  console.log(`   URL: ${context.context.url}`);
  console.log(`   Title: ${context.context.title}`);
  console.log(`   Version: ${context.version}`);
  console.log(`   Tier: ${context.capabilities.tier}`);
  console.log(`   Capabilities: ${context.capabilities.actions.length} actions\n`);

  // Step 2: Get actions via BiDi command
  const actionsResult = await page.evaluate((cmd) => {
    return window.__wab_bidi.send(cmd);
  }, bidiCommand('wab.getActions'));

  console.log(`🔍 Actions (via BiDi):`);
  if (actionsResult.result) {
    actionsResult.result.forEach((action) => {
      console.log(`   • ${action.name} [${action.trigger}] — ${action.description}`);
    });
  }

  // Step 3: Get page info via BiDi
  const infoResult = await page.evaluate((cmd) => {
    return window.__wab_bidi.send(cmd);
  }, bidiCommand('wab.getPageInfo'));

  console.log('\n📄 Page Info (via BiDi):');
  if (infoResult.result) {
    console.log(`   Title: ${infoResult.result.title}`);
    console.log(`   Domain: ${infoResult.result.domain}`);
    console.log(`   Bridge: v${infoResult.result.bridgeVersion}`);
  }

  // Step 4: Read content via BiDi command
  const readResult = await page.evaluate((cmd) => {
    return window.__wab_bidi.send(cmd);
  }, bidiCommand('wab.readContent', { selector: 'h1' }));

  if (readResult.result && readResult.result.success) {
    console.log(`\n📖 Content: "${readResult.result.text}"`);
  }

  // Step 5: Execute an action via BiDi
  const actions = actionsResult.result || [];
  const firstAction = actions.find((a) => a.trigger === 'click');
  if (firstAction) {
    console.log(`\n▶ Executing via BiDi: "${firstAction.name}"`);
    const execResult = await page.evaluate((cmd) => {
      return window.__wab_bidi.send(cmd);
    }, bidiCommand('wab.executeAction', { name: firstAction.name }));

    const r = execResult.result;
    console.log(`   Result: ${r && r.success ? '✓ Success' : '✗ ' + (r?.error || 'Unknown error')}`);
  }

  // Step 6: Test error handling
  console.log('\n🧪 Testing error handling:');
  const errorResult = await page.evaluate((cmd) => {
    return window.__wab_bidi.send(cmd);
  }, bidiCommand('wab.unknownMethod'));

  if (errorResult.error) {
    console.log(`   ✓ Unknown command handled: ${errorResult.error.code} — ${errorResult.error.message}`);
  }

  console.log('\n✓ BiDi agent session complete.');
  await browser.close();
}

main().catch((err) => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
