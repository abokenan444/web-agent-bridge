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
   * Get the WAB discovery document for the current page.
   * @returns {Promise<object>}
   */
  async discover() {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.discover');
      return result.result || result;
    }
    return this.page.evaluate(() => window.AICommands.discover());
  }

  /**
   * Ping the bridge for a health check.
   * @returns {Promise<object>}
   */
  async ping() {
    if (this.useBiDi) {
      const result = await this._bidiSend('wab.ping');
      return result.result || result;
    }
    return this.page.evaluate(() => window.AICommands.ping());
  }

  /**
   * Get BiDi context (only available when useBiDi is true).
   * @returns {Promise<object>}
   */
  async getBiDiContext() {
    return this.page.evaluate(() => window.__wab_bidi.getContext());
  }

  /**
   * Get the WAB protocol interface data.
   * @returns {Promise<object>}
   */
  async getProtocolInfo() {
    return this.page.evaluate(() => window.__wab_protocol ? {
      version: window.__wab_protocol.version,
      protocol: window.__wab_protocol.protocol,
      discovery: window.__wab_protocol.discover()
    } : null);
  }

  /** @private */
  async _bidiSend(method, params = {}) {
    const cmd = { id: ++this._biDiId, method, params };
    return this.page.evaluate((c) => window.__wab_bidi.send(c), cmd);
  }
}

module.exports = { WABAgent };
