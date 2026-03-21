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

  // ─── Security Sandbox ──────────────────────────────────────────────────
  // Isolates the bridge with origin validation, session tokens, and audit log
  class SecuritySandbox {
    constructor(config) {
      this._sessionToken = this._generateToken();
      this._allowedOrigins = config.security?.allowedOrigins || [location.origin];
      this._auditLog = [];
      this._maxAuditEntries = 500;
      this._commandCounter = 0;
      this._blockedCommands = new Set();
      this._escalationAttempts = 0;
      this._maxEscalationAttempts = 5;
      this._locked = false;
    }

    _generateToken() {
      const arr = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(arr);
      } else {
        for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    get sessionToken() { return this._sessionToken; }

    validateOrigin(origin) {
      if (!origin) return this._allowedOrigins.includes(location.origin);
      return this._allowedOrigins.includes(origin);
    }

    audit(action, details, status = 'ok') {
      const entry = {
        id: ++this._commandCounter,
        timestamp: Date.now(),
        action,
        status,
        fingerprint: details?.agentId || 'anonymous'
      };
      this._auditLog.push(entry);
      if (this._auditLog.length > this._maxAuditEntries) {
        this._auditLog = this._auditLog.slice(-250);
      }
      return entry;
    }

    getAuditLog(limit = 50) {
      return this._auditLog.slice(-limit);
    }

    checkEscalation(requestedTier, currentTier) {
      const tierLevel = { free: 0, starter: 1, pro: 2, enterprise: 3 };
      if ((tierLevel[requestedTier] || 0) > (tierLevel[currentTier] || 0)) {
        this._escalationAttempts++;
        this.audit('escalation_attempt', { requestedTier, currentTier }, 'blocked');
        if (this._escalationAttempts >= this._maxEscalationAttempts) {
          this._locked = true;
          this.audit('bridge_locked', { reason: 'Too many escalation attempts' }, 'critical');
        }
        return false;
      }
      return true;
    }

    get isLocked() { return this._locked; }

    validateCommand(command) {
      if (this._locked) return { valid: false, error: 'Bridge is locked due to security violations' };
      if (typeof command !== 'object' || !command) return { valid: false, error: 'Invalid command format' };
      if (typeof command.method !== 'string') return { valid: false, error: 'Command method must be a string' };
      if (command.method.length > 200) return { valid: false, error: 'Command method too long' };
      if (this._blockedCommands.has(command.method)) return { valid: false, error: 'Command is blocked' };
      return { valid: true };
    }
  }

  // ─── Self-Healing Selectors ───────────────────────────────────────────
  // Resilient element resolution for SPAs with dynamic DOM
  class SelfHealingSelector {
    constructor() {
      this._fingerprints = new Map(); // name → element fingerprint
      this._healingStats = { healed: 0, failed: 0 };
    }

    fingerprint(el) {
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList),
        text: (el.textContent || '').trim().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || null,
        name: el.getAttribute('name') || null,
        type: el.getAttribute('type') || null,
        role: el.getAttribute('role') || null,
        dataTestId: el.getAttribute('data-testid') || null,
        dataWabId: el.getAttribute('data-wab-id') || null,
        href: el.tagName === 'A' ? el.getAttribute('href') : null,
        placeholder: el.getAttribute('placeholder') || null,
        parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : null,
        index: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : -1
      };
    }

    store(actionName, selector) {
      const el = safeQuerySelector(selector);
      if (el) {
        this._fingerprints.set(actionName, {
          selector,
          fp: this.fingerprint(el),
          storedAt: Date.now()
        });
      }
    }

    resolve(actionName, originalSelector) {
      // Try original selector first
      const el = safeQuerySelector(originalSelector);
      if (el) return { element: el, selector: originalSelector, healed: false };

      // Try self-healing
      const stored = this._fingerprints.get(actionName);
      if (!stored || !stored.fp) {
        this._healingStats.failed++;
        return null;
      }

      const healed = this._heal(stored.fp);
      if (healed) {
        this._healingStats.healed++;
        return healed;
      }

      this._healingStats.failed++;
      return null;
    }

    _heal(fp) {
      // Strategy 1: data-wab-id (most stable)
      if (fp.dataWabId) {
        const el = safeQuerySelector(`[data-wab-id="${fp.dataWabId}"]`);
        if (el) return { element: el, selector: `[data-wab-id="${fp.dataWabId}"]`, healed: true, strategy: 'data-wab-id' };
      }

      // Strategy 2: data-testid
      if (fp.dataTestId) {
        const el = safeQuerySelector(`[data-testid="${fp.dataTestId}"]`);
        if (el) return { element: el, selector: `[data-testid="${fp.dataTestId}"]`, healed: true, strategy: 'data-testid' };
      }

      // Strategy 3: id (may have changed)
      if (fp.id) {
        const el = safeQuerySelector(`#${CSS.escape(fp.id)}`);
        if (el) return { element: el, selector: `#${CSS.escape(fp.id)}`, healed: true, strategy: 'id' };
      }

      // Strategy 4: aria-label (semantic, usually stable)
      if (fp.ariaLabel) {
        const sel = `${fp.tag}[aria-label="${CSS.escape(fp.ariaLabel)}"]`;
        const el = safeQuerySelector(sel);
        if (el) return { element: el, selector: sel, healed: true, strategy: 'aria-label' };
      }

      // Strategy 5: name attribute
      if (fp.name) {
        const sel = `${fp.tag}[name="${CSS.escape(fp.name)}"]`;
        const el = safeQuerySelector(sel);
        if (el) return { element: el, selector: sel, healed: true, strategy: 'name' };
      }

      // Strategy 6: text content matching (fuzzy)
      if (fp.text && fp.text.length > 0) {
        const candidates = safeQuerySelectorAll(fp.tag);
        const target = fp.text.toLowerCase();
        let bestMatch = null;
        let bestScore = 0;

        for (const candidate of candidates) {
          const candidateText = (candidate.textContent || '').trim().toLowerCase();
          if (!candidateText) continue;

          const score = this._textSimilarity(target, candidateText);
          if (score > 0.7 && score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
          }
        }

        if (bestMatch) {
          const healedSel = this._buildSelectorFor(bestMatch);
          return { element: bestMatch, selector: healedSel, healed: true, strategy: 'text-fuzzy', confidence: bestScore };
        }
      }

      // Strategy 7: role + position heuristic
      if (fp.role && fp.parentTag) {
        const candidates = safeQuerySelectorAll(`${fp.parentTag} > ${fp.tag}[role="${fp.role}"]`);
        if (candidates.length > 0 && fp.index >= 0 && fp.index < candidates.length) {
          const el = candidates[fp.index];
          const sel = this._buildSelectorFor(el);
          return { element: el, selector: sel, healed: true, strategy: 'role-position' };
        }
      }

      return null;
    }

    _textSimilarity(a, b) {
      if (a === b) return 1;
      const longer = a.length > b.length ? a : b;
      const shorter = a.length > b.length ? b : a;
      if (longer.length === 0) return 1;
      if (longer.includes(shorter) || shorter.includes(longer)) {
        return shorter.length / longer.length;
      }
      // Simple bigram similarity
      const bigramsA = new Set();
      for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
      let matches = 0;
      for (let i = 0; i < b.length - 1; i++) {
        if (bigramsA.has(b.slice(i, i + 2))) matches++;
      }
      const total = Math.max(bigramsA.size, b.length - 1);
      return total > 0 ? matches / total : 0;
    }

    _buildSelectorFor(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.dataset.wabId) return `[data-wab-id="${el.dataset.wabId}"]`;
      const tag = el.tagName.toLowerCase();
      const attrs = ['data-testid', 'aria-label', 'name'];
      for (const attr of attrs) {
        const val = el.getAttribute(attr);
        if (val && document.querySelectorAll(`${tag}[${attr}="${CSS.escape(val)}"]`).length === 1) {
          return `${tag}[${attr}="${CSS.escape(val)}"]`;
        }
      }
      return null;
    }

    getStats() {
      return { ...this._healingStats, tracked: this._fingerprints.size };
    }
  }

  // ─── Stealth / Human-like Interaction ─────────────────────────────────
  // Makes automation interactions look natural to anti-bot systems
  const Stealth = {
    _enabled: false,

    enable() { this._enabled = true; },
    disable() { this._enabled = false; },
    get isEnabled() { return this._enabled; },

    // Random delay between min and max ms, with optional Gaussian distribution
    delay(min = 50, max = 300) {
      if (!this._enabled) return Promise.resolve();
      const duration = min + Math.floor(Math.random() * (max - min));
      return new Promise(resolve => setTimeout(resolve, duration));
    },

    // Simulate a full mouse event chain: mouseover → mouseenter → mousemove → mousedown → mouseup → click
    async simulateClick(el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
      const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
      const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

      el.dispatchEvent(new MouseEvent('mouseover', eventOpts));
      el.dispatchEvent(new MouseEvent('mouseenter', { ...eventOpts, bubbles: false }));
      await this.delay(30, 80);
      el.dispatchEvent(new MouseEvent('mousemove', eventOpts));
      await this.delay(40, 120);
      el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
      await this.delay(50, 150);
      el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
      el.dispatchEvent(new MouseEvent('click', eventOpts));
    },

    // Simulate human-like typing with variable delays
    async simulateTyping(el, text) {
      if (!el) return;
      el.focus();
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.value = '';

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.value += char;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await this.delay(30, 120); // Human typing speed: 30-120ms per key
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // Simulate natural scrolling (variable speed, easing)
    async simulateScroll(el, direction = 'down') {
      const target = el || document.documentElement;
      const distance = 300 + Math.floor(Math.random() * 400);
      const steps = 5 + Math.floor(Math.random() * 5);
      const stepSize = distance / steps;

      for (let i = 0; i < steps; i++) {
        const delta = direction === 'down' ? stepSize : -stepSize;
        if (el && el !== document.documentElement) {
          el.scrollTop += delta;
        } else {
          window.scrollBy(0, delta);
        }
        await this.delay(15, 50);
      }
    }
  };

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
      this.security = new SecuritySandbox(this.config);
      this.healer = new SelfHealingSelector();
      this.stealth = Stealth;
      this.authenticated = false;
      this.agentInfo = null;
      this._licenseVerified = null;
      this._ready = false;
      this._readyCallbacks = [];
      this._mutationObserver = null;

      // Enable stealth mode if configured
      if (this.config.stealth?.enabled) {
        this.stealth.enable();
      }

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
      this._storeFingerprints();
      this._setupSPAObserver();
      this._ready = true;
      this._readyCallbacks.forEach(cb => cb());
      this._readyCallbacks = [];
      this.events.emit('ready', { version: VERSION, tier: this.getEffectiveTier() });
      this.logger.log('init', { version: VERSION, tier: this.getEffectiveTier(), security: 'sandbox-active' });
    }

    // Store fingerprints for all discovered actions (self-healing)
    _storeFingerprints() {
      for (const action of this.registry.actions.values()) {
        if (action.selector) {
          this.healer.store(action.name, action.selector);
        }
      }
    }

    // Watch for SPA DOM changes and re-discover actions
    _setupSPAObserver() {
      if (this._mutationObserver) this._mutationObserver.disconnect();

      let debounceTimer = null;
      this._mutationObserver = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this._autoDiscoverActions();
          this._storeFingerprints();
          this.events.emit('dom:changed', { actionsCount: this.registry.actions.size });
        }, 500);
      });

      this._mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });
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
      // Security: check if bridge is locked
      if (this.security.isLocked) {
        return { success: false, error: 'Bridge locked due to security violations' };
      }

      if (!this.rateLimiter.check()) {
        const error = { success: false, error: 'Rate limit exceeded', retryAfter: 60 };
        this.logger.log('rate_limit', { action: actionName });
        this.security.audit('rate_limit', { action: actionName }, 'blocked');
        this.events.emit('error', error);
        return error;
      }

      const action = this.registry.get(actionName);
      if (!action) {
        return { success: false, error: `Action "${actionName}" not found`, available: this.registry.list().map(a => a.name) };
      }

      if (!this._checkPermission(action.trigger)) {
        this.security.audit('permission_denied', { action: actionName, trigger: action.trigger }, 'blocked');
        return { success: false, error: `Permission denied for trigger type: ${action.trigger}`, tier: this.getEffectiveTier() };
      }

      if (action.requiresAuth && !this.authenticated) {
        return { success: false, error: 'Authentication required for this action' };
      }

      const loginRequired = this.config.restrictions.requireLoginForActions || [];
      if (loginRequired.includes(action.trigger) && !this.authenticated) {
        return { success: false, error: 'Login required for this action type' };
      }

      // Self-healing: resolve selector if original is broken
      if (action.selector) {
        const resolved = this.healer.resolve(actionName, action.selector);
        if (resolved && resolved.healed) {
          action.selector = resolved.selector;
          this.logger.log('self_heal', { action: actionName, strategy: resolved.strategy, confidence: resolved.confidence }, 'detailed');
          this.events.emit('selector:healed', { action: actionName, strategy: resolved.strategy });
        }
      }

      this.logger.log('execute', { action: actionName, params }, 'basic');
      this.security.audit('execute', { action: actionName, agentId: this.agentInfo?.key });
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

      // Self-healing: try to find element even if selector is stale
      let el = safeQuerySelector(action.selector);
      if (!el) {
        const resolved = this.healer.resolve(action.name, action.selector);
        if (resolved) {
          el = resolved.element;
        } else {
          return { success: false, error: `Element not found: ${action.selector}` };
        }
      }

      // Stealth: use human-like click simulation
      if (this.stealth.isEnabled) {
        await this.stealth.delay(100, 400);
        await this.stealth.simulateClick(el);
      } else {
        el.click();
      }

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

        let el = safeQuerySelector(field.selector);
        if (!el) {
          // Self-healing: try to find field by name/placeholder
          const healedField = this.healer.resolve(`field_${field.name}`, field.selector);
          if (healedField) {
            el = healedField.element;
          } else {
            results.push({ field: field.name, success: false, error: 'Element not found' });
            continue;
          }
        }

        const value = params[field.name];
        if (value !== undefined) {
          if (this.stealth.isEnabled) {
            await this.stealth.delay(200, 600);
            await this.stealth.simulateTyping(el, String(value));
          } else {
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          results.push({ field: field.name, success: true });
        } else if (field.required !== false) {
          results.push({ field: field.name, success: false, error: 'Value required but not provided' });
        }
      }

      if (action.submitSelector) {
        let submitEl = safeQuerySelector(action.submitSelector);
        if (submitEl) {
          if (this.stealth.isEnabled) {
            await this.stealth.delay(300, 800);
            await this.stealth.simulateClick(submitEl);
          } else {
            submitEl.click();
          }
          results.push({ field: '_submit', success: true });
        }
      }

      return { success: results.every(r => r.success), results };
    }

    async _executeScroll(action) {
      if (action.selector) {
        const el = safeQuerySelector(action.selector);
        if (el) {
          if (this.stealth.isEnabled) {
            await this.stealth.simulateScroll(el);
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return { success: true, action: 'scroll', selector: action.selector };
        }
        return { success: false, error: `Element not found: ${action.selector}` };
      }
      if (this.stealth.isEnabled) {
        await this.stealth.simulateScroll(null, 'down');
      } else {
        window.scrollBy({ top: 500, behavior: 'smooth' });
      }
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
        rateLimitRemaining: this.rateLimiter.remaining,
        security: {
          sandboxActive: true,
          locked: this.security.isLocked,
          sessionToken: this.security.sessionToken
        },
        selfHealing: this.healer.getStats(),
        stealthMode: this.stealth.isEnabled
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
      this._storeFingerprints();
      this.events.emit('refresh');
      this.logger.log('refresh', {});
    }

    destroy() {
      this.events.emit('destroy');
      if (this._mutationObserver) {
        this._mutationObserver.disconnect();
        this._mutationObserver = null;
      }
      this.registry = new ActionRegistry();
      this.logger.clear();
      delete global.AICommands;
      delete global.WebAgentBridge;
      delete global.__wab_bidi;
    }

    // ── Serialization ───────────────────────────────────────────────────
    toJSON() {
      return {
        version: VERSION,
        page: this.getPageInfo(),
        actions: this.getActions()
      };
    }

    // ── WebDriver BiDi Compatibility ────────────────────────────────────
    // Exposes a standardized protocol for agents using WebDriver BiDi
    toBiDi() {
      return {
        type: 'wab:context',
        version: VERSION,
        context: {
          url: location.href,
          title: document.title,
          browsingContext: typeof window !== 'undefined' ? window.name || 'default' : 'default'
        },
        capabilities: {
          actions: this.getActions().map(a => ({
            id: a.name,
            type: a.trigger === 'click' ? 'pointerDown' : a.trigger === 'fill_and_submit' ? 'key' : a.trigger,
            description: a.description,
            parameters: a.fields ? a.fields.map(f => ({ name: f.name, type: f.type, required: f.required })) : undefined
          })),
          permissions: this._getEffectivePermissions(),
          tier: this.getEffectiveTier()
        }
      };
    }

    // Execute via BiDi-style command
    async executeBiDi(command) {
      // Security: validate command
      const validation = this.security.validateCommand(command || {});
      if (!validation.valid) {
        return { id: command?.id, error: { code: 'security error', message: validation.error } };
      }

      if (!command || !command.method) {
        return { id: command?.id, error: { code: 'invalid argument', message: 'Missing method' } };
      }

      this.security.audit('bidi_command', { method: command.method });
      const responseBase = { id: command.id || null, type: 'success' };

      switch (command.method) {
        case 'wab.getContext':
          return { ...responseBase, result: this.toBiDi() };

        case 'wab.getActions':
          return { ...responseBase, result: this.getActions(command.params?.category) };

        case 'wab.executeAction':
          if (!command.params?.name) {
            return { id: command.id, error: { code: 'invalid argument', message: 'Action name required' } };
          }
          const result = await this.execute(command.params.name, command.params.data || {});
          return { ...responseBase, result };

        case 'wab.readContent':
          if (!command.params?.selector) {
            return { id: command.id, error: { code: 'invalid argument', message: 'Selector required' } };
          }
          return { ...responseBase, result: this.readContent(command.params.selector) };

        case 'wab.getPageInfo':
          return { ...responseBase, result: this.getPageInfo() };

        default:
          return { id: command.id, error: { code: 'unknown command', message: `Unknown method: ${command.method}` } };
      }
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

    // WebDriver BiDi compatibility: expose via __wab_bidi channel
    global.__wab_bidi = {
      version: VERSION,
      send: async (command) => bridge.executeBiDi(command),
      getContext: () => bridge.toBiDi()
    };

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
