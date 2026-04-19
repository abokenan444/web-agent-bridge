// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Widget v2.5 — Drop-in link protection for any website
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
//
// Usage: <script src="https://cdn.webagentbridge.com/widget.js"
//                 data-wab-key="YOUR_API_KEY"></script>
//
// License: MIT — https://github.com/abokenan444/web-agent-bridge/blob/master/LICENSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function (window, document) {
  'use strict';

  const WAB_API   = 'https://api.webagentbridge.com/v1';
  const WAB_CDN   = 'https://cdn.webagentbridge.com';
  const WAB_VER   = '2.5.0';
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  // ── Configuration ────────────────────────────────────────────────────────
  const script  = document.currentScript || document.querySelector('script[data-wab-key]');
  const API_KEY = script ? script.getAttribute('data-wab-key') : window.WAB_KEY || '';
  const MODE    = script ? (script.getAttribute('data-wab-mode') || 'badge') : 'badge';
  // Modes: 'badge' = show shield icon | 'tooltip' = show on hover | 'block' = block critical links

  const cache = new Map(); // url → { result, ts }

  // ── Inject CSS ───────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('wab-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'wab-widget-styles';
    style.textContent = `
      .wab-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        font-size: 10px;
        margin-left: 3px;
        cursor: pointer;
        vertical-align: middle;
        transition: transform 0.15s ease;
        text-decoration: none;
        position: relative;
      }
      .wab-badge:hover { transform: scale(1.2); }
      .wab-badge--safe    { background: #22c55e; color: #fff; }
      .wab-badge--warning { background: #f59e0b; color: #fff; }
      .wab-badge--danger  { background: #ef4444; color: #fff; }
      .wab-badge--loading { background: #94a3b8; color: #fff; animation: wab-pulse 1s infinite; }

      @keyframes wab-pulse {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.4; }
      }

      .wab-tooltip {
        display: none;
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #f8fafc;
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 12px;
        line-height: 1.5;
        width: 240px;
        z-index: 99999;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .wab-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #1e293b;
      }
      .wab-badge:hover .wab-tooltip { display: block; }

      .wab-tooltip-header {
        font-weight: 700;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .wab-tooltip-score {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 6px;
        border-top: 1px solid #334155;
        padding-top: 6px;
      }
      .wab-tooltip-footer {
        font-size: 10px;
        color: #64748b;
        margin-top: 4px;
      }
      .wab-tooltip-footer a { color: #60a5fa; text-decoration: none; }

      .wab-blocked-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .wab-blocked-box {
        background: #fff;
        border-radius: 16px;
        padding: 32px;
        max-width: 480px;
        width: 90%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .wab-blocked-icon { font-size: 48px; margin-bottom: 16px; }
      .wab-blocked-title { font-size: 22px; font-weight: 700; color: #ef4444; margin-bottom: 8px; }
      .wab-blocked-msg { font-size: 14px; color: #64748b; margin-bottom: 20px; line-height: 1.6; }
      .wab-blocked-url { font-size: 12px; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; word-break: break-all; color: #475569; margin-bottom: 20px; }
      .wab-blocked-btn { display: inline-block; padding: 10px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 14px; }
      .wab-blocked-back { background: #3b82f6; color: #fff; margin-right: 8px; }
      .wab-blocked-proceed { background: #f1f5f9; color: #64748b; }
      .wab-blocked-powered { font-size: 11px; color: #94a3b8; margin-top: 16px; }
      .wab-blocked-powered a { color: #3b82f6; text-decoration: none; }
    `;
    document.head.appendChild(style);
  }

  // ── Scan URL via WAB API (server-side detection) ──────────────────────────
  async function scanURL(url) {
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && now - cached.ts < CACHE_TTL) return cached.result;

    try {
      const res = await fetch(`${WAB_API}/shield/scan`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'X-WAB-SDK': WAB_VER,
          'X-WAB-Source': 'widget',
        },
        body: JSON.stringify({ url }),
      });
      const result = await res.json();
      cache.set(url, { result, ts: now });
      return result;
    } catch (e) {
      return { status: 'UNKNOWN', risk_score: 0, verdict: 'Could not check this URL' };
    }
  }

  // ── Build badge element ───────────────────────────────────────────────────
  function buildBadge(result, url) {
    const badge = document.createElement('span');
    badge.className = 'wab-badge wab-badge--loading';
    badge.setAttribute('data-wab-url', url);
    badge.setAttribute('aria-label', 'WAB Security Check');
    badge.textContent = '🛡';

    const tooltip = document.createElement('div');
    tooltip.className = 'wab-tooltip';

    if (result) {
      applyResult(badge, tooltip, result, url);
    }

    badge.appendChild(tooltip);
    return badge;
  }

  function applyResult(badge, tooltip, result, url) {
    const { status, risk_score, verdict, threats = [] } = result;

    badge.classList.remove('wab-badge--loading');

    if (status === 'SAFE') {
      badge.classList.add('wab-badge--safe');
      badge.textContent = '✓';
    } else if (status === 'WARNING') {
      badge.classList.add('wab-badge--warning');
      badge.textContent = '⚠';
    } else if (status === 'CRITICAL') {
      badge.classList.add('wab-badge--danger');
      badge.textContent = '✕';
    } else {
      badge.classList.add('wab-badge--loading');
      badge.textContent = '?';
    }

    const statusLabel = status === 'SAFE' ? '✅ Safe' : status === 'WARNING' ? '⚠️ Warning' : status === 'CRITICAL' ? '🚫 Dangerous' : '❓ Unknown';
    const threatList  = threats.length ? `<br><small style="color:#fca5a5">⚠ ${threats.slice(0, 2).join(', ')}</small>` : '';

    tooltip.innerHTML = `
      <div class="wab-tooltip-header">${statusLabel}</div>
      <div>${verdict || 'No threats detected'}${threatList}</div>
      <div class="wab-tooltip-score">Risk Score: ${risk_score}/100</div>
      <div class="wab-tooltip-footer">Powered by <a href="https://www.webagentbridge.com" target="_blank">WAB</a></div>
    `;
  }

  // ── Block overlay ─────────────────────────────────────────────────────────
  function showBlockOverlay(url, verdict, onProceed) {
    const overlay = document.createElement('div');
    overlay.className = 'wab-blocked-overlay';
    overlay.innerHTML = `
      <div class="wab-blocked-box">
        <div class="wab-blocked-icon">🚫</div>
        <div class="wab-blocked-title">Dangerous Link Blocked</div>
        <div class="wab-blocked-msg">${verdict || 'This link has been identified as malicious by WAB Shield.'}</div>
        <div class="wab-blocked-url">${url}</div>
        <button class="wab-blocked-btn wab-blocked-back" id="wab-go-back">← Go Back</button>
        <button class="wab-blocked-btn wab-blocked-proceed" id="wab-proceed">Proceed Anyway</button>
        <div class="wab-blocked-powered">Protected by <a href="https://www.webagentbridge.com" target="_blank">WAB</a></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('wab-go-back').onclick  = () => overlay.remove();
    document.getElementById('wab-proceed').onclick = () => { overlay.remove(); onProceed(); };
  }

  // ── Process all external links ────────────────────────────────────────────
  function processLinks(root = document) {
    const links = root.querySelectorAll('a[href^="http"]');
    links.forEach(link => {
      if (link.dataset.wabProcessed) return;
      link.dataset.wabProcessed = 'true';

      const url = link.href;
      const isSameDomain = url.startsWith(window.location.origin);
      if (isSameDomain) return;

      const badge = buildBadge(null, url);
      link.insertAdjacentElement('afterend', badge);

      scanURL(url).then(result => {
        const tooltip = badge.querySelector('.wab-tooltip');
        applyResult(badge, tooltip, result, url);

        // Block mode: intercept click on critical links
        if (MODE === 'block' && result.status === 'CRITICAL') {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            showBlockOverlay(url, result.verdict, () => {
              window.open(url, '_blank', 'noopener,noreferrer');
            });
          });
        }
      });
    });
  }

  // ── Initialize ────────────────────────────────────────────────────────────
  function init() {
    if (!API_KEY) {
      console.warn('[WAB Widget] No API key provided. Add data-wab-key="YOUR_KEY" to the script tag.');
      return;
    }
    injectStyles();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => processLinks());
    } else {
      processLinks();
    }

    // Observe DOM for dynamically added links
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) processLinks(node);
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.WABWidget = {
    version: WAB_VER,
    scan: scanURL,
    processLinks,
    init,
  };

  init();

})(window, document);
