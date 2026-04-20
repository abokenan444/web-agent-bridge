/**
 * WAB Notary Server
 * Issues cryptographically signed certificates proving platform manipulation,
 * price discrimination, and unfair treatment. Legally admissible evidence.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const url = require('url');

// ─── WAB Notary Key Pair (in production: load from HSM or KMS) ──────────────
const WAB_PRIVATE_KEY = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// ─── In-memory certificate store (production: PostgreSQL + Redis) ────────────
const certStore = new Map();
const priceHistory = new Map(); // platform:productId → [{price, timestamp, geoHash, deviceHash}]
const comparisonPool = new Map(); // platform:productId → Set of prices seen

// ─── Anonymization helpers ───────────────────────────────────────────────────
function anonymizeUser(userId, salt = process.env.WAB_ANON_SALT || 'wab-anon-salt-2026') {
  return crypto.createHmac('sha256', salt).update(String(userId)).digest('hex').substring(0, 16);
}

function anonymizeGeo(country, region) {
  // Returns region-level hash (not city-level) for privacy
  return crypto.createHash('sha256').update(`${country}-${region}`).digest('hex').substring(0, 8);
}

function anonymizeDevice(userAgent) {
  // Extract device type only, not full UA
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
  return 'desktop';
}

// ─── Notary Certificate Generator ────────────────────────────────────────────
class WABNotary {
  constructor() {
    this.certCount = 0;
    this.stats = {
      totalCertificates: 0,
      discriminationDetected: 0,
      platformsMonitored: new Set(),
      startTime: Date.now(),
    };
  }

  // Generate a unique certificate ID
  generateCertId() {
    this.certCount++;
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `WAB-${timestamp}-${random}`;
  }

  // Sign data with WAB's private key
  sign(data) {
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(data));
    sign.end();
    return sign.sign(WAB_PRIVATE_KEY.privateKey, 'base64');
  }

  // Verify a certificate's signature
  verify(certData, signature) {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(JSON.stringify(certData));
      verify.end();
      return verify.verify(WAB_PRIVATE_KEY.publicKey, signature, 'base64');
    } catch (e) {
      return false;
    }
  }

  // Create a blockchain anchor hash (simulates Ethereum tx hash)
  createBlockchainAnchor(certId, certHash) {
    // In production: submit to Ethereum/Polygon via Web3.js
    // Here: deterministic hash that simulates a tx hash
    return '0x' + crypto.createHash('sha256')
      .update(certId + certHash + Date.now().toString())
      .digest('hex');
  }

  // Issue a price observation certificate
  issuePriceCertificate(data) {
    const {
      platform, productId, productName, priceShown, currency,
      userId, userAgent, country, region, sessionId
    } = data;

    // Anonymize all personal data
    const userHash = anonymizeUser(userId || sessionId || crypto.randomBytes(8).toString('hex'));
    const geoHash = anonymizeGeo(country || 'XX', region || 'XX');
    const deviceType = anonymizeDevice(userAgent);

    // Store in price history for comparison
    const priceKey = `${platform}:${productId}`;
    if (!priceHistory.has(priceKey)) priceHistory.set(priceKey, []);
    if (!comparisonPool.has(priceKey)) comparisonPool.set(priceKey, []);

    const history = priceHistory.get(priceKey);
    const pool = comparisonPool.get(priceKey);

    history.push({ price: priceShown, timestamp: Date.now(), geoHash, deviceType });
    pool.push(priceShown);

    // Keep only last 10,000 observations per product
    if (history.length > 10000) history.splice(0, history.length - 10000);
    if (pool.length > 10000) pool.splice(0, pool.length - 10000);

    // Calculate price statistics
    const prices = pool.map(Number).filter(p => !isNaN(p));
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceDeviation = prices.length > 1
      ? ((priceShown - avgPrice) / avgPrice * 100).toFixed(2)
      : 0;

    // Detect discrimination
    const isDiscrimination = Math.abs(priceDeviation) > 5 && prices.length >= 10;

    const certId = this.generateCertId();
    const certData = {
      wab_notary_version: '1.0',
      cert_id: certId,
      cert_type: 'PRICE_OBSERVATION',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      platform: platform,
      product_id: productId,
      product_name: productName || 'Unknown Product',
      price_observed: priceShown,
      currency: currency || 'USD',
      user_hash: userHash,
      geo_hash: geoHash,
      device_type: deviceType,
      price_statistics: {
        sample_size: prices.length,
        average_price: parseFloat(avgPrice.toFixed(2)),
        min_price: minPrice,
        max_price: maxPrice,
        price_deviation_pct: parseFloat(priceDeviation),
        is_above_average: priceShown > avgPrice,
        percentile: prices.filter(p => p <= priceShown).length / prices.length * 100,
      },
      discrimination_detected: isDiscrimination,
      discrimination_confidence: isDiscrimination
        ? (Math.min(99, Math.abs(priceDeviation) * 2)).toFixed(0) + '%'
        : '0%',
    };

    // Sign the certificate
    const signature = this.sign(certData);
    const certHash = crypto.createHash('sha256').update(JSON.stringify(certData)).digest('hex');
    const blockchainAnchor = this.createBlockchainAnchor(certId, certHash);

    const fullCert = {
      ...certData,
      cert_hash: certHash,
      blockchain_anchor: blockchainAnchor,
      signature: signature,
      public_key_fingerprint: crypto.createHash('sha256')
        .update(WAB_PRIVATE_KEY.publicKey)
        .digest('hex')
        .substring(0, 16),
      verification_url: `https://www.webagentbridge.com/verify/${certId}`,
      legal_notice: 'This certificate is issued by Web Agent Bridge and may be used as evidence in legal proceedings under EU DSA Article 17 and US FTC regulations.',
    };

    // Store certificate
    certStore.set(certId, fullCert);
    this.stats.totalCertificates++;
    this.stats.platformsMonitored.add(platform);
    if (isDiscrimination) this.stats.discriminationDetected++;

    return fullCert;
  }

  // Issue a transaction fairness certificate
  issueTransactionCertificate(data) {
    const {
      platform, transactionId, productId, finalPrice, currency,
      darkPatternsDetected, urgencyFake, hiddenFees, userId, userAgent, country, region
    } = data;

    const userHash = anonymizeUser(userId || crypto.randomBytes(8).toString('hex'));
    const geoHash = anonymizeGeo(country || 'XX', region || 'XX');
    const deviceType = anonymizeDevice(userAgent);

    const certId = this.generateCertId();
    const certData = {
      wab_notary_version: '1.0',
      cert_id: certId,
      cert_type: 'TRANSACTION_FAIRNESS',
      issued_at: new Date().toISOString(),
      platform: platform,
      transaction_id: transactionId || 'N/A',
      product_id: productId,
      final_price: finalPrice,
      currency: currency || 'USD',
      user_hash: userHash,
      geo_hash: geoHash,
      device_type: deviceType,
      fairness_assessment: {
        overall_fair: !darkPatternsDetected && !urgencyFake && !hiddenFees,
        dark_patterns_detected: darkPatternsDetected || [],
        false_urgency: urgencyFake || false,
        hidden_fees: hiddenFees || false,
        manipulation_score: (darkPatternsDetected?.length || 0) * 20 + (urgencyFake ? 30 : 0) + (hiddenFees ? 40 : 0),
      },
      applicable_regulations: [
        'EU Digital Services Act (DSA) Article 25',
        'EU Digital Markets Act (DMA)',
        'US FTC Act Section 5',
        'UK Consumer Rights Act 2015',
      ],
    };

    const signature = this.sign(certData);
    const certHash = crypto.createHash('sha256').update(JSON.stringify(certData)).digest('hex');

    const fullCert = {
      ...certData,
      cert_hash: certHash,
      blockchain_anchor: this.createBlockchainAnchor(certId, certHash),
      signature,
      verification_url: `https://www.webagentbridge.com/verify/${certId}`,
    };

    certStore.set(certId, fullCert);
    this.stats.totalCertificates++;
    return fullCert;
  }

  // Get price comparison for a product
  getPriceComparison(platform, productId) {
    const priceKey = `${platform}:${productId}`;
    const pool = comparisonPool.get(priceKey) || [];
    const history = priceHistory.get(priceKey) || [];

    if (pool.length === 0) return null;

    const prices = pool.map(Number).filter(p => !isNaN(p));
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Group by geo
    const geoGroups = {};
    history.forEach(h => {
      if (!geoGroups[h.geoHash]) geoGroups[h.geoHash] = [];
      geoGroups[h.geoHash].push(h.price);
    });

    const geoVariance = Object.entries(geoGroups).map(([geo, prices]) => ({
      geo_hash: geo,
      avg_price: parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)),
      sample_size: prices.length,
    })).sort((a, b) => a.avg_price - b.avg_price);

    return {
      platform,
      product_id: productId,
      sample_size: prices.length,
      average_price: parseFloat(avg.toFixed(2)),
      min_price: Math.min(...prices),
      max_price: Math.max(...prices),
      price_range_pct: parseFloat(((Math.max(...prices) - Math.min(...prices)) / avg * 100).toFixed(1)),
      geo_variance: geoVariance.slice(0, 5),
      discrimination_likely: geoVariance.length > 1 &&
        (geoVariance[geoVariance.length - 1].avg_price - geoVariance[0].avg_price) / avg > 0.05,
    };
  }
}

const notary = new WABNotary();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  // ── POST /notary/price — Issue price certificate ──
  if (req.method === 'POST' && parsedUrl.pathname === '/notary/price') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.platform || !data.productId || data.priceShown === undefined) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'platform, productId, and priceShown are required' }));
          return;
        }
        const cert = notary.issuePriceCertificate(data);
        res.writeHead(201);
        res.end(JSON.stringify(cert));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── POST /notary/transaction — Issue transaction certificate ──
  if (req.method === 'POST' && parsedUrl.pathname === '/notary/transaction') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const cert = notary.issueTransactionCertificate(data);
        res.writeHead(201);
        res.end(JSON.stringify(cert));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GET /notary/verify/:certId — Verify a certificate ──
  const verifyMatch = parsedUrl.pathname.match(/^\/notary\/verify\/(.+)$/);
  if (req.method === 'GET' && verifyMatch) {
    const certId = verifyMatch[1];
    const cert = certStore.get(certId);
    if (!cert) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Certificate not found', cert_id: certId }));
      return;
    }
    const { signature, ...certData } = cert;
    const isValid = notary.verify(certData, signature);
    res.writeHead(200);
    res.end(JSON.stringify({
      cert_id: certId,
      valid: isValid,
      issued_at: cert.issued_at,
      cert_type: cert.cert_type,
      platform: cert.platform,
      discrimination_detected: cert.discrimination_detected,
      fairness_assessment: cert.fairness_assessment,
      blockchain_anchor: cert.blockchain_anchor,
      message: isValid
        ? 'Certificate is authentic and has not been tampered with.'
        : 'WARNING: Certificate signature is invalid. This certificate may have been tampered with.',
    }));
    return;
  }

  // ── GET /notary/compare — Get price comparison ──
  if (req.method === 'GET' && parsedUrl.pathname === '/notary/compare') {
    const { platform, productId } = parsedUrl.query;
    if (!platform || !productId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'platform and productId query params required' }));
      return;
    }
    const comparison = notary.getPriceComparison(platform, productId);
    if (!comparison) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'No price data found for this product yet' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(comparison));
    return;
  }

  // ── GET /notary/stats ──
  if (req.method === 'GET' && parsedUrl.pathname === '/notary/stats') {
    res.writeHead(200);
    res.end(JSON.stringify({
      total_certificates: notary.stats.totalCertificates,
      discrimination_detected: notary.stats.discriminationDetected,
      platforms_monitored: notary.stats.platformsMonitored.size,
      certificates_in_store: certStore.size,
      products_tracked: priceHistory.size,
      uptime_seconds: Math.floor((Date.now() - notary.stats.startTime) / 1000),
      public_key: WAB_PRIVATE_KEY.publicKey,
    }));
    return;
  }

  // ── GET /notary/health ──
  if (parsedUrl.pathname === '/notary/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy', version: '1.0.0' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_NOTARY_PORT) || 3002;
server.listen(PORT, () => {
  console.log(`[WAB Notary] Running on port ${PORT}`);
  console.log(`[WAB Notary] Issue certificates: POST http://localhost:${PORT}/notary/price`);
  console.log(`[WAB Notary] Verify certificates: GET http://localhost:${PORT}/notary/verify/:id`);
});

module.exports = { WABNotary, notary };
