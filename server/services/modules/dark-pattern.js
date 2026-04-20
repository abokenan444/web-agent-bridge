/**
 * WAB Dark Pattern Detector (03-dark-pattern) — FULLY CLOSED
 * DSA compliance engine detects all 17 OECD dark patterns.
 * All detection rules are proprietary.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

let darkPatternEngine;
try { darkPatternEngine = require('./dark-pattern-engine'); } catch { darkPatternEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/audit', async (req, res) => {
    const { url: targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: 'url required' });
    if (!darkPatternEngine) return res.status(503).json({ error: 'Dark pattern engine not available', code: 'MODULE_UNAVAILABLE' });
    try {
      const report = await darkPatternEngine.generateReport(targetUrl);
      res.json(report);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/scan', (req, res) => {
    const { html, page_url } = req.body;
    if (!html) return res.status(400).json({ error: 'html content required' });
    if (!darkPatternEngine) return res.status(503).json({ error: 'Dark pattern engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = darkPatternEngine.scanContent(html, page_url);
    res.json(result);
  });

  router.get('/patterns', (req, res) => {
    res.json({ total: 17, categories: [
      { id: 'DP001', name: 'False Urgency', severity: 'HIGH', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP002', name: 'Scarcity Manipulation', severity: 'HIGH', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP003', name: 'Hidden Costs', severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)' },
      { id: 'DP004', name: 'Trick Question', severity: 'HIGH', dsa_article: 'Article 25(1)(c)' },
      { id: 'DP005', name: 'Roach Motel', severity: 'CRITICAL', dsa_article: 'Article 25(1)(d)' },
      { id: 'DP006', name: 'Confirmshaming', severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP007', name: 'Forced Continuity', severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)' },
      { id: 'DP008', name: 'Misdirection', severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP009', name: 'Disguised Ads', severity: 'HIGH', dsa_article: 'Article 26' },
      { id: 'DP010', name: 'Nagging', severity: 'LOW', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP011', name: 'Basket Sneaking', severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)' },
      { id: 'DP012', name: 'Bait and Switch', severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)' },
      { id: 'DP013', name: 'Privacy Zuckering', severity: 'HIGH', dsa_article: 'Article 25(1)(c)' },
      { id: 'DP014', name: 'Fake Social Proof', severity: 'HIGH', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP015', name: 'Interface Interference', severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)' },
      { id: 'DP016', name: 'Drip Pricing', severity: 'HIGH', dsa_article: 'Article 25(1)(b)' },
      { id: 'DP017', name: 'Disguised Subscription', severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)' },
    ]});
  });

  router.get('/stats', (req, res) => {
    if (!darkPatternEngine) return res.json({ status: 'engine_not_loaded', patterns_tracked: 17 });
    res.json(darkPatternEngine.getStats());
  });

  return router;
}

module.exports = { createRouter };
