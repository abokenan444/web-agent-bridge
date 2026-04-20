/**
 * WAB Affiliate Intelligence (10-affiliate-intelligence) — PUBLIC API, PRIVATE DB
 * Detects affiliate link manipulation and cookie stuffing.
 * API is open, detection database is closed.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');
const url = require('url');

const scanStore = new Map();

let affiliateDb;
try { affiliateDb = require('./affiliate-db'); } catch { affiliateDb = null; }

const KNOWN_AFFILIATE_PARAMS = ['ref', 'aff', 'affiliate', 'partner', 'utm_source', 'tag', 'associate', 'clickid', 'subid', 'irclickid', 'gclid', 'fbclid'];
const COOKIE_STUFFING_INDICATORS = ['iframe[style*="display:none"]', 'iframe[width="0"]', 'img[src*="click"]', 'img[width="1"][height="1"]'];

function createRouter(express) {
  const router = express.Router();

  router.post('/scan-url', (req, res) => {
    const { target_url } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url required' });

    try {
      const parsed = new URL(target_url);
      const affiliateParams = [];
      for (const [key, value] of parsed.searchParams) {
        if (KNOWN_AFFILIATE_PARAMS.includes(key.toLowerCase())) {
          affiliateParams.push({ param: key, value, type: 'affiliate_tracking' });
        }
      }

      const hasRedirect = /\/(click|go|redirect|track|aff|out)\//i.test(parsed.pathname);
      let manipulation = null;
      if (affiliateDb) {
        manipulation = affiliateDb.checkManipulation(target_url, affiliateParams);
      }

      const scanId = 'ASCAN-' + crypto.randomBytes(6).toString('hex').toUpperCase();
      const result = {
        scan_id: scanId, url: target_url, hostname: parsed.hostname,
        affiliate_params: affiliateParams, has_affiliate: affiliateParams.length > 0,
        has_redirect_chain: hasRedirect, manipulation_detected: manipulation,
        risk_level: affiliateParams.length > 2 ? 'HIGH' : affiliateParams.length > 0 ? 'MEDIUM' : 'LOW',
        scanned_at: new Date().toISOString(),
      };
      scanStore.set(scanId, result);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: 'Invalid URL: ' + e.message });
    }
  });

  router.post('/scan-html', (req, res) => {
    const { html, page_url } = req.body;
    if (!html) return res.status(400).json({ error: 'html content required' });

    const findings = [];
    for (const indicator of COOKIE_STUFFING_INDICATORS) {
      const tag = indicator.split('[')[0];
      const attrMatch = indicator.match(/\[([^\]]+)\]/g) || [];
      if (new RegExp(`<${tag}[^>]*${attrMatch.map(a => a.slice(1, -1).replace('*', '.*')).join('[^>]*')}`, 'gi').test(html)) {
        findings.push({ type: 'COOKIE_STUFFING', indicator, severity: 'HIGH' });
      }
    }

    const hiddenIframes = (html.match(/<iframe[^>]*(?:display\s*:\s*none|width\s*=\s*["']?0|height\s*=\s*["']?0)[^>]*>/gi) || []).length;
    const trackingPixels = (html.match(/<img[^>]*(?:width\s*=\s*["']?1["']?\s+height\s*=\s*["']?1|height\s*=\s*["']?1["']?\s+width\s*=\s*["']?1)[^>]*>/gi) || []).length;

    res.json({
      page_url: page_url || 'unknown', cookie_stuffing_indicators: findings,
      hidden_iframes: hiddenIframes, tracking_pixels: trackingPixels,
      risk_level: findings.length > 0 || hiddenIframes > 2 ? 'HIGH' : trackingPixels > 5 ? 'MEDIUM' : 'LOW',
      scanned_at: new Date().toISOString(),
    });
  });

  router.get('/stats', (req, res) => {
    let high = 0, manipulations = 0;
    for (const s of scanStore.values()) { if (s.risk_level === 'HIGH') high++; if (s.manipulation_detected) manipulations++; }
    res.json({ total_scans: scanStore.size, high_risk: high, manipulations_detected: manipulations });
  });

  return router;
}

module.exports = { createRouter };
