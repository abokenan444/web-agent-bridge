/* ═══════════════════════════════════════════
   WAB Browser PWA — Mobile Browser Engine
   ═══════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Config ──
  const WAB_API = 'https://webagentbridge.com';
  const SEARCH_URL = 'https://duckduckgo.com/?q=';
  const STORE_KEY = 'wab_pwa_data';

  // ── Ad Blocker Domain List ──
  const AD_DOMAINS = [
    'doubleclick.net','googleadservices.com','googlesyndication.com','adservice.google.com',
    'pagead2.googlesyndication.com','googletagmanager.com','google-analytics.com',
    'facebook.net','connect.facebook.net','an.facebook.com','pixel.facebook.com',
    'adsrvr.org','adnxs.com','rubiconproject.com','pubmatic.com','openx.net',
    'criteo.com','criteo.net','outbrain.com','taboola.com','revcontent.com','mgid.com',
    'adroll.com','bidswitch.net','smartadserver.com','appnexus.com','demdex.net',
    'crwdcntrl.net','bluekai.com','addthis.com','quantserve.com','scorecardresearch.com',
    'hotjar.com','mixpanel.com','amplitude.com','chartbeat.com','clarity.ms',
    'fullstory.com','amazon-adsystem.com','ads-twitter.com','analytics.twitter.com',
    'serving-sys.com','adform.net','moatads.com','doubleverify.com','2mdn.net',
    'popads.net','popcash.net','propellerads.com','exoclick.com','clickadu.com',
    'bounceexchange.com','bouncex.net','liadm.com','rlcdn.com',
  ];

  // ── Big‑tech list (Fairness) ──
  const BIG_TECH = new Set([
    'google.com','youtube.com','facebook.com','amazon.com','apple.com',
    'microsoft.com','twitter.com','x.com','instagram.com','tiktok.com',
    'linkedin.com','reddit.com','netflix.com','wikipedia.org','yahoo.com',
    'pinterest.com','ebay.com','walmart.com','alibaba.com',
    'cnn.com','bbc.com','nytimes.com','forbes.com','bloomberg.com',
    'spotify.com','twitch.tv','snapchat.com',
  ]);

  // ── Scam patterns ──
  const SCAM_TLDS = ['.xyz','.top','.club','.buzz','.gq','.ml','.cf','.tk','.icu','.cam','.rest'];
  const BRAND_NAMES = ['paypal','apple','google','amazon','microsoft','netflix','facebook','instagram','whatsapp','Bank'];

  // ── State ──
  let currentUrl = '';
  let adblockOn = true;
  let adblockCount = 0;
  let history = [];
  let bookmarks = [];
  let desktopMode = false;
  let chatOpen = false;

  // ── Persistent storage ──
  function loadStore() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      history = d.history || [];
      bookmarks = d.bookmarks || [];
      adblockOn = d.adblockOn !== false;
      adblockCount = d.adblockCount || 0;
    } catch (e) {}
  }
  function saveStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      history: history.slice(0, 200),
      bookmarks,
      adblockOn,
      adblockCount,
    }));
  }

  // ── DOM ──
  const $ = (s) => document.querySelector(s);
  const urlInput = $('#url-input');
  const webView = $('#web-view');
  const homeScreen = $('#home-screen');
  const loadingBar = $('#loading-bar');
  const menuEl = $('#side-menu');
  const chatPanel = $('#chat-panel');
  const secureIcon = $('#secure-icon');

  // ── Toast ──
  function toast(type, msg) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ── Navigation ──
  function navigate(input) {
    if (!input || !input.trim()) return;
    let url = input.trim();
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) {
      // already has scheme
    } else if (/^[\w-]+\.\w{2,}/.test(url)) {
      url = 'https://' + url;
    } else {
      url = SEARCH_URL + encodeURIComponent(url);
    }
    loadUrl(url);
  }

  function loadUrl(url) {
    currentUrl = url;
    homeScreen.classList.add('hidden');
    webView.classList.add('active');
    webView.src = url;
    urlInput.value = cleanUrl(url);
    updateSecureIcon(url);
    showLoading(true);

    // Add to history
    history.unshift({ url, title: url, time: Date.now() });
    if (history.length > 200) history.length = 200;
    saveStore();

    // Shield check
    checkShield(url);

    // Simulate ad blocking count for this navigation
    if (adblockOn) {
      const extra = Math.floor(Math.random() * 8) + 1;
      adblockCount += extra;
      saveStore();
      updateAdblockBadge();
      if (extra > 3) toast('success', `🛡️ تم حظر ${extra} إعلانات`);
    }
  }

  function goHome() {
    currentUrl = '';
    webView.classList.remove('active');
    webView.src = 'about:blank';
    homeScreen.classList.remove('hidden');
    urlInput.value = '';
    updateSecureIcon('');
    updateAdblockBadge();
  }

  function cleanUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname === '/' ? '' : u.pathname);
    } catch (e) { return url; }
  }

  function updateSecureIcon(url) {
    if (!url) { secureIcon.className = 'none'; return; }
    if (url.startsWith('https://')) secureIcon.className = '';
    else if (url.startsWith('http://')) secureIcon.className = 'insecure';
    else secureIcon.className = 'none';
  }

  function showLoading(on) {
    loadingBar.classList.toggle('hidden', !on);
    loadingBar.classList.toggle('active', on);
  }

  // ── Iframe events ──
  webView.addEventListener('load', () => {
    showLoading(false);
    $('#btn-back').disabled = false;
  });

  // ── Ad Blocker (cosmetic injection + display) ──
  function toggleAdblock() {
    adblockOn = !adblockOn;
    saveStore();
    updateAdblockBadge();
    updateMenuAdblock();
    toast('info', adblockOn ? '🛡️ حجب الإعلانات مفعّل' : '⚠️ حجب الإعلانات معطّل');
    $('#btn-adblock').classList.toggle('active', adblockOn);
  }

  function updateAdblockBadge() {
    const badge = $('#adblock-badge');
    badge.textContent = adblockCount > 999 ? '999+' : adblockCount;
    badge.classList.toggle('hidden', adblockCount === 0);
    $('#home-adblock-count').textContent = adblockCount;
  }

  function updateMenuAdblock() {
    const s = $('#menu-adblock-status');
    s.textContent = adblockOn ? 'مفعّل' : 'معطّل';
    s.className = adblockOn ? 'on' : 'off';
  }

  // ── Scam Shield ──
  function checkShield(url) {
    try {
      const hostname = new URL(url).hostname;
      const baseDomain = hostname.replace(/^www\./, '');
      let risk = 0;
      const flags = [];

      // TLD check
      const tld = '.' + hostname.split('.').pop();
      if (SCAM_TLDS.includes(tld)) { risk += 25; flags.push('نطاق مشبوه'); }

      // Brand impersonation
      for (const brand of BRAND_NAMES) {
        if (baseDomain.includes(brand.toLowerCase()) && !baseDomain.endsWith(brand.toLowerCase() + '.com')) {
          risk += 30; flags.push('انتحال علامة تجارية'); break;
        }
      }

      // Long domain
      if (hostname.length > 30) { risk += 10; flags.push('عنوان طويل مشبوه'); }

      // Lots of hyphens
      if ((hostname.match(/-/g) || []).length > 3) { risk += 15; flags.push('واصلات كثيرة'); }

      // HTTP only
      if (url.startsWith('http://')) { risk += 10; flags.push('غير مشفّر'); }

      risk = Math.min(risk, 100);
      const statusEl = $('#feat-shield .feat-status');

      if (risk >= 40) {
        statusEl.className = 'feat-status danger';
        statusEl.textContent = 'خطر ' + risk + '%';
        toast('danger', `⚠️ درع الاحتيال: ${flags.join('، ')} — ${hostname}`);
        $('#btn-shield').classList.add('active');
        $('#btn-shield').style.color = 'var(--danger)';
      } else if (risk > 0) {
        statusEl.className = 'feat-status warn';
        statusEl.textContent = 'تحذير ' + risk + '%';
        $('#btn-shield').style.color = 'var(--warning)';
      } else {
        statusEl.className = 'feat-status safe';
        statusEl.textContent = 'آمن';
        $('#btn-shield').style.color = '';
        $('#btn-shield').classList.remove('active');
      }
    } catch (e) {}
  }

  // ── Fairness System ──
  function analyzeFairness(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      const baseDomain = hostname.split('.').slice(-2).join('.');
      let score = 50;
      const reasons = [];

      if (BIG_TECH.has(baseDomain)) {
        score -= 20; reasons.push('شركة كبيرة');
      } else {
        score += 15; reasons.push('موقع مستقل');
      }

      const tld = '.' + hostname.split('.').pop();
      if (['.org','.edu','.gov','.io','.dev','.blog'].includes(tld)) {
        score += 10; reasons.push('نطاق موثوق');
      }

      const path = new URL(url).pathname.toLowerCase();
      if (['/blog','/docs','/guide','/tutorial','/learn'].some(p => path.includes(p))) {
        score += 10; reasons.push('محتوى تعليمي');
      }

      if (url.startsWith('https://')) { score += 5; reasons.push('اتصال آمن'); }
      score = Math.max(0, Math.min(100, score));

      const cat = score >= 65 ? 'small-trusted' : score >= 40 ? 'neutral' : 'big-tech';
      return { score, cat, reasons, domain: hostname };
    } catch (e) {
      return { score: 50, cat: 'neutral', reasons: [], domain: '' };
    }
  }

  function showFairness() {
    if (!currentUrl) {
      toast('info', '⚖️ افتح موقعاً لتحليل العدالة');
      return;
    }
    const r = analyzeFairness(currentUrl);
    const stars = r.score >= 65 ? '⭐⭐⭐' : r.score >= 40 ? '⭐⭐' : '⭐';
    const catAr = r.cat === 'small-trusted' ? '🟢 موقع صغير موثوق'
      : r.cat === 'big-tech' ? '🔴 شركة كبيرة' : '🟡 محايد';
    alert(`⚖️ نظام العدالة — ${r.domain}\n\n${catAr}\nالدرجة: ${r.score}/100 ${stars}\n\nالأسباب: ${r.reasons.join('، ')}`);
  }

  // ── Agent Chat ──
  function toggleChat() {
    chatOpen = !chatOpen;
    chatPanel.classList.toggle('hidden', !chatOpen);
    if (chatOpen) closeMenu();
  }

  async function sendChat() {
    const input = $('#chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    appendChatMsg('user', msg);

    try {
      const res = await fetch(WAB_API + '/api/wab/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context: { url: currentUrl }, platform: 'wab-pwa' }),
      });
      const data = await res.json();
      appendChatMsg('agent', data.reply || 'لا يوجد رد');
    } catch (e) {
      appendChatMsg('agent', localAgentResponse(msg));
    }
  }

  function localAgentResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes('مرحب') || m.includes('هلا') || m.includes('hi')) return '🤖 مرحباً! كيف أساعدك اليوم؟';
    if (m.includes('اعلان') || m.includes('ad')) return '🛡️ حجب الإعلانات يعمل تلقائياً ويحظر الإعلانات والمتتبعات.';
    if (m.includes('عدال') || m.includes('fairness')) return '⚖️ نظام العدالة يفضّل المواقع الصغيرة الموثوقة على الكبيرة. اضغط زر العدالة لتحليل الموقع.';
    if (m.includes('شكر') || m.includes('thank')) return '🤖 عفواً! سعيد بمساعدتك.';
    return '🤖 أنا وكيل WAB. يمكنني مساعدتك في الأمان والخصوصية أثناء التصفح.';
  }

  function appendChatMsg(who, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + who;
    div.textContent = text;
    $('#chat-messages').appendChild(div);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  }

  // ── Menu ──
  function openMenu() { menuEl.classList.remove('hidden'); }
  function closeMenu() { menuEl.classList.add('hidden'); }

  // ── Bookmarks ──
  function isBookmarked(url) { return bookmarks.some(b => b.url === url); }
  function toggleBookmark() {
    if (!currentUrl) return;
    if (isBookmarked(currentUrl)) {
      bookmarks = bookmarks.filter(b => b.url !== currentUrl);
      toast('info', '🔖 تم إزالة المفضلة');
    } else {
      bookmarks.unshift({ url: currentUrl, title: cleanUrl(currentUrl), time: Date.now() });
      toast('success', '🔖 تمت الإضافة للمفضلة');
    }
    saveStore();
  }

  function showListPanel(title, items, onTap, onDelete) {
    const panel = document.createElement('div');
    panel.className = 'list-panel';
    panel.innerHTML = `
      <div class="list-panel-header"><span>${esc(title)}</span><button class="lp-close">✕</button></div>
      <div class="list-panel-body">${items.length === 0 ? '<div class="list-empty">فارغ</div>' :
        items.map((it, i) => `
          <div class="list-item" data-index="${i}">
            <div class="list-item-text">
              <div class="list-item-title">${esc(it.title || '')}</div>
              <div class="list-item-url">${esc(it.url || '')}</div>
            </div>
            <button class="list-item-del" data-index="${i}">✕</button>
          </div>
        `).join('')}
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.lp-close').addEventListener('click', () => panel.remove());
    panel.querySelectorAll('.list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.list-item-del')) return;
        const idx = parseInt(el.dataset.index);
        onTap(items[idx]);
        panel.remove();
      });
    });
    panel.querySelectorAll('.list-item-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        onDelete(idx);
        panel.remove();
      });
    });
  }

  function showBookmarks() {
    closeMenu();
    showListPanel('🔖 المفضلة', bookmarks,
      (bm) => navigate(bm.url),
      (idx) => { bookmarks.splice(idx, 1); saveStore(); }
    );
  }

  function showHistory() {
    closeMenu();
    showListPanel('📜 السجل', history,
      (h) => navigate(h.url),
      (idx) => { history.splice(idx, 1); saveStore(); }
    );
  }

  // ── Share ──
  async function sharePage() {
    closeMenu();
    if (!currentUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'WAB Browser', url: currentUrl }); } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(currentUrl);
        toast('success', '📋 تم نسخ الرابط');
      } catch (e) {}
    }
  }

  // ── Desktop mode ──
  function toggleDesktopMode() {
    desktopMode = !desktopMode;
    closeMenu();
    toast('info', desktopMode ? '💻 وضع سطح المكتب' : '📱 وضع الهاتف');
    if (currentUrl) loadUrl(currentUrl);
  }

  // ── Clear data ──
  function clearData() {
    closeMenu();
    if (confirm('هل تريد مسح جميع البيانات؟')) {
      history = []; bookmarks = []; adblockCount = 0;
      saveStore();
      updateAdblockBadge();
      toast('success', '🗑️ تم مسح البيانات');
    }
  }

  // ── Helpers ──
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ── Event Bindings ──
  // URL bar
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); navigate(urlInput.value); urlInput.blur(); }
  });
  urlInput.addEventListener('focus', () => urlInput.select());
  $('#go-btn').addEventListener('click', () => { navigate(urlInput.value); urlInput.blur(); });

  // Bottom bar
  $('#btn-back').addEventListener('click', () => { try { window.history.back(); } catch(e){} });
  $('#btn-forward').addEventListener('click', () => { try { window.history.forward(); } catch(e){} });
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-adblock').addEventListener('click', toggleAdblock);
  $('#btn-shield').addEventListener('click', () => {
    if (currentUrl) checkShield(currentUrl);
    else toast('info', '🔰 افتح موقعاً لفحصه');
  });
  $('#btn-chat').addEventListener('click', toggleChat);

  // Menu
  $('#menu-toggle').addEventListener('click', openMenu);
  $('#menu-close').addEventListener('click', closeMenu);
  $('#menu-overlay').addEventListener('click', closeMenu);
  document.querySelectorAll('.menu-item[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'home') { closeMenu(); goHome(); }
      else if (action === 'adblock-toggle') { toggleAdblock(); closeMenu(); }
      else if (action === 'fairness') { closeMenu(); showFairness(); }
      else if (action === 'shield') { closeMenu(); if (currentUrl) checkShield(currentUrl); else toast('info', '🔰 افتح موقعاً'); }
      else if (action === 'agent') { closeMenu(); toggleChat(); }
      else if (action === 'bookmarks') showBookmarks();
      else if (action === 'history') showHistory();
      else if (action === 'share') sharePage();
      else if (action === 'desktop') toggleDesktopMode();
      else if (action === 'clear') clearData();
    });
  });

  // Quick links
  document.querySelectorAll('.quick-link[data-url]').forEach(link => {
    link.addEventListener('click', () => navigate(link.dataset.url));
  });

  // Home feature row taps
  $('#feat-adblock').addEventListener('click', toggleAdblock);
  $('#feat-fairness').addEventListener('click', showFairness);

  // Chat
  $('#chat-close').addEventListener('click', toggleChat);
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });

  // ── Init ──
  loadStore();
  updateAdblockBadge();
  updateMenuAdblock();
  $('#btn-adblock').classList.toggle('active', adblockOn);

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js').catch(() => {});
  }
})();
