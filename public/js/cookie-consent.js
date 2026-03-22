/**
 * WAB Cookie Consent Banner
 * Compliant with EU ePrivacy Directive & Dutch Telecommunicatiewet Art. 11.7a
 * Auto-injects a cookie consent banner if user hasn't consented yet.
 */
(function () {
  if (localStorage.getItem('wab_cookie_consent')) return;

  var banner = document.createElement('div');
  banner.id = 'wab-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML =
    '<div class="wab-cookie-inner">' +
      '<p>We use essential cookies (authentication tokens) to keep you signed in. ' +
      'We do not use tracking or marketing cookies. ' +
      'See our <a href="/cookies">Cookie Policy</a> and <a href="/privacy">Privacy Policy</a>.</p>' +
      '<div class="wab-cookie-actions">' +
        '<button id="wab-cookie-accept" class="wab-cookie-btn wab-cookie-btn-primary">Accept</button>' +
        '<button id="wab-cookie-decline" class="wab-cookie-btn wab-cookie-btn-ghost">Essential Only</button>' +
      '</div>' +
    '</div>';

  var style = document.createElement('style');
  style.textContent =
    '#wab-cookie-banner{position:fixed;bottom:0;left:0;right:0;z-index:10000;' +
    'background:rgba(10,14,26,0.97);border-top:1px solid rgba(59,130,246,0.2);' +
    'padding:16px 0;font-family:Inter,system-ui,sans-serif;backdrop-filter:blur(12px)}' +
    '.wab-cookie-inner{max-width:960px;margin:0 auto;padding:0 24px;display:flex;' +
    'align-items:center;gap:20px;flex-wrap:wrap}' +
    '.wab-cookie-inner p{flex:1;min-width:280px;color:#94a3b8;font-size:0.875rem;line-height:1.6;margin:0}' +
    '.wab-cookie-inner a{color:#3b82f6;text-decoration:none}' +
    '.wab-cookie-inner a:hover{text-decoration:underline}' +
    '.wab-cookie-actions{display:flex;gap:10px;flex-shrink:0}' +
    '.wab-cookie-btn{padding:8px 20px;border-radius:8px;font-size:0.85rem;font-weight:500;cursor:pointer;' +
    'border:none;transition:all 0.2s}' +
    '.wab-cookie-btn-primary{background:#3b82f6;color:#fff}' +
    '.wab-cookie-btn-primary:hover{background:#2563eb}' +
    '.wab-cookie-btn-ghost{background:transparent;color:#94a3b8;border:1px solid rgba(148,163,184,0.3)}' +
    '.wab-cookie-btn-ghost:hover{color:#e2e8f0;border-color:rgba(148,163,184,0.5)}' +
    '@media(max-width:600px){.wab-cookie-inner{flex-direction:column;text-align:center}' +
    '.wab-cookie-actions{width:100%;justify-content:center}}';

  document.head.appendChild(style);
  document.body.appendChild(banner);

  document.getElementById('wab-cookie-accept').addEventListener('click', function () {
    localStorage.setItem('wab_cookie_consent', 'all');
    banner.remove();
  });

  document.getElementById('wab-cookie-decline').addEventListener('click', function () {
    localStorage.setItem('wab_cookie_consent', 'essential');
    banner.remove();
  });
})();
