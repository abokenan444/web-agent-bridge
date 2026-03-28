/**
 * TechStore Demo — WAB-enabled in ~40 lines of business logic
 *
 * This is a real store that proves how simple WAB integration is:
 *   1. Define your business logic (products, cart, checkout)
 *   2. app.use(wab({ actions: { ... } }))
 *   3. Done — your store is now AI-agent-ready
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const wab = require('./wab-server');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Your business data (this is YOUR code, not WAB) ─────────────────
const products = [
  { id: 1, name: 'Wireless Headphones', price: 4900, currency: 'USD', stock: 12, category: 'electronics', image: '🎧', rating: 4.7 },
  { id: 2, name: 'Mechanical Keyboard', price: 8900, currency: 'USD', stock: 7,  category: 'electronics', image: '⌨️', rating: 4.9 },
  { id: 3, name: 'Smart Watch',         price: 19900, currency: 'USD', stock: 3,  category: 'electronics', image: '⌚', rating: 4.5 },
  { id: 4, name: 'USB-C Hub',           price: 3400, currency: 'USD', stock: 25, category: 'accessories', image: '🔌', rating: 4.3 },
];

const cart = [];
const orders = [];
const fmt = (cents) => '$' + (cents / 100).toFixed(2);
const withPrice = (p) => ({ ...p, priceFormatted: fmt(p.price) });

// ── ONE LINE: make this store WAB-enabled ───────────────────────────
app.use(wab({
  name: 'TechStore Demo',
  description: 'WAB-enabled electronics store — demonstrates the protocol with real product data, cart, and checkout.',
  category: 'e-commerce',

  actions: {
    listProducts: {
      description: 'List all products in the catalog',
      category: 'content',
      params: [{ name: 'category', type: 'string', required: false }],
      handler: async ({ category: cat }) => {
        let list = cat ? products.filter(p => p.category === cat) : products;
        return { products: list.map(withPrice), total: list.length };
      }
    },

    getProduct: {
      description: 'Get details for a specific product',
      category: 'content',
      params: [{ name: 'productId', type: 'number', required: true }],
      handler: async ({ productId }) => {
        const p = products.find(x => x.id === productId);
        return p ? withPrice(p) : { error: `Product ${productId} not found` };
      }
    },

    searchProducts: {
      description: 'Search products by name or category',
      category: 'content',
      params: [{ name: 'query', type: 'string', required: true }],
      handler: async ({ query }) => {
        const q = (query || '').toLowerCase();
        const matches = products.filter(p => p.name.toLowerCase().includes(q) || p.category.includes(q));
        return { query, results: matches.map(withPrice), total: matches.length };
      }
    },

    addToCart: {
      description: 'Add a product to the shopping cart',
      category: 'commerce',
      params: [{ name: 'productId', type: 'number', required: true }, { name: 'quantity', type: 'number', required: false }],
      handler: async ({ productId, quantity }) => {
        const p = products.find(x => x.id === productId);
        if (!p) return { error: `Product ${productId} not found` };
        const qty = quantity || 1;
        if (p.stock < qty) return { error: `Insufficient stock. Available: ${p.stock}` };
        const existing = cart.find(c => c.productId === p.id);
        if (existing) existing.quantity += qty; else cart.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
        p.stock -= qty;
        return { added: p.name, quantity: qty, cartItems: cart.length, cartTotal: fmt(cart.reduce((s, c) => s + c.price * c.quantity, 0)) };
      }
    },

    viewCart: {
      description: 'View current cart contents and total',
      category: 'commerce',
      handler: async () => {
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        return { items: cart.map(c => ({ ...c, priceFormatted: fmt(c.price), subtotal: fmt(c.price * c.quantity) })), itemCount: cart.length, total: fmt(total) };
      }
    },

    removeFromCart: {
      description: 'Remove a product from the cart',
      category: 'commerce',
      params: [{ name: 'productId', type: 'number', required: true }],
      handler: async ({ productId }) => {
        const idx = cart.findIndex(c => c.productId === productId);
        if (idx === -1) return { error: 'Product not in cart' };
        const removed = cart.splice(idx, 1)[0];
        const prod = products.find(p => p.id === removed.productId);
        if (prod) prod.stock += removed.quantity;
        return { removed: removed.name, cartItems: cart.length, cartTotal: fmt(cart.reduce((s, c) => s + c.price * c.quantity, 0)) };
      }
    },

    checkout: {
      description: 'Complete the purchase and place an order',
      category: 'commerce',
      params: [{ name: 'email', type: 'string', required: true }],
      handler: async ({ email }) => {
        if (!cart.length) return { error: 'Cart is empty' };
        if (!email) return { error: 'Email is required' };
        const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
        const order = { orderId: 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase(), email, items: [...cart], total: fmt(total), totalCents: total, status: 'confirmed', createdAt: new Date().toISOString() };
        orders.push(order);
        cart.length = 0;
        return { orderId: order.orderId, status: order.status, total: order.total, itemCount: order.items.length, email };
      }
    },

    getOrderStatus: {
      description: 'Check the status of an order',
      category: 'commerce',
      params: [{ name: 'orderId', type: 'string', required: true }],
      handler: async ({ orderId }) => {
        const order = orders.find(o => o.orderId === orderId);
        return order ? { orderId: order.orderId, status: order.status, total: order.total, itemCount: order.items.length, createdAt: order.createdAt } : { error: `Order ${orderId} not found` };
      }
    }
  }
}));

app.listen(PORT, () => console.log(`TechStore Demo (WAB-enabled) running on port ${PORT}`));
