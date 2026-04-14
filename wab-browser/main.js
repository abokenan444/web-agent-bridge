const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ──────────────────── Performance Flags ────────────────────
// GPU & rendering acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('canvas-oop-rasterization');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization');

// Memory optimization
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --optimize-for-size --gc-interval=100');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-features', 'BackForwardCache');

// Process limits - reduces memory per webview
app.commandLine.appendSwitch('renderer-process-limit', '4');

// Network
app.commandLine.appendSwitch('enable-quic');

// Disable unnecessary features
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-translate');

// ──────────────────────── Config ────────────────────────
const WAB_API = 'https://webagentbridge.com';
const STORE_FILE = 'wab-data.json';

// ──────────────────────── Ad Blocker ────────────────────────
const AD_DOMAINS = new Set([
  // Google Ads
  'doubleclick.net','googleadservices.com','googlesyndication.com','googleads.g.doubleclick.net',
  'adservice.google.com','pagead2.googlesyndication.com','tpc.googlesyndication.com',
  'googletagmanager.com','google-analytics.com','googletagservices.com',
  // Facebook/Meta
  'facebook.net','fbcdn.net','facebook.com/tr','pixel.facebook.com',
  'connect.facebook.net','an.facebook.com',
  // Ad networks
  'adsrvr.org','adnxs.com','rubiconproject.com','pubmatic.com','openx.net',
  'casalemedia.com','criteo.com','criteo.net','outbrain.com','taboola.com',
  'revcontent.com','mgid.com','adblade.com','adroll.com','bidswitch.net',
  'lijit.com','sharethrough.com','33across.com','smartadserver.com',
  'appnexus.com','demdex.net','crwdcntrl.net','bluekai.com','exelator.com',
  'eyeota.net','addthis.com','ml314.com','quantserve.com','scorecardresearch.com',
  // Trackers
  'tracking.com','hotjar.com','mixpanel.com','segment.io','segment.com',
  'amplitude.com','chartbeat.com','optimizely.com','crazyegg.com',
  'mouseflow.com','clarity.ms','fullstory.com','luckyorange.com',
  'newrelic.com','nr-data.net','sentry.io',
  // Amazon ads
  'amazon-adsystem.com','aax.amazon-adsystem.com','fls-na.amazon-adsystem.com',
  // Twitter/X ads
  'ads-twitter.com','analytics.twitter.com','syndication.twitter.com',
  't.co','ads-api.twitter.com',
  // Ad serving
  'ad.doubleclick.net','static.doubleclick.net','m.doubleclick.net',
  'mediavisor.doubleclick.net','cm.g.doubleclick.net',
  'serving-sys.com','adform.net','adsafeprotected.com','moatads.com',
  'doubleverify.com','iasds01.com','2mdn.net',
  // Popups/Popunders
  'popads.net','popcash.net','propellerads.com','exoclick.com',
  'juicyads.com','trafficjunky.com','clickadu.com',
  // Other trackers
  'matomo.cloud','plausible.io','simpleanalytics.com',
  'adguard.com','zemanta.com','zergnet.com','adobedtm.com',
  'omtrdc.net','2o7.net','everesttech.net','scene7.com',
  'bounceexchange.com','bouncex.net','liadm.com','rlcdn.com',
  'adsymptotic.com','adtrue.com','adcolony.com','unity3d.com/ads',
  'mopub.com','vungle.com','chartboost.com','ironsrc.com',
]);

// Pre-build a Map of root domains for O(1) lookup
const AD_DOMAIN_ROOTS = new Map();
for (const d of AD_DOMAINS) {
  const parts = d.split('.');
  const root = parts.slice(-2).join('.');
  if (!AD_DOMAIN_ROOTS.has(root)) AD_DOMAIN_ROOTS.set(root, []);
  AD_DOMAIN_ROOTS.get(root).push(d);
}

// Pre-compile a single combined regex for URL patterns
const AD_URL_COMBINED_RE = /\/ads?\/|\/adserver|\/adframe|\/adclick|\/adview|\/adbanner|\/adimage|\/adscript|\/banner\d+|\/popup|\/popunder|\/tracking\/|\/pixel\/|\/beacon\/|\/analytics\.js|\/gtag\/js|\/gtm\.js|[-_]ad[-_]|\.ad\.|\/pagead\/|\/sponsor|\/affiliate|\/clickserve|\/impression|\/tracker\//i;

const AD_COSMETIC_CSS = `
  [class*="ad-"], [class*="ad_"], [class*="ads-"], [class*="ads_"],
  [id*="google_ads"], [id*="adfox"], [id*="ad-container"],
  [class*="adsbygoogle"], ins.adsbygoogle,
  [class*="sponsored"], [data-ad], [data-ads],
  iframe[src*="doubleclick"], iframe[src*="googleads"],
  iframe[src*="googlesyndication"], iframe[src*="ad."],
  div[class*="banner-ad"], div[class*="ad-banner"],
  div[id*="ad-slot"], div[class*="ad-slot"],
  a[href*="doubleclick.net"], a[href*="adclick"],
  [class*="outbrain"], [class*="taboola"],
  .ad-wrapper, .ad-container, .advertisement,
  #ad-header, #ad-footer, #ad-sidebar { 
    display: none !important; 
    visibility: hidden !important;
    height: 0 !important;
    overflow: hidden !important;
  }
`;

let adBlockEnabled = true;
let adBlockStats = { blocked: 0, session: 0 };

// URL check cache for hot paths - LRU-like with periodic flush
const adUrlCache = new Map();
const AD_CACHE_MAX = 2000;

function isAdUrl(url) {
  // Cache hit
  if (adUrlCache.has(url)) return adUrlCache.get(url);

  let result = false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // O(1) root domain lookup via Map
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      const root = parts.slice(Math.max(i, parts.length - 2)).join('.');
      const domainList = AD_DOMAIN_ROOTS.get(root);
      if (domainList) {
        for (const adDomain of domainList) {
          if (hostname === adDomain || hostname.endsWith('.' + adDomain)) {
            result = true;
            break;
          }
        }
      }
      if (result) break;
    }

    // Single combined regex instead of 25 separate tests
    if (!result) {
      result = AD_URL_COMBINED_RE.test(parsed.pathname + parsed.search);
    }
  } catch (e) {}

  // Cache result (flush when too large)
  if (adUrlCache.size >= AD_CACHE_MAX) adUrlCache.clear();
  adUrlCache.set(url, result);
  return result;
}

// ──────────────────────── Fairness Ranking System ────────────────────────
// نظام العدالة – يفضّل المواقع الصغيرة الموثوقة على الكبيرة
const BIG_TECH_DOMAINS = new Set([
  'google.com','youtube.com','facebook.com','amazon.com','apple.com',
  'microsoft.com','twitter.com','x.com','instagram.com','tiktok.com',
  'linkedin.com','reddit.com','netflix.com','wikipedia.org','yahoo.com',
  'bing.com','pinterest.com','tumblr.com','ebay.com','walmart.com',
  'alibaba.com','aliexpress.com','cnn.com','bbc.com','nytimes.com',
  'washingtonpost.com','forbes.com','bloomberg.com','cnbc.com',
  'theguardian.com','huffpost.com','buzzfeed.com','vox.com',
  'vice.com','techcrunch.com','wired.com','theverge.com',
  'spotify.com','twitch.tv','snapchat.com','whatsapp.com',
]);

const TRUSTED_SMALL_INDICATORS = {
  // TLDs that tend to be small/independent
  trustedTlds: ['.org','.edu','.gov','.io','.dev','.blog','.wiki','.info'],
  // Content quality signals  
  qualityPaths: ['/blog','/docs','/guide','/tutorial','/learn','/article','/research'],
};

function analyzeFairness(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const baseDomain = hostname.split('.').slice(-2).join('.');
    
    let score = 50; // neutral start
    let category = 'neutral';
    let reasons = [];
    
    // Big tech penalty
    if (BIG_TECH_DOMAINS.has(baseDomain) || BIG_TECH_DOMAINS.has(hostname)) {
      score -= 20;
      category = 'big-tech';
      reasons.push('موقع شركة كبيرة');
    } else {
      // Small site bonus
      score += 15;
      reasons.push('موقع مستقل');
    }
    
    // Trusted TLD bonus
    const tld = '.' + hostname.split('.').pop();
    if (TRUSTED_SMALL_INDICATORS.trustedTlds.includes(tld)) {
      score += 10;
      reasons.push('نطاق موثوق');
    }
    
    // Quality content path bonus
    const pathLower = parsed.pathname.toLowerCase();
    if (TRUSTED_SMALL_INDICATORS.qualityPaths.some(p => pathLower.includes(p))) {
      score += 10;
      reasons.push('محتوى تعليمي');
    }
    
    // HTTPS bonus
    if (parsed.protocol === 'https:') {
      score += 5;
      reasons.push('اتصال آمن');
    }
    
    // Domain length – shorter domains tend to be big corps
    if (hostname.length > 15) {
      score += 5; // likely a niche/specific site
    }
    
    // Subdomain bonus (community sites often use subdomains)
    const parts = hostname.split('.');
    if (parts.length > 2 && !parts[0].match(/^(www|m|mobile|app|api)$/)) {
      score += 5;
      reasons.push('موقع فرعي متخصص');
    }
    
    score = Math.max(0, Math.min(100, score));
    
    if (score >= 65) category = 'small-trusted';
    else if (score >= 40) category = 'neutral';
    else category = 'big-tech';
    
    return { score, category, reasons, domain: hostname };
  } catch (e) {
    return { score: 50, category: 'neutral', reasons: [], domain: '' };
  }
}

function rankByFairness(urls) {
  return urls
    .map(url => ({ url, fairness: analyzeFairness(url) }))
    .sort((a, b) => b.fairness.score - a.fairness.score);
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0',
];

// Ghost stealth script injected into webview pages
const GHOST_STEALTH_SCRIPT = `
(function(){
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  
  // Realistic chrome object
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  }
  
  // Realistic plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const p = { length: 3 };
      p[0] = { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' };
      p[1] = { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' };
      p[2] = { name: 'Native Client', filename: 'internal-nacl-plugin' };
      return p;
    }
  });
  
  // Languages
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
  Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
  
  // Hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  
  // Canvas noise
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    try {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
        for (let i = 0; i < imageData.data.length; i += 37) {
          imageData.data[i] = (imageData.data[i] + 1) % 256;
        }
        ctx.putImageData(imageData, 0, 0);
      }
    } catch(e) {}
    return origToDataURL.apply(this, arguments);
  };
  
  // WebGL vendor/renderer
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Intel Inc.';
    if (p === 37446) return 'Intel Iris OpenGL Engine';
    return getParam.call(this, p);
  };
  
  // Permissions
  if (navigator.permissions) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (desc) => {
      if (desc.name === 'notifications') return Promise.resolve({ state: 'default', onchange: null });
      return origQuery(desc);
    };
  }
  
  // Connection
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 + Math.floor(Math.random() * 100) });
  }
})();
`;

// ──────────────────────── Local Store (Debounced Async) ────────────────────────
class LocalStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), STORE_FILE);
    this.data = this._load();
    this._saveTimer = null;
    this._dirty = false;
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (e) { /* corrupted file, start fresh */ }
    return { bookmarks: [], history: [], preferences: { searchEngine: 'duckduckgo', theme: 'dark', ghostModeDefault: false }, auth: null, searchCache: {} };
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return; // already scheduled
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._dirty) this._flush();
    }, 500); // debounce 500ms
  }

  _flush() {
    this._dirty = false;
    try {
      const data = JSON.stringify(this.data, null, 2);
      fs.writeFile(this.filePath, data, (err) => {
        if (err) console.error('Store save error:', err.message);
      });
    } catch (e) { console.error('Store serialize error:', e.message); }
  }

  // Sync flush on app quit
  flushSync() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._dirty) {
      try { fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2)); }
      catch (e) {}
      this._dirty = false;
    }
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this._scheduleSave();
  }

  addHistory(entry) {
    if (!this.data.history) this.data.history = [];
    this.data.history.unshift({ ...entry, timestamp: Date.now() });
    if (this.data.history.length > 10000) this.data.history = this.data.history.slice(0, 10000);
    this._scheduleSave();
  }

  addBookmark(bm) {
    if (!this.data.bookmarks) this.data.bookmarks = [];
    if (!this.data.bookmarks.find(b => b.url === bm.url)) {
      this.data.bookmarks.push({ ...bm, timestamp: Date.now() });
      this._scheduleSave();
    }
  }

  removeBookmark(url) {
    this.data.bookmarks = (this.data.bookmarks || []).filter(b => b.url !== url);
    this._scheduleSave();
  }

  isBookmarked(url) {
    return (this.data.bookmarks || []).some(b => b.url === url);
  }

  cacheSearch(query, results) {
    if (!this.data.searchCache) this.data.searchCache = {};
    this.data.searchCache[query] = { results, timestamp: Date.now() };
    // Keep only last 500 cached searches
    const keys = Object.keys(this.data.searchCache);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => this.data.searchCache[a].timestamp - this.data.searchCache[b].timestamp);
      for (let i = 0; i < sorted.length - 500; i++) delete this.data.searchCache[sorted[i]];
    }
    this._scheduleSave();
  }

  getCachedSearch(query) {
    const cached = (this.data.searchCache || {})[query];
    if (cached && Date.now() - cached.timestamp < 3600000) return cached.results; // 1h TTL
    return null;
  }
}

// ──────────────────────── WAB Smart Index (Self-Learning Search Engine) ────────────────────────
class WabIndex {
  constructor(store) {
    this.store = store;
    this.index = store.get('wabIndex') || {}; // keyword → [{url, title, score, visits, lastVisit, fairness}]
    this.siteProfiles = store.get('siteProfiles') || {}; // domain → {category, keywords, visits, trustScore, blocked}
  }

  // Learn from page visit — called on every navigation
  learnFromVisit(url, title) {
    if (!url || url.startsWith('file://') || url === 'about:blank') return;
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const pathname = parsed.pathname;

      // Extract keywords from title + URL
      const words = this._extractKeywords(title, domain, pathname);
      const fairness = analyzeFairness(url);

      // Update site profile
      if (!this.siteProfiles[domain]) {
        this.siteProfiles[domain] = { category: 'unknown', keywords: [], visits: 0, trustScore: 50, firstVisit: Date.now(), blocked: false };
      }
      const profile = this.siteProfiles[domain];
      profile.visits++;
      profile.lastVisit = Date.now();
      profile.trustScore = Math.min(100, profile.trustScore + 1); // trust grows with use
      profile.fairnessScore = fairness.score;
      profile.fairnessCategory = fairness.category;

      // Merge keywords into profile
      for (const w of words) {
        if (!profile.keywords.includes(w)) profile.keywords.push(w);
      }
      if (profile.keywords.length > 50) profile.keywords = profile.keywords.slice(-50);

      // Index each keyword
      for (const keyword of words) {
        if (!this.index[keyword]) this.index[keyword] = [];
        const existing = this.index[keyword].find(e => e.url === url);
        if (existing) {
          existing.visits++;
          existing.score += 1;
          existing.lastVisit = Date.now();
          existing.title = title || existing.title;
          existing.fairness = fairness.score;
        } else {
          this.index[keyword].push({
            url, title: title || domain, domain,
            score: 1, visits: 1, lastVisit: Date.now(),
            fairness: fairness.score, category: fairness.category
          });
        }
        // Cap entries per keyword
        if (this.index[keyword].length > 100) {
          this.index[keyword].sort((a, b) => b.score - a.score);
          this.index[keyword] = this.index[keyword].slice(0, 100);
        }
      }

      this._save();
    } catch(e) {}
  }

  // Smart search — query the local index with fairness ranking
  search(query, limit = 20) {
    if (!query || query.length < 2) return [];
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    const seen = new Map(); // url → aggregated result

    for (const word of words) {
      // Exact match
      if (this.index[word]) {
        for (const entry of this.index[word]) {
          this._aggregate(seen, entry, 3);
        }
      }
      // Prefix match
      for (const key of Object.keys(this.index)) {
        if (key.startsWith(word) && key !== word) {
          for (const entry of this.index[key]) {
            this._aggregate(seen, entry, 1);
          }
        }
      }
    }

    // Convert to array and rank with fairness
    let results = Array.from(seen.values());

    // Apply fairness boost
    for (const r of results) {
      const profile = this.siteProfiles[r.domain] || {};
      // Small/independent site bonus
      if (r.category === 'small-trusted') r.finalScore += 10;
      else if (r.category === 'big-tech') r.finalScore -= 5;
      // Trust bonus from repeat visits
      r.finalScore += Math.min(20, (profile.visits || 0) * 0.5);
      // Recency bonus
      const daysAgo = (Date.now() - r.lastVisit) / 86400000;
      if (daysAgo < 1) r.finalScore += 5;
      else if (daysAgo < 7) r.finalScore += 2;
      // Block check
      if (profile.blocked) r.finalScore = -999;
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.filter(r => r.finalScore > -999).slice(0, limit).map(r => ({
      url: r.url, title: r.title, domain: r.domain,
      score: r.finalScore, visits: r.visits,
      fairness: r.fairness, category: r.category,
      source: 'wab-index'
    }));
  }

  // Get suggestions as user types
  suggest(prefix) {
    if (!prefix || prefix.length < 2) return [];
    const p = prefix.toLowerCase();
    const suggestions = [];
    const seen = new Set();

    // Match from index keys
    for (const key of Object.keys(this.index)) {
      if (key.startsWith(p)) {
        for (const entry of this.index[key].slice(0, 3)) {
          if (!seen.has(entry.url)) {
            seen.add(entry.url);
            suggestions.push({ text: entry.title || entry.domain, url: entry.url, type: 'wab-index' });
          }
        }
      }
      if (suggestions.length >= 5) break;
    }

    // Match from history titles
    const history = this.store.get('history') || [];
    for (const h of history.slice(0, 200)) {
      if (suggestions.length >= 8) break;
      if ((h.title || '').toLowerCase().includes(p) || (h.url || '').toLowerCase().includes(p)) {
        if (!seen.has(h.url)) {
          seen.add(h.url);
          suggestions.push({ text: h.title || h.url, url: h.url, type: 'history' });
        }
      }
    }

    return suggestions;
  }

  // Block a domain from results
  blockDomain(domain) {
    if (!this.siteProfiles[domain]) this.siteProfiles[domain] = { visits: 0, trustScore: 0, keywords: [] };
    this.siteProfiles[domain].blocked = true;
    this._save();
  }

  // Get stats
  stats() {
    return {
      indexedKeywords: Object.keys(this.index).length,
      indexedPages: new Set(Object.values(this.index).flat().map(e => e.url)).size,
      trackedDomains: Object.keys(this.siteProfiles).length,
      totalVisits: Object.values(this.siteProfiles).reduce((s, p) => s + (p.visits || 0), 0),
    };
  }

  _aggregate(seen, entry, weight) {
    if (seen.has(entry.url)) {
      seen.get(entry.url).finalScore += entry.score * weight;
    } else {
      seen.set(entry.url, { ...entry, finalScore: entry.score * weight });
    }
  }

  _extractKeywords(title, domain, pathname) {
    const text = `${title || ''} ${domain} ${pathname.replace(/[\/_-]/g, ' ')}`;
    return text.toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && w.length <= 30)
      .filter(w => !['the','and','for','www','com','org','net','http','https','html','php','asp','page','index'].includes(w));
  }

  _save() {
    this.store.set('wabIndex', this.index);
    this.store.set('siteProfiles', this.siteProfiles);
  }
}

// ──────────────────────── WAB Sponsored Ads System ────────────────────────
let sponsoredAdsCache = { ads: [], lastFetch: 0 };

async function fetchSponsoredAds() {
  // Refresh every 5 minutes
  if (Date.now() - sponsoredAdsCache.lastFetch < 300000 && sponsoredAdsCache.ads.length > 0) {
    return sponsoredAdsCache.ads;
  }
  try {
    const ads = await fetchJSON(`${WAB_API}/api/ads/active`);
    if (Array.isArray(ads)) {
      sponsoredAdsCache = { ads, lastFetch: Date.now() };
      return ads;
    }
  } catch(e) {}
  return sponsoredAdsCache.ads;
}

async function recordAdImpression(adId) {
  try {
    const postData = JSON.stringify({ adId, platform: 'wab-browser', timestamp: Date.now() });
    const url = new URL(`${WAB_API}/api/ads/impression`);
    const req = https.request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, () => {});
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch(e) {}
}

async function recordAdClick(adId) {
  try {
    const postData = JSON.stringify({ adId, platform: 'wab-browser', timestamp: Date.now() });
    const url = new URL(`${WAB_API}/api/ads/click`);
    const req = https.request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, () => {});
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch(e) {}
}

// ──────────────────────── Local Agent ────────────────────────
function generateLocalResponse(message, context) {
  const msg = (message || '').toLowerCase();
  const url = context?.url || '';
  const title = context?.title || '';

  if (msg.includes('ghost') || msg.includes('شبح') || msg.includes('خفي')) {
    return '👻 Ghost Mode يخفي بصمتك الرقمية عن المواقع. يقوم بتدوير User-Agent، إخفاء Canvas fingerprint، تعطيل WebRTC leak، وإرسال DNT. فعّله من زر الشبح في شريط التنقل أو Ctrl+Shift+G.';
  }
  if (msg.includes('shield') || msg.includes('حماية') || msg.includes('درع') || msg.includes('scam')) {
    return '🛡️ Scam Shield يفحص كل موقع تزوره تلقائياً. يحلل النطاق، TLD، أنماط الاحتيال، محاولات انتحال العلامات التجارية، وهجمات Homograph. النتيجة تظهر في الدرع بشريط التنقل: أخضر=آمن، أصفر=حذر، أحمر=خطر.';
  }
  if (msg.includes('search') || msg.includes('بحث')) {
    return '🔍 Smart Search يدعم محركات: DuckDuckGo (افتراضي للخصوصية)، Google، Bing، Startpage. اكتب في شريط العنوان للبحث. غيّر المحرك من القائمة > Search Engine.';
  }
  if (msg.includes('bookmark') || msg.includes('مفضل') || msg.includes('علامة')) {
    return '🔖 أضف أي صفحة للمفضلة بـ Ctrl+D أو زر العلامة. اعرض المفضلات من Ctrl+B أو القائمة > Bookmarks.';
  }
  if (msg.includes('safe') || msg.includes('آمن') || msg.includes('أمان') || msg.includes('secure')) {
    return `🔒 الصفحة الحالية: ${url ? (url.startsWith('https') ? 'اتصال مشفّر SSL/TLS ✅' : 'اتصال غير مشفّر ⚠️') : 'لا توجد صفحة محمّلة'}.\nScam Shield يعمل تلقائياً لحمايتك.`;
  }
  if (msg.includes('help') || msg.includes('مساعدة') || msg.includes('ماذا') || msg.includes('what can')) {
    return '🤖 أنا وكيل WAB Browser. أستطيع مساعدتك في:\n• تحليل أمان الصفحة الحالية\n• شرح ميزات المتصفح (Ghost Mode, Scam Shield, Smart Search)\n• تقديم نصائح للخصوصية والحماية\n• البحث والتنقل\n\nجرّب: "هل هذا الموقع آمن؟" أو "فعّل وضع الشبح"';
  }
  if (url && (msg.includes('this') || msg.includes('هذا') || msg.includes('page') || msg.includes('صفحة') || msg.includes('site') || msg.includes('موقع'))) {
    return `📄 الصفحة الحالية:\n• العنوان: ${title || 'غير معروف'}\n• الرابط: ${url}\n• الاتصال: ${url.startsWith('https') ? '🔒 مشفّر' : '⚠️ غير مشفّر'}\n\nاسأل عن أي شيء يخص هذه الصفحة.`;
  }
  return `🤖 مرحباً! أنا وكيل WAB Browser الذكي. أستطيع مساعدتك في تحليل المواقع، إعدادات الخصوصية، وميزات المتصفح.\n\nجرّب أسئلة مثل: "هل الموقع آمن؟" أو "كيف أستخدم Ghost Mode؟"`;
}

// ──────────────────────── Globals ────────────────────────
let mainWindow = null;
let store = null;
let wabIndex = null;
let ghostMode = false;
let currentUA = USER_AGENTS[0];
const WAB_API_BASE = 'http://localhost:3003'; // Local dev, switch to https://webagentbridge.com for production

function rotateUA() {
  currentUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Fallback extraction script (when server unreachable)
const UNIVERSAL_EXTRACT_FALLBACK = `(function(){return{url:location.href,domain:location.hostname,title:document.title,jsonLd:[],meta:null,prices:[],cards:[],timestamp:Date.now(),hasWabBridge:typeof window.AICommands!=='undefined'}})()`;

// ──────────────────────── HTTP Helpers ───────────────────────
function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': currentUA },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

// ──────────────────────── HTTP Helper ────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': currentUA, 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': currentUA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(10000, () => { req.destroy(); resolve(''); });
  });
}

// ──────────────────────── Scam Shield ────────────────────────
const SAFE_DOMAINS = new Set([
  'google.com','youtube.com','facebook.com','twitter.com','x.com','amazon.com',
  'wikipedia.org','reddit.com','instagram.com','linkedin.com','github.com',
  'microsoft.com','apple.com','netflix.com','ebay.com','paypal.com',
  'stackoverflow.com','medium.com','twitch.tv','spotify.com','whatsapp.com',
  'duckduckgo.com','bing.com','yahoo.com','cloudflare.com','stripe.com',
  'webagentbridge.com',
]);

const RISKY_TLDS = new Set(['.tk','.ml','.ga','.cf','.gq','.xyz','.top','.work','.click','.loan','.win','.bid','.stream','.racing','.gdn','.review','.party','.science','.trade','.date','.faith','.accountant','.cricket','.download']);

const SCAM_PATTERNS = [
  /free.*bitcoin/i, /earn.*money.*fast/i, /act.*now.*limited/i,
  /congratulations.*won/i, /claim.*your.*prize/i, /verify.*account.*immediately/i,
  /password.*expired/i, /suspended.*account/i, /urgent.*action.*required/i,
  /wire.*transfer/i, /nigerian.*prince/i, /lottery.*winner/i,
];

function analyzeDomain(domain) {
  const result = { domain, riskScore: 0, flags: [], safe: false, details: {} };

  // Check whitelisted
  const rootDomain = domain.split('.').slice(-2).join('.');
  if (SAFE_DOMAINS.has(rootDomain) || SAFE_DOMAINS.has(domain)) {
    result.safe = true;
    result.riskScore = 0;
    result.details.reason = 'Known safe domain';
    return result;
  }

  // TLD risk
  const tld = '.' + domain.split('.').pop();
  if (RISKY_TLDS.has(tld)) {
    result.riskScore += 25;
    result.flags.push('risky-tld');
  }

  // Domain length
  if (domain.length > 35) { result.riskScore += 15; result.flags.push('long-domain'); }
  if (domain.length > 50) { result.riskScore += 10; result.flags.push('very-long-domain'); }

  // Hyphens
  const hyphens = (domain.match(/-/g) || []).length;
  if (hyphens > 2) { result.riskScore += 15; result.flags.push('many-hyphens'); }

  // Numbers
  if (/\d{5,}/.test(domain)) { result.riskScore += 15; result.flags.push('many-numbers'); }

  // Subdomain depth
  const parts = domain.split('.');
  if (parts.length > 4) { result.riskScore += 20; result.flags.push('deep-subdomains'); }

  // Brand impersonation
  const brands = ['paypal','google','apple','amazon','microsoft','facebook','bank','secure','login','verify'];
  for (const brand of brands) {
    if (domain.includes(brand) && !rootDomain.startsWith(brand)) {
      result.riskScore += 30;
      result.flags.push(`possible-impersonation-${brand}`);
      break;
    }
  }

  // Homograph attack (mixed scripts) - basic check
  if (/[а-яА-Я]/.test(domain) || /[α-ωΑ-Ω]/.test(domain)) {
    result.riskScore += 40;
    result.flags.push('homograph-attack');
  }

  result.riskScore = Math.min(result.riskScore, 100);
  return result;
}

async function analyzePageContent(content) {
  const flags = [];
  let risk = 0;

  for (const pattern of SCAM_PATTERNS) {
    if (pattern.test(content)) {
      flags.push('scam-content-pattern');
      risk += 15;
      break;
    }
  }

  // Check for fake payment badges (images with payment names but no real links)
  if (/visa|mastercard|paypal/i.test(content) && !/(paypal\.com|visa\.com|mastercard\.com)/i.test(content)) {
    if (/\<img[^>]*(visa|mastercard|paypal)/i.test(content)) {
      flags.push('possible-fake-payment-badges');
      risk += 10;
    }
  }

  return { risk: Math.min(risk, 100), flags };
}

// ──────────────────────── Search ────────────────────────
const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
};

async function searchSuggestions(query) {
  if (!query || query.length < 2) return [];
  try {
    const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`;
    const data = await fetchJSON(url);
    if (Array.isArray(data) && data.length > 1) return data[1].slice(0, 8);
    if (Array.isArray(data)) return data.map(d => d.phrase || d).filter(Boolean).slice(0, 8);
    return [];
  } catch (e) { return []; }
}

// ──────────────────────── Window ────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      v8CacheOptions: 'bypassHeatCheck', // faster V8 code caching
      backgroundThrottling: true,         // throttle background tabs
      spellcheck: false,                   // disable spellcheck overhead
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (store.get('preferences')?.maximized) mainWindow.maximize();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));

  mainWindow.on('close', () => {
    const prefs = store.get('preferences') || {};
    prefs.maximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    prefs.windowBounds = bounds;
    store.set('preferences', prefs);
  });

  // Ad Blocker – block ad/tracker requests
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (adBlockEnabled && details.url.startsWith('http') && isAdUrl(details.url)) {
      adBlockStats.blocked++;
      adBlockStats.session++;
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // Ghost mode header modification
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (ghostMode) {
      details.requestHeaders['User-Agent'] = currentUA;
      delete details.requestHeaders['X-DevTools-Emulate-Network-Conditions-Client-Id'];
    }
    // Always set DNT
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Handle permission requests from webviews
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
    callback(allowedPermissions.includes(permission));
  });

  // Handle new-window from webviews
  mainWindow.webContents.on('did-attach-webview', (event, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      mainWindow.webContents.send('open-new-tab', url);
      return { action: 'deny' };
    });
  });
}

// ──────────────────────── IPC Registration ────────────────────────
function setupIPC() {
  // ── Window controls ──
  ipcMain.handle('win:minimize', () => mainWindow?.minimize());
  ipcMain.handle('win:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('win:close', () => mainWindow?.close());

  // ── Ghost mode ──
  ipcMain.handle('ghost:toggle', (_, enabled) => {
    ghostMode = enabled;
    if (ghostMode) rotateUA();
    return ghostMode;
  });
  ipcMain.handle('ghost:status', () => ghostMode);
  ipcMain.handle('ghost:script', () => ghostMode ? GHOST_STEALTH_SCRIPT : null);
  ipcMain.handle('ghost:rotate-ua', () => { rotateUA(); return currentUA; });

  // ── Scam Shield ──
  ipcMain.handle('shield:check-domain', (_, domain) => analyzeDomain(domain));
  ipcMain.handle('shield:analyze-content', (_, content) => analyzePageContent(content));

  // ── Search ──
  ipcMain.handle('search:url', (_, query) => {
    const engine = store.get('preferences')?.searchEngine || 'duckduckgo';
    const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
    return base + encodeURIComponent(query);
  });
  ipcMain.handle('search:suggestions', (_, query) => searchSuggestions(query));
  ipcMain.handle('search:engines', () => Object.keys(SEARCH_ENGINES));
  ipcMain.handle('search:set-engine', (_, engine) => {
    if (SEARCH_ENGINES[engine]) {
      const prefs = store.get('preferences') || {};
      prefs.searchEngine = engine;
      store.set('preferences', prefs);
      return true;
    }
    return false;
  });

  // ── Store ──
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => { store.set(key, value); return true; });

  // ── History ──
  ipcMain.handle('history:add', (_, entry) => { store.addHistory(entry); return true; });
  ipcMain.handle('history:get', () => store.get('history') || []);
  ipcMain.handle('history:clear', () => { store.set('history', []); return true; });

  // ── Bookmarks ──
  ipcMain.handle('bookmarks:add', (_, bm) => { store.addBookmark(bm); return true; });
  ipcMain.handle('bookmarks:remove', (_, url) => { store.removeBookmark(url); return true; });
  ipcMain.handle('bookmarks:get', () => store.get('bookmarks') || []);
  ipcMain.handle('bookmarks:check', (_, url) => store.isBookmarked(url));

  // ── Platform Auth ──
  ipcMain.handle('auth:login', async (_, email, password) => {
    try {
      const res = await fetchJSON(`${WAB_API}/api/auth/login`);
      // POST would require more complex implementation
      // For now, use simple approach
      return new Promise((resolve) => {
        const postData = JSON.stringify({ email, password });
        const url = new URL(`${WAB_API}/api/auth/login`);
        const req = https.request({
          hostname: url.hostname, port: url.port || 443, path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.token) {
                store.set('auth', { email, token: result.token, loggedIn: true });
              }
              resolve(result);
            } catch (e) { resolve({ error: 'Invalid response' }); }
          });
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.write(postData);
        req.end();
      });
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('auth:register', async (_, data) => {
    return new Promise((resolve) => {
      const postData = JSON.stringify(data);
      const url = new URL(`${WAB_API}/api/auth/register`);
      const req = https.request({
        hostname: url.hostname, port: url.port || 443, path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch (e) { resolve({ error: 'Invalid response' }); }
        });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.write(postData);
      req.end();
    });
  });

  ipcMain.handle('auth:status', () => store.get('auth') || { loggedIn: false });
  ipcMain.handle('auth:logout', () => { store.set('auth', { loggedIn: false }); return true; });

  // ── External links ──
  ipcMain.handle('shell:open', (_, url) => shell.openExternal(url));

  // ── Search cache ──
  ipcMain.handle('cache:search-get', (_, query) => store.getCachedSearch(query));
  ipcMain.handle('cache:search-set', (_, query, results) => { store.cacheSearch(query, results); return true; });

  // ── App info ──
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    arch: process.arch,
  }));

  // ── Paths ──
  ipcMain.handle('app:new-tab-path', () => {
    const p = path.join(__dirname, 'src', 'pages', 'new-tab.html').replace(/\\/g, '/');
    return `file://${p}`;
  });

  // ── Agent Chat ──
  ipcMain.handle('agent:chat', async (_, message, context) => {
    return new Promise((resolve) => {
      const auth = store.get('auth') || {};
      const payload = JSON.stringify({
        message,
        context: context?.context || context || {},
        platform: 'wab-browser',
        version: app.getVersion(),
        sessionId: auth.userId || 'local',
        taskId: context?.taskId || undefined,
        taskAction: context?.taskAction || undefined,
      });
      const url = new URL(`${WAB_API}/api/wab/agent-chat`);
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      };
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      const req = https.request({
        hostname: url.hostname, port: url.port || 443, path: url.pathname,
        method: 'POST', headers
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ reply: data || 'No response from agent.', type: 'text' }); }
        });
      });
      req.on('error', () => resolve({
        reply: generateLocalResponse(message, context),
        type: 'local',
        local: true,
      }));
      req.setTimeout(15000, () => {
        req.destroy();
        resolve({
          reply: generateLocalResponse(message, context),
          type: 'local',
          local: true,
        });
      });
      req.write(payload);
      req.end();
    });
  });

  ipcMain.handle('agent:page-analysis', async (_, url, title, content) => {
    const alerts = [];
    // Shield analysis
    if (url && !url.startsWith('file://')) {
      try {
        const domain = new URL(url).hostname;
        const shieldResult = analyzeDomain(domain);
        if (shieldResult.riskScore > 0) {
          alerts.push({
            type: shieldResult.riskScore >= 40 ? 'danger' : 'warning',
            title: 'Scam Shield Alert',
            message: `Risk score: ${shieldResult.riskScore}% — ${shieldResult.flags.join(', ')}`,
            domain,
            timestamp: Date.now(),
          });
        }
        if (content) {
          const contentResult = await analyzePageContent(content);
          if (contentResult.risk > 0) {
            alerts.push({
              type: contentResult.risk >= 30 ? 'danger' : 'warning',
              title: 'Content Warning',
              message: `Suspicious content detected: ${contentResult.flags.join(', ')}`,
              domain,
              timestamp: Date.now(),
            });
          }
        }
      } catch(e) {}
    }
    // Performance / SSL info
    if (url && url.startsWith('https://')) {
      alerts.push({
        type: 'info',
        title: 'Secure Connection',
        message: `SSL/TLS encrypted connection to ${new URL(url).hostname}`,
        timestamp: Date.now(),
      });
    } else if (url && url.startsWith('http://')) {
      alerts.push({
        type: 'warning',
        title: 'Insecure Connection',
        message: 'This page is not using HTTPS. Your data may be visible to others.',
        timestamp: Date.now(),
      });
    }
    return alerts;
  });

  // ── Notifications store ──
  ipcMain.handle('notifications:get', () => store.get('notifications') || []);
  ipcMain.handle('notifications:add', (_, notification) => {
    const notifs = store.get('notifications') || [];
    notifs.unshift({ ...notification, id: Date.now(), read: false });
    if (notifs.length > 200) notifs.length = 200;
    store.set('notifications', notifs);
    mainWindow?.webContents.send('notification-new', notifs[0]);
    return notifs[0];
  });
  ipcMain.handle('notifications:mark-read', (_, id) => {
    const notifs = store.get('notifications') || [];
    const n = notifs.find(x => x.id === id);
    if (n) { n.read = true; store.set('notifications', notifs); }
    return true;
  });
  ipcMain.handle('notifications:clear', () => { store.set('notifications', []); return true; });

  // ── Ad Blocker ──
  ipcMain.handle('adblock:toggle', (_, enabled) => {
    adBlockEnabled = enabled;
    const prefs = store.get('preferences') || {};
    prefs.adBlockEnabled = enabled;
    store.set('preferences', prefs);
    return adBlockEnabled;
  });
  ipcMain.handle('adblock:status', () => adBlockEnabled);
  ipcMain.handle('adblock:stats', () => ({ ...adBlockStats }));
  ipcMain.handle('adblock:reset-stats', () => { adBlockStats.session = 0; return true; });
  ipcMain.handle('adblock:cosmetic-css', () => adBlockEnabled ? AD_COSMETIC_CSS : '');
  ipcMain.handle('adblock:whitelist-get', () => store.get('adblockWhitelist') || []);
  ipcMain.handle('adblock:whitelist-add', (_, domain) => {
    const list = store.get('adblockWhitelist') || [];
    if (!list.includes(domain)) { list.push(domain); store.set('adblockWhitelist', list); }
    return list;
  });
  ipcMain.handle('adblock:whitelist-remove', (_, domain) => {
    let list = store.get('adblockWhitelist') || [];
    list = list.filter(d => d !== domain);
    store.set('adblockWhitelist', list);
    return list;
  });

  // ── Fairness Ranking ──
  ipcMain.handle('fairness:analyze', (_, url) => analyzeFairness(url));
  ipcMain.handle('fairness:rank', (_, urls) => rankByFairness(urls));

  // ── Universal Agent (works on ANY page) ──
  ipcMain.handle('universal:extract', async (_, url) => {
    // Fetch and extract from URL server-side
    try {
      const resp = await fetchJSON(`${WAB_API_BASE}/api/universal/extract`);
      return resp;
    } catch (_e) { return { error: _e.message }; }
  });

  ipcMain.handle('universal:analyze', async (_, data) => {
    // Send browser-extracted data to server for analysis
    try {
      return await postJSON(`${WAB_API_BASE}/api/universal/analyze`, { extraction: data });
    } catch (_e) {
      // Offline fallback — basic analysis
      return { products: data?.jsonLd || [], alerts: [], offline: true };
    }
  });

  ipcMain.handle('universal:compare', async (_, query, category) => {
    try {
      return await postJSON(`${WAB_API_BASE}/api/universal/compare`, { query, category });
    } catch (_e) { return { error: _e.message, results: [] }; }
  });

  ipcMain.handle('universal:deals', async (_, query, category, lang) => {
    try {
      return await postJSON(`${WAB_API_BASE}/api/universal/deals`, { query, category, lang });
    } catch (_e) { return { error: _e.message, deals: [] }; }
  });

  ipcMain.handle('universal:fairness-score', async (_, domain) => {
    try {
      return await postJSON(`${WAB_API_BASE}/api/universal/fairness`, { domain });
    } catch (_e) { return analyzeFairness('https://' + domain); }
  });

  ipcMain.handle('universal:extraction-script', async () => {
    // Return the extraction script to inject in webviews
    try {
      const resp = await fetchText(`${WAB_API_BASE}/api/universal/extraction-script`);
      return resp;
    } catch (_e) {
      return UNIVERSAL_EXTRACT_FALLBACK;
    }
  });

  // ── WAB Smart Index ──
  ipcMain.handle('wabindex:learn', (_, url, title) => { wabIndex.learnFromVisit(url, title); return true; });
  ipcMain.handle('wabindex:search', (_, query) => wabIndex.search(query));
  ipcMain.handle('wabindex:suggest', (_, prefix) => wabIndex.suggest(prefix));
  ipcMain.handle('wabindex:stats', () => wabIndex.stats());
  ipcMain.handle('wabindex:block-domain', (_, domain) => { wabIndex.blockDomain(domain); return true; });
  ipcMain.handle('wabindex:site-profile', (_, domain) => wabIndex.siteProfiles[domain] || null);

  // ── Sponsored Ads ──
  ipcMain.handle('ads:get-active', () => fetchSponsoredAds());
  ipcMain.handle('ads:impression', (_, adId) => { recordAdImpression(adId); return true; });
  ipcMain.handle('ads:click', (_, adId) => { recordAdClick(adId); return true; });

  // ── Memory & Performance ──
  ipcMain.handle('perf:memory', () => {
    const mem = process.memoryUsage();
    return {
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
      rss: Math.round(mem.rss / 1048576),
      external: Math.round(mem.external / 1048576),
    };
  });
  ipcMain.handle('perf:gc', () => {
    if (global.gc) { global.gc(); return true; }
    return false;
  });
  ipcMain.handle('perf:clear-cache', async () => {
    const ses = session.defaultSession;
    await ses.clearCache();
    adUrlCache.clear();
    return true;
  });
}

// ──────────────────────── App Lifecycle ────────────────────────
app.whenReady().then(() => {
  store = new LocalStore();
  wabIndex = new WabIndex(store);
  const prefs = store.get('preferences') || {};
  ghostMode = prefs.ghostModeDefault || false;
  adBlockEnabled = prefs.adBlockEnabled !== false; // default: true
  if (ghostMode) rotateUA();
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => {
  if (store) store.flushSync();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.flushSync();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Security: prevent navigation away from the browser shell
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'window') {
    contents.on('will-navigate', (e) => e.preventDefault());
  }
});
