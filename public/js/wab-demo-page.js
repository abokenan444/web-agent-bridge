/**
 * WAB /demo page — tries live Railway store, falls back to in-browser protocol simulator.
 * No placeholders: full cart/checkout/order parity with TechStore API shape.
 */
(function () {
  'use strict';

  var STORE = 'https://web-agent-bridge-production.up.railway.app';
  var CONNECT_MS = 4500;

  var OFFLINE_CATALOG = [
    { id: 1, name: 'Wireless Headphones', price: 4900, currency: 'USD', category: 'electronics', image: '🎧', rating: 4.7 },
    { id: 2, name: 'Mechanical Keyboard', price: 8900, currency: 'USD', category: 'electronics', image: '⌨️', rating: 4.9 },
    { id: 3, name: 'Smart Watch', price: 19900, currency: 'USD', category: 'electronics', image: '⌚', rating: 4.5 },
    { id: 4, name: 'USB-C Hub', price: 3400, currency: 'USD', category: 'accessories', image: '🔌', rating: 4.3 }
  ];

  var useRemote = false;
  var offlineStock = {};
  var offlineCart = [];
  var offlineOrders = [];
  var offlineAudit = [];

  function resetOfflineState() {
    offlineCart = [];
    offlineOrders = [];
    offlineAudit = [];
    OFFLINE_CATALOG.forEach(function (p) { offlineStock[p.id] = p.id === 1 ? 12 : p.id === 2 ? 7 : p.id === 3 ? 3 : 25; });
  }

  function fmtCents(c) {
    return '$' + (c / 100).toFixed(2);
  }

  function cloneProducts() {
    return OFFLINE_CATALOG.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        stock: offlineStock[p.id],
        category: p.category,
        image: p.image,
        rating: p.rating,
        priceFormatted: fmtCents(p.price)
      };
    });
  }

  function localDiscovery() {
    return {
      wab_version: '1.2.0',
      protocol: '1.0',
      generated_at: new Date().toISOString(),
      site: {
        name: 'TechStore (Offline Demo)',
        domain: 'browser-local',
        description: 'In-browser WAB simulator — same JSON shape as live store; no network required.',
        category: 'e-commerce',
        platform: 'demo'
      },
      actions: [
        { name: 'listProducts', description: 'List all products' },
        { name: 'getProduct', description: 'Get product by id' },
        { name: 'searchProducts', description: 'Search products' },
        { name: 'addToCart', description: 'Add to cart' },
        { name: 'viewCart', description: 'View cart' },
        { name: 'removeFromCart', description: 'Remove from cart' },
        { name: 'checkout', description: 'Checkout' },
        { name: 'getOrderStatus', description: 'Order status' }
      ],
      endpoints: { execute: 'local://wab/execute', discover: 'local://.well-known/wab.json' }
    };
  }

  function localExec(action, params) {
    params = params || {};
    var result;
    switch (action) {
      case 'listProducts': {
        var list = cloneProducts();
        if (params.category) list = list.filter(function (p) { return p.category === params.category; });
        result = { products: list, total: list.length };
        break;
      }
      case 'getProduct': {
        var gp = cloneProducts().find(function (x) { return x.id === params.productId; });
        result = gp || { error: 'Product ' + params.productId + ' not found' };
        break;
      }
      case 'searchProducts': {
        var q = (params.query || '').toLowerCase();
        var matches = cloneProducts().filter(function (p) {
          return p.name.toLowerCase().indexOf(q) !== -1 || p.category.indexOf(q) !== -1;
        });
        result = { query: params.query, results: matches, total: matches.length };
        break;
      }
      case 'addToCart': {
        var id = params.productId;
        var qty = params.quantity || 1;
        var prod = OFFLINE_CATALOG.find(function (x) { return x.id === id; });
        if (!prod) { result = { error: 'Product ' + id + ' not found' }; break; }
        if (offlineStock[id] < qty) { result = { error: 'Insufficient stock. Available: ' + offlineStock[id] }; break; }
        offlineStock[id] -= qty;
        var existing = offlineCart.find(function (c) { return c.productId === id; });
        if (existing) existing.quantity += qty;
        else offlineCart.push({ productId: id, name: prod.name, price: prod.price, quantity: qty });
        var tAdd = offlineCart.reduce(function (s, c) { return s + c.price * c.quantity; }, 0);
        result = { added: prod.name, quantity: qty, cartItems: offlineCart.length, cartTotal: fmtCents(tAdd) };
        break;
      }
      case 'viewCart': {
        var tView = offlineCart.reduce(function (s, c) { return s + c.price * c.quantity; }, 0);
        result = {
          items: offlineCart.map(function (c) {
            return {
              productId: c.productId,
              name: c.name,
              price: c.price,
              quantity: c.quantity,
              priceFormatted: fmtCents(c.price),
              subtotal: fmtCents(c.price * c.quantity)
            };
          }),
          itemCount: offlineCart.reduce(function (s, c) { return s + c.quantity; }, 0),
          total: fmtCents(tView)
        };
        break;
      }
      case 'removeFromCart': {
        var rid = params.productId;
        var idx = offlineCart.findIndex(function (c) { return c.productId === rid; });
        if (idx === -1) { result = { error: 'Product not in cart' }; break; }
        var rem = offlineCart.splice(idx, 1)[0];
        var pRem = OFFLINE_CATALOG.find(function (x) { return x.id === rem.productId; });
        if (pRem) offlineStock[rid] += rem.quantity;
        var tRem = offlineCart.reduce(function (s, c) { return s + c.price * c.quantity; }, 0);
        result = { removed: rem.name, cartItems: offlineCart.length, cartTotal: fmtCents(tRem) };
        break;
      }
      case 'checkout': {
        if (!offlineCart.length) { result = { error: 'Cart is empty' }; break; }
        if (!params.email) { result = { error: 'Email is required' }; break; }
        var tCo = offlineCart.reduce(function (s, c) { return s + c.price * c.quantity; }, 0);
        var itemCount = offlineCart.reduce(function (s, c) { return s + c.quantity; }, 0);
        var oid = 'ORD-OFF-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        offlineOrders.push({
          orderId: oid,
          email: params.email,
          items: offlineCart.map(function (c) { return Object.assign({}, c); }),
          total: fmtCents(tCo),
          status: 'confirmed',
          createdAt: new Date().toISOString()
        });
        offlineCart = [];
        result = { orderId: oid, status: 'confirmed', total: fmtCents(tCo), itemCount: itemCount, email: params.email };
        break;
      }
      case 'getOrderStatus': {
        var ord = offlineOrders.find(function (o) { return o.orderId === params.orderId; });
        if (!ord) { result = { error: 'Order ' + params.orderId + ' not found' }; break; }
        var ic = ord.items.reduce(function (s, i) { return s + i.quantity; }, 0);
        result = { orderId: ord.orderId, status: ord.status, total: ord.total, itemCount: ic, createdAt: ord.createdAt };
        break;
      }
      default:
        result = { error: 'Unknown action: ' + action };
    }
    var success = !result.error;
    offlineAudit.push({ action: action, params: params, success: success, timestamp: new Date().toISOString() });
    if (offlineAudit.length > 200) offlineAudit.shift();
    return { success: success, action: action, result: result, wab_version: '1.2.0', duration_ms: 0, mode: 'offline' };
  }

  function localGet(path) {
    if (path === '/.well-known/wab.json' || path === '/agent-bridge.json' || path === '/wab/discover') {
      return localDiscovery();
    }
    if (path === '/wab/ping') {
      return { status: 'ok', wab_version: '1.2.0', protocol: '1.0', mode: 'offline-demo', timestamp: new Date().toISOString() };
    }
    if (path === '/wab/audit') {
      return { entries: offlineAudit.slice(-50), total: offlineAudit.length, mode: 'offline-demo' };
    }
    return { error: 'Not found', path: path };
  }

  /* ── DOM refs ─────────────────────────────────── */
  var netLog = document.getElementById('net-log');
  var agentLog = document.getElementById('agent-log');
  var reqCount = 0;
  var busy = false;
  var cartData = { items: [], total: '$0.00', itemCount: 0 };
  var productsCache = [];

  var bannerEl = document.getElementById('demo-mode-banner');
  var storeFrame = document.getElementById('store-frame');
  var storeLiveWrap = document.getElementById('store-live-wrap');
  var storeOfflineBox = document.getElementById('store-offline-placeholder');

  function setBanner(html, kind) {
    if (!bannerEl) return;
    bannerEl.style.display = 'block';
    bannerEl.className = 'demo-banner demo-banner--' + (kind || 'info');
    bannerEl.innerHTML = html;
  }

  function syntaxHL(json) {
    if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (m) {
      var c = 'num';
      if (/^"/.test(m)) c = /:$/.test(m) ? 'key' : 'str';
      else if (/true|false/.test(m)) c = 'bool';
      return '<span class="' + c + '">' + m + '</span>';
    });
  }

  function addNetEntry(method, url, reqBody, resBody, status, duration, label) {
    var id = ++reqCount;
    document.getElementById('req-count').textContent = reqCount + ' request' + (reqCount > 1 ? 's' : '');
    var g = document.createElement('div');
    g.className = 'log-group';
    var sc = status >= 200 && status < 300 ? 's2' : 's4';
    var short = url.replace(STORE, '');
    if (label) short = '<span class="net-local">' + label + '</span> ' + short;
    g.innerHTML =
      '<div class="log-group-header">' +
        '<span class="arrow" id="arr-' + id + '">▶</span>' +
        '<span class="method ' + method + '">' + method + '</span>' +
        '<span class="url">' + short + '</span>' +
        '<span class="status ' + sc + '">' + status + '</span>' +
        '<span class="timing">' + duration + 'ms</span>' +
      '</div>' +
      '<div class="log-group-body" id="nb-' + id + '">' +
        (reqBody ? '<div class="log-sec"><div class="log-sec-title">Request</div><div class="log-json">' + syntaxHL(reqBody) + '</div></div>' : '') +
        '<div class="log-sec"><div class="log-sec-title">Response · ' + status + '</div><div class="log-json">' + syntaxHL(resBody) + '</div></div>' +
      '</div>';
    g.querySelector('.log-group-header').addEventListener('click', function () {
      document.getElementById('nb-' + id).classList.toggle('open');
      document.getElementById('arr-' + id).classList.toggle('open');
    });
    netLog.appendChild(g);
    netLog.scrollTop = netLog.scrollHeight;
  }

  function wabGet(path) {
    var s = performance.now();
    if (!useRemote) {
      var d = localGet(path);
      addNetEntry('GET', 'local://wab' + path, null, d, 200, Math.round(performance.now() - s), 'OFFLINE');
      return Promise.resolve(d);
    }
    var url = STORE + path;
    return fetch(url)
      .then(function (r) { return r.json().then(function (j) { addNetEntry('GET', url, null, j, r.status, Math.round(performance.now() - s)); return j; }); })
      .catch(function (err) {
        addNetEntry('GET', url, null, { error: String(err.message || err) }, 0, Math.round(performance.now() - s));
        throw err;
      });
  }

  function wabExec(action, params) {
    var s = performance.now();
    if (!useRemote) {
      var body = { action: action, params: params || {} };
      var out = localExec(action, params);
      addNetEntry('POST', 'local://wab/execute', body, out, 200, Math.round(performance.now() - s), 'OFFLINE');
      return Promise.resolve(out);
    }
    var url = STORE + '/wab/execute';
    var bodyR = { action: action, params: params || {} };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyR)
    })
      .then(function (r) { return r.json().then(function (j) { addNetEntry('POST', url, bodyR, j, r.status, Math.round(performance.now() - s)); return j; }); })
      .catch(function (err) {
        addNetEntry('POST', url, bodyR, { error: String(err.message || err) }, 0, Math.round(performance.now() - s));
        throw err;
      });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function refreshStore() {
    if (!useRemote) return;
    try { storeFrame.contentWindow.postMessage({ source: 'wab-agent', type: 'refresh' }, '*'); } catch (e) {}
    setTimeout(function () { storeFrame.src = STORE + '?t=' + Date.now(); }, 300);
  }

  function applyStorePanel() {
    if (useRemote) {
      if (storeLiveWrap) storeLiveWrap.style.display = '';
      if (storeOfflineBox) storeOfflineBox.style.display = 'none';
    } else {
      if (storeLiveWrap) storeLiveWrap.style.display = 'none';
      if (storeOfflineBox) storeOfflineBox.style.display = 'flex';
    }
  }

  function agentMsg(text, type) {
    var div = document.createElement('div');
    div.className = 'agent-msg ' + (type || 'system');
    div.textContent = text;
    agentLog.appendChild(div);
    agentLog.scrollTop = agentLog.scrollHeight;
  }

  function setPhase(n, s) {
    var d = document.getElementById('ph-' + n);
    var l = document.getElementById('pl-' + n);
    if (d) d.className = 'ph-dot' + (s ? ' ' + s : '');
    if (l) l.className = 'ph-lbl' + (s ? ' ' + s : '');
  }

  function resetPhases() {
    ['discover', 'plan', 'execute', 'confirm'].forEach(function (p) { setPhase(p, ''); });
  }

  /* ── Shop UI ──────────────────────────────────── */
  function loadProducts() {
    var grid = document.getElementById('products-grid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted)">Loading products via WAB Protocol…</div>';
    return wabExec('listProducts')
      .then(function (d) {
        if (!d.success) {
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--red)">Could not load products. <button type="button" class="retry-btn" id="demo-retry">Retry</button></div>';
          var rb = document.getElementById('demo-retry');
          if (rb) rb.addEventListener('click', function () { loadProducts(); });
          return;
        }
        productsCache = d.result.products;
        renderProducts();
      })
      .catch(function () {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--red)">Network error. <button type="button" class="retry-btn" id="demo-retry">Retry</button></div>';
        var rb = document.getElementById('demo-retry');
        if (rb) rb.addEventListener('click', function () { loadProducts(); });
      });
  }

  function renderProducts() {
    var grid = document.getElementById('products-grid');
    grid.innerHTML = productsCache.map(function (p) {
      var stars = '';
      for (var i = 0; i < 5; i++) stars += i < Math.round(p.rating) ? '★' : '☆';
      var sc = p.stock <= 5 ? 'stock low' : 'stock';
      var st = p.stock <= 0 ? 'Out of stock' : (p.stock <= 5 ? p.stock + ' left' : p.stock + ' in stock');
      return '<div class="p-card">' +
        '<span class="emoji">' + p.image + '</span>' +
        '<h4>' + p.name + '</h4>' +
        '<div class="rating">' + stars + '</div>' +
        '<div class="price">' + p.priceFormatted + '</div>' +
        '<div class="' + sc + '">' + st + '</div>' +
        '<button class="add" data-id="' + p.id + '" data-name="' + p.name.replace(/"/g, '&quot;') + '"' + (p.stock <= 0 ? ' disabled' : '') + '>+ Add to Cart</button>' +
      '</div>';
    }).join('');
    grid.querySelectorAll('.add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        shopAddToCart(parseInt(btn.dataset.id, 10), btn.dataset.name);
      });
    });
  }

  function shopAddToCart(id, name) {
    wabExec('addToCart', { productId: id, quantity: 1 }).then(function (d) {
      if (d.success) {
        shopRefreshCart();
        loadProducts();
        refreshStore();
      }
    });
  }

  function shopRemoveFromCart(id) {
    wabExec('removeFromCart', { productId: id }).then(function (d) {
      if (d.success) {
        shopRefreshCart();
        loadProducts();
        refreshStore();
      }
    });
  }

  function shopRefreshCart() {
    return wabExec('viewCart').then(function (d) {
      if (!d.success) return;
      cartData = d.result;
      renderCart();
    });
  }

  function renderCart() {
    var area = document.getElementById('cart-area');
    var items = document.getElementById('cart-items');
    var totalEl = document.getElementById('cart-total-val');
    if (cartData.itemCount === 0) {
      area.style.display = 'none';
      return;
    }
    area.style.display = 'block';
    items.innerHTML = cartData.items.map(function (c) {
      var prod = productsCache.find(function (p) { return p.id === c.productId; }) || {};
      return '<div class="cart-item">' +
        '<span class="ci-emoji">' + (prod.image || '📦') + '</span>' +
        '<div class="ci-info"><div class="ci-name">' + c.name + '</div><div class="ci-meta">Qty: ' + c.quantity + ' × ' + c.priceFormatted + '</div></div>' +
        '<div class="ci-price">' + c.subtotal + '</div>' +
        '<button class="ci-remove" data-id="' + c.productId + '">✕</button>' +
      '</div>';
    }).join('');
    totalEl.textContent = cartData.total;
    items.querySelectorAll('.ci-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        shopRemoveFromCart(parseInt(btn.dataset.id, 10));
      });
    });
  }

  function checkoutSuccessCopy() {
    return useRemote
      ? 'Every step used HTTP to the live Railway TechStore (WAB Protocol). See Network Log →'
      : 'This session used the <strong>offline WAB simulator</strong> in your browser — same JSON request/response shape as a real store; no external server required.';
  }

  /* ── AI Agent flows ───────────────────────────── */
  function doDiscover() {
    setPhase('discover', 'active');
    agentMsg('Fetching discovery document…', 'think');
    return wabGet('/.well-known/wab.json').then(function (doc) {
      var n = doc.actions && doc.actions.length ? doc.actions.length : 0;
      agentMsg('Discovered ' + n + ' actions on "' + (doc.site && doc.site.name) + '"', 'result');
      setPhase('discover', 'done');
      return doc;
    });
  }

  function runFullAgent() {
    if (busy) return;
    busy = true;
    document.getElementById('btn-full').disabled = true;
    resetPhases();
    agentLog.innerHTML = '';
    agentMsg('Agent session started (' + (useRemote ? 'live store' : 'offline simulator') + ')', 'system');
    agentMsg('Target: ' + (useRemote ? STORE : 'local://wab'), 'system');

    doDiscover()
      .then(function (doc) { return sleep(300).then(function () { return doc; }); })
      .then(function (doc) {
        setPhase('plan', 'active');
        agentMsg('Planning: find cheapest in-stock product → cart → checkout → verify', 'think');
        setPhase('plan', 'done');
        return sleep(200).then(function () { return doc; });
      })
      .then(function () {
        setPhase('execute', 'active');
        return wabExec('listProducts');
      })
      .then(function (list) {
        if (!list || !list.success || !list.result || !list.result.products) {
          throw new Error((list && list.result && list.result.error) || 'listProducts failed');
        }
        var prods = list.result.products;
        agentMsg('Found ' + prods.length + ' products', 'result');
        var cheap = prods.reduce(function (a, b) { return a.price < b.price ? a : b; });
        agentMsg('Cheapest: "' + cheap.name + '" at ' + cheap.priceFormatted, 'think');
        return wabExec('addToCart', { productId: cheap.id, quantity: 1 });
      })
      .then(function (addD) {
        agentMsg(addD.success ? 'Added. Cart: ' + addD.result.cartTotal : 'Failed: ' + addD.result.error, addD.success ? 'result' : 'error');
        return wabExec('viewCart');
      })
      .then(function (cartD) {
        agentMsg('Cart: ' + cartD.result.itemCount + ' item(s), ' + cartD.result.total, 'result');
        return wabExec('checkout', { email: 'agent@webagentbridge.com' });
      })
      .then(function (orderD) {
        if (!orderD || !orderD.result) {
          agentMsg('Checkout returned no result', 'error');
          setPhase('execute', 'done');
          return Promise.resolve();
        }
        agentMsg(orderD.success ? 'Order: ' + orderD.result.orderId + ' — ' + orderD.result.total : 'Failed: ' + (orderD.result.error || orderD.result), orderD.success ? 'result' : 'error');
        setPhase('execute', 'done');
        if (!orderD.success) {
          setPhase('confirm', 'active');
          return wabGet('/wab/audit');
        }
        setPhase('confirm', 'active');
        return wabExec('getOrderStatus', { orderId: orderD.result.orderId }).then(function (st) {
          agentMsg('Status: ' + (st.result && st.result.status ? st.result.status : 'unknown'), 'result');
          return wabGet('/wab/audit');
        });
      })
      .then(function () {
        agentMsg('Audit log checked', 'result');
        setPhase('confirm', 'done');
        agentMsg('Complete — see Network Log for all protocol calls', 'system');
        refreshStore();
        return loadProducts();
      })
      .catch(function (e) {
        agentMsg('Agent error: ' + (e && e.message ? e.message : e), 'error');
      })
      .finally(function () {
        busy = false;
        document.getElementById('btn-full').disabled = false;
      });
  }

  function handleInput(text) {
    if (busy) return;
    text = text.trim();
    if (!text) return;
    busy = true;
    if (text.charAt(0) === '{') {
      try {
        var p = JSON.parse(text);
        if (p.action) {
          agentMsg('Execute: ' + p.action, 'user');
          wabExec(p.action, p.params).then(function () {
            if (['addToCart', 'removeFromCart', 'checkout'].indexOf(p.action) !== -1) {
              refreshStore();
              loadProducts();
            }
            busy = false;
          });
          return;
        }
      } catch (e) {}
    }
    agentMsg('User: ' + text, 'user');
    var l = text.toLowerCase();
    if (l.indexOf('discover') !== -1) {
      doDiscover().finally(function () { busy = false; });
      return;
    }
    if (l.indexOf('list') !== -1 || l.indexOf('product') !== -1) {
      wabExec('listProducts').then(function (d) {
        if (d.success) agentMsg(d.result.total + ' products', 'result');
        busy = false;
      });
      return;
    }
    if (l.indexOf('search') !== -1 || l.indexOf('find') !== -1) {
      var q = text.replace(/^.*?(search|find)\s*(for)?\s*/i, '').trim() || 'keyboard';
      wabExec('searchProducts', { query: q }).then(function (d) {
        if (d.success) agentMsg(d.result.total + ' results', 'result');
        busy = false;
      });
      return;
    }
    if (l.indexOf('cart') !== -1) {
      wabExec('viewCart').then(function (d) {
        agentMsg(d.result.itemCount + ' items, ' + d.result.total, 'result');
        busy = false;
      });
      return;
    }
    if (l.indexOf('buy') !== -1 || l.indexOf('purchase') !== -1 || l.indexOf('cheapest') !== -1) {
      runFullAgent();
      busy = false;
      return;
    }
    if (l.indexOf('ping') !== -1) {
      wabGet('/wab/ping').finally(function () { busy = false; });
      return;
    }
    if (l.indexOf('audit') !== -1) {
      wabGet('/wab/audit').finally(function () { busy = false; });
      return;
    }
    agentMsg('Try: discover, list products, search keyboard, view cart, buy cheapest, or raw JSON', 'think');
    busy = false;
  }

  /* ── Init: probe remote ───────────────────────── */
  resetOfflineState();

  function tryRemote() {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, CONNECT_MS);
    return fetch(STORE + '/wab/ping', { signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error('ping ' + r.status);
        return r.json();
      })
      .then(function () {
        useRemote = true;
        setBanner(
          '<strong>Live demo store connected.</strong> Requests go to Railway; if it goes offline, this page switches to the offline simulator automatically on reload.',
          'ok'
        );
        applyStorePanel();
      })
      .catch(function () {
        useRemote = false;
        setBanner(
          '<strong>Offline mode.</strong> The live TechStore on Railway did not respond in time. ' +
          'You are using the <strong>in-browser WAB simulator</strong> — same <code>POST /wab/execute</code> JSON shape, logged as <code>OFFLINE</code> in the network panel. ' +
          '<a href="' + STORE + '" target="_blank" rel="noopener">Open live store</a> in a new tab when it is available.',
          'warn'
        );
        applyStorePanel();
      });
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab-body').forEach(function (x) { x.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('tab-' + this.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('btn-checkout').addEventListener('click', function () {
    var email = document.getElementById('checkout-email').value;
    if (!email) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Processing…';
    wabExec('checkout', { email: email }).then(function (d) {
      if (d.success) {
        return wabExec('getOrderStatus', { orderId: d.result.orderId }).then(function (statusD) {
          document.getElementById('shop-view').style.display = 'none';
          document.getElementById('order-view').style.display = 'block';
          document.getElementById('order-view').innerHTML =
            '<div class="order-done">' +
              '<div class="check">✅</div>' +
              '<h3>Order Confirmed!</h3>' +
              '<div class="oid">' + d.result.orderId + '</div>' +
              '<p>Total: <strong>' + d.result.total + '</strong><br>' + d.result.itemCount + ' item(s)<br>' + d.result.email + '</p>' +
              '<p style="margin-top:12px;font-size:0.75rem;color:var(--muted)">Status: ' + (statusD.success ? statusD.result.status : 'confirmed') + '</p>' +
              '<p style="margin-top:14px;font-size:0.72rem;color:var(--dim);line-height:1.5">' + checkoutSuccessCopy() + '</p>' +
              '<button class="reset-btn" id="btn-reset-shop">Shop Again</button>' +
            '</div>';
          document.getElementById('btn-reset-shop').addEventListener('click', function () {
            document.getElementById('shop-view').style.display = 'block';
            document.getElementById('order-view').style.display = 'none';
            cartData = { items: [], total: '$0.00', itemCount: 0 };
            renderCart();
            if (!useRemote) resetOfflineState();
            loadProducts();
            refreshStore();
            btn.disabled = false;
            btn.textContent = 'Complete Purchase via WAB Protocol';
          });
          refreshStore();
        });
      } else {
        btn.disabled = false;
        btn.textContent = 'Complete Purchase via WAB Protocol';
        alert(d.result.error || 'Checkout failed');
      }
    });
  });

  document.getElementById('btn-full').addEventListener('click', runFullAgent);
  document.getElementById('btn-discover').addEventListener('click', function () {
    if (!busy) {
      busy = true;
      doDiscover().finally(function () { busy = false; });
    }
  });
  document.getElementById('btn-list').addEventListener('click', function () {
    if (!busy) {
      busy = true;
      agentMsg('Listing…', 'think');
      wabExec('listProducts').finally(function () { busy = false; });
    }
  });
  document.getElementById('btn-search').addEventListener('click', function () {
    var q = prompt('Search:');
    if (q && !busy) {
      busy = true;
      wabExec('searchProducts', { query: q }).finally(function () { busy = false; });
    }
  });
  document.getElementById('btn-viewcart').addEventListener('click', function () {
    if (!busy) {
      busy = true;
      wabExec('viewCart').finally(function () { busy = false; });
    }
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    netLog.innerHTML = '';
    reqCount = 0;
    document.getElementById('req-count').textContent = '0 requests';
  });
  document.getElementById('btn-send').addEventListener('click', function () {
    var i = document.getElementById('cmd-input');
    handleInput(i.value);
    i.value = '';
  });
  document.getElementById('cmd-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      handleInput(this.value);
      this.value = '';
    }
  });

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'wab-store') return;
    if (e.data.type === 'action-executed' || e.data.type === 'cart-update') {
      loadProducts();
      shopRefreshCart();
    }
  });

  tryRemote().then(function () {
    return loadProducts();
  }).then(function () {
    return shopRefreshCart();
  });
})();
