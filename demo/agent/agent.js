/**
 * WAB Demo Agent
 * An AI agent that uses the Web Agent Bridge protocol to interact
 * with the demo store — no scraping, no guesswork.
 *
 * License: MIT
 */

const BASE_URL = process.env.WAB_SERVER || 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  const { headers: extraHeaders, body, ...rest } = options;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    ...(body !== undefined ? { body } : {}),
    ...rest
  });
  return res.json();
}

function log(icon, msg, data = null) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] ${icon}  ${msg}`);
  if (data) console.log('   ', JSON.stringify(data, null, 2).replace(/\n/g, '\n    '));
}

function separator(title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  if (title) console.log(`  ${title}`);
  console.log(line);
}

// ─── Agent Steps ──────────────────────────────────────────────────────────────

async function step1_discover() {
  separator('STEP 1 — Discover Capabilities');
  log('🔍', 'Reading WAB capabilities from /.well-known/wab.json...');
  const wab = await fetchJSON(`${BASE_URL}/.well-known/wab.json`);
  log('✅', `Site: "${wab.name}"`, {
    version: wab.wab,
    actionsAvailable: wab.actions.map(a => a.name)
  });
  return wab;
}

async function step2_login(wab) {
  separator('STEP 2 — Authenticate');
  const authAction = wab.auth;
  log('🔐', `Logging in via ${authAction.endpoint}...`);
  const result = await fetchJSON(`${BASE_URL}${authAction.endpoint}`, {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@wab.dev', password: 'demo123' })
  });
  log('✅', `Authenticated as "${result.name}"`, { token: result.token });
  return result.token;
}

async function step3_browse(wab, token) {
  separator('STEP 3 — Browse Products');
  log('📋', 'Fetching product list...');
  const data = await fetchJSON(`${BASE_URL}/api/products`);
  log('✅', `Found ${data.count} products:`);
  data.products.forEach(p => {
    const discount = p.originalPrice > p.price
      ? ` (${Math.round((1 - p.price / p.originalPrice) * 100)}% OFF)`
      : '';
    console.log(`      • [${p.id}] ${p.name} — $${p.price}${discount} | Stock: ${p.stock}`);
  });
  return data.products;
}

async function step4_decide(products) {
  separator('STEP 4 — Make Decision');
  log('🧠', 'Agent reasoning: Find best value product under $100...');

  // Agent logic: find highest discount % under $100
  const candidates = products.filter(p => p.price < 100);
  const best = candidates.reduce((prev, curr) => {
    const prevDiscount = (prev.originalPrice - prev.price) / prev.originalPrice;
    const currDiscount = (curr.originalPrice - curr.price) / curr.originalPrice;
    return currDiscount > prevDiscount ? curr : prev;
  });

  log('🎯', `Decision: Purchase "${best.name}"`, {
    price: `$${best.price}`,
    savings: `$${(best.originalPrice - best.price).toFixed(2)}`,
    rating: best.rating,
    reason: 'Best discount % under $100 with high rating'
  });
  return best;
}

async function step5_purchase(product, token) {
  separator('STEP 5 — Execute Purchase');
  log('🛒', `Placing order for "${product.name}"...`);
  const result = await fetchJSON(`${BASE_URL}/api/order`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      shippingAddress: '123 AI Street, Agent City'
    })
  });
  log('✅', `Order confirmed!`, {
    orderId: result.order.orderId,
    total: `$${result.order.total}`,
    status: result.order.status,
    createdAt: result.order.createdAt
  });
  return result.order;
}

async function step6_verify(order, token) {
  separator('STEP 6 — Verify Order');
  log('🔎', `Checking order status for ${order.orderId}...`);
  const result = await fetchJSON(`${BASE_URL}/api/order/${order.orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  log('✅', `Order verified — Status: ${result.order.status}`, {
    items: result.order.items.map(i => `${i.name} x${i.quantity} = $${i.subtotal}`)
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function runAgent() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           WAB DEMO AGENT — AI Shopping Assistant            ║');
  console.log('║   No scraping. No guessing. Just structured capabilities.   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    const wab      = await step1_discover();
    const token    = await step2_login(wab);
    const products = await step3_browse(wab, token);
    const product  = await step4_decide(products);
    const order    = await step5_purchase(product, token);
                     await step6_verify(order, token);

    separator('MISSION COMPLETE');
    console.log('\n  ✅  Agent completed full shopping workflow in 6 steps.');
    console.log('  ⚡  Zero HTML parsing. Zero CSS selectors. Zero fragility.');
    console.log('  🔒  Authenticated, structured, auditable.\n');

  } catch (err) {
    console.error('\n❌ Agent error:', err.message);
    console.error('   Make sure the server is running: npm start\n');
    process.exit(1);
  }
}

runAgent();
