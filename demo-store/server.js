const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WAB_VERSION = '1.2.0';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Product catalog ──────────────────────────────────────────────────
const products = [
  { id: 1, name: 'Wireless Headphones', price: 4900, currency: 'USD', stock: 12, category: 'electronics', image: '🎧', rating: 4.7 },
  { id: 2, name: 'Mechanical Keyboard', price: 8900, currency: 'USD', stock: 7,  category: 'electronics', image: '⌨️', rating: 4.9 },
  { id: 3, name: 'Smart Watch',         price: 19900, currency: 'USD', stock: 3,  category: 'electronics', image: '⌚', rating: 4.5 },
  { id: 4, name: 'USB-C Hub',           price: 3400, currency: 'USD', stock: 25, category: 'accessories', image: '🔌', rating: 4.3 },
];

const cart = [];
const orders = [];
const auditLog = [];

function logAudit(action, details) {
  auditLog.push({ action, details, timestamp: new Date().toISOString() });
  if (auditLog.length > 200) auditLog.shift();
}

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// ── WAB Discovery (/.well-known/wab.json) ────────────────────────────
const discoveryDocument = {
  wab_version: WAB_VERSION,
  protocol: '1.0',
  generated_at: null,
  site: {
    name: 'TechStore Demo',
    domain: process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT,
    description: 'WAB-enabled electronics store — demonstrates the Web Agent Bridge protocol with real product data, cart management, and checkout.',
    category: 'e-commerce',
    platform: 'custom'
  },
  capabilities: {
    commands: ['read', 'navigate', 'click', 'fill', 'submit', 'search'],
    permissions: {
      readContent: true,
      click: true,
      fillForms: true,
      scroll: true,
      navigate: true,
      apiAccess: true
    },
    tier: 'pro',
    transport: ['http'],
    features: ['product_catalog', 'cart_management', 'checkout', 'search', 'audit_log']
  },
  actions: [
    { name: 'listProducts',  description: 'List all products in the catalog',           category: 'content',   params: [{ name: 'category', type: 'string', required: false }] },
    { name: 'getProduct',    description: 'Get details for a specific product',          category: 'content',   params: [{ name: 'productId', type: 'number', required: true }] },
    { name: 'searchProducts',description: 'Search products by name or category',         category: 'content',   params: [{ name: 'query', type: 'string', required: true }] },
    { name: 'addToCart',     description: 'Add a product to the shopping cart',           category: 'commerce',  params: [{ name: 'productId', type: 'number', required: true }, { name: 'quantity', type: 'number', required: false }] },
    { name: 'viewCart',      description: 'View current cart contents and total',         category: 'commerce',  params: [] },
    { name: 'removeFromCart',description: 'Remove a product from the cart',               category: 'commerce',  params: [{ name: 'productId', type: 'number', required: true }] },
    { name: 'checkout',      description: 'Complete the purchase and place an order',     category: 'commerce',  params: [{ name: 'email', type: 'string', required: true }] },
    { name: 'getOrderStatus',description: 'Check the status of an order',                category: 'commerce',  params: [{ name: 'orderId', type: 'string', required: true }] },
  ],
  fairness: {
    is_independent: true,
    commission_rate: 0,
    direct_benefit: 'Direct to seller',
    neutrality_score: 95
  },
  security: {
    session_required: false,
    rate_limit: 60,
    sandbox: true
  },
  endpoints: {
    discover: '/wab/discover',
    execute:  '/wab/execute',
    actions:  '/wab/actions',
    ping:     '/wab/ping'
  },
  lifecycle: ['discover', 'authenticate', 'plan', 'execute', 'confirm']
};

app.get('/.well-known/wab.json', (req, res) => {
  const doc = { ...discoveryDocument, generated_at: new Date().toISOString() };
  res.set({ 'Cache-Control': 'public, max-age=60', 'X-WAB-Version': WAB_VERSION });
  res.json(doc);
});

app.get('/agent-bridge.json', (req, res) => {
  const doc = { ...discoveryDocument, generated_at: new Date().toISOString() };
  res.set({ 'Cache-Control': 'public, max-age=60', 'X-WAB-Version': WAB_VERSION });
  res.json(doc);
});

// ── WAB Protocol Endpoints ───────────────────────────────────────────

app.get('/wab/ping', (req, res) => {
  res.json({ status: 'ok', wab_version: WAB_VERSION, protocol: '1.0', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/wab/discover', (req, res) => {
  const doc = { ...discoveryDocument, generated_at: new Date().toISOString() };
  res.json(doc);
});

app.get('/wab/actions', (req, res) => {
  res.json({ wab_version: WAB_VERSION, actions: discoveryDocument.actions });
});

app.post('/wab/execute', (req, res) => {
  const { action, params } = req.body || {};
  const start = Date.now();

  if (!action) {
    return res.status(400).json({ success: false, error: 'Missing "action" field', wab_version: WAB_VERSION });
  }

  const known = discoveryDocument.actions.find(a => a.name === action);
  if (!known) {
    return res.status(400).json({ success: false, error: `Unknown action: ${action}`, available: discoveryDocument.actions.map(a => a.name), wab_version: WAB_VERSION });
  }

  let result;
  try {
    switch (action) {
      case 'listProducts': {
        let list = [...products];
        if (params?.category) list = list.filter(p => p.category === params.category);
        result = { products: list.map(p => ({ ...p, priceFormatted: formatPrice(p.price) })), total: list.length };
        break;
      }
      case 'getProduct': {
        const product = products.find(p => p.id === params?.productId);
        if (!product) { result = { error: `Product ${params?.productId} not found` }; break; }
        result = { ...product, priceFormatted: formatPrice(product.price) };
        break;
      }
      case 'searchProducts': {
        const q = (params?.query || '').toLowerCase();
        const matches = products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
        result = { query: params?.query, results: matches.map(p => ({ ...p, priceFormatted: formatPrice(p.price) })), total: matches.length };
        break;
      }
      case 'addToCart': {
        const product = products.find(p => p.id === params?.productId);
        if (!product) { result = { error: `Product ${params?.productId} not found` }; break; }
        const qty = params?.quantity || 1;
        if (product.stock < qty) { result = { error: `Insufficient stock. Available: ${product.stock}` }; break; }
        const existing = cart.find(c => c.productId === product.id);
        if (existing) { existing.quantity += qty; } else { cart.push({ productId: product.id, name: product.name, price: product.price, quantity: qty }); }
        product.stock -= qty;
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        result = { added: product.name, quantity: qty, cartItems: cart.length, cartTotal: formatPrice(total) };
        break;
      }
      case 'viewCart': {
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        result = { items: cart.map(c => ({ ...c, priceFormatted: formatPrice(c.price), subtotal: formatPrice(c.price * c.quantity) })), itemCount: cart.length, total: formatPrice(total) };
        break;
      }
      case 'removeFromCart': {
        const idx = cart.findIndex(c => c.productId === params?.productId);
        if (idx === -1) { result = { error: 'Product not in cart' }; break; }
        const removed = cart.splice(idx, 1)[0];
        const prod = products.find(p => p.id === removed.productId);
        if (prod) prod.stock += removed.quantity;
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        result = { removed: removed.name, cartItems: cart.length, cartTotal: formatPrice(total) };
        break;
      }
      case 'checkout': {
        if (cart.length === 0) { result = { error: 'Cart is empty' }; break; }
        if (!params?.email) { result = { error: 'Email is required for checkout' }; break; }
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        const order = {
          orderId: 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
          email: params.email,
          items: [...cart],
          total: formatPrice(total),
          totalCents: total,
          status: 'confirmed',
          createdAt: new Date().toISOString()
        };
        orders.push(order);
        cart.length = 0;
        result = { orderId: order.orderId, status: order.status, total: order.total, itemCount: order.items.length, email: order.email };
        break;
      }
      case 'getOrderStatus': {
        const order = orders.find(o => o.orderId === params?.orderId);
        if (!order) { result = { error: `Order ${params?.orderId} not found` }; break; }
        result = { orderId: order.orderId, status: order.status, total: order.total, itemCount: order.items.length, createdAt: order.createdAt };
        break;
      }
      default:
        result = { error: 'Unhandled action' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  const duration = Date.now() - start;
  logAudit(action, { params, duration });

  res.json({
    success: !result.error,
    action,
    result,
    wab_version: WAB_VERSION,
    duration_ms: duration
  });
});

// ── Audit log (shows protocol is real) ───────────────────────────────
app.get('/wab/audit', (req, res) => {
  res.json({ entries: auditLog.slice(-50), total: auditLog.length });
});

// ── Store HTML ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TechStore Demo (WAB-enabled) running on port ${PORT}`);
});
