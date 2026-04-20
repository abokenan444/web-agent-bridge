/**
 * WAB Notary (02-notary) — FULLY CLOSED
 * Cryptographic certificate system for price discrimination evidence.
 * Signing algorithm is proprietary.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

let notaryEngine;
try { notaryEngine = require('./notary-engine'); } catch { notaryEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/price', (req, res) => {
    const { platform, productId, priceShown } = req.body;
    if (!platform || !productId || priceShown === undefined) {
      return res.status(400).json({ error: 'platform, productId, and priceShown required' });
    }
    if (!notaryEngine) return res.status(503).json({ error: 'Notary engine not available', code: 'MODULE_UNAVAILABLE' });
    const cert = notaryEngine.issuePriceCertificate(req.body);
    res.status(201).json(cert);
  });

  router.post('/transaction', (req, res) => {
    if (!notaryEngine) return res.status(503).json({ error: 'Notary engine not available', code: 'MODULE_UNAVAILABLE' });
    const cert = notaryEngine.issueTransactionCertificate(req.body);
    res.status(201).json(cert);
  });

  router.get('/verify/:certId', (req, res) => {
    if (!notaryEngine) return res.status(503).json({ error: 'Notary engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = notaryEngine.verifyCertificate(req.params.certId);
    if (!result) return res.status(404).json({ error: 'Certificate not found' });
    res.json(result);
  });

  router.get('/stats', (req, res) => {
    if (!notaryEngine) return res.json({ status: 'offline' });
    res.json(notaryEngine.getStats());
  });

  return router;
}

module.exports = { createRouter };
