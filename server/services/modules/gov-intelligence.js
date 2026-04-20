/**
 * WAB Gov Intelligence (05-gov-intelligence) — FULLY CLOSED
 * Regulatory compliance and government intelligence database.
 * All data and logic is proprietary.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

let govEngine;
try { govEngine = require('./gov-engine'); } catch { govEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.get('/check/:domain', (req, res) => {
    if (!govEngine) return res.status(503).json({ error: 'Gov intelligence engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = govEngine.checkDomain(req.params.domain);
    res.json(result);
  });

  router.get('/regulations', (req, res) => {
    const { country, sector } = req.query;
    if (!govEngine) return res.status(503).json({ error: 'Gov intelligence engine not available', code: 'MODULE_UNAVAILABLE' });
    res.json(govEngine.getRegulations(country, sector));
  });

  router.post('/compliance-report', (req, res) => {
    const { domain, country } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain required' });
    if (!govEngine) return res.status(503).json({ error: 'Gov intelligence engine not available', code: 'MODULE_UNAVAILABLE' });
    res.json(govEngine.generateComplianceReport(domain, country));
  });

  router.get('/stats', (req, res) => {
    if (!govEngine) return res.json({ status: 'offline' });
    res.json(govEngine.getStats());
  });

  return router;
}

module.exports = { createRouter };
