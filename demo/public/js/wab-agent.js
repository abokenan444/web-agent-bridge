/**
 * WAB Demo Store — Frontend App
 * Handles: product loading, live agent demo, terminal output
 */

// When served under /demo prefix on main WAB site, use /demo. When standalone, use ''.
const API = (function(){
  const p = window.location.pathname;
  if (p.startsWith('/demo')) return '/demo';
  return '';
})();

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(path, opts = {}) {
  const fetchOpts = {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  };
  if (opts.body !== undefined) fetchOpts.body = opts.body;
  const res = await fetch(API + path, fetchOpts);
  return res.json();
}

// ─── Terminal ─────────────────────────────────────────────────────────────────
const terminal = {
  el: null,
  statusEl: null,

  init() {
    this.el = document.getElementById('terminal-body');
    this.statusEl = document.getElementById('terminal-status');
  },

  clear() {
    this.el.innerHTML = '';
  },

  write(text, cls = '') {
    const line = document.createElement('div');
    line.className = 'terminal-line' + (cls ? ' terminal-line--' + cls : '');
    line.textContent = text;
    this.el.appendChild(line);
    this.el.scrollTop = this.el.scrollHeight;
  },

  sep(title = '') {
    const line = '─'.repeat(56);
    this.write(line, 'sep');
    if (title) this.write('  ' + title, 'bold');
    this.write(line, 'sep');
  },

  setStatus(status) {
    this.statusEl.textContent = status;
    this.statusEl.className = 'terminal-badge ' + status;
  }
};

// ─── Steps ────────────────────────────────────────────────────────────────────
const steps = {
  setActive(n) {
    document.querySelectorAll('.agent-step').forEach(el => {
      el.classList.remove('active');
      if (parseInt(el.dataset.step) === n) el.classList.add('active');
    });
  },

  setDone(n) {
    const el = document.querySelector(`.agent-step[data-step="${n}"]`);
    if (el) {
      el.classList.remove('active');
      el.classList.add('done');
      el.querySelector('.step-status').textContent = '✅';
    }
  },

  resetAll() {
    document.querySelectorAll('.agent-step').forEach(el => {
      el.classList.remove('active', 'done');
      el.querySelector('.step-status').textContent = '⏳';
    });
  }
};

// ─── Load Products ────────────────────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById('products-grid');
  try {
    const data = await apiFetch('/api/products');
    grid.innerHTML = '';
    data.products.forEach(p => {
      const discount = p.originalPrice > p.price
        ? Math.round((1 - p.price / p.originalPrice) * 100)
        : 0;
      const stars = '★'.repeat(Math.round(p.rating)) + '☆'.repeat(5 - Math.round(p.rating));
      grid.innerHTML += `
        <div class="product-card">
          <div class="product-image">
            <img src="${p.image}" alt="${p.name}" onerror="this.style.display='none'" />
          </div>
          <div class="product-body">
            <div class="product-category">${p.category}</div>
            <div class="product-name">${p.name}</div>
            <div class="product-desc">${p.description}</div>
            <div class="product-rating">
              <span class="stars">${stars}</span>
              <span>${p.rating} (${p.reviews} reviews)</span>
            </div>
            <div class="product-footer">
              <div class="product-price">
                <span class="price-current">$${p.price}</span>
                ${p.originalPrice > p.price ? `<span class="price-original">$${p.originalPrice}</span>` : ''}
              </div>
              ${discount > 0 ? `<span class="price-badge">${discount}% OFF</span>` : `<span style="font-size:0.8rem;color:var(--text-dim)">Stock: ${p.stock}</span>`}
            </div>
            <div class="product-id">ID: ${p.id} · Stock: ${p.stock}</div>
          </div>
        </div>`;
    });
  } catch (e) {
    grid.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:40px">Could not load products. Make sure the server is running.</p>';
  }
}

// ─── Load WAB JSON Preview ────────────────────────────────────────────────────
async function loadWabPreview() {
  try {
    const wab = await apiFetch('/.well-known/wab.json');
    document.getElementById('wab-json-preview').textContent = JSON.stringify(wab, null, 2);
  } catch (e) {
    document.getElementById('wab-json-preview').textContent = 'Could not load wab.json';
  }
}

// ─── Agent Demo ───────────────────────────────────────────────────────────────
let agentRunning = false;

async function runAgentDemo() {
  if (agentRunning) return;
  agentRunning = true;

  const btnRun = document.getElementById('btn-run');
  const btnReset = document.getElementById('btn-reset');
  const resultEl = document.getElementById('agent-result');

  btnRun.disabled = true;
  btnReset.disabled = true;
  resultEl.style.display = 'none';

  terminal.clear();
  steps.resetAll();
  terminal.setStatus('running');

  terminal.write('╔══════════════════════════════════════════════════════╗', 'sep');
  terminal.write('║       WAB DEMO AGENT — AI Shopping Assistant        ║', 'bold');
  terminal.write('║  No scraping. No guessing. Just structured data.    ║', 'dim');
  terminal.write('╚══════════════════════════════════════════════════════╝', 'sep');
  terminal.write('');

  try {
    // ── Step 1: Discover ──────────────────────────────────────────────────
    steps.setActive(1);
    terminal.sep('STEP 1 — Discover Capabilities');
    terminal.write('  Fetching /.well-known/wab.json...', 'dim');
    await sleep(600);

    const wab = await apiFetch('/.well-known/wab.json');
    terminal.write(`  ✅ Site: "${wab.name}" (WAB v${wab.wab})`, 'ok');
    terminal.write(`  ✅ Actions available: ${wab.actions.map(a => a.name).join(', ')}`, 'ok');
    await sleep(400);
    steps.setDone(1);

    // ── Step 2: Auth ──────────────────────────────────────────────────────
    steps.setActive(2);
    terminal.write('');
    terminal.sep('STEP 2 — Authenticate');
    terminal.write(`  Auth endpoint: ${wab.auth.endpoint}`, 'dim');
    terminal.write('  POST { email: "demo@wab.dev", password: "demo123" }', 'dim');
    await sleep(700);

    const auth = await apiFetch(wab.auth.endpoint, {
      method: 'POST',
      body: JSON.stringify({ email: 'demo@wab.dev', password: 'demo123' })
    });
    terminal.write(`  ✅ Authenticated as "${auth.name}"`, 'ok');
    terminal.write(`  ✅ Token: ${auth.token}`, 'ok');
    await sleep(400);
    steps.setDone(2);

    // ── Step 3: Browse ────────────────────────────────────────────────────
    steps.setActive(3);
    terminal.write('');
    terminal.sep('STEP 3 — Browse Products');
    terminal.write('  GET /api/products', 'dim');
    await sleep(600);

    const { products } = await apiFetch('/api/products');
    terminal.write(`  ✅ Found ${products.length} products:`, 'ok');
    products.forEach(p => {
      const disc = p.originalPrice > p.price
        ? ` (${Math.round((1 - p.price / p.originalPrice) * 100)}% OFF)`
        : '';
      terminal.write(`      • [${p.id}] ${p.name} — $${p.price}${disc}`, 'info');
    });
    await sleep(400);
    steps.setDone(3);

    // ── Step 4: Decide ────────────────────────────────────────────────────
    steps.setActive(4);
    terminal.write('');
    terminal.sep('STEP 4 — Make Decision');
    terminal.write('  Agent reasoning: find best discount % under $100...', 'dim');
    await sleep(800);

    const candidates = products.filter(p => p.price < 100);
    const best = candidates.reduce((a, b) => {
      const dA = (a.originalPrice - a.price) / a.originalPrice;
      const dB = (b.originalPrice - b.price) / b.originalPrice;
      return dB > dA ? b : a;
    });
    const savings = (best.originalPrice - best.price).toFixed(2);
    const discPct = Math.round((1 - best.price / best.originalPrice) * 100);

    terminal.write(`  ✅ Decision: "${best.name}"`, 'ok');
    terminal.write(`      Price:   $${best.price}  (was $${best.originalPrice})`, 'info');
    terminal.write(`      Savings: $${savings} (${discPct}% OFF)`, 'info');
    terminal.write(`      Rating:  ${best.rating}/5 ⭐`, 'info');
    terminal.write(`      Reason:  Best discount under $100 with high rating`, 'dim');
    await sleep(400);
    steps.setDone(4);

    // ── Step 5: Purchase ──────────────────────────────────────────────────
    steps.setActive(5);
    terminal.write('');
    terminal.sep('STEP 5 — Execute Purchase');
    terminal.write(`  POST /api/order`, 'dim');
    terminal.write(`  Body: { items: [{ productId: "${best.id}", quantity: 1 }] }`, 'dim');
    await sleep(800);

    const orderRes = await apiFetch('/api/order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({
        items: [{ productId: best.id, quantity: 1 }],
        shippingAddress: '123 AI Street, Agent City'
      })
    });
    console.log('[WAB Agent] orderRes:', JSON.stringify(orderRes));
    if (!orderRes || !orderRes.order) {
      throw new Error(`Order API failed: ${JSON.stringify(orderRes)}`);
    }
    const order = orderRes.order;
    terminal.write(`  ✅ Order confirmed!`, 'ok');
    terminal.write(`      Order ID: ${order.orderId}`, 'info');
    terminal.write(`      Total:    $${order.total}`, 'info');
    terminal.write(`      Status:   ${order.status}`, 'info');
    await sleep(400);
    steps.setDone(5);

    // ── Step 6: Verify ────────────────────────────────────────────────────
    steps.setActive(6);
    terminal.write('');
    terminal.sep('STEP 6 — Verify Order');
    terminal.write(`  GET /api/order/${order.orderId}`, 'dim');
    await sleep(600);

    const verifyRes = await apiFetch(`/api/order/${order.orderId}`, {
      headers: { Authorization: `Bearer ${auth.token}` }
    });
    terminal.write(`  ✅ Order verified — Status: ${verifyRes.order.status}`, 'ok');
    verifyRes.order.items.forEach(i => {
      terminal.write(`      ${i.name} × ${i.quantity} = $${i.subtotal}`, 'info');
    });
    await sleep(400);
    steps.setDone(6);

    // ── Done ──────────────────────────────────────────────────────────────
    terminal.write('');
    terminal.write('══════════════════════════════════════════════════════', 'sep');
    terminal.write('  ✅  MISSION COMPLETE', 'ok');
    terminal.write('  ⚡  Zero HTML parsing. Zero CSS selectors. Zero fragility.', 'ok');
    terminal.write('  🔒  Authenticated, structured, fully auditable.', 'ok');
    terminal.write('══════════════════════════════════════════════════════', 'sep');
    terminal.setStatus('done');

    // Show result card
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="result-title">✅ Purchase Completed</div>
      <div class="result-item"><span class="result-label">Product</span><span class="result-value">${best.name}</span></div>
      <div class="result-item"><span class="result-label">Order ID</span><span class="result-value">${order.orderId}</span></div>
      <div class="result-item"><span class="result-label">Total</span><span class="result-value">$${order.total}</span></div>
      <div class="result-item"><span class="result-label">Status</span><span class="result-value">${order.status}</span></div>
      <div class="result-item"><span class="result-label">Savings</span><span class="result-value">$${savings} (${discPct}% OFF)</span></div>
    `;

  } catch (err) {
    terminal.write('');
    terminal.write(`  ❌ Error: ${err.message}`, 'error');
    terminal.write('  Make sure the server is running: npm start', 'dim');
    terminal.setStatus('error');
    resultEl.style.display = 'block';
    resultEl.className = 'agent-result error';
    resultEl.innerHTML = `<div class="result-title" style="color:var(--red)">❌ Agent Error</div><p style="font-size:0.88rem;color:var(--text-dim)">${err.message}</p>`;
  }

  agentRunning = false;
  btnRun.disabled = false;
  btnReset.disabled = false;
}

// ─── Reset ────────────────────────────────────────────────────────────────────
async function resetDemo() {
  await apiFetch('/api/demo/reset', { method: 'POST' });
  steps.resetAll();
  terminal.setStatus('idle');
  terminal.clear();
  terminal.write('$ node agent/agent.js', 'dim');
  terminal.write('Demo reset. Press "Run Agent" to start again.', 'dim');
  document.getElementById('agent-result').style.display = 'none';
  document.getElementById('agent-result').className = 'agent-result';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  terminal.init();
  loadProducts();
  loadWabPreview();
});
