/**
 * WAB Demo Store Router
 * Mounts the interactive demo at /demo and /demo/api/*
 * Based on demo/server/index.js — adapted as sub-route for main server.
 * License: MIT
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const uuid = () => crypto.randomUUID();

// ─── In-Memory Store (resets on server restart) ──────────────────────────────
const products = [
  { id: 'prod-001', name: 'Wireless Headphones', price: 79.99, originalPrice: 129.99, category: 'Electronics', stock: 15, rating: 4.7, reviews: 342, image: 'images/headphones.svg', description: 'Premium noise-cancelling wireless headphones with 30h battery life.' },
  { id: 'prod-002', name: 'Smart Watch', price: 199.99, originalPrice: 249.99, category: 'Electronics', stock: 8, rating: 4.5, reviews: 218, image: 'images/watch.svg', description: 'Track fitness, notifications, and health metrics in style.' },
  { id: 'prod-003', name: 'Mechanical Keyboard', price: 89.99, originalPrice: 89.99, category: 'Accessories', stock: 23, rating: 4.8, reviews: 567, image: 'images/keyboard.svg', description: 'Tactile RGB mechanical keyboard for developers and gamers.' },
  { id: 'prod-004', name: 'USB-C Hub', price: 34.99, originalPrice: 49.99, category: 'Accessories', stock: 42, rating: 4.3, reviews: 189, image: 'images/hub.svg', description: '7-in-1 USB-C hub with HDMI 4K, PD 100W, and SD card reader.' }
];

const orders = [];
const users = { 'demo@wab.dev': { id: 'usr-001', name: 'Demo User', token: 'demo-token-abc123' } };

// ─── Agent activity log ──────────────────────────────────────────────────────
const agentLog = [];
function logAgentAction(type, data) {
  const entry = { id: uuid(), timestamp: new Date().toISOString(), type, data };
  agentLog.unshift(entry);
  if (agentLog.length > 50) agentLog.pop();
  return entry;
}

// ─── Static frontend ─────────────────────────────────────────────────────────
router.use(express.static(path.join(__dirname, '..', '..', 'demo', 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
}));

// ─── WAB Discovery Document ──────────────────────────────────────────────────
router.get('/.well-known/wab.json', (req, res) => {
  logAgentAction('discovery', { agent: req.headers['user-agent'] });
  const base = `${req.protocol}://${req.get('host')}/demo`;
  res.json({
    wab: '1.0',
    name: 'WAB Demo Store',
    description: 'An AI-ready e-commerce store powered by Web Agent Bridge',
    baseUrl: base,
    auth: { type: 'bearer', endpoint: '/demo/api/auth/login', description: 'POST email+password, receive token' },
    actions: [
      { name: 'list_products', description: 'Get all available products', endpoint: '/demo/api/products', method: 'GET', auth: false, params: { category: { type: 'string', required: false }, maxPrice: { type: 'number', required: false } }, returns: { type: 'array', items: 'Product' } },
      { name: 'get_product', description: 'Get details of a product by ID', endpoint: '/demo/api/products/:id', method: 'GET', auth: false, params: { id: { type: 'string', required: true } }, returns: { type: 'object', schema: 'Product' } },
      { name: 'add_to_cart', description: 'Add a product to cart', endpoint: '/demo/api/cart/add', method: 'POST', auth: true, params: { productId: { type: 'string', required: true }, quantity: { type: 'number', required: true, min: 1, max: 10 } }, returns: { type: 'object', schema: 'CartItem' } },
      { name: 'purchase', description: 'Complete a purchase', endpoint: '/demo/api/order', method: 'POST', auth: true, params: { items: { type: 'array', required: true }, shippingAddress: { type: 'string', required: false } }, returns: { type: 'object', schema: 'Order' } },
      { name: 'check_order', description: 'Check order status', endpoint: '/demo/api/order/:orderId', method: 'GET', auth: true, params: { orderId: { type: 'string', required: true } }, returns: { type: 'object', schema: 'Order' } }
    ],
    schemas: {
      Product: { id: 'string', name: 'string', price: 'number', originalPrice: 'number', category: 'string', stock: 'number', rating: 'number', reviews: 'number', description: 'string' },
      Order: { orderId: 'string', status: 'string', items: 'array', total: 'number', createdAt: 'string' }
    }
  });
});

// ─── Auth ────────────────────────────────────────────────────────────────────
router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  logAgentAction('auth', { email });
  const user = users[email];
  if (user && password === 'demo123') {
    return res.json({ success: true, token: user.token, userId: user.id, name: user.name });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// ─── Products ────────────────────────────────────────────────────────────────
router.get('/api/products', (req, res) => {
  logAgentAction('list_products', { filters: req.query });
  let result = [...products];
  if (req.query.category) result = result.filter(p => p.category.toLowerCase() === String(req.query.category).toLowerCase());
  if (req.query.maxPrice) result = result.filter(p => p.price <= parseFloat(req.query.maxPrice));
  res.json({ success: true, count: result.length, products: result });
});

router.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  logAgentAction('get_product', { productId: req.params.id, name: product.name });
  res.json({ success: true, product });
});

// ─── Cart ────────────────────────────────────────────────────────────────────
router.post('/api/cart/add', (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  logAgentAction('add_to_cart', { productId, name: product.name, quantity });
  res.json({ success: true, cartItem: { productId, name: product.name, quantity, price: product.price, subtotal: product.price * quantity } });
});

// ─── Orders ──────────────────────────────────────────────────────────────────
router.post('/api/order', (req, res) => {
  const { items = [], shippingAddress = 'Default Address' } = req.body || {};
  if (!items.length) return res.status(400).json({ success: false, error: 'No items provided' });

  let total = 0;
  let orderItems;
  try {
    orderItems = items.map(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) throw new Error(`Product ${item.productId} not found`);
      const subtotal = product.price * item.quantity;
      total += subtotal;
      return { productId: item.productId, name: product.name, quantity: item.quantity, price: product.price, subtotal };
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  const order = { orderId: 'ORD-' + Date.now(), status: 'confirmed', items: orderItems, total: Math.round(total * 100) / 100, shippingAddress, createdAt: new Date().toISOString() };
  orders.push(order);
  logAgentAction('purchase', { orderId: order.orderId, total: order.total, itemCount: orderItems.length });
  res.json({ success: true, order });
});

router.get('/api/order/:orderId', (req, res) => {
  const order = orders.find(o => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  logAgentAction('check_order', { orderId: req.params.orderId });
  res.json({ success: true, order });
});

// ─── Agent log ───────────────────────────────────────────────────────────────
router.get('/api/demo/agent-log', (req, res) => res.json({ success: true, log: agentLog }));

router.get('/api/demo/agent-log/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify(agentLog.slice(0, 10))}\n\n`);
  send();
  const interval = setInterval(send, 1000);
  req.on('close', () => clearInterval(interval));
});

router.post('/api/demo/reset', (req, res) => {
  orders.length = 0;
  agentLog.length = 0;
  res.json({ success: true, message: 'Demo reset' });
});

module.exports = router;
