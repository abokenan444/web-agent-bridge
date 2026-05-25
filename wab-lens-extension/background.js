// WAB Lens — background service worker (MV3).
// On every committed navigation we probe the site's /.well-known/wab.json and
// the X-WAB-Discovery response header, then update the toolbar badge:
//   verified  → green   "✓"
//   enabled   → amber   "•"
//   missing   → no badge
//   error     → grey    "?"

const STATE = new Map(); // tabId -> { status, host, manifest }
const CACHE = new Map(); // host -> { status, signed, exp }
const TTL = 10 * 60 * 1000;

const COLORS = {
  verified: '#10b981',
  enabled:  '#f59e0b',
  missing:  '#9ca3af',
  error:    '#ef4444'
};

async function probe(host) {
  const c = CACHE.get(host);
  if (c && c.exp > Date.now()) return c;
  let status = 'missing', signed = false, manifest = null;
  try {
    const r = await fetch(`https://${host}/.well-known/wab.json`, { redirect: 'follow' });
    if (r.ok) {
      manifest = await r.json().catch(() => null);
      if (manifest) {
        signed = !!(manifest.signature || (manifest.trust && manifest.trust.signed));
        status = signed ? 'verified' : 'enabled';
      }
    }
  } catch (_) { status = 'missing'; }
  const rec = { status, signed, manifest, exp: Date.now() + TTL };
  CACHE.set(host, rec);
  return rec;
}

async function refreshTab(tabId, url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return;
    const rec = await probe(u.hostname);
    STATE.set(tabId, { ...rec, host: u.hostname });
    const text = rec.status === 'verified' ? '✓'
              : rec.status === 'enabled'  ? '•'
              : '';
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[rec.status] || COLORS.missing });
    await chrome.action.setTitle({ tabId, title: `WAB Lens — ${u.hostname}: ${rec.status}` });
  } catch (_) {}
}

chrome.webNavigation.onCommitted.addListener(({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  refreshTab(tabId, url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && tab.url) refreshTab(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'wab:getState') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    sendResponse(STATE.get(tabId) || null);
    return true;
  }
});
