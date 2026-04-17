/* ════════════════════════════════════════════════════
   WAB Browser - Core Browser Logic
   ════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ──────────────────────── State ────────────────────────
  const state = {
    tabs: [],
    activeTabId: null,
    ghostMode: false,
    suggestionIndex: -1,
    menuOpen: false,
    sidebarPanel: null,
  };

  let tabIdCounter = 0;
  let NEW_TAB_URL = 'https://webagentbridge.com/pwa/';

  // ──────────── Performance: Tab Suspension ────────────
  const TAB_SUSPEND_DELAY = 5 * 60 * 1000; // 5 min inactive → suspend
  const tabTimers = new Map(); // tabId → suspendTimeout
  const suspendedTabs = new Map(); // tabId → { url, title, favicon }

  function scheduleTabSuspend(tabId) {
    clearTabSuspendTimer(tabId);
    if (tabId === state.activeTabId) return;
    tabTimers.set(tabId, setTimeout(() => suspendTab(tabId), TAB_SUSPEND_DELAY));
  }

  function clearTabSuspendTimer(tabId) {
    const timer = tabTimers.get(tabId);
    if (timer) { clearTimeout(timer); tabTimers.delete(tabId); }
  }

  function suspendTab(tabId) {
    if (tabId === state.activeTabId) return;
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const wv = document.querySelector(`webview[data-tab-id="${tabId}"]`);
    if (!wv) return;

    // Save state before suspending
    suspendedTabs.set(tabId, { url: tab.url, title: tab.title, favicon: tab.favicon });

    // Remove webview from DOM to free memory
    wv.remove();

    // Update tab UI to show suspended state
    const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabEl) tabEl.classList.add('suspended');
  }

  function resumeTab(tabId) {
    const saved = suspendedTabs.get(tabId);
    if (!saved) return;
    suspendedTabs.delete(tabId);

    // Re-create webview
    const webview = document.createElement('webview');
    webview.dataset.tabId = tabId;
    webview.setAttribute('partition', state.ghostMode ? `ghost-${tabId}` : 'persist:main');
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('autosize', 'on');
    attachWebviewEvents(webview, tabId);
    dom.contentArea.appendChild(webview);
    webview.src = saved.url || NEW_TAB_URL;

    const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabEl) tabEl.classList.remove('suspended');
  }

  // ──────────── Performance: Throttle helper ────────────
  function throttle(fn, ms) {
    let last = 0, timer = null;
    return function(...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, args); }, ms - (now - last));
      }
    };
  }

  // ──────────────────────── DOM Refs ────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    tabsContainer: $('#tabs-container'),
    contentArea: $('#content-area'),
    urlInput: $('#url-input'),
    urlSuggestions: $('#url-suggestions'),
    securityIcon: $('#security-icon'),
    backBtn: $('#back-btn'),
    forwardBtn: $('#forward-btn'),
    reloadBtn: $('#reload-btn'),
    homeBtn: $('#home-btn'),
    shieldBtn: $('#shield-btn'),
    shieldBadge: $('#shield-badge'),
    ghostBtn: $('#ghost-btn'),
    bookmarkBtn: $('#bookmark-btn'),
    menuBtn: $('#menu-btn'),
    menuDropdown: $('#menu-dropdown'),
    sidebar: $('#sidebar'),
    sidebarTitle: $('#sidebar-title'),
    sidebarContent: $('#sidebar-content'),
    sidebarClose: $('#sidebar-close'),
    statusShield: $('#status-shield-info'),
    statusGhost: $('#status-ghost-info'),
    statusText: $('#status-text'),
    chatPanel: $('#chat-panel'),
    chatMessages: $('#chat-messages'),
    chatInput: $('#chat-input'),
    chatSend: $('#chat-send'),
    chatClose: $('#chat-close'),
    chatBtn: $('#chat-btn'),
    notifPanel: $('#notif-panel'),
    notifList: $('#notif-list'),
    notifBtn: $('#notif-btn'),
    notifBadge: $('#notif-badge'),
    notifClose: $('#notif-close'),
    notifClear: $('#notif-clear'),
    toastContainer: $('#toast-container'),
    adblockBtn: $('#adblock-btn'),
    adblockBadge: $('#adblock-badge'),
    fairnessBtn: $('#fairness-btn'),
    universalBtn: $('#universal-btn'),
    universalBadge: $('#universal-badge'),
    universalPanel: $('#universal-panel'),
    universalClose: $('#universal-close'),
    universalContent: $('#universal-content'),
  };

  // ──────────────────────── Tab Management ────────────────────────

  function attachWebviewEvents(webview, id) {
    webview.addEventListener('did-start-loading', () => setTabLoading(id, true));
    webview.addEventListener('did-stop-loading', () => setTabLoading(id, false));
    webview.addEventListener('did-fail-load', () => setTabLoading(id, false));

    webview.addEventListener('page-title-updated', (e) => {
      setTabTitle(id, e.title);
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        setTabFavicon(id, e.favicons[0]);
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      updateTabUrl(id, e.url);
      updateNavButtons();
      checkScamShield(e.url);
      addToHistory(e.url, state.tabs.find(t => t.id === id)?.title);
      setTimeout(() => injectAdblockCss(), 300);
      setTimeout(() => analyzeCurrentPage(), 2000);
      // Auto-analyze if Universal Agent panel is open
      if (universalOpen) setTimeout(() => analyzeUniversalPage(), 2500);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        updateTabUrl(id, e.url);
        updateNavButtons();
      }
    });

    webview.addEventListener('dom-ready', async () => {
      if (state.ghostMode) {
        const script = await wab.ghost.getScript();
        if (script) {
          try { webview.executeJavaScript(script); } catch(e) {}
        }
      }
    });

    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      createTab(e.url);
    });
  }

  function createTab(url, activate = true) {
    const id = ++tabIdCounter;
    const tab = { id, title: 'New Tab', url: url || '', loading: false, favicon: null, shieldResult: null };
    state.tabs.push(tab);

    // Create tab element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = id;
    tabEl.innerHTML = `
      <div class="tab-favicon-wrap"><img class="tab-favicon" src="" style="display:none" /></div>
      <span class="tab-title">New Tab</span>
      <button class="tab-close" title="Close tab">✕</button>
    `;
    tabEl.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) switchTab(id);
    });
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });
    dom.tabsContainer.appendChild(tabEl);

    // Create webview
    const webview = document.createElement('webview');
    webview.dataset.tabId = id;
    webview.setAttribute('partition', state.ghostMode ? `ghost-${id}` : 'persist:main');
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('autosize', 'on');
    attachWebviewEvents(webview, id);

    dom.contentArea.appendChild(webview);

    if (url) {
      webview.src = url;
    } else {
      webview.src = NEW_TAB_URL;
    }

    if (activate) switchTab(id);
    return id;
  }

  function switchTab(id) {
    const prevTabId = state.activeTabId;
    state.activeTabId = id;
    const tab = state.tabs.find(t => t.id === id);

    // Schedule suspension of the previously active tab
    if (prevTabId && prevTabId !== id) {
      scheduleTabSuspend(prevTabId);
    }

    // Cancel suspension timer for the now-active tab
    clearTabSuspendTimer(id);

    // Resume if suspended
    if (suspendedTabs.has(id)) {
      resumeTab(id);
    }

    // Update tab UI
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    const tabEl = document.querySelector(`.tab[data-tab-id="${id}"]`);
    if (tabEl) {
      tabEl.classList.add('active');
      tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    // Update webview visibility
    document.querySelectorAll('#content-area webview').forEach(wv => wv.classList.remove('active'));
    const webview = document.querySelector(`webview[data-tab-id="${id}"]`);
    if (webview) webview.classList.add('active');

    // Update URL bar
    if (tab) {
      updateUrlBar(tab.url);
      document.title = tab.title ? `${tab.title} - WAB Browser` : 'WAB Browser';
      updateShieldUI(tab.shieldResult);
    }

    updateNavButtons();
    updateBookmarkBtn();
  }

  function closeTab(id) {
    const index = state.tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    // Clean up suspension state
    clearTabSuspendTimer(id);
    suspendedTabs.delete(id);

    // Remove from state
    state.tabs.splice(index, 1);

    // Remove DOM elements
    const tabEl = document.querySelector(`.tab[data-tab-id="${id}"]`);
    if (tabEl) tabEl.remove();
    const webview = document.querySelector(`webview[data-tab-id="${id}"]`);
    if (webview) webview.remove();

    // If no tabs left, create a new one
    if (state.tabs.length === 0) {
      createTab();
      return;
    }

    // If closed the active tab, switch to nearest
    if (state.activeTabId === id) {
      const newIndex = Math.min(index, state.tabs.length - 1);
      switchTab(state.tabs[newIndex].id);
    }
  }

  function setTabTitle(id, title) {
    const tab = state.tabs.find(t => t.id === id);
    if (tab) tab.title = title;
    const el = document.querySelector(`.tab[data-tab-id="${id}"] .tab-title`);
    if (el) el.textContent = title || 'New Tab';
    if (id === state.activeTabId) {
      document.title = title ? `${title} - WAB Browser` : 'WAB Browser';
    }
  }

  function setTabFavicon(id, faviconUrl) {
    const tab = state.tabs.find(t => t.id === id);
    if (tab) tab.favicon = faviconUrl;
    const img = document.querySelector(`.tab[data-tab-id="${id}"] .tab-favicon`);
    if (img && faviconUrl) {
      img.src = faviconUrl;
      img.style.display = 'block';
      img.onerror = () => { img.style.display = 'none'; };
    }
  }

  function setTabLoading(id, loading) {
    const tab = state.tabs.find(t => t.id === id);
    if (tab) tab.loading = loading;
    const tabEl = document.querySelector(`.tab[data-tab-id="${id}"]`);
    if (!tabEl) return;

    const faviconWrap = tabEl.querySelector('.tab-favicon-wrap');
    if (loading) {
      faviconWrap.innerHTML = '<div class="tab-loading"></div>';
    } else {
      const favicon = tab?.favicon;
      faviconWrap.innerHTML = favicon
        ? `<img class="tab-favicon" src="${favicon}" onerror="this.style.display='none'" />`
        : '<img class="tab-favicon" src="" style="display:none" />';
    }

    if (id === state.activeTabId) {
      dom.statusText.textContent = loading ? 'Loading...' : 'Ready';
    }
  }

  function updateTabUrl(id, url) {
    const tab = state.tabs.find(t => t.id === id);
    if (tab) tab.url = url;
    if (id === state.activeTabId) updateUrlBar(url);
  }

  function getActiveWebview() {
    return document.querySelector(`webview[data-tab-id="${state.activeTabId}"]`);
  }

  // ──────────────────────── Navigation ────────────────────────
  function isURL(input) {
    if (/^(https?:\/\/|file:\/\/|wab:\/\/)/.test(input)) return true;
    if (/^[\w-]+(\.[\w-]+)+/.test(input) && !input.includes(' ')) return true;
    if (/^localhost(:\d+)?/.test(input)) return true;
    return false;
  }

  function normalizeURL(input) {
    if (/^(https?:\/\/|file:\/\/|wab:\/\/)/.test(input)) return input;
    if (/^localhost/.test(input)) return 'http://' + input;
    return 'https://' + input;
  }

  async function navigate(input) {
    input = input.trim();
    if (!input) return;

    const wv = getActiveWebview();
    if (!wv) return;

    if (isURL(input)) {
      wv.src = normalizeURL(input);
    } else {
      // Check WAB Smart Index first — if we have a strong local result, go directly
      try {
        const localResults = await wab.wabIndex.search(input);
        if (localResults && localResults.length > 0 && localResults[0].score >= 10 && localResults[0].visits >= 3) {
          // Strong local match → navigate directly
          wv.src = localResults[0].url;
          dom.urlInput.blur();
          hideSuggestions();
          return;
        }
      } catch(e) {}

      // Fall back to external search engine
      const searchUrl = await wab.search.getUrl(input);
      wv.src = searchUrl;
    }

    dom.urlInput.blur();
    hideSuggestions();
  }

  function updateUrlBar(url) {
    if (!url || url === NEW_TAB_URL || url.startsWith('file://')) {
      dom.urlInput.value = '';
      dom.securityIcon.className = '';
      return;
    }
    dom.urlInput.value = url;

    // Update security icon
    if (url.startsWith('https://')) {
      dom.securityIcon.className = 'secure';
    } else if (url.startsWith('http://')) {
      dom.securityIcon.className = 'insecure';
    } else {
      dom.securityIcon.className = '';
    }
  }

  function updateNavButtons() {
    const wv = getActiveWebview();
    if (!wv) return;
    try {
      dom.backBtn.disabled = !wv.canGoBack();
      dom.forwardBtn.disabled = !wv.canGoForward();
    } catch(e) {
      dom.backBtn.disabled = true;
      dom.forwardBtn.disabled = true;
    }
  }

  // ──────────────────────── Search Suggestions ────────────────────────
  let suggestTimeout = null;

  async function showSuggestions(query) {
    if (!query || query.length < 2) { hideSuggestions(); return; }
    if (isURL(query)) { hideSuggestions(); return; }

    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(async () => {
      try {
        // Parallel fetch: WAB Index local results + external suggestions
        const [wabResults, externalSuggestions] = await Promise.all([
          wab.wabIndex.suggest(query),
          wab.search.suggestions(query).catch(() => [])
        ]);

        const items = [];
        const seen = new Set();

        // WAB Index results first (local memory)
        if (wabResults && wabResults.length > 0) {
          for (const r of wabResults.slice(0, 5)) {
            if (!seen.has(r.url)) {
              seen.add(r.url);
              items.push({ text: r.text, value: r.url, icon: '🧠', type: r.type === 'history' ? 'History' : 'WAB Index', isUrl: true });
            }
          }
        }

        // External suggestions
        if (externalSuggestions && externalSuggestions.length > 0) {
          for (const s of externalSuggestions.slice(0, 5)) {
            if (!seen.has(s)) {
              seen.add(s);
              items.push({ text: s, value: s, icon: '🔍', type: 'Search', isUrl: false });
            }
          }
        }

        if (items.length === 0) { hideSuggestions(); return; }

        state.suggestionIndex = -1;
        dom.urlSuggestions.innerHTML = items.map((item, i) => `
          <div class="suggestion-item" data-index="${i}" data-value="${escapeAttr(item.value)}" data-is-url="${item.isUrl}">
            <span class="suggestion-icon">${item.icon}</span>
            <span class="suggestion-text">${escapeHtml(item.text)}</span>
            <span class="suggestion-type">${item.type}</span>
          </div>
        `).join('');

        dom.urlSuggestions.classList.remove('hidden');

        dom.urlSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const val = item.dataset.value;
            dom.urlInput.value = val;
            if (item.dataset.isUrl === 'true') {
              navigate(val);
            } else {
              navigate(val);
            }
          });
        });
      } catch(e) {}
    }, 200);
  }

  function hideSuggestions() {
    dom.urlSuggestions.classList.add('hidden');
    state.suggestionIndex = -1;
  }

  function navigateSuggestions(dir) {
    const items = dom.urlSuggestions.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;

    items.forEach(i => i.classList.remove('selected'));
    state.suggestionIndex += dir;
    if (state.suggestionIndex >= items.length) state.suggestionIndex = 0;
    if (state.suggestionIndex < 0) state.suggestionIndex = items.length - 1;

    items[state.suggestionIndex].classList.add('selected');
    dom.urlInput.value = items[state.suggestionIndex].dataset.value;
  }

  // ──────────────────────── Scam Shield ────────────────────────
  async function checkScamShield(url) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === 'file:') {
        updateShieldUI(null);
        return;
      }

      const result = await wab.shield.checkDomain(parsedUrl.hostname);
      const tab = state.tabs.find(t => t.id === state.activeTabId);
      if (tab) tab.shieldResult = result;
      updateShieldUI(result);
    } catch(e) {
      updateShieldUI(null);
    }
  }

  function updateShieldUI(result) {
    if (!result) {
      dom.shieldBtn.className = 'shield-safe';
      dom.shieldBadge.classList.add('hidden');
      dom.statusShield.textContent = '';
      dom.statusShield.className = '';
      return;
    }

    if (result.safe || result.riskScore === 0) {
      dom.shieldBtn.className = 'shield-safe';
      dom.shieldBadge.classList.add('hidden');
      dom.statusShield.textContent = '🛡️ Safe';
      dom.statusShield.className = 'safe';
    } else if (result.riskScore < 40) {
      dom.shieldBtn.className = 'shield-warning';
      dom.shieldBadge.classList.remove('hidden');
      dom.statusShield.textContent = `⚠️ Caution (${result.riskScore}%)`;
      dom.statusShield.className = 'warning';
    } else {
      dom.shieldBtn.className = 'shield-danger';
      dom.shieldBadge.classList.remove('hidden');
      dom.statusShield.textContent = `🚨 Danger (${result.riskScore}%)`;
      dom.statusShield.className = 'danger';
    }
  }

  // ──────────────────────── Ghost Mode ────────────────────────
  async function toggleGhostMode() {
    state.ghostMode = !state.ghostMode;
    await wab.ghost.toggle(state.ghostMode);
    updateGhostUI();
  }

  function updateGhostUI() {
    dom.ghostBtn.className = state.ghostMode ? 'ghost-on' : 'ghost-off';
    dom.statusGhost.textContent = state.ghostMode ? '👻 Ghost Mode' : '';
    dom.statusGhost.className = state.ghostMode ? 'active' : '';
  }

  // ──────────────────────── Bookmarks ────────────────────────
  async function toggleBookmark() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url || tab.url.startsWith('file://')) return;

    const isBookmarked = await wab.bookmarks.check(tab.url);
    if (isBookmarked) {
      await wab.bookmarks.remove(tab.url);
    } else {
      await wab.bookmarks.add({ url: tab.url, title: tab.title, favicon: tab.favicon });
    }
    updateBookmarkBtn();
  }

  async function updateBookmarkBtn() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url || tab.url.startsWith('file://')) {
      dom.bookmarkBtn.classList.remove('bookmarked');
      return;
    }
    const isBookmarked = await wab.bookmarks.check(tab.url);
    dom.bookmarkBtn.classList.toggle('bookmarked', isBookmarked);
  }

  // ──────────────────────── History ────────────────────────
  async function addToHistory(url, title) {
    if (!url || url.startsWith('file://') || url === 'about:blank') return;
    await wab.history.add({ url, title: title || url });
    // Feed the WAB Smart Index
    wab.wabIndex.learn(url, title || '');
  }

  // ──────────────────────── Menu ────────────────────────
  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    dom.menuDropdown.classList.toggle('hidden', !state.menuOpen);
  }

  function closeMenu() {
    state.menuOpen = false;
    dom.menuDropdown.classList.add('hidden');
  }

  // ──────────────────────── Sidebar ────────────────────────
  function openSidebar(panel) {
    state.sidebarPanel = panel;
    dom.sidebar.classList.remove('hidden');
    dom.sidebarTitle.textContent = panel;

    switch (panel) {
      case 'History': loadHistoryPanel(); break;
      case 'Bookmarks': loadBookmarksPanel(); break;
      case 'Settings': loadSettingsPanel(); break;
      case 'Search Engine': loadSearchEnginePanel(); break;
      case 'About': loadAboutPanel(); break;
      default: dom.sidebarContent.innerHTML = '';
    }
  }

  function closeSidebar() {
    dom.sidebar.classList.add('hidden');
    state.sidebarPanel = null;
  }

  async function loadHistoryPanel() {
    const history = await wab.history.get();
    if (history.length === 0) {
      dom.sidebarContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">No history yet</p>';
      return;
    }

    dom.sidebarContent.innerHTML = history.slice(0, 100).map(h => `
      <div class="sb-item" data-url="${escapeAttr(h.url)}">
        <div style="flex:1;overflow:hidden">
          <div class="sb-title">${escapeHtml(h.title || 'Untitled')}</div>
          <div class="sb-url">${escapeHtml(h.url)}</div>
        </div>
        <span class="sb-time">${timeAgo(h.timestamp)}</span>
      </div>
    `).join('');

    dom.sidebarContent.querySelectorAll('.sb-item').forEach(item => {
      item.addEventListener('click', () => {
        navigate(item.dataset.url);
        closeSidebar();
      });
    });
  }

  async function loadBookmarksPanel() {
    const bookmarks = await wab.bookmarks.get();
    if (bookmarks.length === 0) {
      dom.sidebarContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px">No bookmarks yet</p>';
      return;
    }

    dom.sidebarContent.innerHTML = bookmarks.map(b => `
      <div class="sb-item" data-url="${escapeAttr(b.url)}">
        <div style="flex:1;overflow:hidden">
          <div class="sb-title">${escapeHtml(b.title || 'Untitled')}</div>
          <div class="sb-url">${escapeHtml(b.url)}</div>
        </div>
        <button class="sb-delete" data-url="${escapeAttr(b.url)}" title="Remove">✕</button>
      </div>
    `).join('');

    dom.sidebarContent.querySelectorAll('.sb-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.sb-delete')) return;
        navigate(item.dataset.url);
        closeSidebar();
      });
    });

    dom.sidebarContent.querySelectorAll('.sb-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await wab.bookmarks.remove(btn.dataset.url);
        loadBookmarksPanel();
        updateBookmarkBtn();
      });
    });
  }

  async function loadSearchEnginePanel() {
    const engines = await wab.search.engines();
    const prefs = await wab.store.get('preferences') || {};
    const current = prefs.searchEngine || 'duckduckgo';

    const names = { duckduckgo: 'DuckDuckGo', google: 'Google', bing: 'Bing', startpage: 'Startpage' };
    const descs = { duckduckgo: 'Privacy-focused search', google: 'Most popular search engine', bing: 'Microsoft search', startpage: 'Google results without tracking' };

    dom.sidebarContent.innerHTML = `<div class="engine-selector">${engines.map(e => `
      <div class="engine-option ${e === current ? 'active' : ''}" data-engine="${e}">
        <div>
          <div class="engine-name">${names[e] || e}</div>
          <div style="font-size:11px;color:var(--text-muted)">${descs[e] || ''}</div>
        </div>
      </div>
    `).join('')}</div>`;

    dom.sidebarContent.querySelectorAll('.engine-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        await wab.search.setEngine(opt.dataset.engine);
        loadSearchEnginePanel();
      });
    });
  }

  async function loadSettingsPanel() {
    const prefs = await wab.store.get('preferences') || {};

    dom.sidebarContent.innerHTML = `
      <div class="settings-group">
        <h4>Privacy</h4>
        <div class="setting-row">
          <span class="setting-label">Ghost Mode by default</span>
          <div class="toggle ${prefs.ghostModeDefault ? 'on' : ''}" data-key="ghostModeDefault"></div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Send Do Not Track</span>
          <div class="toggle on" style="opacity:0.5;pointer-events:none"></div>
        </div>
      </div>
      <div class="settings-group">
        <h4>🛡️ Ad Blocker</h4>
        <div class="setting-row">
          <span class="setting-label">حجب الإعلانات</span>
          <div class="toggle ${prefs.adBlockEnabled !== false ? 'on' : ''}" data-key="adBlockEnabled"></div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="setting-label">إعلانات محظورة هذه الجلسة</span>
          <span class="adblock-stats-num" id="settings-adblock-count" style="color:var(--accent);font-size:18px;font-weight:bold">${adblockCount}</span>
        </div>
      </div>
      <div class="settings-group">
        <h4>Data</h4>
        <button class="modal-btn secondary" id="clear-history-btn" style="width:auto;padding:8px 16px">Clear History</button>
      </div>
    `;

    dom.sidebarContent.querySelectorAll('.toggle[data-key]').forEach(toggle => {
      toggle.addEventListener('click', async () => {
        const key = toggle.dataset.key;
        const prefs = await wab.store.get('preferences') || {};
        prefs[key] = !prefs[key];
        await wab.store.set('preferences', prefs);
        toggle.classList.toggle('on');
        // Sync adblock toggle
        if (key === 'adBlockEnabled') {
          adblockOn = prefs[key];
          await wab.adblock.toggle(adblockOn);
          updateAdblockUI();
        }
      });
    });

    const clearBtn = dom.sidebarContent.querySelector('#clear-history-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await wab.history.clear();
        clearBtn.textContent = 'Cleared!';
        setTimeout(() => { clearBtn.textContent = 'Clear History'; }, 2000);
      });
    }
  }

  async function loadAboutPanel() {
    const info = await wab.app.info();
    dom.sidebarContent.innerHTML = `
      <div class="about-panel">
        <svg width="64" height="64" viewBox="0 0 40 40" class="logo-large">
          <circle cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" stroke-width="2"/>
          <path d="M12 26 L16 14 L20 22 L24 14 L28 26" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="20" cy="12" r="2.5" fill="var(--accent)"/>
        </svg>
        <h2>WAB Browser</h2>
        <p class="version">v${info.version} · ${info.platform} · ${info.arch}</p>
        <p>The Intelligent Web Agent Browser.<br>Built by WebAgentBridge.</p>
        <p style="margin-top:16px;font-size:12px;color:var(--text-muted)">
          Ghost Mode · Scam Shield · Smart Search<br>
          Ad Blocker · Fairness System · Agent Chat<br>
          Agent Workspace · Bilingual (AR/EN)<br>
          Your data stays on your device.
        </p>
      </div>
    `;
  }

  // ──────────────────────── Auth Modal ────────────────────────
  function showAuthModal() {
    closeMenu();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>WAB Account</h2>
        <div id="auth-content"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    loadAuthStatus(overlay);
  }

  async function loadAuthStatus(overlay) {
    const auth = await wab.auth.status();
    const content = overlay.querySelector('#auth-content');

    if (auth.loggedIn) {
      content.innerHTML = `
        <p style="margin-bottom:16px">Logged in as <strong>${escapeHtml(auth.email)}</strong></p>
        <button class="modal-btn secondary" id="auth-logout">Logout</button>
        <button class="modal-btn secondary" id="auth-close" style="margin-top:8px">Close</button>
      `;
      content.querySelector('#auth-logout').addEventListener('click', async () => {
        await wab.auth.logout();
        overlay.remove();
      });
      content.querySelector('#auth-close').addEventListener('click', () => overlay.remove());
    } else {
      content.innerHTML = `
        <div class="modal-error hidden" id="auth-error"></div>
        <input class="modal-input" type="email" id="auth-email" placeholder="Email" />
        <input class="modal-input" type="password" id="auth-password" placeholder="Password" />
        <button class="modal-btn" id="auth-login-btn">Login</button>
        <button class="modal-btn secondary" id="auth-register-btn">Register</button>
        <div class="modal-link"><a id="auth-cancel">Cancel</a></div>
      `;

      content.querySelector('#auth-login-btn').addEventListener('click', async () => {
        const email = content.querySelector('#auth-email').value.trim();
        const pw = content.querySelector('#auth-password').value;
        if (!email || !pw) return;

        const errEl = content.querySelector('#auth-error');
        const result = await wab.auth.login(email, pw);
        if (result.error) {
          errEl.textContent = result.error;
          errEl.classList.remove('hidden');
        } else if (result.token) {
          overlay.remove();
        }
      });

      content.querySelector('#auth-register-btn').addEventListener('click', async () => {
        const email = content.querySelector('#auth-email').value.trim();
        const pw = content.querySelector('#auth-password').value;
        if (!email || !pw) return;

        const errEl = content.querySelector('#auth-error');
        const result = await wab.auth.register({ email, password: pw });
        if (result.error) {
          errEl.textContent = result.error;
          errEl.classList.remove('hidden');
        } else {
          errEl.textContent = 'Registered! Please login.';
          errEl.style.color = 'var(--safe)';
          errEl.classList.remove('hidden');
        }
      });

      content.querySelector('#auth-cancel').addEventListener('click', () => overlay.remove());
    }
  }

  // ──────────────────────── Agent Chat + Tasks ────────────────────────
  let chatOpen = false;
  let activeTaskId = null;
  let activeTaskStatus = null;

  function toggleChat() {
    chatOpen = !chatOpen;
    dom.chatPanel.classList.toggle('hidden', !chatOpen);
    if (chatOpen) {
      dom.chatInput.focus();
      if (notifOpen) toggleNotifications();
    }
  }

  async function sendChatMessage() {
    const text = dom.chatInput.value.trim();
    if (!text) return;

    appendChatMsg('user', text);
    dom.chatInput.value = '';

    // Show typing indicator
    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div> WAB Agent يعمل... working...';
    dom.chatMessages.appendChild(typing);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    const tab = state.tabs.find(t => t.id === state.activeTabId);
    const context = {
      url: tab?.url || '',
      title: tab?.title || '',
      ghostMode: state.ghostMode,
    };

    // Build payload — if there's an active task, send as task action
    const payload = { message: text, context };
    if (activeTaskId && activeTaskStatus === 'clarifying') {
      payload.taskId = activeTaskId;
      payload.taskAction = 'answer';
    }

    try {
      const response = await wab.agent.chat(text, payload);
      typing.remove();

      if (response?.type === 'task') {
        handleTaskResponse(response);
      } else {
        const reply = response?.reply || response?.message || 'No response.';
        appendChatMsg('agent', reply);
      }
    } catch(e) {
      typing.remove();
      appendChatMsg('agent', '⚠️ تعذر الاتصال بالوكيل. حاول لاحقاً.\nCould not reach the agent. Try again later.');
    }
  }

  function handleTaskResponse(response) {
    activeTaskId = response.taskId || activeTaskId;
    activeTaskStatus = response.status;

    if (response.status === 'clarifying') {
      // Agent needs more info
      appendChatMsg('agent', response.message, 'clarification');
      dom.chatInput.placeholder = '↩ أجب على سؤال الوكيل... Answer the agent...';
    } else if (response.status === 'presenting' && response.offers) {
      // Show offers as interactive cards
      appendChatMsg('agent', response.message);
      renderOfferCards(response.offers);
      dom.chatInput.placeholder = 'اختر رقم العرض — Pick offer number (e.g. 1)';
    } else if (response.status === 'completed' && response.action?.type === 'open_url') {
      appendChatMsg('agent', response.message, 'success');
      // Open the selected URL in a new tab
      const url = response.action.url;
      if (url) {
        setTimeout(() => {
          createTab(url);
        }, 1000);
      }
      activeTaskId = null;
      activeTaskStatus = null;
      dom.chatInput.placeholder = 'اسأل الوكيل... Ask the agent...';
    } else if (response.status === 'failed') {
      appendChatMsg('agent', response.message, 'error');
      activeTaskId = null;
      activeTaskStatus = null;
      dom.chatInput.placeholder = 'اسأل الوكيل... Ask the agent...';
    } else {
      // Progress or other statuses
      const msg = response.message || response.reply || '';
      if (msg) appendChatMsg('agent', msg, 'progress');
    }
  }

  function renderOfferCards(offers) {
    const container = document.createElement('div');
    container.className = 'offer-cards';

    offers.forEach((offer, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const card = document.createElement('div');
      card.className = `offer-card${i === 0 ? ' best' : ''}`;
      card.innerHTML = `
        <div class="offer-header">
          <span class="offer-medal">${medal}</span>
          <span class="offer-source">${escapeHtml(offer.source)}</span>
          <span class="offer-score">${offer.score}/100</span>
        </div>
        <div class="offer-title">${escapeHtml(offer.title || '')}</div>
        ${offer.price ? `<div class="offer-price">💰 ${escapeHtml(String(offer.price))}</div>` : ''}
        ${offer.negotiation?.savings ? `<div class="offer-savings">🤝 وفّرت: ${offer.negotiation.savings} (${offer.negotiation.savingsPercent}%)</div>` : ''}
        ${offer.negotiation?.log?.[0] ? `<div class="offer-tip">${escapeHtml(offer.negotiation.log[0])}</div>` : ''}
        <button class="offer-select-btn" data-index="${i}">اختر ➜ Select</button>
      `;
      container.appendChild(card);
    });

    // Add click handlers
    container.querySelectorAll('.offer-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        dom.chatInput.value = `اختر ${idx + 1}`;
        sendChatMessage();
      });
    });

    dom.chatMessages.appendChild(container);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function appendChatMsg(role, text, msgType) {
    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}${msgType ? ` msg-${msgType}` : ''}`;
    // Convert **bold** to <strong> and URLs to links
    let html = escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" class="chat-link" data-url="$1">$1</a>')
      .replace(/\n/g, '<br>');
    msg.innerHTML = `<div class="chat-msg-content">${html}</div>`;

    // Add click handlers for links
    msg.querySelectorAll('.chat-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        createTab(link.dataset.url);
      });
    });

    dom.chatMessages.appendChild(msg);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  // ──────────────────────── Notifications ────────────────────────
  let notifOpen = false;
  let unreadCount = 0;

  function toggleNotifications() {
    notifOpen = !notifOpen;
    dom.notifPanel.classList.toggle('hidden', !notifOpen);
    if (notifOpen) {
      loadNotifications();
      // Close chat if open
      if (chatOpen) toggleChat();
    }
  }

  async function loadNotifications() {
    const notifs = await wab.notifications.get();
    if (!notifs || notifs.length === 0) {
      dom.notifList.innerHTML = '<div class="notif-empty">No alerts yet.<br>Scam Shield analyzes every page you visit.</div>';
      return;
    }

    dom.notifList.innerHTML = notifs.map(n => {
      const icons = { info: 'ℹ️', warning: '⚠️', danger: '🚨', success: '✅' };
      return `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notif-icon ${n.type || 'info'}">${icons[n.type] || 'ℹ️'}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-message">${escapeHtml(n.message)}</div>
            <div class="notif-time">${timeAgo(n.timestamp || n.id)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Mark all as read
    for (const n of notifs) {
      if (!n.read) await wab.notifications.markRead(n.id);
    }
    unreadCount = 0;
    updateNotifBadge();
  }

  function updateNotifBadge() {
    if (unreadCount > 0) {
      dom.notifBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      dom.notifBadge.classList.remove('hidden');
    } else {
      dom.notifBadge.classList.add('hidden');
    }
  }

  function showToast(type, text) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { info: 'ℹ️', warning: '⚠️', danger: '🚨', success: '✅' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-text">${escapeHtml(text)}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  async function analyzeCurrentPage() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url || tab.url.startsWith('file://') || tab.url === 'about:blank') return;

    try {
      const alerts = await wab.agent.analyzeePage(tab.url, tab.title || '', '');
      for (const alert of alerts) {
        await wab.notifications.add(alert);
        if (alert.type === 'danger' || alert.type === 'warning') {
          showToast(alert.type, alert.message);
        }
      }
    } catch(e) {}
  }

  // ──────────────────────── Ad Blocker UI ────────────────────────
  let adblockOn = true;
  let adblockCount = 0;

  async function initAdblock() {
    adblockOn = await wab.adblock.status();
    updateAdblockUI();
    setInterval(updateAdblockStats, 10000);
  }

  async function toggleAdblock() {
    adblockOn = !adblockOn;
    await wab.adblock.toggle(adblockOn);
    updateAdblockUI();
    showToast('info', adblockOn ? '🛡️ حجب الإعلانات مفعّل' : '⚠️ حجب الإعلانات معطّل');
  }

  function updateAdblockUI() {
    dom.adblockBtn.className = adblockOn ? 'adblock-on' : 'adblock-off';
    dom.adblockBtn.title = adblockOn ? 'Ad Blocker: ON' : 'Ad Blocker: OFF';
  }

  async function updateAdblockStats() {
    const stats = await wab.adblock.stats();
    adblockCount = stats.session;
    dom.adblockBadge.textContent = adblockCount > 999 ? '999+' : adblockCount;
    dom.adblockBadge.classList.toggle('hidden', adblockCount === 0);
  }

  async function injectAdblockCss() {
    const wv = getActiveWebview();
    if (!wv || !adblockOn) return;
    try {
      const css = await wab.adblock.cosmeticCss();
      if (css) wv.insertCSS(css);
    } catch(e) {}
  }

  // ──────────────────────── Fairness UI ────────────────────────
  async function showFairnessInfo() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url || tab.url.startsWith('file://')) {
      alert('⚖️ نظام العدالة\n\nافتح موقعاً لتحليل درجة العدالة');
      return;
    }
    try {
      const result = await wab.fairness.analyze(tab.url);
      const stars = result.score >= 65 ? '⭐⭐⭐' : result.score >= 40 ? '⭐⭐' : '⭐';
      const cat = result.category === 'small-trusted' ? '🟢 موقع صغير موثوق'
        : result.category === 'big-tech' ? '🔴 شركة كبيرة' : '🟡 محايد';
      const reasons = result.reasons.length > 0 ? result.reasons.join('، ') : 'لا توجد بيانات إضافية';
      alert(`⚖️ نظام العدالة — ${result.domain}\n\n${cat}\nدرجة العدالة: ${result.score}/100 ${stars}\n\nالأسباب: ${reasons}\n\nنظام العدالة يفضّل المواقع الصغيرة الموثوقة على الكبيرة.`);
    } catch(e) {
      alert('⚖️ نظام العدالة\n\nتعذر تحليل هذا الموقع');
    }
  }

  // ──────────────────────── Universal Agent Panel ────────────────────────
  let universalOpen = false;
  let universalData = null; // cached extraction for current page

  function toggleUniversal() {
    universalOpen = !universalOpen;
    dom.universalPanel.classList.toggle('hidden', !universalOpen);
    if (universalOpen) {
      if (chatOpen) toggleChat();
      if (notifOpen) toggleNotifications();
      analyzeUniversalPage();
    }
  }

  async function analyzeUniversalPage() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url || tab.url.startsWith('file://') || tab.url === 'about:blank') {
      renderUniversalEmpty();
      return;
    }

    const domain = _extractDomain(tab.url);
    $('#uniPageDomain').textContent = domain;
    $('#uniPageTitle').textContent = tab.title || tab.url;
    $('#uniLoading').classList.remove('hidden');
    $('#uniProducts').style.display = 'none';
    $('#uniDarkPatterns').style.display = 'none';
    $('#uniFraudAlerts').style.display = 'none';
    $('#uniCompareResults').style.display = 'none';

    try {
      // Try extracting from the webview first (client-side, more accurate)
      let extraction = null;
      const wv = getActiveWebview();
      if (wv) {
        try {
          const script = await wab.universal.getExtractionScript();
          extraction = await wv.executeJavaScript(script);
        } catch(_) {}
      }

      let result;
      if (extraction && (extraction.jsonLd?.length > 0 || extraction.cards?.length > 0 || extraction.prices?.length > 0)) {
        // Send browser extraction to server for analysis
        result = await wab.universal.analyze({ extraction: { ...extraction, url: tab.url } });
      } else {
        // Fall back to server-side fetch
        result = await wab.universal.analyze({ url: tab.url });
      }

      universalData = result;
      renderUniversalResults(result, domain);
    } catch (e) {
      renderUniversalError(e.message);
    } finally {
      $('#uniLoading').classList.add('hidden');
    }
  }

  function renderUniversalResults(data, domain) {
    // Bridge status
    const bridge = data.fairness?.wabBridge || { installed: false };
    $('#uniBridgeInfo').innerHTML = bridge.installed
      ? `<div class="uni-badge bridge">🌉 WAB Bridge مثبت</div>
         ${bridge.hasNegotiation ? '<div class="uni-badge negotiate">🤝 التفاوض متاح — Negotiable</div>' : ''}
         ${bridge.isListed ? '<div class="uni-badge listed">📋 مسجل في الدليل</div>' : ''}
         <div class="uni-badge tier">${bridge.tier || 'free'}</div>
         <div class="uni-note">⭐ هذا الموقع يحصل على أولوية في الترتيب والبحث</div>`
      : `<div class="uni-badge no-bridge">🌐 Universal Mode — وضع شامل</div>
         <div class="uni-note">يعمل بالاستخراج الذكي — بدون سكربت مثبت</div>`;

    // Fairness
    const f = data.fairness;
    if (f) {
      const barColor = f.total >= 70 ? '#22c55e' : f.total >= 45 ? '#eab308' : '#ef4444';
      const catLabel = f.category === 'recommended' ? '✅ موصى — Recommended'
        : f.category === 'caution' ? '⚠️ حذر — Caution' : '🟡 محايد — Neutral';
      $('#uniFairnessScore').innerHTML = `
        <div class="uni-score-bar"><div class="uni-score-fill" style="width:${f.total}%;background:${barColor}"></div></div>
        <div class="uni-score-row"><span>${f.total}/100</span><span class="uni-cat">${catLabel}</span></div>
        ${f.platform ? `<div class="uni-meta">📏 ${f.platform.size} · 💸 ${f.platform.commission}% commission</div>` : ''}
        ${f.wabBridge?.bonus > 0 ? `<div class="uni-meta bridge-bonus">🌉 WAB bonus: +${f.wabBridge.bonus}</div>` : ''}
        <div class="uni-score-details">
          <span>📐 Size: ${f.breakdown.sizeScore}</span>
          <span>🤝 Trust: ${f.breakdown.trustScore}</span>
          <span>💰 Price: ${f.breakdown.priceHonesty}</span>
          <span>🔍 Transparency: ${f.breakdown.transparency}</span>
        </div>`;
    }

    // Products
    const products = data.products || [];
    if (products.length > 0) {
      $('#uniProducts').style.display = '';
      $('#uniProductsList').innerHTML = products.slice(0, 8).map(p => `
        <div class="uni-product">
          <div class="uni-product-name">${escapeHtml(String(p.name || 'Unknown').slice(0, 100))}</div>
          <div class="uni-product-row">
            ${p.price ? `<span class="uni-price">${p.currency || '$'}${p.price}</span>` : ''}
            ${p.originalPrice ? `<span class="uni-original">${p.currency || '$'}${p.originalPrice}</span>` : ''}
            ${p.rating ? `<span class="uni-rating">⭐ ${p.rating}</span>` : ''}
            <span class="uni-method">${p.method || ''}</span>
          </div>
        </div>
      `).join('');
    }

    // Dark Patterns
    const darkPatterns = data.darkPatterns || [];
    if (darkPatterns.length > 0) {
      $('#uniDarkPatterns').style.display = '';
      $('#uniDarkList').innerHTML = darkPatterns.map(dp => `
        <div class="uni-dark ${dp.severity || 'low'}">
          <span class="uni-dark-icon">🚩</span>
          <span>${escapeHtml(dp.type || dp.name || '')} ${dp.matches ? '— ' + dp.matches.slice(0, 3).map(m => escapeHtml(m)).join(', ') : ''}</span>
        </div>
      `).join('');
    }

    // Fraud Alerts
    const alerts = data.alerts || [];
    if (alerts.length > 0) {
      $('#uniFraudAlerts').style.display = '';
      $('#uniFraudList').innerHTML = alerts.map(a => `
        <div class="uni-alert ${a.severity || 'medium'}">
          <span class="uni-alert-icon">${a.severity === 'high' ? '🚨' : '⚠️'}</span>
          <div><strong>${escapeHtml(a.title || '')}</strong><br><small>${escapeHtml(a.description || '')}</small></div>
        </div>
      `).join('');
    }

    // Update badge
    const issueCount = darkPatterns.length + alerts.length;
    dom.universalBadge.textContent = issueCount || '✓';
    dom.universalBadge.classList.toggle('hidden', false);
    dom.universalBadge.className = issueCount > 0 ? 'universal-badge warning' : 'universal-badge safe';
  }

  function renderUniversalEmpty() {
    $('#uniPageDomain').textContent = '';
    $('#uniPageTitle').textContent = 'Open a website to analyze — افتح موقعاً للتحليل';
    $('#uniBridgeInfo').innerHTML = '<div class="uni-note">Navigate to any site to start analysis</div>';
    $('#uniFairnessScore').innerHTML = '';
    dom.universalBadge.classList.add('hidden');
  }

  function renderUniversalError(msg) {
    $('#uniFairnessScore').innerHTML = `<div class="uni-note error">⚠️ ${escapeHtml(msg)}</div>`;
  }

  // Compare prices
  async function universalCompare() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.url) return;
    $('#uniLoading').classList.remove('hidden');
    try {
      const query = tab.title || _extractDomain(tab.url);
      const result = await wab.universal.compare(query, 'product');
      renderCompareResults(result);
    } catch(e) {
      showToast('warning', 'Compare failed: ' + e.message);
    } finally {
      $('#uniLoading').classList.add('hidden');
    }
  }

  // Find deals
  async function universalDeals() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab) return;
    $('#uniLoading').classList.remove('hidden');
    try {
      const query = tab.title || _extractDomain(tab.url);
      const result = await wab.universal.deals(query, 'product', 'ar');
      renderCompareResults(result);
    } catch(e) {
      showToast('warning', 'Deals search failed: ' + e.message);
    } finally {
      $('#uniLoading').classList.add('hidden');
    }
  }

  // Deep analyze — re-run full analysis
  async function universalDeepAnalyze() {
    analyzeUniversalPage();
  }

  function renderCompareResults(data) {
    const deals = data.deals || data.results || [];
    if (deals.length === 0) {
      showToast('info', 'No comparison results found');
      return;
    }
    $('#uniCompareResults').style.display = '';
    const badges = ['🥇', '🥈', '🥉'];
    $('#uniCompareList').innerHTML = `
      ${(data.insights || []).map(ins => `
        <div class="uni-insight"><span>${ins.icon || '💡'}</span> ${escapeHtml(ins.text)}</div>
      `).join('')}
      ${deals.slice(0, 10).map((d, i) => `
        <div class="uni-deal ${i === 0 ? 'best' : ''} ${d.wabBridge ? 'wab-bridge' : ''}">
          <div class="uni-deal-header">
            <span class="uni-deal-rank">${badges[i] || '#' + (i + 1)}</span>
            <span class="uni-deal-source">${escapeHtml(d.source || d.domain || '')}</span>
            ${d.wabBridge ? '<span class="uni-badge bridge small">🌉 WAB</span>' : ''}
            ${d.canNegotiate ? '<span class="uni-badge negotiate small">🤝</span>' : ''}
            <span class="uni-deal-score">${d.compositeScore || d.score || ''}</span>
          </div>
          <div class="uni-deal-name">${escapeHtml(String(d.name || '').slice(0, 80))}</div>
          <div class="uni-deal-row">
            ${d.priceUsd ? `<span class="uni-price">$${d.priceUsd}</span>` : ''}
            ${d.fairness ? `<span class="uni-fairness-mini ${d.fairness.category}">${d.fairness.total}/100</span>` : ''}
            ${d.rating ? `<span class="uni-rating">⭐ ${d.rating}</span>` : ''}
          </div>
          ${d.url ? `<a href="#" class="uni-deal-link" data-url="${escapeHtml(d.url)}">🔗 Open — فتح</a>` : ''}
        </div>
      `).join('')}
      <div class="uni-compare-summary">${data.sourcesChecked || 0} sources checked</div>
    `;

    // Add click handlers for deal links
    $$('#uniCompareList .uni-deal-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        createTab(link.dataset.url);
      });
    });
  }

  function _extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch(_) { return ''; }
  }

  // ──────────────────────── Keyboard Shortcuts ────────────────────────
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // Ctrl+T: New tab
    if (ctrl && !shift && e.key === 't') { e.preventDefault(); createTab(); }
    // Ctrl+W: Close tab
    if (ctrl && !shift && e.key === 'w') { e.preventDefault(); closeTab(state.activeTabId); }
    // Ctrl+L: Focus URL bar
    if (ctrl && !shift && e.key === 'l') { e.preventDefault(); dom.urlInput.focus(); dom.urlInput.select(); }
    // Ctrl+R / F5: Reload
    if ((ctrl && e.key === 'r') || e.key === 'F5') { e.preventDefault(); getActiveWebview()?.reload(); }
    // Ctrl+Shift+G: Ghost mode
    if (ctrl && shift && e.key === 'G') { e.preventDefault(); toggleGhostMode(); }
    // Ctrl+Shift+A: Agent chat
    if (ctrl && shift && e.key === 'A') { e.preventDefault(); toggleChat(); }
    // Ctrl+H: History
    if (ctrl && !shift && e.key === 'h') { e.preventDefault(); openSidebar('History'); }
    // Ctrl+B: Bookmarks
    if (ctrl && !shift && e.key === 'b') { e.preventDefault(); openSidebar('Bookmarks'); }
    // Ctrl+D: Bookmark current
    if (ctrl && !shift && e.key === 'd') { e.preventDefault(); toggleBookmark(); }
    // Ctrl+Shift+N: New ghost tab
    if (ctrl && shift && e.key === 'N') {
      e.preventDefault();
      if (!state.ghostMode) toggleGhostMode();
      createTab();
    }
    // Alt+Left: Back
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); getActiveWebview()?.goBack(); }
    // Alt+Right: Forward
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); getActiveWebview()?.goForward(); }
    // Escape: Close menu/sidebar/suggestions
    if (e.key === 'Escape') {
      closeMenu();
      closeSidebar();
      hideSuggestions();
      if (chatOpen) toggleChat();
      if (notifOpen) toggleNotifications();
      if (universalOpen) toggleUniversal();
      dom.urlInput.blur();
    }
    // Ctrl+Tab: Next tab
    if (ctrl && e.key === 'Tab') {
      e.preventDefault();
      const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
      const next = shift ? (idx - 1 + state.tabs.length) % state.tabs.length : (idx + 1) % state.tabs.length;
      switchTab(state.tabs[next].id);
    }
    // Ctrl+1-9: Switch to tab N
    if (ctrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const n = parseInt(e.key) - 1;
      if (n < state.tabs.length) switchTab(state.tabs[n].id);
    }
  });

  // ──────────────────────── Event Bindings ────────────────────────
  // URL bar
  dom.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = dom.urlSuggestions.querySelector('.suggestion-item.selected');
      if (selected) {
        navigate(selected.dataset.value);
      } else {
        navigate(dom.urlInput.value);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSuggestions(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSuggestions(-1);
    }
  });

  dom.urlInput.addEventListener('input', () => {
    showSuggestions(dom.urlInput.value);
  });

  dom.urlInput.addEventListener('focus', () => {
    dom.urlInput.select();
  });

  dom.urlInput.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 200);
  });

  // Navigation buttons
  dom.backBtn.addEventListener('click', () => getActiveWebview()?.goBack());
  dom.forwardBtn.addEventListener('click', () => getActiveWebview()?.goForward());
  dom.reloadBtn.addEventListener('click', () => getActiveWebview()?.reload());
  dom.homeBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) wv.src = NEW_TAB_URL;
  });

  // Tools
  dom.shieldBtn.addEventListener('click', () => {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (tab?.shieldResult) {
      const r = tab.shieldResult;
      const msg = r.safe
        ? `✅ ${r.domain}\nThis site is recognized as safe.`
        : `⚠️ ${r.domain}\nRisk Score: ${r.riskScore}%\nFlags: ${r.flags.join(', ') || 'None'}`;
      alert(msg);
    }
  });

  dom.ghostBtn.addEventListener('click', toggleGhostMode);
  dom.bookmarkBtn.addEventListener('click', toggleBookmark);
  dom.menuBtn.addEventListener('click', toggleMenu);

  // Ad Blocker
  dom.adblockBtn.addEventListener('click', toggleAdblock);
  dom.fairnessBtn.addEventListener('click', showFairnessInfo);

  // Universal Agent
  dom.universalBtn.addEventListener('click', toggleUniversal);
  dom.universalClose.addEventListener('click', toggleUniversal);
  $('#uniCompareBtn').addEventListener('click', universalCompare);
  $('#uniDealsBtn').addEventListener('click', universalDeals);
  $('#uniAnalyzeBtn').addEventListener('click', universalDeepAnalyze);

  // Chat
  dom.chatBtn.addEventListener('click', toggleChat);
  dom.chatClose.addEventListener('click', toggleChat);
  dom.chatSend.addEventListener('click', sendChatMessage);
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
  });

  // Notifications
  dom.notifBtn.addEventListener('click', toggleNotifications);
  dom.notifClose.addEventListener('click', toggleNotifications);
  dom.notifClear.addEventListener('click', async () => {
    await wab.notifications.clear();
    loadNotifications();
    unreadCount = 0;
    updateNotifBadge();
  });

  // Menu items
  $('#menu-new-tab')?.addEventListener('click', () => { closeMenu(); createTab(); });
  $('#menu-new-ghost')?.addEventListener('click', () => {
    closeMenu();
    if (!state.ghostMode) toggleGhostMode();
    createTab();
  });
  $('#menu-history')?.addEventListener('click', () => { closeMenu(); openSidebar('History'); });
  $('#menu-bookmarks')?.addEventListener('click', () => { closeMenu(); openSidebar('Bookmarks'); });
  $('#menu-search-engine')?.addEventListener('click', () => { closeMenu(); openSidebar('Search Engine'); });
  $('#menu-workspace')?.addEventListener('click', () => { closeMenu(); createTab('https://webagentbridge.com/workspace'); });
  $('#menu-settings')?.addEventListener('click', () => { closeMenu(); openSidebar('Settings'); });
  $('#menu-auth')?.addEventListener('click', () => showAuthModal());
  $('#menu-about')?.addEventListener('click', () => { closeMenu(); openSidebar('About'); });

  // New tab button
  $('#new-tab-btn')?.addEventListener('click', () => createTab());

  // Window controls
  $('#min-btn')?.addEventListener('click', () => wab.minimize());
  $('#max-btn')?.addEventListener('click', () => wab.maximize());
  $('#close-btn')?.addEventListener('click', () => wab.close());

  // Window state
  wab.onWindowState((state) => {
    const btn = $('#max-btn svg rect');
    // Could change icon for restore vs maximize
  });

  // Sidebar close
  dom.sidebarClose.addEventListener('click', closeSidebar);

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (state.menuOpen && !e.target.closest('#menu-dropdown') && !e.target.closest('#menu-btn')) {
      closeMenu();
    }
  });

  // New tab from main process
  wab.onNewTab((url) => createTab(url));

  // Incoming notifications from main process
  wab.notifications.onNew((n) => {
    unreadCount++;
    updateNotifBadge();
    if (n.type === 'danger' || n.type === 'warning') {
      showToast(n.type, n.message);
    }
  });

  // ──────────────────────── Helpers ────────────────────────
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return Math.floor(diff / 86400000) + 'd';
  }

  // ──────────────────────── Init ────────────────────────
  async function init() {
    // Resolve new-tab path from main process
    NEW_TAB_URL = await wab.app.newTabPath();

    // Load ghost mode state
    state.ghostMode = await wab.ghost.status();
    updateGhostUI();

    // Load ad blocker state
    await initAdblock();

    // Load unread notifications count
    const notifs = await wab.notifications.get();
    unreadCount = (notifs || []).filter(n => !n.read).length;
    updateNotifBadge();

    // Create first tab
    createTab();

    dom.statusText.textContent = 'Ready';

    // Memory monitor - update status bar every 30s
    setInterval(async () => {
      try {
        const mem = await wab.perf.memory();
        dom.statusText.textContent = `RAM: ${mem.rss}MB`;
      } catch(e) {}
    }, 30000);
  }

  init();
})();
