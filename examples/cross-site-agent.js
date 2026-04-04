/**
 * Example: Cross-Site Agent Orchestration
 *
 * One agent manages multiple WAB-enabled sites simultaneously.
 * Compares prices, aggregates product data, and finds the best deal.
 *
 * Prerequisites:
 *   npm install puppeteer web-agent-bridge-sdk
 *
 * Usage:
 *   node examples/cross-site-agent.js site1.com site2.com site3.com
 */

const { WABMultiAgent } = require('../sdk');

const sites = process.argv.slice(2);
if (sites.length < 2) {
  console.log('Usage: node cross-site-agent.js <url1> <url2> [url3 ...]');
  console.log('Example: node cross-site-agent.js https://shop1.com https://shop2.com');
  process.exit(1);
}

// Ensure URLs have protocol
const urls = sites.map((s) => (s.startsWith('http') ? s : `https://${s}`));

async function main() {
  console.log('\n🌐 WAB Cross-Site Agent Orchestration');
  console.log(`   Sites: ${urls.length}\n`);

  // 1. Create multi-agent and connect to all sites
  const multiAgent = new WABMultiAgent(urls, {
    timeout: 20000,
    headless: true
  });

  console.log('⏳ Launching browsers and connecting...');
  const { connected, failed } = await multiAgent.launch();

  for (const site of connected) console.log(`  ✓ Connected: ${site}`);
  for (const site of failed) console.log(`  ✗ Failed: ${site}`);

  if (connected.length === 0) {
    console.log('\n✗ No sites connected. Exiting.');
    await multiAgent.close();
    return;
  }

  // 2. Discover all sites
  console.log('\n📡 Discovering WAB capabilities...');
  const discoveries = await multiAgent.discoverAll();
  for (const d of discoveries) {
    console.log(`  ${d.site}: ${d.actions.length} actions`);
  }

  // 3. Compare prices for a product
  console.log('\n💰 Comparing prices...');
  const comparison = await multiAgent.comparePrices('product-sku');
  for (const r of comparison.results) {
    if (r.price != null) {
      console.log(`  ${r.site}: ${r.currency} ${r.price.toFixed(2)} — ${r.product}`);
    } else {
      console.log(`  ${r.site}: ${r.error || 'No price data'}`);
    }
  }

  if (comparison.cheapest) {
    console.log(`\n🏆 Best deal: ${comparison.cheapest.site}`);
    console.log(`   Price: ${comparison.cheapest.currency} ${comparison.cheapest.price.toFixed(2)}`);
    if (comparison.savings != null) {
      console.log(`   You save: ${comparison.cheapest.currency} ${comparison.savings.toFixed(2)}`);
    }
  }

  // 4. Execute a common action across all sites
  console.log('\n🔄 Executing getPageInfo on all sites...');
  const infos = await multiAgent.executeAll('getPageInfo');
  for (const info of infos) {
    if (info.status === 'fulfilled' && info.value) {
      console.log(`  ${info.site}: "${info.value.title}" (v${info.value.bridgeVersion})`);
    }
  }

  // 5. Cleanup
  await multiAgent.close();
  console.log('\n✓ All sessions closed. Done!\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
