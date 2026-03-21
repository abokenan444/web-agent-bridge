/**
 * Web Agent Bridge v1.0.0
 * Open-source middleware for AI agent ↔ website interaction
 * https://github.com/web-agent-bridge
 * License: MIT
 */
(function (global) {
  'use strict';

  const VERSION = '1.0.0';
  const LICENSING_SERVER = 'https://api.webagentbridge.com';

  // ─── Default Configuration ────────────────────────────────────────────
  const DEFAULT_CONFIG = {
    agentPermissions: {
      readContent: true,
      click: true,
      fillForms: false,
      scroll: true,
      navigate: false,
      apiAccess: false,
      automatedLogin: false,
      extractData: false
    },
    features: {
      advancedAnalytics: false,
      realTimeUpdates: false,
      customActions: false,
      webhooks: false
    },
    restrictions: {
      allowedSelectors: [],
      blockedSelectors: ['.private', '[data-private]', '[data-no-agent]'],
      requireLoginForActions: [],
      rateLimit: { maxCallsPerMinute: 60 }
    },
    logging: {
      enabled: false,
      level: 'basic'
    },
    subscriptionTier: 'free',
    licenseKey: null
  };

  // ─── Rate Limiter ─────────────────────────────────────────────────────
  class RateLimiter {
    constructor(maxPerMinute) {
      this.maxPerMinute = maxPerMinute;
      this.calls = [];
    }

    check() {
      const now = Date.now();
      this.calls = this.calls.filter(t => now - t < 60000);
      if (this.calls.length >= this.maxPerMinute) {
        return false;
      }
      this.calls.push(now);
      return true;
    }

    get remaining() {
      const now = Date.now();
      this.calls = this.calls.filter(t => now - t < 60000);
      return Math.max(0, this.maxPerMinute - this.calls.length);
    }
  }

  // ─── Logger ───────────────────────────────────────────────────────────
  class BridgeLogger {
    constructor(config) {
      this.enabled = config.enabled;
      this.level = config.level;
      this.logs = [];
    }

    log(action, details, level = 'basic') {
      if (!this.enabled) return;
      if (level === 'detailed' && this.level !== 'detailed') return;

      const entry = {
        timestamp: new Date().toISOString(),
        action,
        details,
        level
      };
      this.logs.push(entry);

      if (this.logs.length > 1000) {
        this.logs = this.logs.slice(-500);
      }
    }

    getLogs(filter) {
      if (!filter) return [...this.logs];
      return this.logs.filter(l => l.action === filter);
    }

    clear() {
      this.logs = [];
    }
  }

  // ─── Element Utilities ────────────────────────────────────────────────
  function isElementAllowed(selector, config) {
    const { allowedSelectors, blockedSelectors } = config.restrictions;

    if (blockedSelectors.length > 0) {
      const el = document.querySelector(selector);
      if (el) {
        for (const blocked of blockedSelectors) {
          if (el.matches(blocked) || el.closest(blocked)) return false;
        }
      }
    }

    if (allowedSelectors.length > 0) {
      const el = document.querySelector(selector);
      if (el) {
        for (const allowed of allowedSelectors) {
          if (el.matches(allowed) || el.closest(allowed)) return true;
        }
        return false;
      }
    }

    return true;
  }

  function safeQuerySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function safeQuerySelectorAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  // ─── Action Registry ──────────────────────────────────────────────────
  class ActionRegistry {
    constructor() {
      this.actions = new Map();
    }

    register(action) {
      if (!action.name || !action.description) {
        throw new Error('Action must have a name and description');
      }
      this.actions.set(action.name, {
        name: action.name,
        description: action.description,
        trigger: action.trigger || 'click',
        selector: action.selector || null,
        fields: action.fields || null,
        submitSelector: action.submitSelector || null,
        endpoint: action.endpoint || null,
        method: action.method || 'GET',
        requiresAuth: action.requiresAuth || false,
        category: action.category || 'general',
        params: action.params || null,
        handler: action.handler || null,
        metadata: action.metadata || {}
      });
    }

    unregister(name) {
      return this.actions.delete(name);
    }

    get(name) {
      return this.actions.get(name) || null;
    }

    list() {
      return Array.from(this.actions.values()).map(a => ({
        name: a.name,
        description: a.description,
        trigger: a.trigger,
        category: a.category,
        requiresAuth: a.requiresAuth,
        params: a.params,
        fields: a.fields ? a.fields.map(f => ({ name: f.name, type: f.type, required: f.required !== false })) : null
      }));
    }

    getByCategory(category) {
      return this.list().filter(a => a.category === category);
    }

    toJSON() {
      return this.list();
    }
  }

  // ─── Event Emitter ────────────────────────────────────────────────────
  class BridgeEventEmitter {
    constructor() {
      this.listeners = {};
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
      if (!this.listeners[event]) return;
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[WAB] Event handler error for "${event}":`, e); }
      });
    }
  }

  // ─── Main Bridge Class ────────────────────────────────────────────────
  class WebAgentBridge {
    constructor(userConfig) {
      this.config = this._mergeConfig(DEFAULT_CONFIG, userConfig || {});
      this.registry = new ActionRegistry();
      this.rateLimiter = new RateLimiter(this.config.restrictions.rateLimit.maxCallsPerMinute);
      this.logger = new BridgeLogger(this.config.logging);
      this.events = new BridgeEventEmitter();
      this.authenticated = false;
      this.agentInfo = null;
      this._licenseVerified = null;
      this._ready = false;
      this._readyCallbacks = [];

      this._init();
    }

    // ── Initialization ──────────────────────────────────────────────────
    async _init() {
      if (this.config.licenseKey) {
        await this._verifyLicense();
      } else {
        this._licenseVerified = { tier: 'free', valid: true };
      }

      this._autoDiscoverActions();
      this._ready = true;
      this._readyCallbacks.forEach(cb => cb());
      this._readyCallbacks = [];
      this.events.emit('ready', { version: VERSION, tier: this.getEffectiveTier() });
      this.logger.log('init', { version: VERSION, tier: this.getEffectiveTier() });
    }

    onReady(callback) {
      if (this._ready) {
        callback();
      } else {
        this._readyCallbacks.push(callback);
      }
    }

    _mergeConfig(defaults, overrides) {
      const result = {};
      for (const key of Object.keys(defaults)) {
        if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
          result[key] = this._mergeConfig(defaults[key], overrides[key] || {});
        } else {
          result[key] = overrides[key] !== undefined ? overrides[key] : defaults[key];
        }
      }
      for (const key of Object.keys(overrides)) {
        if (!(key in defaults)) {
          result[key] = overrides[key];
        }
      }
      return result;
    }

    // ── License Verification ────────────────────────────────────────────
    async _verifyLicense() {
      try {
        const res = await fetch(`${LICENSING_SERVER}/api/license/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: location.hostname,
            licenseKey: this.config.licenseKey
          })
        });
        if (res.ok) {
          this._licenseVerified = await res.json();
        } else {
          this._licenseVerified = { tier: 'free', valid: false, error: 'License verification failed' };
        }
      } catch (e) {
        this._licenseVerified = { tier: this.config.subscriptionTier || 'free', valid: false, error: 'Offline' };
      }
    }

    getEffectiveTier() {
      if (this._licenseVerified && this._licenseVerified.valid) {
        return this._licenseVerified.tier;
      }
      return 'free';
    }

    // ── Auto-discover Page Actions ──────────────────────────────────────
    _autoDiscoverActions() {
      const buttons = safeQuerySelectorAll('button, [role="button"], input[type="submit"], a.btn, a.button');
      buttons.forEach((el, i) => {
        const text = (el.textContent || el.value || '').trim();
        if (!text) return;

        const selector = this._generateSelector(el);
        if (!selector || !isElementAllowed(selector, this.config)) return;

        const name = this._slugify(text) || `action_${i}`;
        if (!this.registry.get(name)) {
          this.registry.register({
            name,
            description: `Click: ${text}`,
            trigger: 'click',
            selector,
            category: 'auto-discovered'
          });
        }
      });

      const forms = safeQuerySelectorAll('form');
      forms.forEach((form, i) => {
        const formSelector = this._generateSelector(form);
        if (!formSelector || !isElementAllowed(formSelector, this.config)) return;

        const fields = Array.from(form.querySelectorAll('input, textarea, select'))
          .filter(f => f.type !== 'hidden' && f.type !== 'submit')
          .map(f => ({
            name: f.name || f.id || f.placeholder || `field_${Math.random().toString(36).slice(2, 6)}`,
            selector: this._generateSelector(f),
            type: f.type || 'text',
            required: f.required,
            placeholder: f.placeholder || ''
          }));

        const submitBtn = form.querySelector('[type="submit"], button:not([type])');
        const formName = form.id || form.name || `form_${i}`;

        this.registry.register({
          name: `fill_${this._slugify(formName)}`,
          description: `Fill and submit form: ${formName}`,
          trigger: 'fill_and_submit',
          selector: formSelector,
          fields,
          submitSelector: submitBtn ? this._generateSelector(submitBtn) : null,
          category: 'auto-discovered'
        });
      });

      const links = safeQuerySelectorAll('nav a, [role="navigation"] a');
      links.forEach((el, i) => {
        const text = (el.textContent || '').trim();
        if (!text) return;

        const selector = this._generateSelector(el);
        if (!selector || !isElementAllowed(selector, this.config)) return;

        const name = `nav_${this._slugify(text)}` || `nav_${i}`;
        if (!this.registry.get(name)) {
          this.registry.register({
            name,
            description: `Navigate: ${text}`,
            trigger: 'click',
            selector,
            category: 'navigation'
          });
        }
      });
    }

    _generateSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.dataset.wabId) return `[data-wab-id="${el.dataset.wabId}"]`;

      const classes = Array.from(el.classList).filter(c => !c.match(/^(js-|is-|has-)/));
      if (classes.length > 0) {
        const sel = `${el.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }

      const attrs = ['name', 'data-testid', 'aria-label', 'title', 'role'];
      for (const attr of attrs) {
        const val = el.getAttribute(attr);
        if (val) {
          const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
      }

      const path = [];
      let current = el;
      while (current && current !== document.body) {
        let tag = current.tagName.toLowerCase();
        if (current.id) {
          path.unshift(`#${CSS.escape(current.id)}`);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
          if (siblings.length > 1) {
            tag += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }
        path.unshift(tag);
        current = parent;
      }
      return path.join(' > ');
    }

    _slugify(text) {
      return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '_')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    }

    // ── Agent Authentication ────────────────────────────────────────────
    authenticate(agentKey, agentMeta = {}) {
      this.logger.log('authenticate', { agentKey: agentKey ? '***' : null });
      this.events.emit('agent:authenticate', { agentMeta });
      this.authenticated = true;
      this.agentInfo = { key: agentKey, ...agentMeta, authenticatedAt: new Date().toISOString() };
      return { success: true, permissions: this._getEffectivePermissions() };
    }

    // ── Permission Checks ───────────────────────────────────────────────
    _getEffectivePermissions() {
      const perms = { ...this.config.agentPermissions };
      const tier = this.getEffectiveTier();

      if (tier === 'free') {
        perms.apiAccess = false;
        perms.automatedLogin = false;
        perms.extractData = false;
      }

      return perms;
    }

    _checkPermission(action) {
      const perms = this._getEffectivePermissions();

      switch (action) {
        case 'click': return perms.click;
        case 'fill_and_submit': return perms.fillForms;
        case 'scroll': return perms.scroll;
        case 'navigate': return perms.navigate;
        case 'api': return perms.apiAccess;
        case 'read': return perms.readContent;
        case 'extract': return perms.extractData;
        default: return perms.click;
      }
    }

    // ── Core: Execute Action ────────────────────────────────────────────
    async execute(actionName, params = {}) {
      if (!this.rateLimiter.check()) {
        const error = { success: false, error: 'Rate limit exceeded', retryAfter: 60 };
        this.logger.log('rate_limit', { action: actionName });
        this.events.emit('error', error);
        return error;
      }

      const action = this.registry.get(actionName);
      if (!action) {
        return { success: false, error: `Action "${actionName}" not found`, available: this.registry.list().map(a => a.name) };
      }

      if (!this._checkPermission(action.trigger)) {
        return { success: false, error: `Permission denied for trigger type: ${action.trigger}`, tier: this.getEffectiveTier() };
      }

      if (action.requiresAuth && !this.authenticated) {
        return { success: false, error: 'Authentication required for this action' };
      }

      const loginRequired = this.config.restrictions.requireLoginForActions || [];
      if (loginRequired.includes(action.trigger) && !this.authenticated) {
        return { success: false, error: 'Login required for this action type' };
      }

      this.logger.log('execute', { action: actionName, params }, 'basic');
      this.events.emit('action:before', { action: actionName, params });

      try {
        let result;

        if (action.handler) {
          result = await action.handler(params);
        } else {
          switch (action.trigger) {
            case 'click':
              result = await this._executeClick(action);
              break;
            case 'fill_and_submit':
              result = await this._executeFillAndSubmit(action, params);
              break;
            case 'scroll':
              result = await this._executeScroll(action);
              break;
            case 'api':
              result = await this._executeApi(action, params);
              break;
            default:
              result = { success: false, error: `Unknown trigger: ${action.trigger}` };
          }
        }

        this.events.emit('action:after', { action: actionName, result });
        this.logger.log('execute_result', { action: actionName, success: result.success }, 'detailed');
        return result;

      } catch (err) {
        const error = { success: false, error: err.message };
        this.events.emit('error', { action: actionName, error: err.message });
        this.logger.log('execute_error', { action: actionName, error: err.message });
        return error;
      }
    }

    async _executeClick(action) {
      if (!action.selector) return { success: false, error: 'No selector defined' };
      if (!isElementAllowed(action.selector, this.config)) {
        return { success: false, error: 'Element is blocked by restrictions' };
      }

      const el = safeQuerySelector(action.selector);
      if (!el) return { success: false, error: `Element not found: ${action.selector}` };

      el.click();
      return { success: true, action: 'click', selector: action.selector };
    }

    async _executeFillAndSubmit(action, params) {
      if (!action.fields) return { success: false, error: 'No fields defined' };

      const results = [];
      for (const field of action.fields) {
        if (!isElementAllowed(field.selector, this.config)) {
          results.push({ field: field.name, success: false, error: 'Element blocked' });
          continue;
        }

        const el = safeQuerySelector(field.selector);
        if (!el) {
          results.push({ field: field.name, success: false, error: 'Element not found' });
          continue;
        }

        const value = params[field.name];
        if (value !== undefined) {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          results.push({ field: field.name, success: true });
        } else if (field.required !== false) {
          results.push({ field: field.name, success: false, error: 'Value required but not provided' });
        }
      }

      if (action.submitSelector) {
        const submitEl = safeQuerySelector(action.submitSelector);
        if (submitEl) {
          submitEl.click();
          results.push({ field: '_submit', success: true });
        }
      }

      return { success: results.every(r => r.success), results };
    }

    async _executeScroll(action) {
      if (action.selector) {
        const el = safeQuerySelector(action.selector);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { success: true, action: 'scroll', selector: action.selector };
        }
        return { success: false, error: `Element not found: ${action.selector}` };
      }
      window.scrollBy({ top: 500, behavior: 'smooth' });
      return { success: true, action: 'scroll', direction: 'down' };
    }

    async _executeApi(action, params) {
      if (this.getEffectiveTier() === 'free') {
        return { success: false, error: 'API access requires a premium subscription' };
      }

      const url = new URL(action.endpoint, location.origin);
      const options = { method: action.method || 'GET', headers: { 'Content-Type': 'application/json' } };

      if (action.method !== 'GET' && params) {
        options.body = JSON.stringify(params);
      }

      const res = await fetch(url.toString(), options);
      const data = await res.json().catch(() => null);
      return { success: res.ok, status: res.status, data };
    }

    // ── Content Reading ─────────────────────────────────────────────────
    readContent(selector) {
      if (!this._checkPermission('read')) {
        return { success: false, error: 'readContent permission denied' };
      }

      if (!isElementAllowed(selector, this.config)) {
        return { success: false, error: 'Element is blocked by restrictions' };
      }

      const el = safeQuerySelector(selector);
      if (!el) return { success: false, error: 'Element not found' };

      return {
        success: true,
        text: el.textContent.trim(),
        html: el.innerHTML,
        attributes: Object.fromEntries(
          Array.from(el.attributes).map(a => [a.name, a.value])
        )
      };
    }

    getPageInfo() {
      return {
        title: document.title,
        url: location.href,
        domain: location.hostname,
        lang: document.documentElement.lang || 'unknown',
        bridgeVersion: VERSION,
        tier: this.getEffectiveTier(),
        permissions: this._getEffectivePermissions(),
        actionsCount: this.registry.actions.size,
        rateLimitRemaining: this.rateLimiter.remaining
      };
    }

    // ── Custom Action Registration ──────────────────────────────────────
    registerAction(actionDef) {
      this.registry.register(actionDef);
      this.events.emit('action:registered', { name: actionDef.name });
      this.logger.log('register_action', { name: actionDef.name });
    }

    unregisterAction(name) {
      this.registry.unregister(name);
      this.events.emit('action:unregistered', { name });
    }

    // ── Discovery / Info ────────────────────────────────────────────────
    getActions(category) {
      if (category) return this.registry.getByCategory(category);
      return this.registry.list();
    }

    getAction(name) {
      return this.registry.get(name);
    }

    // ── Waiting Utilities for Agents ────────────────────────────────────
    waitForElement(selector, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const el = safeQuerySelector(selector);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
          const found = safeQuerySelector(selector);
          if (found) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(found);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout: element "${selector}" not found within ${timeout}ms`));
        }, timeout);
      });
    }

    waitForNavigation(timeout = 15000) {
      return new Promise((resolve) => {
        const start = location.href;
        const check = setInterval(() => {
          if (location.href !== start) {
            clearInterval(check);
            clearTimeout(timer);
            resolve({ from: start, to: location.href });
          }
        }, 200);
        const timer = setTimeout(() => {
          clearInterval(check);
          resolve({ from: start, to: start, timedOut: true });
        }, timeout);
      });
    }

    // ── Lifecycle ───────────────────────────────────────────────────────
    refresh() {
      this.registry = new ActionRegistry();
      this._autoDiscoverActions();
      this.events.emit('refresh');
      this.logger.log('refresh', {});
    }

    destroy() {
      this.events.emit('destroy');
      this.registry = new ActionRegistry();
      this.logger.clear();
      delete global.AICommands;
      delete global.WebAgentBridge;
    }

    // ── Serialization ───────────────────────────────────────────────────
    toJSON() {
      return {
        version: VERSION,
        page: this.getPageInfo(),
        actions: this.getActions()
      };
    }
  }

  // ─── Auto-initialize ──────────────────────────────────────────────────
  function autoInit() {
    const config = global.AIBridgeConfig || {};

    const scriptTag = document.currentScript || document.querySelector('script[data-wab-config]');
    if (scriptTag) {
      const dataConfig = scriptTag.getAttribute('data-config') || scriptTag.getAttribute('data-wab-config');
      if (dataConfig) {
        try {
          Object.assign(config, JSON.parse(dataConfig));
        } catch (e) {
          console.error('[WAB] Invalid data-config JSON:', e);
        }
      }
    }

    const bridge = new WebAgentBridge(config);

    global.AICommands = bridge;
    global.WebAgentBridge = WebAgentBridge;

    if (typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('wab:ready', { detail: { version: VERSION } }));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

})(typeof window !== 'undefined' ? window : globalThis);
