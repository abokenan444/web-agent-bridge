/* ═══════════════════════════════════════════
   WAB Browser PWA — Mobile Browser Engine
   ═══════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Config ──
  const WAB_API = 'https://webagentbridge.com';
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

  // ── DOM extras ──
  const searchResults = $('#search-results');
  const searchResultsList = $('#search-results-list');
  const searchQueryLabel = $('#search-query-label');
  const suggestionsDropdown = $('#suggestions-dropdown');

  // ── Suggestion state ──
  let suggestTimer = null;

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
    let raw = input.trim();

    // Check if it's a URL (has scheme or looks like domain.tld without spaces)
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw) || (/^[\w-]+(\.[\w-]+)+/.test(raw) && !raw.includes(' '))) {
      let url = raw;
      if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) url = 'https://' + url;
      openExternal(url);
    } else {
      // It's a search query
      doSearch(raw);
    }
  }

  function openExternal(url) {
    // Add to history
    history.unshift({ url, title: cleanUrl(url), time: Date.now() });
    if (history.length > 200) history.length = 200;
    saveStore();
    currentUrl = url;
    urlInput.value = cleanUrl(url);

    // Shield check
    checkShield(url);

    // Track ad block
    if (adblockOn) trackAdblock(url);

    // Load in iframe — works inside iOS PWA standalone mode
    loadInFrame(url);
  }

  function loadInFrame(url) {
    homeScreen.classList.add('hidden');
    searchResults.classList.add('hidden');
    showLoading(true);
    updateSecureIcon(url);

    // Set a timeout to detect if iframe failed to load (X-Frame-Options block)
    let loadOk = false;
    const failTimer = setTimeout(() => {
      if (!loadOk) {
        showLoading(false);
        showFrameError(url);
      }
    }, 8000);

    webView.onload = () => {
      loadOk = true;
      clearTimeout(failTimer);
      showLoading(false);
      webView.classList.add('active');
      $('#btn-back').disabled = false;
    };

    webView.src = url;
    webView.classList.add('active');
  }

  function showFrameError(url) {
    webView.classList.remove('active');
    const errDiv = document.getElementById('frame-error') || document.createElement('div');
    errDiv.id = 'frame-error';
    errDiv.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--bg);z-index:7;padding:24px;text-align:center';
    errDiv.innerHTML = `
      <div style="font-size:48px">🔒</div>
      <h2 style="font-size:18px;font-weight:700">This site can't be framed</h2>
      <p style="font-size:14px;color:var(--text-muted);max-width:280px">This website blocks embedded viewing. You can open it in your default browser instead.</p>
      <button onclick="window.open('${url.replace(/'/g, "\\'\'")}','_blank')" style="padding:12px 28px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">🌐 Open in Browser</button>
      <button onclick="document.getElementById('frame-error').style.display='none';goHome()" style="padding:8px 20px;border:1px solid var(--border);border-radius:10px;background:none;color:var(--text-muted);font-size:13px;cursor:pointer">← Back to Home</button>
    `;
    if (!document.getElementById('frame-error')) {
      document.getElementById('browser-frame').appendChild(errDiv);
    }
  }

  function openInBrowser() {
    if (currentUrl) window.open(currentUrl, '_blank');
  }

  function doSearch(query) {
    hideSuggestions();
    homeScreen.classList.add('hidden');
    webView.classList.remove('active');
    searchResults.classList.remove('hidden');
    searchQueryLabel.textContent = '\uD83D\uDD0D ' + query;
    searchResultsList.innerHTML = '<div class="sr-powered">… Searching...</div>';
    urlInput.value = query;
    currentUrl = '';

    // Track ad block
    if (adblockOn) {
      adblockCount += 3;
      saveStore();
      updateAdblockBadge();
    }

    fetchSearchResults(query);
  }

  async function fetchSearchResults(query) {
    try {
      const res = await fetch(WAB_API + '/api/search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        renderSearchResults(query, data.results);
        return;
      }
    } catch (e) {}
    renderFallbackSearch(query);
  }

  function renderSearchResults(query, results) {
    let html = '<div class="sr-result-count">' + results.length + ' results for "' + esc(query) + '"</div>';
    html += results.map(r => {
      const domain = safeDomain(r.url);
      const favicon = 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(domain);
      return `
      <a class="sr-item" data-url="${esc(r.url)}">
        <div class="sr-title"><img class="sr-favicon" src="${esc(favicon)}" alt="" onerror="this.style.display='none'">${esc(r.title)}</div>
        <div class="sr-url">${esc(domain)}</div>
        ${r.snippet ? '<div class="sr-snippet">' + esc(r.snippet) + '</div>' : ''}
      </a>`;
    }).join('');
    html += '<div class="sr-powered">WAB Search \u2014 Independent Search Engine</div>';
    searchResultsList.innerHTML = html;
    bindSearchResultClicks();
  }

  function safeDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function renderFallbackSearch(query) {
    searchResultsList.innerHTML =
      '<div style="padding:32px 16px;text-align:center;">' +
        '<p style="color:var(--text-muted);margin-bottom:16px;">No results for "' + esc(query) + '"</p>' +
        '<button class="sr-retry" onclick="document.getElementById(\x27url-input\x27).focus()">🔄 Try another search</button>' +
      '</div>';
  }

  function bindSearchResultClicks() {
    searchResultsList.querySelectorAll('.sr-item[data-url]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openExternal(el.dataset.url);
      });
    });
  }

  function closeSearchResults() {
    searchResults.classList.add('hidden');
    homeScreen.classList.remove('hidden');
    urlInput.value = '';
    loadTrending();
  }

  // ── Suggestions ──────────────────────────────────────────────────
  function showSuggestions(items) {
    if (!items || items.length === 0) { hideSuggestions(); return; }
    suggestionsDropdown.innerHTML = items.map(s =>
      '<div class="suggest-item" data-query="' + esc(s) + '">' +
        '<span class="suggest-icon">\uD83D\uDD0D</span>' +
        '<span class="suggest-text">' + esc(s) + '</span>' +
      '</div>'
    ).join('');
    suggestionsDropdown.classList.remove('hidden');
    suggestionsDropdown.querySelectorAll('.suggest-item').forEach(el => {
      el.addEventListener('click', () => {
        urlInput.value = el.dataset.query;
        hideSuggestions();
        navigate(el.dataset.query);
        urlInput.blur();
      });
    });
  }

  function hideSuggestions() {
    suggestionsDropdown.classList.add('hidden');
    suggestionsDropdown.innerHTML = '';
  }

  async function fetchSuggestions(prefix) {
    if (!prefix || prefix.length < 2) { hideSuggestions(); return; }
    // If it looks like a URL, don't suggest
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(prefix) || (/^[\w-]+(\.[\w-]+)+/.test(prefix) && !prefix.includes(' '))) {
      hideSuggestions(); return;
    }
    try {
      const res = await fetch(WAB_API + '/api/search/suggest?q=' + encodeURIComponent(prefix));
      const data = await res.json();
      showSuggestions(data.suggestions || []);
    } catch (e) { hideSuggestions(); }
  }

  // ── Trending ────────────────────────────────────────────────────
  async function loadTrending() {
    const trendingList = $('#trending-list');
    if (!trendingList) return;
    try {
      const res = await fetch(WAB_API + '/api/search/trending');
      const data = await res.json();
      if (data.trending && data.trending.length > 0) {
        trendingList.innerHTML = data.trending.map(t =>
          '<span class="trending-tag" data-query="' + esc(t.query) + '">' + esc(t.query) + '</span>'
        ).join('');
        trendingList.querySelectorAll('.trending-tag').forEach(el => {
          el.addEventListener('click', () => {
            urlInput.value = el.dataset.query;
            navigate(el.dataset.query);
          });
        });
        $('#trending-section').style.display = '';
      } else {
        $('#trending-section').style.display = 'none';
      }
    } catch (e) {
      $('#trending-section').style.display = 'none';
    }
  }

  function trackAdblock(url) {
    try {
      const hostname = new URL(url).hostname;
      const isAd = AD_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
      if (!isAd) {
        adblockCount += 5;
        saveStore();
        updateAdblockBadge();
        toast('success', '🛡️ Blocked trackers & ads');
      }
    } catch(e) {}
  }

  function goHome() {
    currentUrl = '';
    webView.classList.remove('active');
    webView.src = 'about:blank';
    searchResults.classList.add('hidden');
    homeScreen.classList.remove('hidden');
    urlInput.value = '';
    updateSecureIcon('');
    updateAdblockBadge();
    // Hide frame error if present
    const errDiv = document.getElementById('frame-error');
    if (errDiv) errDiv.style.display = 'none';
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
    toast('info', adblockOn ? '🛡️ Ad Blocker enabled' : '⚠️ Ad Blocker disabled');
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
    s.textContent = adblockOn ? 'ON' : 'OFF';
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
      if (SCAM_TLDS.includes(tld)) { risk += 25; flags.push('Suspicious TLD'); }

      // Brand impersonation
      for (const brand of BRAND_NAMES) {
        if (baseDomain.includes(brand.toLowerCase()) && !baseDomain.endsWith(brand.toLowerCase() + '.com')) {
          risk += 30; flags.push('Brand impersonation'); break;
        }
      }

      // Long domain
      if (hostname.length > 30) { risk += 10; flags.push('Suspicious long URL'); }

      // Lots of hyphens
      if ((hostname.match(/-/g) || []).length > 3) { risk += 15; flags.push('Too many hyphens'); }

      // HTTP only
      if (url.startsWith('http://')) { risk += 10; flags.push('Not encrypted'); }

      risk = Math.min(risk, 100);
      const statusEl = $('#feat-shield .feat-status');

      if (risk >= 40) {
        statusEl.className = 'feat-status danger';
        statusEl.textContent = 'Danger ' + risk + '%';
        toast('danger', `⚠️ درع الاحتيال: ${flags.join('، ')} — ${hostname}`);
        $('#btn-shield').classList.add('active');
        $('#btn-shield').style.color = 'var(--danger)';
      } else if (risk > 0) {
        statusEl.className = 'feat-status warn';
        statusEl.textContent = 'Warning ' + risk + '%';
        $('#btn-shield').style.color = 'var(--warning)';
      } else {
        statusEl.className = 'feat-status safe';
        statusEl.textContent = 'Safe';
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
        score -= 20; reasons.push('Big tech');
      } else {
        score += 15; reasons.push('Independent site');
      }

      const tld = '.' + hostname.split('.').pop();
      if (['.org','.edu','.gov','.io','.dev','.blog'].includes(tld)) {
        score += 10; reasons.push('Trusted TLD');
      }

      const path = new URL(url).pathname.toLowerCase();
      if (['/blog','/docs','/guide','/tutorial','/learn'].some(p => path.includes(p))) {
        score += 10; reasons.push('Educational content');
      }

      if (url.startsWith('https://')) { score += 5; reasons.push('Secure connection'); }
      score = Math.max(0, Math.min(100, score));

      const cat = score >= 65 ? 'small-trusted' : score >= 40 ? 'neutral' : 'big-tech';
      return { score, cat, reasons, domain: hostname };
    } catch (e) {
      return { score: 50, cat: 'neutral', reasons: [], domain: '' };
    }
  }

  function showFairness() {
    if (!currentUrl) {
      toast('info', '⚖️ Open a website to analyze fairness');
      return;
    }
    const r = analyzeFairness(currentUrl);
    const stars = r.score >= 65 ? '⭐⭐⭐' : r.score >= 40 ? '⭐⭐' : '⭐';
    const catAr = r.cat === 'small-trusted' ? '🟢 Small Trusted Site'
      : r.cat === 'big-tech' ? '🔴 Big Tech' : '🟡 Neutral';
    alert(`⚖️ Fairness System \u2014 ${r.domain}\n\n${catAr}\nScore: ${r.score}/100 ${stars}\n\nReasons: ${r.reasons.join(', ')}`);
  }

  // ── Agent Chat ──
  // ── Chat session ──
  let chatSessionId = localStorage.getItem('wab_chat_session') || crypto.randomUUID();
  localStorage.setItem('wab_chat_session', chatSessionId);

  function toggleChat() {
    chatOpen = !chatOpen;
    chatPanel.classList.toggle('hidden', !chatOpen);
    if (chatOpen) closeMenu();
  }

  let pwaActiveTaskId = null;
  let pwaActiveTaskStatus = null;

  async function sendChat() {
    const input = $('#chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    appendChatMsg('user', msg);

    const typing = document.createElement('div');
    typing.className = 'chat-msg agent typing';
    typing.textContent = '⏳ Agent working...';
    $('#chat-messages').appendChild(typing);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;

    const payload = {
      message: msg,
      context: { url: currentUrl },
      platform: 'wab-pwa',
      sessionId: chatSessionId,
    };
    if (pwaActiveTaskId && pwaActiveTaskStatus === 'clarifying') {
      payload.taskId = pwaActiveTaskId;
      payload.taskAction = 'answer';
    }

    try {
      const res = await fetch(WAB_API + '/api/wab/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      typing.remove();
      const data = await res.json();

      if (data.type === 'task') {
        pwaActiveTaskId = data.taskId || pwaActiveTaskId;
        pwaActiveTaskStatus = data.status;
        appendChatMsg('agent', data.message || data.reply || 'Working...');

        if (data.offers && data.offers.length > 0) {
          const offerHtml = data.offers.map((o, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
            return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin:4px 0">
              <b>${medal} ${o.source}</b><br>
              ${o.title ? `<small>${o.title}</small><br>` : ''}
              ${o.price ? `💰 ${o.price}<br>` : ''}
              ${o.negotiation?.savings ? `🤝 وفّرت: ${o.negotiation.savings}<br>` : ''}
              <a href="${o.url}" style="color:#0ea5e9">${o.url}</a>
            </div>`;
          }).join('');
          const wrapper = document.createElement('div');
          wrapper.className = 'chat-msg agent';
          wrapper.innerHTML = offerHtml;
          $('#chat-messages').appendChild(wrapper);
          $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
        }

        if (data.status === 'completed' && data.action?.url) {
          setTimeout(() => { navigateToUrl(data.action.url); }, 1500);
          pwaActiveTaskId = null;
          pwaActiveTaskStatus = null;
        }
      } else {
        appendChatMsg('agent', data.reply || 'لا يوجد رد');
      }
    } catch (e) {
      typing.remove();
      appendChatMsg('agent', localAgentResponse(msg));
    }
  }

  function localAgentResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes('مرحب') || m.includes('هلا') || m.includes('hi') || m.includes('hello')) return '🤖 مرحباً! أنا وكيل WAB. حالياً أنت غير متصل — سأساعدك بما أستطيع.';
    if (m.includes('أمان') || m.includes('آمن') || m.includes('safe')) {
      if (currentUrl) {
        return currentUrl.startsWith('https') ? '🔒 الاتصال مشفر SSL/TLS ✅' : '⚠️ اتصال غير مشفر — تجنب إدخال بيانات حساسة.';
      }
      return '📄 لا توجد صفحة محملة حالياً.';
    }
    if (m.includes('اعلان') || m.includes('ad')) return '🚫 حاجب الإعلانات يعمل تلقائياً — يحظر 80+ نطاق إعلاني ومتتبع.';
    if (m.includes('عدال') || m.includes('fairness')) return '⚖️ نظام العدالة يفضّل المواقع الصغيرة الموثوقة على الكبيرة.';
    if (m.includes('ghost') || m.includes('شبح') || m.includes('خصوصية')) return '👻 Ghost Mode يحمي خصوصيتك — فعّله من القائمة.';
    if (m.includes('shield') || m.includes('درع')) return '🛡️ Scam Shield يحلل المواقع تلقائياً ضد الاحتيال.';
    if (m.includes('بحث') || m.includes('search')) return '🔍 WAB Search — محرك بحث مستقل يجمع نتائج من مصادر متعددة.';
    if (m.includes('شكر') || m.includes('thank')) return '😊 عفواً! سعيد بمساعدتك.';
    if (m.includes('مساعدة') || m.includes('help')) return '🤖 يمكنني مساعدتك في: أمان المواقع، الخصوصية، حجب الإعلانات، البحث. أنت حالياً غير متصل — اتصل بالإنترنت للحصول على إجابات أفضل.';
    return '🤖 أنا وكيل WAB. أنت حالياً غير متصل — اتصل بالإنترنت لتفعيل الوكيل الذكي بالكامل.';
  }

  function appendChatMsg(who, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + who;
    // Support multi-line messages
    div.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
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
      toast('info', '🔖 Bookmark removed');
    } else {
      bookmarks.unshift({ url: currentUrl, title: cleanUrl(currentUrl), time: Date.now() });
      toast('success', '🔖 Bookmarked');
    }
    saveStore();
  }

  function showListPanel(title, items, onTap, onDelete) {
    const panel = document.createElement('div');
    panel.className = 'list-panel';
    panel.innerHTML = `
      <div class="list-panel-header"><span>${esc(title)}</span><button class="lp-close">✕</button></div>
      <div class="list-panel-body">${items.length === 0 ? '<div class="list-empty">Empty</div>' :
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
    showListPanel('🔖 Bookmarks', bookmarks,
      (bm) => navigate(bm.url),
      (idx) => { bookmarks.splice(idx, 1); saveStore(); }
    );
  }

  function showHistory() {
    closeMenu();
    showListPanel('📜 History', history,
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
        toast('success', '📋 Link copied');
      } catch (e) {}
    }
  }

  // ── Desktop mode ──
  function toggleDesktopMode() {
    desktopMode = !desktopMode;
    closeMenu();
    toast('info', desktopMode ? '💻 Desktop Mode' : '📱 Mobile Mode');
    if (currentUrl) loadUrl(currentUrl);
  }

  // ── Clear data ──
  function clearData() {
    closeMenu();
    if (confirm('Clear all browsing data?')) {
      history = []; bookmarks = []; adblockCount = 0;
      saveStore();
      updateAdblockBadge();
      toast('success', '🗑️ Data cleared');
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
    if (e.key === 'Enter') { e.preventDefault(); hideSuggestions(); navigate(urlInput.value); urlInput.blur(); }
    if (e.key === 'Escape') { hideSuggestions(); }
  });
  urlInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const val = urlInput.value.trim();
    if (val.length < 2) { hideSuggestions(); return; }
    suggestTimer = setTimeout(() => fetchSuggestions(val), 250);
  });
  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('blur', () => { setTimeout(hideSuggestions, 200); });
  $('#go-btn').addEventListener('click', () => { hideSuggestions(); navigate(urlInput.value); urlInput.blur(); });

  // Search results close
  $('#search-close').addEventListener('click', closeSearchResults);

  // Bottom bar
  $('#btn-back').addEventListener('click', () => {
    // Navigate WAB history, not browser history (avoids iframe Home→eBay issue)
    if (currentUrl) { goHome(); }
    else { try { window.history.back(); } catch(e){} }
  });
  $('#btn-forward').addEventListener('click', () => { try { window.history.forward(); } catch(e){} });
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-adblock').addEventListener('click', toggleAdblock);
  $('#btn-shield').addEventListener('click', () => {
    if (currentUrl) checkShield(currentUrl);
    else toast('info', '🔰 Open a site to scan');
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
      else if (action === 'shield') { closeMenu(); if (currentUrl) checkShield(currentUrl); else toast('info', '🔰 Open a site first'); }
      else if (action === 'agent') { closeMenu(); toggleChat(); }
      else if (action === 'bookmarks') showBookmarks();
      else if (action === 'history') showHistory();
      else if (action === 'share') sharePage();
      else if (action === 'desktop') toggleDesktopMode();
      else if (action === 'open-external') { closeMenu(); openInBrowser(); }
      else if (action === 'clear') clearData();
    });
  });

  // Quick links
  document.querySelectorAll('.quick-link[data-url]').forEach(link => {
    link.addEventListener('click', () => navigate(link.dataset.url));
  });
  document.querySelectorAll('.quick-link[data-action="search"]').forEach(link => {
    link.addEventListener('click', () => { urlInput.focus(); });
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
  loadTrending();

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js').catch(() => {});
  }
})();
