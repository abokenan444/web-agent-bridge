/**
 * WAB Demo — The Comparison
 * Side-by-side: Traditional scraping approach vs WAB approach
 * This is the core "aha moment" for anyone watching the demo.
 *
 * License: MIT
 */

const BASE_URL = process.env.WAB_SERVER || 'http://localhost:3000';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(msg); }
function err(msg) { console.log(`\x1b[31m${msg}\x1b[0m`); }
function ok(msg)  { console.log(`\x1b[32m${msg}\x1b[0m`); }
function dim(msg) { console.log(`\x1b[90m${msg}\x1b[0m`); }
function bold(msg){ console.log(`\x1b[1m${msg}\x1b[0m`); }

async function traditionalApproach() {
  bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  bold('  APPROACH 1: Traditional Scraping / DOM Automation');
  bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  log('  Agent: "I need to buy the cheapest product on this store."');
  log('  Agent: "Let me load the page and parse the HTML..."\n');
  await sleep(500);

  dim('  [1] Fetching HTML from http://localhost:3000 ...');
  const html = await fetch(BASE_URL).then(r => r.text());
  dim(`  [2] Got ${html.length} bytes of HTML`);
  await sleep(300);

  dim('  [3] Trying to find price with regex: /\\$([\\d.]+)/g ...');
  const prices = [...html.matchAll(/\$[\d.]+/g)].map(m => m[0]);
  dim(`  [4] Found prices in HTML: ${prices.join(', ') || 'NONE FOUND'}`);
  await sleep(300);

  dim('  [5] Trying to find "Add to Cart" button...');
  const hasButton = html.includes('add-to-cart') || html.includes('Add to Cart') || html.includes('buy-btn');
  dim(`  [6] Button found: ${hasButton ? 'YES' : 'NO — not in this page'}`);
  await sleep(300);

  dim('  [7] Trying to find product IDs...');
  const productIds = [...html.matchAll(/data-product-id="([^"]+)"/g)].map(m => m[1]);
  dim(`  [8] Product IDs found: ${productIds.length > 0 ? productIds.join(', ') : 'NONE'}`);
  await sleep(300);

  dim('  [9] Trying to find checkout form...');
  dim('  [10] Guessing form fields: productId? item_id? sku? product?');
  dim('  [11] Guessing endpoint: /checkout? /cart/add? /buy? /order?');
  await sleep(500);

  err('\n  ❌ RESULT: Cannot reliably complete purchase.');
  err('  ❌ The page is a simple HTML page — no structured data exposed.');
  err('  ❌ Agent must guess field names, endpoints, and form structure.');
  err('  ❌ Any website redesign breaks this agent completely.\n');

  log('  Problems with this approach:');
  err('    • Fragile — breaks on every UI change');
  err('    • Unreliable — guessing endpoints and field names');
  err('    • Slow — parsing megabytes of HTML for a few data points');
  err('    • Blind — no way to know what actions are actually available');
  err('    • Risky — might click wrong buttons or submit wrong data\n');
}

async function wabApproach() {
  bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  bold('  APPROACH 2: Web Agent Bridge (WAB)');
  bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  log('  Agent: "I need to buy the cheapest product on this store."');
  log('  Agent: "Let me check the WAB capabilities document..."\n');
  await sleep(300);

  dim('  [1] Fetching /.well-known/wab.json ...');
  const wab = await fetch(`${BASE_URL}/.well-known/wab.json`).then(r => r.json());
  ok(`  [2] ✅ Got structured capabilities: ${wab.actions.length} actions available`);
  ok(`      Actions: ${wab.actions.map(a => a.name).join(', ')}`);
  await sleep(300);

  dim('  [3] Reading auth requirements...');
  ok(`  [4] ✅ Auth: POST ${wab.auth.endpoint} with email+password`);
  await sleep(200);

  dim('  [5] Authenticating...');
  const auth = await fetch(`${BASE_URL}${wab.auth.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@wab.dev', password: 'demo123' })
  }).then(r => r.json());
  ok(`  [6] ✅ Authenticated as "${auth.name}"`);
  await sleep(200);

  dim('  [7] Listing products via /api/products ...');
  const { products } = await fetch(`${BASE_URL}/api/products`).then(r => r.json());
  ok(`  [8] ✅ Got ${products.length} products with full structured data`);
  await sleep(200);

  dim('  [9] Finding cheapest product...');
  const cheapest = products.reduce((a, b) => a.price < b.price ? a : b);
  ok(`  [10] ✅ Cheapest: "${cheapest.name}" at $${cheapest.price} (ID: ${cheapest.id})`);
  await sleep(200);

  dim('  [11] Placing order via /api/order ...');
  const order = await fetch(`${BASE_URL}/api/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.token}`
    },
    body: JSON.stringify({ items: [{ productId: cheapest.id, quantity: 1 }] })
  }).then(r => r.json());
  ok(`  [12] ✅ Order confirmed: ${order.order.orderId} — Total: $${order.order.total}`);
  await sleep(200);

  ok('\n  ✅ RESULT: Purchase completed successfully in 12 steps.');
  ok('  ✅ Zero HTML parsing. Zero guessing. Zero fragility.\n');

  log('  Advantages of WAB:');
  ok('    • Reliable — structured API, not fragile DOM selectors');
  ok('    • Fast — fetch one JSON file instead of parsing HTML');
  ok('    • Safe — explicit permissions and typed parameters');
  ok('    • Resilient — UI can change, WAB contract stays stable');
  ok('    • Auditable — every action is logged and traceable\n');
}

async function summary() {
  bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  bold('  SUMMARY');
  bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  log('  ┌─────────────────────┬──────────────────┬──────────────────┐');
  log('  │                     │  Traditional     │  WAB             │');
  log('  ├─────────────────────┼──────────────────┼──────────────────┤');
  log('  │ Discover actions    │ ❌ Guess from HTML│ ✅ Read wab.json │');
  log('  │ Find endpoints      │ ❌ Trial & error  │ ✅ Declared       │');
  log('  │ Know field names    │ ❌ Reverse-eng.   │ ✅ Typed schema   │');
  log('  │ Handle auth         │ ❌ Fragile        │ ✅ Declared flow  │');
  log('  │ Survive UI changes  │ ❌ Breaks         │ ✅ Stable         │');
  log('  │ Audit trail         │ ❌ None           │ ✅ Full log       │');
  log('  └─────────────────────┴──────────────────┴──────────────────┘\n');

  bold('  "robots.txt told bots what NOT to do.');
  bold('   WAB tells AI agents what they CAN do."\n');
  log('  🌐  GitHub: https://github.com/abokenan444/web-agent-bridge');
  log('  💬  Discord: https://discord.gg/NnbpJYEF\n');
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         WAB DEMO — Traditional vs WAB Comparison            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    await traditionalApproach();
    await sleep(800);
    await wabApproach();
    await sleep(500);
    await summary();
  } catch (e) {
    err(`\n❌ Error: ${e.message}`);
    err('   Make sure the server is running: npm start\n');
    process.exit(1);
  }
}

run();
