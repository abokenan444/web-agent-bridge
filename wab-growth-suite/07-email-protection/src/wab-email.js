// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Email Protection v2.5
// Real-time phishing protection for Gmail & Outlook
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';

// ── WABEmailScanner — core scanning engine ────────────────────────────────
class WABEmailScanner {
  constructor(apiKey) {
    if (!apiKey) throw new Error('WAB API key required — https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;
    this._cache = new Map();
    this._CACHE_TTL = 30 * 60 * 1000; // 30 min
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VER,
      'X-WAB-Source': 'email-protection',
    };
  }

  // ── Extract all URLs from email HTML/text ─────────────────────────────
  extractURLs(emailContent) {
    const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
    const found    = emailContent.match(urlRegex) || [];
    // Deduplicate and clean
    return [...new Set(found.map(u => u.replace(/[.,;:!?]+$/, '')))];
  }

  // ── Scan a single URL (with cache) ────────────────────────────────────
  async scanURL(url) {
    const now    = Date.now();
    const cached = this._cache.get(url);
    if (cached && now - cached.ts < this._CACHE_TTL) return cached.result;

    const res = await fetch(`${WAB_API}/shield/scan`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ url, source: 'email' }),
    });
    const result = await res.json();
    this._cache.set(url, { result, ts: now });
    return result;
  }

  // ── Scan full email (returns structured report) ───────────────────────
  async scanEmail(emailData) {
    const { subject = '', body = '', sender = '', headers = {} } = emailData;
    const fullText = `${subject} ${body}`;
    const urls     = this.extractURLs(fullText);

    // Scan all URLs in parallel
    const urlResults = await Promise.allSettled(urls.map(u => this.scanURL(u)));

    const scannedURLs = urls.map((url, i) => ({
      url,
      ...(urlResults[i].status === 'fulfilled'
        ? urlResults[i].value
        : { status: 'ERROR', error: urlResults[i].reason?.message }),
    }));

    // Analyze sender reputation
    const senderDomain  = sender.includes('@') ? sender.split('@')[1] : sender;
    const senderScan    = senderDomain ? await this.scanURL(`https://${senderDomain}`).catch(() => null) : null;

    // Calculate overall email risk
    const criticalURLs = scannedURLs.filter(u => u.status === 'CRITICAL');
    const warningURLs  = scannedURLs.filter(u => u.status === 'WARNING');

    let overallRisk = 'SAFE';
    let riskScore   = 0;
    let verdict     = 'No threats detected in this email.';

    if (criticalURLs.length > 0) {
      overallRisk = 'CRITICAL';
      riskScore   = Math.max(...criticalURLs.map(u => u.risk_score || 90));
      verdict     = `⚠️ PHISHING DETECTED: ${criticalURLs.length} dangerous link(s) found. Do NOT click any links.`;
    } else if (warningURLs.length > 0) {
      overallRisk = 'WARNING';
      riskScore   = Math.max(...warningURLs.map(u => u.risk_score || 50));
      verdict     = `⚠️ Suspicious links detected. Proceed with caution.`;
    } else if (senderScan?.status === 'CRITICAL') {
      overallRisk = 'WARNING';
      riskScore   = 60;
      verdict     = `Sender domain flagged as suspicious.`;
    }

    // Detect common phishing patterns in subject/body
    const phishingPatterns = this._detectPhishingPatterns(subject, body);
    if (phishingPatterns.length > 0 && overallRisk === 'SAFE') {
      overallRisk = 'WARNING';
      riskScore   = Math.max(riskScore, 40);
      verdict     = `Suspicious language patterns detected: ${phishingPatterns.join(', ')}`;
    }

    return {
      overall_risk:      overallRisk,
      risk_score:        riskScore,
      verdict,
      urls_found:        urls.length,
      urls_scanned:      scannedURLs,
      critical_count:    criticalURLs.length,
      warning_count:     warningURLs.length,
      sender_domain:     senderDomain,
      sender_reputation: senderScan,
      phishing_patterns: phishingPatterns,
      scanned_at:        new Date().toISOString(),
      powered_by:        'WAB Email Protection | https://www.webagentbridge.com',
    };
  }

  // ── Detect phishing language patterns ────────────────────────────────
  _detectPhishingPatterns(subject, body) {
    const text     = `${subject} ${body}`.toLowerCase();
    const patterns = [];

    const checks = [
      { regex: /urgent|immediately|act now|expires? (today|in \d+ hours?)/i, label: 'urgency language' },
      { regex: /verify your (account|identity|password|email)/i,             label: 'account verification request' },
      { regex: /you (have|won|are selected|are eligible).{0,30}(prize|reward|gift|winner)/i, label: 'prize/reward claim' },
      { regex: /click here|click the link|click below/i,                     label: 'suspicious CTA' },
      { regex: /your (account|card|payment) (has been|will be) (suspended|blocked|charged)/i, label: 'account threat' },
      { regex: /confirm (your|account|payment|details)/i,                    label: 'confirmation request' },
      { regex: /update (your|billing|payment|account) (information|details)/i, label: 'info update request' },
      { regex: /\$\d+[\.,]\d+ (has been|was) (charged|deducted|withdrawn)/i, label: 'fake charge notification' },
    ];

    checks.forEach(({ regex, label }) => {
      if (regex.test(text)) patterns.push(label);
    });

    return patterns;
  }
}

// ── WABGmailIntegration — Gmail content script ────────────────────────────
// This runs as a Chrome extension content script on mail.google.com
const WABGmailContentScript = `
// WAB Email Protection — Gmail Content Script
// Powered by WAB — Web Agent Bridge | https://www.webagentbridge.com

(function() {
  'use strict';
  const WAB_EXT_ID = chrome.runtime.id;

  function injectWarningBanner(emailEl, report) {
    if (emailEl.querySelector('.wab-email-banner')) return;

    const color  = report.overall_risk === 'CRITICAL' ? '#ef4444' : '#f59e0b';
    const icon   = report.overall_risk === 'CRITICAL' ? '🚫' : '⚠️';
    const banner = document.createElement('div');
    banner.className = 'wab-email-banner';
    banner.style.cssText = \`
      background:\${color}15;border-left:4px solid \${color};
      padding:12px 16px;margin:8px 0;border-radius:4px;
      font-family:-apple-system,sans-serif;font-size:13px;color:#1e293b;
    \`;
    banner.innerHTML = \`
      <strong>\${icon} WAB Security Alert:</strong> \${report.verdict}
      <span style="float:right;font-size:11px;color:#94a3b8">
        Powered by <a href="https://www.webagentbridge.com" target="_blank" style="color:#3b82f6">WAB</a>
      </span>
    \`;
    emailEl.insertBefore(banner, emailEl.firstChild);
  }

  function scanVisibleEmails() {
    const emailBodies = document.querySelectorAll('.a3s.aiL:not([data-wab-scanned])');
    emailBodies.forEach(emailEl => {
      emailEl.setAttribute('data-wab-scanned', 'true');
      const content = emailEl.innerText;
      chrome.runtime.sendMessage(
        { type: 'WAB_SCAN_EMAIL', content },
        (report) => {
          if (report && report.overall_risk !== 'SAFE') {
            injectWarningBanner(emailEl, report);
          }
        }
      );
    });
  }

  // Run on load and observe DOM changes
  scanVisibleEmails();
  new MutationObserver(scanVisibleEmails).observe(document.body, { childList: true, subtree: true });
})();
`;

// ── Chrome Extension manifest ─────────────────────────────────────────────
const extensionManifest = {
  manifest_version: 3,
  name:             'WAB Email Protection',
  version:          '2.5.0',
  description:      'Real-time phishing protection for Gmail & Outlook — Powered by WAB',
  permissions:      ['storage', 'activeTab', 'scripting'],
  host_permissions: ['https://mail.google.com/*', 'https://outlook.live.com/*', 'https://outlook.office.com/*'],
  background: {
    service_worker: 'background.js',
  },
  content_scripts: [
    {
      matches:  ['https://mail.google.com/*'],
      js:       ['content-gmail.js'],
      run_at:   'document_idle',
    },
    {
      matches:  ['https://outlook.live.com/*', 'https://outlook.office.com/*'],
      js:       ['content-outlook.js'],
      run_at:   'document_idle',
    },
  ],
  action: {
    default_popup: 'popup.html',
    default_icon:  { '48': 'icons/wab-48.png', '128': 'icons/wab-128.png' },
  },
  icons: { '48': 'icons/wab-48.png', '128': 'icons/wab-128.png' },
  // Powered by WAB — Web Agent Bridge | https://www.webagentbridge.com
};

module.exports = { WABEmailScanner, WABGmailContentScript, extensionManifest };
