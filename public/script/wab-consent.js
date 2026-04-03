/**
 * WAB Consent — optional GDPR/CCPA-style prompt before agents run actions.
 * Load after wab.min.js: <script src="/script/wab-consent.js"></script>
 *
 *   WABConsent.showBanner({
 *     policyUrl: '/privacy',
 *     onAccept: () => WAB.init({ ... }),
 *     onDecline: () => { ... }
 *   });
 *
 * Before execute, check WABConsent.hasConsent() or gate your own flows.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'wab_agent_consent_v1';

  function hasConsent() {
    try {
      return global.localStorage.getItem(STORAGE_KEY) === 'granted';
    } catch (e) {
      return false;
    }
  }

  function setConsent(value) {
    try {
      if (value === null) global.localStorage.removeItem(STORAGE_KEY);
      else global.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {}
  }

  function injectStyles() {
    if (global.document.getElementById('wab-consent-styles')) return;
    var s = global.document.createElement('style');
    s.id = 'wab-consent-styles';
    s.textContent =
      '#wab-consent-bar{position:fixed;left:16px;right:16px;bottom:16px;max-width:520px;margin:0 auto;' +
      'background:#0f172a;color:#e2e8f0;padding:16px 18px;border-radius:12px;border:1px solid #334155;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.35);z-index:99999;font-family:system-ui,sans-serif;font-size:14px;line-height:1.45}' +
      '#wab-consent-bar p{margin:0 0 12px}' +
      '#wab-consent-bar .wab-c-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}' +
      '#wab-consent-bar button{padding:8px 16px;border-radius:8px;border:none;font-weight:600;cursor:pointer;font-size:13px}' +
      '#wab-consent-bar .wab-c-accept{background:#3b82f6;color:#fff}' +
      '#wab-consent-bar .wab-c-decline{background:#1e293b;color:#94a3b8;border:1px solid #334155}' +
      '#wab-consent-bar a{color:#93c5fd}';
    global.document.head.appendChild(s);
  }

  function showBanner(options) {
    options = options || {};
    if (hasConsent() && options.skipIfGranted !== false) {
      if (typeof options.onAccept === 'function') options.onAccept();
      return;
    }
    injectStyles();
    var existing = global.document.getElementById('wab-consent-bar');
    if (existing) existing.remove();

    var bar = global.document.createElement('div');
    bar.id = 'wab-consent-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'AI agent consent');

    var policy = options.policyUrl
      ? '<a href="' + options.policyUrl + '" target="_blank" rel="noopener">Privacy policy</a>'
      : '';

    bar.innerHTML =
      '<p><strong>AI assistance on this site</strong><br>' +
      (options.message ||
        'This site can expose actions to AI agents (forms, cart, navigation). Allow this site to register agent-ready actions in your browser?') +
      (policy ? ' ' + policy + '.' : '') +
      '</p>' +
      '<div class="wab-c-actions">' +
      '<button type="button" class="wab-c-accept" id="wab-c-accept">Allow</button>' +
      '<button type="button" class="wab-c-decline" id="wab-c-decline">Decline</button>' +
      '</div>';

    global.document.body.appendChild(bar);

    bar.querySelector('#wab-c-accept').addEventListener('click', function () {
      setConsent('granted');
      bar.remove();
      if (typeof options.onAccept === 'function') options.onAccept();
    });
    bar.querySelector('#wab-c-decline').addEventListener('click', function () {
      setConsent('denied');
      bar.remove();
      if (typeof options.onDecline === 'function') options.onDecline();
    });
  }

  function clear() {
    setConsent(null);
  }

  global.WABConsent = {
    showBanner: showBanner,
    hasConsent: hasConsent,
    clear: clear,
    STORAGE_KEY: STORAGE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
