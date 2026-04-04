/**
 * WABMultiAgent — Cross-Site Agent Orchestration
 *
 * Manages multiple WAB sessions across different domains simultaneously.
 * One agent, many sites — compare prices, aggregate data, run parallel actions.
 *
 * @example
 *   const { WABMultiAgent } = require('web-agent-bridge-sdk/multi-agent');
 *   const multi = new WABMultiAgent([
 *     'https://site1.com',
 *     'https://site2.com',
 *     'https://site3.com'
 *   ]);
 *   await multi.launch();
 *   const comparison = await multi.comparePrices('laptop-sku-123');
 *   console.log(comparison.cheapest);  // { site, price, currency }
 *   await multi.close();
 */

const { WABAgent } = require('./index');

class WABMultiAgent {
  /**
   * @param {string[]} sites — Array of URLs
   * @param {object} [options]
   * @param {number} [options.timeout=15000] — Per-site timeout
   * @param {boolean} [options.headless=true] — Launch headless browsers
   * @param {object} [options.launchOptions] — Puppeteer launch options
   * @param {boolean} [options.useBiDi=false] — Use BiDi protocol
   */
  constructor(sites, options = {}) {
    if (!Array.isArray(sites) || sites.length === 0) {
      throw new Error('WABMultiAgent requires at least one site URL');
    }
    this.sites = sites;
    this.timeout = options.timeout || 15000;
    this.headless = options.headless !== false;
    this.launchOptions = options.launchOptions || {};
    this.useBiDi = options.useBiDi || false;
    this._sessions = []; // { url, browser, page, agent }
    this._launched = false;
  }

  /**
   * Launch browsers and connect to all sites.
   * Creates a separate browser context per site for isolation.
   * @returns {Promise<{ connected: string[], failed: string[] }>}
   */
  async launch() {
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch {
      throw new Error('puppeteer is required: npm install puppeteer');
    }

    const connected = [];
    const failed = [];

    const results = await Promise.allSettled(
      this.sites.map(async (url) => {
        const browser = await puppeteer.launch({
          headless: this.headless ? 'new' : false,
          ...this.launchOptions
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: this.timeout });

        const agent = new WABAgent(page, {
          timeout: this.timeout,
          useBiDi: this.useBiDi
        });

        const hasBridge = await agent.hasBridge();
        if (!hasBridge) {
          await browser.close();
          throw new Error(`No WAB bridge found on ${url}`);
        }

        return { url, browser, page, agent };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        this._sessions.push(r.value);
        connected.push(r.value.url);
      } else {
        const urlMatch = r.reason.message.match(/on (.+)$/);
        failed.push(urlMatch ? urlMatch[1] : r.reason.message);
      }
    }

    this._launched = true;
    return { connected, failed };
  }

  /**
   * Discover all sites — return actions and metadata per site.
   * @returns {Promise<Array<{ site: string, actions: Array, meta: object, error?: string }>>}
   */
  async discoverAll() {
    this._ensureLaunched();
    return Promise.all(
      this._sessions.map(async (s) => {
        try {
          const discovery = await s.agent.discover();
          return { site: s.url, actions: discovery.actions || [], meta: discovery.meta || {} };
        } catch (err) {
          return { site: s.url, actions: [], meta: {}, error: err.message };
        }
      })
    );
  }

  /**
   * Execute an action on all connected sites in parallel.
   * @param {string} actionName
   * @param {object} [params]
   * @returns {Promise<Array<{ site: string, status: string, value?: any, error?: string }>>}
   */
  async executeAll(actionName, params) {
    this._ensureLaunched();
    return Promise.all(
      this._sessions.map(async (s) => {
        try {
          const result = await s.agent.execute(actionName, params);
          return { site: s.url, status: 'fulfilled', value: result };
        } catch (err) {
          return { site: s.url, status: 'rejected', error: err.message };
        }
      })
    );
  }

  /**
   * Compare prices for a product across all sites.
   * Queries each site via WAB getOfferPrice / getProductFromSchema actions,
   * and falls back to schema.org JSON-LD extraction from page HTML.
   *
   * @param {string} sku — Product SKU or identifier
   * @returns {Promise<{
   *   results: Array<{ site: string, product?: string, price?: number, currency?: string, error?: string }>,
   *   cheapest: { site: string, product?: string, price: number, currency: string } | null,
   *   savings: number | null
   * }>}
   */
  async comparePrices(sku) {
    this._ensureLaunched();
    const { extractProductsFromHtml } = require('./schema-discovery');

    const results = await Promise.all(
      this._sessions.map(async (s) => {
        try {
          // Strategy 1: Try WAB getOfferPrice action
          const hasAction = await s.page.evaluate((name) => {
            if (window.AICommands && typeof window.AICommands.getAction === 'function') {
              return !!window.AICommands.getAction(name);
            }
            return false;
          }, 'getOfferPrice');

          if (hasAction) {
            const offer = await s.agent.execute('getOfferPrice', { sku });
            if (offer && offer.price != null) {
              return {
                site: s.url,
                product: offer.name || sku,
                price: parseFloat(offer.price),
                currency: offer.currency || offer.priceCurrency || 'USD'
              };
            }
          }

          // Strategy 2: Extract from schema.org JSON-LD in page HTML
          const html = await s.page.content();
          const products = extractProductsFromHtml(html);

          // Find product matching the SKU (or take first one)
          const match = products.find((p) => p.sku === sku) || products[0];
          if (match && match.offers) {
            const offer = Array.isArray(match.offers) ? match.offers[0] : match.offers;
            const price = parseFloat(offer.price || offer.lowPrice || 0);
            if (price > 0) {
              return {
                site: s.url,
                product: match.name || sku,
                price,
                currency: offer.priceCurrency || 'USD'
              };
            }
          }

          // Strategy 3: Try generic getProductInfo action
          try {
            const pInfo = await s.agent.execute('getProductInfo', { sku });
            if (pInfo && pInfo.price != null) {
              return {
                site: s.url,
                product: pInfo.name || sku,
                price: parseFloat(pInfo.price),
                currency: pInfo.currency || 'USD'
              };
            }
          } catch {
            // action not available — that's fine
          }

          return { site: s.url, error: 'No price data found' };
        } catch (err) {
          return { site: s.url, error: err.message };
        }
      })
    );

    // Find cheapest
    const priced = results.filter((r) => r.price != null);
    let cheapest = null;
    let savings = null;

    if (priced.length > 0) {
      priced.sort((a, b) => a.price - b.price);
      cheapest = priced[0];

      if (priced.length >= 2) {
        savings = priced[priced.length - 1].price - priced[0].price;
      }
    }

    return { results, cheapest, savings };
  }

  /**
   * Compare a specific action result across all sites.
   * @param {string} actionName
   * @param {object} [params]
   * @param {function} [rankFn] — Custom ranking function, receives array of results, returns sorted
   * @returns {Promise<{ results: Array, ranked: Array }>}
   */
  async compareAction(actionName, params, rankFn) {
    const results = await this.executeAll(actionName, params);
    const successful = results.filter((r) => r.status === 'fulfilled');
    const ranked = rankFn ? rankFn(successful) : successful;
    return { results, ranked };
  }

  /**
   * Navigate all sessions to a new path (keeps each domain).
   * @param {string} path — e.g. '/products/laptop'
   * @returns {Promise<Array<{ site: string, ok: boolean, error?: string }>>}
   */
  async navigateAll(path) {
    this._ensureLaunched();
    return Promise.all(
      this._sessions.map(async (s) => {
        try {
          const url = new URL(path, s.url).href;
          await s.agent.navigateAndWait(url);
          return { site: s.url, ok: true };
        } catch (err) {
          return { site: s.url, ok: false, error: err.message };
        }
      })
    );
  }

  /**
   * Take screenshots from all sites (useful for vision verification).
   * @param {{ fullPage?: boolean }} [opts]
   * @returns {Promise<Array<{ site: string, screenshot?: string, error?: string }>>}
   */
  async screenshotAll(opts = {}) {
    this._ensureLaunched();
    return Promise.all(
      this._sessions.map(async (s) => {
        try {
          const screenshot = await s.agent.screenshot(opts);
          return { site: s.url, screenshot };
        } catch (err) {
          return { site: s.url, error: err.message };
        }
      })
    );
  }

  /**
   * Get a summary of all sessions.
   * @returns {{ total: number, connected: string[] }}
   */
  status() {
    return {
      total: this.sites.length,
      connected: this._sessions.map((s) => s.url)
    };
  }

  /**
   * Close all browser sessions.
   * @returns {Promise<void>}
   */
  async close() {
    const closings = this._sessions.map((s) =>
      s.browser.close().catch(() => {})
    );
    await Promise.all(closings);
    this._sessions = [];
    this._launched = false;
  }

  /** @private */
  _ensureLaunched() {
    if (!this._launched || this._sessions.length === 0) {
      throw new Error('Call launch() before using WABMultiAgent');
    }
  }
}

module.exports = { WABMultiAgent };
