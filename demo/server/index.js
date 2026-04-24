/**
 * WAB Demo Store — Backend Server
 * Demonstrates how a website exposes its capabilities to AI agents
 * via the Web Agent Bridge protocol.
 *
 * License: MIT
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), { etag: false, maxAge: 0, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); } }));

// ─── In-Memory Store ───────────────────────────────────────────────────────────
const products = [
  {
    id: 'prod-001',
    name: 'Wireless Headphones',
    price: 79.99,
    originalPrice: 129.99,
    category: 'Electronics',
    stock: 15,
    rating: 4.7,
    reviews: 342,
    image: '/images/headphones.svg',
    description: 'Premium noise-cancelling wireless headphones with 30h battery life.'
  },
  {
    id: 'prod-002',
    name: 'Smart Watch',
    price: 199.99,
    originalPrice: 249.99,
    category: 'Electronics',
    stock: 8,
    rating: 4.5,
    reviews: 218,
    image: '/images/watch.svg',
    description: 'Track fitness, notifications, and health metrics in style.'
  },
  {
    id: 'prod-003',
    name: 'Mechanical Keyboard',
    price: 89.99,
    originalPrice: 89.99,
    category: 'Accessories',
    stock: 23,
    rating: 4.8,
    reviews: 567,
    image: '/images/keyboard.svg',
    description: 'Tactile RGB mechanical keyboard for developers and gamers.'
  },
  {
    id: 'prod-004',
    name: 'USB-C Hub',
    price: 34.99,
    originalPrice: 49.99,
    category: 'Accessories',
    stock: 42,
    rating: 4.3,
    reviews: 189,
    image: '/images/hub.svg',
    description: '7-in-1 USB-C hub with HDMI 4K, PD 100W, and SD card reader.'
  }
];

const orders = [];
const users = {
  'demo@wab.dev': { id: 'usr-001', name: 'Demo User', token: 'demo-token-abc123' }
};

// ─── Agent Activity Log (for live demo panel) ─────────────────────────────────
const agentLog = [];
function logAgentAction(type, data) {
  const entry = { id: uuidv4(), timestamp: new Date().toISOString(), type, data };
  agentLog.unshift(entry);
  if (agentLog.length > 50) agentLog.pop();
  return entry;
}

// ─── WAB Discovery Endpoint ───────────────────────────────────────────────────
// This is the core of WAB — the machine-readable capabilities document
app.get('/.well-known/wab.json', (req, res) => {
  logAgentAction('discovery', { agent: req.headers['user-agent'] });
  res.json({
    wab: '1.0',
    name: 'WAB Demo Store',
    description: 'An AI-ready e-commerce store powered by Web Agent Bridge',
    baseUrl: `http://localhost:${PORT}`,
    auth: {
      type: 'bearer',
      endpoint: '/api/auth/login',
      description: 'POST email+password, receive token'
    },
    actions: [
      {
        name: 'list_products',
        description: 'Get all available products with prices and stock',
        endpoint: '/api/products',
        method: 'GET',
        auth: false,
        params: {
          category: { type: 'string', required: false, description: 'Filter by category' },
          maxPrice: { type: 'number', required: false, description: 'Maximum price filter' }
        },
        returns: { type: 'array', items: 'Product' }
      },
      {
        name: 'get_product',
        description: 'Get details of a specific product by ID',
        endpoint: '/api/products/:id',
        method: 'GET',
        auth: false,
        params: {
          id: { type: 'string', required: true, description: 'Product ID' }
        },
        returns: { type: 'object', schema: 'Product' }
      },
      {
        name: 'add_to_cart',
        description: 'Add a product to the shopping cart',
        endpoint: '/api/cart/add',
        method: 'POST',
        auth: true,
        params: {
          productId: { type: 'string', required: true },
          quantity: { type: 'number', required: true, min: 1, max: 10 }
        },
        returns: { type: 'object', schema: 'CartItem' }
      },
      {
        name: 'purchase',
        description: 'Complete a purchase for one or more products',
        endpoint: '/api/order',
        method: 'POST',
        auth: true,
        params: {
          items: {
            type: 'array',
            required: true,
            items: {
              productId: { type: 'string', required: true },
              quantity: { type: 'number', required: true }
            }
          },
          shippingAddress: { type: 'string', required: false }
        },
        returns: { type: 'object', schema: 'Order' }
      },
      {
        name: 'check_order',
        description: 'Check the status of an existing order',
        endpoint: '/api/order/:orderId',
        method: 'GET',
        auth: true,
        params: {
          orderId: { type: 'string', required: true }
        },
        returns: { type: 'object', schema: 'Order' }
      }
    ],
    schemas: {
      Product: {
        id: 'string',
        name: 'string',
        price: 'number',
        originalPrice: 'number',
        category: 'string',
        stock: 'number',
        rating: 'number',
        reviews: 'number',
        description: 'string'
      },
      Order: {
        orderId: 'string',
        status: 'string',
        items: 'array',
        total: 'number',
        createdAt: 'string'
      }
    }
  });
});

// ─── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  logAgentAction('auth', { email });
  const user = users[email];
  if (user && password === 'demo123') {
    return res.json({ success: true, token: user.token, userId: user.id, name: user.name });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// ─── Products ──────────────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  logAgentAction('list_products', { filters: req.query });
  let result = [...products];
  if (req.query.category) {
    result = result.filter(p => p.category.toLowerCase() === req.query.category.toLowerCase());
  }
  if (req.query.maxPrice) {
    result = result.filter(p => p.price <= parseFloat(req.query.maxPrice));
  }
  res.json({ success: true, count: result.length, products: result });
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  logAgentAction('get_product', { productId: req.params.id, name: product.name });
  res.json({ success: true, product });
});

// ─── Cart ──────────────────────────────────────────────────────────────────────
app.post('/api/cart/add', (req, res) => {
  const { productId, quantity } = req.body;
  const product = products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  logAgentAction('add_to_cart', { productId, name: product.name, quantity });
  res.json({
    success: true,
    cartItem: { productId, name: product.name, quantity, price: product.price, subtotal: product.price * quantity }
  });
});

// ─── Orders ───────────────────────────────────────────────────────────────────
app.post('/api/order', (req, res) => {
  const { items = [], shippingAddress = 'Default Address' } = req.body;
  if (!items.length) return res.status(400).json({ success: false, error: 'No items provided' });

  let total = 0;
  const orderItems = items.map(item => {
    const product = products.find(p => p.id === item.productId);
    if (!product) throw new Error(`Product ${item.productId} not found`);
    const subtotal = product.price * item.quantity;
    total += subtotal;
    return { productId: item.productId, name: product.name, quantity: item.quantity, price: product.price, subtotal };
  });

  const order = {
    orderId: 'ORD-' + Date.now(),
    status: 'confirmed',
    items: orderItems,
    total: Math.round(total * 100) / 100,
    shippingAddress,
    createdAt: new Date().toISOString()
  };
  orders.push(order);
  logAgentAction('purchase', { orderId: order.orderId, total: order.total, itemCount: orderItems.length });
  res.json({ success: true, order });
});

app.get('/api/order/:orderId', (req, res) => {
  const order = orders.find(o => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  logAgentAction('check_order', { orderId: req.params.orderId });
  res.json({ success: true, order });
});

// ─── Demo API — Agent Log (SSE for live panel) ────────────────────────────────
app.get('/api/demo/agent-log', (req, res) => {
  res.json({ success: true, log: agentLog });
});

app.get('/api/demo/agent-log/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    res.write(`data: ${JSON.stringify(agentLog.slice(0, 10))}\n\n`);
  };
  send();
  const interval = setInterval(send, 1000);
  req.on('close', () => clearInterval(interval));
});

// ─── Demo API — Reset ─────────────────────────────────────────────────────────
app.post('/api/demo/reset', (req, res) => {
  orders.length = 0;
  agentLog.length = 0;
  res.json({ success: true, message: 'Demo reset' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛍️  WAB Demo Store running at http://localhost:${PORT}`);
  console.log(`🤖  WAB Discovery:       http://localhost:${PORT}/.well-known/wab.json`);
  console.log(`📦  Products API:        http://localhost:${PORT}/api/products`);
  console.log(`\n  Run the AI agent:    node agent/agent.js`);
  console.log(`  Compare approaches:  node agent/compare.js\n`);
});
