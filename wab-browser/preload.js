const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wab', {
  // Window controls
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_, state) => cb(state)),

  // Ghost mode
  ghost: {
    toggle: (enabled) => ipcRenderer.invoke('ghost:toggle', enabled),
    status: () => ipcRenderer.invoke('ghost:status'),
    getScript: () => ipcRenderer.invoke('ghost:script'),
    rotateUA: () => ipcRenderer.invoke('ghost:rotate-ua'),
  },

  // Scam Shield
  shield: {
    checkDomain: (domain) => ipcRenderer.invoke('shield:check-domain', domain),
    analyzeContent: (content) => ipcRenderer.invoke('shield:analyze-content', content),
  },

  // Search
  search: {
    getUrl: (query) => ipcRenderer.invoke('search:url', query),
    suggestions: (query) => ipcRenderer.invoke('search:suggestions', query),
    engines: () => ipcRenderer.invoke('search:engines'),
    setEngine: (engine) => ipcRenderer.invoke('search:set-engine', engine),
  },

  // Store
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },

  // History
  history: {
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    get: () => ipcRenderer.invoke('history:get'),
    clear: () => ipcRenderer.invoke('history:clear'),
  },

  // Bookmarks
  bookmarks: {
    add: (bm) => ipcRenderer.invoke('bookmarks:add', bm),
    remove: (url) => ipcRenderer.invoke('bookmarks:remove', url),
    get: () => ipcRenderer.invoke('bookmarks:get'),
    check: (url) => ipcRenderer.invoke('bookmarks:check', url),
  },

  // Auth
  auth: {
    login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
    register: (data) => ipcRenderer.invoke('auth:register', data),
    status: () => ipcRenderer.invoke('auth:status'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // Cache
  cache: {
    getSearch: (query) => ipcRenderer.invoke('cache:search-get', query),
    setSearch: (query, results) => ipcRenderer.invoke('cache:search-set', query, results),
  },

  // App
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('shell:open', url),
    newTabPath: () => ipcRenderer.invoke('app:new-tab-path'),
  },

  // Agent Chat
  agent: {
    chat: (message, context) => ipcRenderer.invoke('agent:chat', message, context),
    analyzeePage: (url, title, content) => ipcRenderer.invoke('agent:page-analysis', url, title, content),
  },

  // Notifications
  notifications: {
    get: () => ipcRenderer.invoke('notifications:get'),
    add: (n) => ipcRenderer.invoke('notifications:add', n),
    markRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    onNew: (cb) => ipcRenderer.on('notification-new', (_, n) => cb(n)),
  },

  // Ad Blocker
  adblock: {
    toggle: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
    status: () => ipcRenderer.invoke('adblock:status'),
    stats: () => ipcRenderer.invoke('adblock:stats'),
    resetStats: () => ipcRenderer.invoke('adblock:reset-stats'),
    cosmeticCss: () => ipcRenderer.invoke('adblock:cosmetic-css'),
    whitelistGet: () => ipcRenderer.invoke('adblock:whitelist-get'),
    whitelistAdd: (domain) => ipcRenderer.invoke('adblock:whitelist-add', domain),
    whitelistRemove: (domain) => ipcRenderer.invoke('adblock:whitelist-remove', domain),
  },

  // Fairness Ranking
  fairness: {
    analyze: (url) => ipcRenderer.invoke('fairness:analyze', url),
    rank: (urls) => ipcRenderer.invoke('fairness:rank', urls),
  },

  // Universal Agent (works on ANY page, no script needed)
  universal: {
    extract: (url) => ipcRenderer.invoke('universal:extract', url),
    analyze: (data) => ipcRenderer.invoke('universal:analyze', data),
    compare: (query, category) => ipcRenderer.invoke('universal:compare', query, category),
    deals: (query, category, lang) => ipcRenderer.invoke('universal:deals', query, category, lang),
    fairnessScore: (domain) => ipcRenderer.invoke('universal:fairness-score', domain),
    getExtractionScript: () => ipcRenderer.invoke('universal:extraction-script'),
  },

  // WAB Smart Index (Self-Learning Search)
  wabIndex: {
    learn: (url, title) => ipcRenderer.invoke('wabindex:learn', url, title),
    search: (query) => ipcRenderer.invoke('wabindex:search', query),
    suggest: (prefix) => ipcRenderer.invoke('wabindex:suggest', prefix),
    stats: () => ipcRenderer.invoke('wabindex:stats'),
    blockDomain: (domain) => ipcRenderer.invoke('wabindex:block-domain', domain),
    siteProfile: (domain) => ipcRenderer.invoke('wabindex:site-profile', domain),
  },

  // Sponsored Ads
  ads: {
    getActive: () => ipcRenderer.invoke('ads:get-active'),
    impression: (adId) => ipcRenderer.invoke('ads:impression', adId),
    click: (adId) => ipcRenderer.invoke('ads:click', adId),
  },

  // Performance
  perf: {
    memory: () => ipcRenderer.invoke('perf:memory'),
    gc: () => ipcRenderer.invoke('perf:gc'),
    clearCache: () => ipcRenderer.invoke('perf:clear-cache'),
  },

  // Events from main
  onNewTab: (cb) => ipcRenderer.on('open-new-tab', (_, url) => cb(url)),
});
