/**
 * WAB Agent Firewall — Backend Proxy Server
 * Intercepts all AI agent HTTP requests, strips prompt injections,
 * detects manipulation, and returns clean responses.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');
const EventEmitter = require('events');

// ─── Threat Intelligence Database (in-memory, syncs with WAB API) ──────────
const THREAT_DB = {
  // Known prompt injection patterns
  promptInjections: [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /you\s+are\s+now\s+in\s+developer\s+mode/gi,
    /disregard\s+(your\s+)?(prior\s+|previous\s+)?instructions/gi,
    /\[SYSTEM\].*override/gi,
    /<!--.*?inject.*?-->/gi,
    /<\s*script[^>]*>.*?<\/\s*script\s*>/gis,
    /\bact\s+as\s+(a\s+)?(?:jailbreak|dan|evil|unrestricted)/gi,
    /transfer\s+\$?\d+.*?to\s+(?:wallet|account|address)/gi,
    /send\s+(?:all\s+)?(?:my\s+)?(?:funds|money|crypto|bitcoin)/gi,
    /click\s+(?:the\s+)?(?:confirm|approve|authorize)\s+button/gi,
    /\bpassword\s*[:=]\s*\S+/gi,
    /\bapikey\s*[:=]\s*\S+/gi,
    /data:text\/html.*base64/gi,
    /javascript:void/gi,
    /\bonmouseover\s*=/gi,
  ],

  // Dark pattern HTML signatures
  darkPatterns: [
    { pattern: /countdown.*timer.*(?:expires|limited)/gi, type: 'FALSE_URGENCY', severity: 'HIGH' },
    { pattern: /only\s+\d+\s+left\s+in\s+stock/gi, type: 'SCARCITY_MANIPULATION', severity: 'MEDIUM' },
    { pattern: /pre-?checked.*(?:newsletter|subscription|marketing)/gi, type: 'TRICK_QUESTION', severity: 'HIGH' },
    { pattern: /(?:unsubscribe|cancel|opt.out)\s+is\s+(?:hard|difficult|complex)/gi, type: 'ROACH_MOTEL', severity: 'HIGH' },
    { pattern: /(?:free\s+trial|no\s+credit\s+card).*(?:automatically\s+charges|will\s+be\s+billed)/gi, type: 'HIDDEN_SUBSCRIPTION', severity: 'CRITICAL' },
    { pattern: /confirm\s+shaming/gi, type: 'CONFIRMSHAMING', severity: 'MEDIUM' },
    { pattern: /no\s+thanks.*(?:i\s+don.t\s+want|i\s+hate)/gi, type: 'CONFIRMSHAMING', severity: 'MEDIUM' },
    { pattern: /(?:price\s+shown|displayed\s+price).*(?:excludes|before\s+tax|plus\s+fees)/gi, type: 'HIDDEN_COSTS', severity: 'HIGH' },
    { pattern: /\b(?:bait|switch)\b/gi, type: 'BAIT_AND_SWITCH', severity: 'CRITICAL' },
    { pattern: /forced\s+(?:continuity|subscription|renewal)/gi, type: 'FORCED_CONTINUITY', severity: 'CRITICAL' },
  ],

  // Malicious domains (loaded from WAB threat feed)
  maliciousDomains: new Set([
    'paypa1.com', 'amaz0n.com', 'g00gle.com', 'faceb00k.com',
    'secure-paypal-login.com', 'amazon-security-alert.com',
    'apple-id-verify.net', 'microsoft-support-alert.com',
  ]),
};

// ─── Firewall Engine ─────────────────────────────────────────────────────────
class WABFirewall extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 8888,
      wabApiUrl: config.wabApiUrl || 'https://www.webagentbridge.com/api',
      blockOnInjection: config.blockOnInjection !== false,
      blockOnMaliciousDomain: config.blockOnMaliciousDomain !== false,
      stripInjections: config.stripInjections !== false,
      logLevel: config.logLevel || 'info',
      maxResponseSize: config.maxResponseSize || 10 * 1024 * 1024, // 10MB
    };
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      injectionStripped: 0,
      darkPatternsDetected: 0,
      maliciousDomainsBlocked: 0,
      cleanRequests: 0,
      startTime: Date.now(),
    };
    this.requestLog = [];
  }

  // ── Analyze a URL for threats ──
  analyzeUrl(targetUrl) {
    const threats = [];
    try {
      const parsed = url.parse(targetUrl);
      const hostname = (parsed.hostname || '').toLowerCase();

      // Check malicious domain
      if (THREAT_DB.maliciousDomains.has(hostname)) {
        threats.push({ type: 'MALICIOUS_DOMAIN', severity: 'CRITICAL', detail: hostname });
      }

      // Check for homograph attacks (unicode lookalikes)
      if (/[^\x00-\x7F]/.test(hostname)) {
        threats.push({ type: 'HOMOGRAPH_ATTACK', severity: 'HIGH', detail: hostname });
      }

      // Check for suspicious URL patterns
      if (/(?:login|signin|account|secure|verify|update|confirm).*(?:paypal|amazon|apple|google|microsoft|bank)/i.test(targetUrl)) {
        const domainParts = hostname.split('.');
        const knownBrands = ['paypal', 'amazon', 'apple', 'google', 'microsoft'];
        const isFake = knownBrands.some(brand =>
          targetUrl.toLowerCase().includes(brand) &&
          !hostname.endsWith(brand + '.com') &&
          !hostname.endsWith(brand + '.net')
        );
        if (isFake) {
          threats.push({ type: 'PHISHING_URL', severity: 'CRITICAL', detail: targetUrl });
        }
      }

      // Check for data exfiltration patterns
      if (/(?:password|passwd|token|apikey|secret|credential)=/i.test(targetUrl)) {
        threats.push({ type: 'DATA_EXFILTRATION', severity: 'HIGH', detail: 'Sensitive params in URL' });
      }
    } catch (e) {
      threats.push({ type: 'INVALID_URL', severity: 'LOW', detail: e.message });
    }
    return threats;
  }

  // ── Scan HTML/text content for prompt injections ──
  scanContent(content, contentType = 'text/html') {
    const findings = {
      injections: [],
      darkPatterns: [],
      riskScore: 0,
      sanitized: content,
    };

    if (!content || typeof content !== 'string') return findings;

    // Scan for prompt injections
    for (const pattern of THREAT_DB.promptInjections) {
      const matches = content.match(pattern);
      if (matches) {
        findings.injections.push({
          pattern: pattern.toString(),
          matches: matches.slice(0, 3),
          count: matches.length,
        });
        findings.riskScore += 30;
        // Strip the injection
        if (this.config.stripInjections) {
          findings.sanitized = findings.sanitized.replace(pattern, '[WAB_BLOCKED]');
        }
      }
    }

    // Scan for dark patterns (only in HTML)
    if (contentType.includes('html') || contentType.includes('text')) {
      for (const dp of THREAT_DB.darkPatterns) {
        if (dp.pattern.test(content)) {
          findings.darkPatterns.push({
            type: dp.type,
            severity: dp.severity,
          });
          const severityScore = { LOW: 5, MEDIUM: 15, HIGH: 25, CRITICAL: 40 };
          findings.riskScore += severityScore[dp.severity] || 10;
        }
      }
    }

    // Cap risk score at 100
    findings.riskScore = Math.min(100, findings.riskScore);
    return findings;
  }

  // ── Generate a WAB Firewall Certificate for the request ──
  generateCertificate(requestData, scanResult) {
    const cert = {
      wab_firewall_cert: 'v1',
      request_id: crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      target_url: requestData.url,
      agent_id: requestData.agentId || 'unknown',
      verdict: scanResult.blocked ? 'BLOCKED' : scanResult.riskScore > 50 ? 'WARNING' : 'CLEAN',
      risk_score: scanResult.riskScore,
      threats_found: [
        ...scanResult.urlThreats.map(t => t.type),
        ...scanResult.injections.map(i => 'PROMPT_INJECTION'),
        ...scanResult.darkPatterns.map(d => d.type),
      ],
      injections_stripped: scanResult.injections.length,
      dark_patterns: scanResult.darkPatterns.length,
      processing_time_ms: scanResult.processingTime,
    };
    cert.signature = crypto
      .createHmac('sha256', process.env.WAB_SECRET || 'wab-firewall-secret-key')
      .update(JSON.stringify({ id: cert.request_id, url: cert.target_url, verdict: cert.verdict }))
      .digest('hex');
    return cert;
  }

  // ── Main proxy handler ──
  async handleRequest(req, res) {
    const startTime = Date.now();
    this.stats.totalRequests++;

    // Parse target URL from request
    const targetUrl = req.url.startsWith('http')
      ? req.url
      : `https:/${req.url}`;

    const agentId = req.headers['x-wab-agent-id'] || req.headers['user-agent'] || 'unknown';
    const requestId = crypto.randomBytes(8).toString('hex');

    // CORS headers for browser-based agents
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-WAB-Agent-ID');
    res.setHeader('X-WAB-Request-ID', requestId);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Step 1: URL Analysis ──
    const urlThreats = this.analyzeUrl(targetUrl);
    const criticalUrlThreat = urlThreats.find(t => t.severity === 'CRITICAL');

    if (criticalUrlThreat && this.config.blockOnMaliciousDomain) {
      this.stats.blockedRequests++;
      this.stats.maliciousDomainsBlocked++;
      const cert = this.generateCertificate(
        { url: targetUrl, agentId },
        { blocked: true, riskScore: 100, urlThreats, injections: [], darkPatterns: [], processingTime: Date.now() - startTime }
      );
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        wab_blocked: true,
        reason: criticalUrlThreat.type,
        detail: criticalUrlThreat.detail,
        certificate: cert,
        message: 'WAB Agent Firewall blocked this request. Threat detected in URL.',
      }));
      this.emit('blocked', { url: targetUrl, reason: criticalUrlThreat.type, agentId });
      return;
    }

    // ── Step 2: Proxy the request ──
    try {
      const parsedTarget = url.parse(targetUrl);
      const protocol = parsedTarget.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
        path: parsedTarget.path || '/',
        method: req.method,
        headers: {
          ...req.headers,
          host: parsedTarget.hostname,
          'x-forwarded-for': req.socket.remoteAddress,
          'x-wab-firewall': 'v1',
        },
        timeout: 15000,
      };

      // Remove proxy-specific headers
      delete options.headers['proxy-connection'];
      delete options.headers['x-wab-agent-id'];

      const proxyReq = protocol.request(options, (proxyRes) => {
        let body = '';
        const contentType = proxyRes.headers['content-type'] || '';
        const isTextContent = contentType.includes('text') ||
          contentType.includes('html') ||
          contentType.includes('json') ||
          contentType.includes('javascript');

        if (!isTextContent) {
          // Binary content — pass through without scanning
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
          this.stats.cleanRequests++;
          return;
        }

        proxyRes.on('data', chunk => {
          body += chunk.toString();
          if (body.length > this.config.maxResponseSize) {
            proxyReq.abort();
            res.writeHead(413);
            res.end('Response too large for WAB scanning');
          }
        });

        proxyRes.on('end', () => {
          // ── Step 3: Content Scanning ──
          const scanResult = this.scanContent(body, contentType);
          scanResult.urlThreats = urlThreats;
          scanResult.processingTime = Date.now() - startTime;

          if (scanResult.injections.length > 0) {
            this.stats.injectionStripped += scanResult.injections.length;
            this.emit('injection_stripped', {
              url: targetUrl,
              count: scanResult.injections.length,
              agentId,
            });
          }

          if (scanResult.darkPatterns.length > 0) {
            this.stats.darkPatternsDetected += scanResult.darkPatterns.length;
          }

          // ── Step 4: Generate Certificate ──
          const cert = this.generateCertificate(
            { url: targetUrl, agentId },
            { ...scanResult, blocked: false }
          );

          // ── Step 5: Return sanitized response ──
          const responseHeaders = {
            ...proxyRes.headers,
            'x-wab-firewall': 'v1',
            'x-wab-risk-score': String(scanResult.riskScore),
            'x-wab-verdict': cert.verdict,
            'x-wab-cert-id': cert.request_id,
            'x-wab-injections-stripped': String(scanResult.injections.length),
            'x-wab-dark-patterns': String(scanResult.darkPatterns.length),
          };

          // Inject WAB metadata into HTML responses
          let finalBody = scanResult.sanitized;
          if (contentType.includes('html') && scanResult.riskScore > 0) {
            const wabBanner = `
<!-- WAB Agent Firewall Report -->
<script>
window.__WAB_FIREWALL__ = ${JSON.stringify({
  verdict: cert.verdict,
  riskScore: scanResult.riskScore,
  threatsFound: cert.threats_found,
  injectionsStripped: cert.injections_stripped,
  darkPatterns: cert.dark_patterns,
  certId: cert.request_id,
})};
</script>`;
            finalBody = finalBody.replace('</head>', wabBanner + '</head>');
          }

          res.writeHead(proxyRes.statusCode, responseHeaders);
          res.end(finalBody);

          // Log the request
          this.logRequest({
            id: requestId,
            timestamp: new Date().toISOString(),
            url: targetUrl,
            agentId,
            verdict: cert.verdict,
            riskScore: scanResult.riskScore,
            threats: cert.threats_found,
            processingTime: scanResult.processingTime,
          });

          if (scanResult.riskScore === 0) this.stats.cleanRequests++;
        });
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ wab_error: true, message: err.message }));
      });

      proxyReq.on('timeout', () => {
        proxyReq.abort();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ wab_error: true, message: 'Target request timed out' }));
      });

      // Forward request body
      req.pipe(proxyReq);

    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wab_error: true, message: err.message }));
    }
  }

  // ── Stats & Management API ──
  handleManagementApi(req, res) {
    const parsedUrl = url.parse(req.url, true);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (parsedUrl.pathname === '/wab/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'healthy', version: '1.0.0', uptime: Date.now() - this.stats.startTime }));
    } else if (parsedUrl.pathname === '/wab/stats') {
      const uptime = (Date.now() - this.stats.startTime) / 1000;
      res.writeHead(200);
      res.end(JSON.stringify({
        ...this.stats,
        uptime_seconds: uptime,
        requests_per_second: (this.stats.totalRequests / uptime).toFixed(2),
        block_rate: this.stats.totalRequests > 0
          ? ((this.stats.blockedRequests / this.stats.totalRequests) * 100).toFixed(1) + '%'
          : '0%',
      }));
    } else if (parsedUrl.pathname === '/wab/logs') {
      const limit = parseInt(parsedUrl.query.limit) || 50;
      res.writeHead(200);
      res.end(JSON.stringify(this.requestLog.slice(-limit)));
    } else if (parsedUrl.pathname === '/wab/scan') {
      // Direct scan endpoint (no proxy)
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { url: targetUrl, content } = JSON.parse(body);
          const urlThreats = targetUrl ? this.analyzeUrl(targetUrl) : [];
          const contentScan = content ? this.scanContent(content) : { injections: [], darkPatterns: [], riskScore: 0 };
          res.writeHead(200);
          res.end(JSON.stringify({
            url_threats: urlThreats,
            content_threats: contentScan,
            overall_risk: Math.max(
              urlThreats.reduce((s, t) => s + (t.severity === 'CRITICAL' ? 40 : t.severity === 'HIGH' ? 25 : 10), 0),
              contentScan.riskScore
            ),
          }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Unknown management endpoint' }));
    }
  }

  logRequest(data) {
    this.requestLog.push(data);
    if (this.requestLog.length > 10000) {
      this.requestLog = this.requestLog.slice(-5000);
    }
  }

  start() {
    const server = http.createServer((req, res) => {
      // Management API on /wab/* paths
      if (req.url.startsWith('/wab/')) {
        this.handleManagementApi(req, res);
      } else {
        this.handleRequest(req, res);
      }
    });

    server.listen(this.config.port, () => {
      console.log(`[WAB Agent Firewall] Running on port ${this.config.port}`);
      console.log(`[WAB Agent Firewall] Management API: http://localhost:${this.config.port}/wab/stats`);
      console.log(`[WAB Agent Firewall] Proxy endpoint: http://localhost:${this.config.port}/`);
    });

    this.on('blocked', (data) => {
      console.log(`[WAB BLOCKED] ${data.reason} → ${data.url}`);
    });
    this.on('injection_stripped', (data) => {
      console.log(`[WAB STRIPPED] ${data.count} injection(s) from ${data.url}`);
    });

    return server;
  }
}

// ── Start the firewall ──
const firewall = new WABFirewall({
  port: parseInt(process.env.WAB_FIREWALL_PORT) || 8888,
  blockOnInjection: process.env.WAB_BLOCK_INJECTIONS !== 'false',
  blockOnMaliciousDomain: process.env.WAB_BLOCK_MALICIOUS !== 'false',
  stripInjections: process.env.WAB_STRIP_INJECTIONS !== 'false',
});

firewall.start();

module.exports = { WABFirewall, THREAT_DB };
