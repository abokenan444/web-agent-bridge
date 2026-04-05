/**
 * WAB Agent SDK
 *
 * Helpers for building AI agents that interact with Web Agent Bridge.
 * Works with Puppeteer, Playwright, or any browser automation tool.
 *
 * Usage:
 *   const { WABAgent } = require('./sdk');
 *   const agent = new WABAgent(page);
 *   await agent.waitForBridge();
 *   const actions = await agent.getActions();
 *   await agent.execute('signup', { email: 'test@example.com' });
 */

class WABAgent {
  /**
   * @param {object} page — A Puppeteer or Playwright page object
   * @param {object} [options]
   * @param {number} [options.timeout=10000] — Default timeout in ms
   * @param {boolean} [options.useBiDi=false] — Use BiDi interface instead of AICommands
   */
  constructor(page, options = {}) {
    this.page = page;
    this.timeout = options.timeout || 10000;
    this.useBiDi = options.useBiDi || false;
    this._biDiId = 0;
  }

  /**
   * Wait for the WAB bridge to be ready on the page.
   * @returns {Promise<boolean>}
   */
  async waitForBridge() {
    const iface = this.useBiDi ? '__wab_bidi' : 'AICommands';
    await this.page.waitForFunction(
      (name) => typeof window[name] !== 'undefined',
      { timeout: this.timeout },
      iface
    );
    return true;
  }

  /**
   * Check if the bridge is loaded on the current page.
   * @returns {Promise<boolean>}
   */
  async hasBridge() {
    const iface = this.useBiDi ? '__wab_bidi' : 'AICommands';
    return this.page.evaluate((name) => typeof window[name] !== 'undefined', iface);
  }

  /**
   * Get all available actions.
   * @param {string} [category] — Optional category filter
   * @returns {Promise<Array>}
   */
  async getActions(category) {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.getActions', category ? { category } : {});
      return result.result || [];
    }
    return this.page.evaluate((cat) => window.AICommands.getActions(cat), category);
  }

  /**
   * Get a single action by name.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async getAction(name) {
    return this.page.evaluate((n) => window.AICommands.getAction(n), name);
  }

  /**
   * Execute an action by name.
   * @param {string} name — Action name
   * @param {object} [params] — Action parameters
   * @returns {Promise<object>}
   */
  async execute(name, params) {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.executeAction', { name, data: params || {} });
      return result.result || result;
    }
    return this.page.evaluate(
      (n, p) => window.AICommands.execute(n, p),
      name, params
    );
  }

  /**
   * Read text content of an element.
   * @param {string} selector — CSS selector
   * @returns {Promise<object>}
   */
  async readContent(selector) {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.readContent', { selector });
      return result.result || result;
    }
    return this.page.evaluate((sel) => window.AICommands.readContent(sel), selector);
  }

  /**
   * Get page info and bridge metadata.
   * @returns {Promise<object>}
   */
  async getPageInfo() {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.getPageInfo');
      return result.result || result;
    }
    return this.page.evaluate(() => window.AICommands.getPageInfo());
  }

  /**
   * Authenticate an agent with the bridge.
   * @param {string} apiKey
   * @param {object} [meta] — Agent metadata
   * @returns {Promise<object>}
   */
  async authenticate(apiKey, meta) {
    return this.page.evaluate(
      (key, m) => window.AICommands.authenticate(key, m),
      apiKey, meta
    );
  }

  /**
   * Navigate to a URL and wait for the bridge.
   * @param {string} url
   * @returns {Promise<void>}
   */
  async navigateAndWait(url) {
    await this.page.goto(url, { waitUntil: 'networkidle2' });
    await this.waitForBridge();
  }

  /**
   * Execute multiple actions in sequence.
   * @param {Array<{name: string, params?: object}>} steps
   * @returns {Promise<Array>}
   */
  async executeSteps(steps) {
    const results = [];
    for (const step of steps) {
      results.push(await this.execute(step.name, step.params));
    }
    return results;
  }

  /**
   * Get BiDi context (only available when useBiDi is true).
   * @returns {Promise<object>}
   */
  async getBiDiContext() {
    return this.page.evaluate(() => window.__wab_bidi.getContext());
  }

  /**
   * Check if the page has granted consent for agent interactions.
   * @returns {Promise<boolean>}
   */
  async hasConsent() {
    return this.page.evaluate(() => {
      if (typeof window.WABConsent !== 'undefined') return window.WABConsent.hasConsent();
      // If no consent script, treat as allowed
      return true;
    });
  }

  /**
   * Wait until consent is granted (blocks until user clicks Allow).
   * @param {number} [pollMs=500]
   * @returns {Promise<boolean>}
   */
  async waitForConsent(pollMs = 500) {
    return this.page.waitForFunction(
      () => {
        if (typeof window.WABConsent === 'undefined') return true;
        return window.WABConsent.hasConsent();
      },
      { timeout: this.timeout, polling: pollMs }
    ).then(() => true);
  }

  /**
   * Discover the page and return the list of actions.
   * Combines bridge discovery with runtime getActions().
   * @returns {Promise<object>}
   */
  async discover() {
    return this.page.evaluate(() => {
      if (window.WAB && typeof window.WAB.discover === 'function') return window.WAB.discover();
      if (window.AICommands && typeof window.AICommands.getActions === 'function') {
        return { actions: window.AICommands.getActions(), meta: window.AICommands.getPageInfo ? window.AICommands.getPageInfo() : {} };
      }
      return { actions: [] };
    });
  }

  /**
   * Run a sequence of actions, stopping on the first failure.
   * @param {Array<{name: string, params?: object}>} steps
   * @param {{ stopOnError?: boolean }} [options]
   * @returns {Promise<Array<{ name: string, ok: boolean, result?: any, error?: string }>>}
   */
  async runPipeline(steps, options = {}) {
    const stopOnError = options.stopOnError !== false;
    const results = [];
    for (const step of steps) {
      try {
        const res = await this.execute(step.name, step.params);
        results.push({ name: step.name, ok: true, result: res });
      } catch (err) {
        results.push({ name: step.name, ok: false, error: err.message || String(err) });
        if (stopOnError) break;
      }
    }
    return results;
  }

  /**
   * Execute multiple actions in parallel.
   * @param {Array<{name: string, params?: object}>} actions
   * @returns {Promise<Array<{ name: string, status: string, value?: any, reason?: string }>>}
   */
  async executeParallel(actions) {
    const promises = actions.map((a) =>
      this.execute(a.name, a.params)
        .then((value) => ({ name: a.name, status: 'fulfilled', value }))
        .catch((err) => ({ name: a.name, status: 'rejected', reason: err.message || String(err) }))
    );
    return Promise.all(promises);
  }

  /**
   * Take a screenshot and return as base64 (useful for vision agents).
   * @param {{ fullPage?: boolean }} [opts]
   * @returns {Promise<string>}
   */
  async screenshot(opts = {}) {
    const buf = await this.page.screenshot({
      encoding: 'base64',
      fullPage: opts.fullPage || false
    });
    return buf;
  }

  /** @private */
  async _bidiSend(method, params = {}) {
    const cmd = { id: ++this._biDiId, method, params };
    return this.page.evaluate((c) => window.__wab_bidi.send(c), cmd);
  }
}

const { WABMultiAgent } = require('./multi-agent');
const { WABAgentMesh } = require('./agent-mesh');

module.exports = { WABAgent, WABMultiAgent, WABAgentMesh };
