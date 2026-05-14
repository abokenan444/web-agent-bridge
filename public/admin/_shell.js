/**
 * WAB Admin — shared shell.
 * Every admin page includes this once and calls AdminShell.init({page}).
 * It builds the sidebar, enforces auth, and exposes API helpers.
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'wab_admin_token';

  // ── Auth guard (runs immediately on script load) ───────────────────
  const token = (function () {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  })();
  if (!token && location.pathname !== '/admin/login') {
    location.replace('/admin/login');
    return;
  }

  // ── Navigation map (single source of truth) ────────────────────────
  const NAV = [
    { id: 'overview',     href: '/admin',              label: '📊 Overview' },
    { id: 'users',        href: '/admin/users',        label: '👥 Users' },
    { id: 'sites',        href: '/admin/sites',        label: '🌐 Sites' },
    { id: 'analytics',    href: '/admin/analytics',    label: '📈 Analytics' },
    { id: 'grants',       href: '/admin/grants',       label: '🎁 Free Grants' },
    { id: 'plans',        href: '/admin/plans',        label: '📦 Plans' },
    { id: 'shieldqr',     href: '/admin/shieldqr',     label: '🛡️ ShieldQR' },
    { id: 'shieldlink',   href: '/admin/shieldlink',   label: '🔗 ShieldLink' },
    { id: 'trust-monitor',href: '/admin/trust-monitor',label: '🔐 Trust Monitor' },
    { id: 'payments',     href: '/admin/payments',     label: '💳 Payments' },
    { id: 'stripe',       href: '/admin/stripe',       label: '🔧 Stripe' },
    { id: 'smtp',         href: '/admin/smtp',         label: '📧 SMTP' },
    { id: 'notifications',href: '/admin/notifications',label: '🔔 Notifications' },
    { id: 'governance',   href: '/admin/governance',   label: '🛡️ Governance' },
    { id: 'discovery',    href: '/admin/discovery',    label: '🔍 DNS Discovery' },
    { id: 'trust',        href: '/admin/trust',        label: '🔐 Trust Layer' },
    { id: 'providers',    href: '/admin/providers',    label: '🔗 Providers' },
    { id: 'snapshots',    href: '/admin/snapshots',    label: '📸 Snapshots' },
  ];

  // ── HTTP helper ────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {},
      { Authorization: 'Bearer ' + token }
    );
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    // Treat both 401 (no token) and 403 (expired/invalid/revoked admin token) as auth failure
    const errMsg = (data && data.error) || '';
    const isAuthFailure =
      res.status === 401 ||
      (res.status === 403 && /admin token|admin access|admin privileges|token has been revoked/i.test(errMsg));
    if (isAuthFailure) {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      location.replace('/admin/login');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const msg = errMsg || res.statusText || 'request_failed';
      const err = new Error(msg); err.status = res.status; err.body = data; throw err;
    }
    return data;
  }

  // ── Toast / flash messages ────────────────────────────────────────
  function toast(msg, kind = 'info') {
    let host = document.getElementById('admin-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'admin-toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'admin-toast admin-toast-' + kind;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('admin-toast-fade'); }, 2400);
    setTimeout(() => { el.remove(); }, 3000);
  }

  // ── DOM helpers ───────────────────────────────────────────────────
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const k in props) {
      if (k === 'class')      node.className = props[k];
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(node.style, props[k]);
      else if (k === 'html')  node.innerHTML = props[k];
      else if (k === 'text')  node.textContent = props[k];
      else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else                    node.setAttribute(k, props[k]);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }
  function fmtMoney(cents, currency = 'USD') {
    const n = Number(cents || 0);
    return (currency === 'USD' ? '$' : currency + ' ') + (n / 100).toFixed(2);
  }
  function confirmAsync(msg) { return Promise.resolve(window.confirm(msg)); }

  function logout() {
    api('/api/admin/logout', { method: 'POST' }).catch(() => {}).finally(() => {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      location.replace('/admin/login');
    });
  }

  // ── Build the page chrome (sidebar + main wrapper) ────────────────
  function buildShell(activeId) {
    document.body.classList.add('admin-body');

    const dashboardEl = $('.dashboard');
    if (dashboardEl) return; // page already rendered shell manually

    const aside = el('aside', { class: 'sidebar' }, [
      el('div', { class: 'sidebar-brand' }, [
        el('a', { href: '/', class: 'navbar-brand' }, [
          el('div', {
            class: 'brand-icon',
            style: { background: 'linear-gradient(135deg,#ef4444,#f59e0b)' },
            text: '🛡️',
          }),
          el('span', { text: 'WAB Admin' }),
        ]),
      ]),
      el('nav', { class: 'sidebar-nav' },
        NAV.map((n) => el('a', {
          href: n.href,
          class: n.id === activeId ? 'active' : '',
          text: n.label,
        }))
      ),
      el('div', { class: 'sidebar-footer' }, [
        el('div', {
          id: 'adminName',
          style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' },
        }),
        el('button', {
          class: 'btn btn-ghost btn-sm',
          style: { width: '100%', justifyContent: 'flex-start' },
          onclick: logout,
          text: '🚪 Sign Out',
        }),
      ]),
    ]);

    const main = el('main', { class: 'main-content', id: 'admin-main' });

    const wrapper = el('div', { class: 'dashboard' }, [aside, main]);
    document.body.appendChild(wrapper);
  }

  async function loadAdminProfile() {
    try {
      const r = await api('/api/admin/me');
      const lbl = $('#adminName');
      if (lbl && r && r.admin) {
        lbl.textContent = (r.admin.email || 'admin') + (r.admin.name ? ' • ' + r.admin.name : '');
      }
    } catch { /* token guard handles 401 */ }
  }

  // ── Public API ────────────────────────────────────────────────────
  window.AdminShell = {
    NAV, api, toast, el, $, $$,
    escapeHtml, fmtDate, fmtMoney, confirmAsync, logout,
    init: function ({ page, mount }) {
      buildShell(page);
      loadAdminProfile();
      const target = $('#admin-main');
      if (target && typeof mount === 'function') {
        Promise.resolve(mount(target)).catch((e) => {
          console.error(e);
          toast(e.message || 'page_failed', 'error');
        });
      }
    },
  };
})();
