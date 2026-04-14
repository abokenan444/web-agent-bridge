/**
 * WAB Extension — Background Service Worker
 * Handles communication between content scripts, popup, and WAB server.
 */

const WAB_SERVER = 'http://localhost:3003'; // Local development
// const WAB_SERVER = 'https://webagentbridge.com'; // Production

// ─── State ───────────────────────────────────────────────────────────

let authToken = null;
const tabData = new Map(); // tabId → extracted data
const priceAlerts = new Map(); // tabId → alerts

// ─── Init ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['wab_token'], (result) => {
    if (result.wab_token) authToken = result.wab_token;
  });
});

// ─── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'wab-extraction':
      handleExtraction(tabId, msg.data, sendResponse);
      return true; // async

    case 'wab-analyze':
      analyzeCurrentPage(tabId, sendResponse);
      return true;

    case 'wab-compare':
      comparePrice(msg.query, msg.category, sendResponse);
      return true;

    case 'wab-find-deals':
      findDeals(msg.query, msg.category, sendResponse);
      return true;

    case 'wab-login':
      login(msg.email, msg.password, sendResponse);
      return true;

    case 'wab-get-state':
      sendResponse({
        tabData: tabData.get(tabId) || null,
        alerts: priceAlerts.get(tabId) || [],
        isLoggedIn: !!authToken,
      });
      return false;

    case 'wab-chat':
      agentChat(msg.message, msg.sessionId, sendResponse);
      return true;
  }
});

// ─── Handle page extraction from content script ─────────────────────

async function handleExtraction(tabId, data, sendResponse) {
  if (!data || !data.url) { sendResponse({ error: 'No data' }); return; }

  tabData.set(tabId, data);

  // Send to server for analysis
  try {
    const resp = await fetch(`${WAB_SERVER}/api/universal/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ extraction: data }),
    });

    if (resp.ok) {
      const result = await resp.json();
      priceAlerts.set(tabId, result.alerts || []);

      // Update badge
      const alertCount = (result.alerts || []).length;
      if (alertCount > 0) {
        chrome.action.setBadgeText({ text: `${alertCount}`, tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
      } else if (result.products && result.products.length > 0) {
        chrome.action.setBadgeText({ text: '✓', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
      }

      sendResponse(result);
    } else {
      sendResponse({ error: 'Server error' });
    }
  } catch (err) {
    // Offline mode — do local analysis
    const products = localAnalyze(data);
    tabData.set(tabId, { ...data, products });
    sendResponse({ products, offline: true });
  }
}

// ─── Server API calls ────────────────────────────────────────────────

async function analyzeCurrentPage(tabId, sendResponse) {
  const data = tabData.get(tabId);
  if (!data) { sendResponse({ error: 'No page data. Visit a page first.' }); return; }

  try {
    const resp = await fetch(`${WAB_SERVER}/api/universal/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ url: data.url, extraction: data }),
    });
    const result = await resp.json();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function comparePrice(query, category, sendResponse) {
  try {
    const resp = await fetch(`${WAB_SERVER}/api/universal/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ query, category }),
    });
    const result = await resp.json();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function findDeals(query, category, sendResponse) {
  try {
    const resp = await fetch(`${WAB_SERVER}/api/universal/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ query, category }),
    });
    const result = await resp.json();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function agentChat(message, sessionId, sendResponse) {
  try {
    const resp = await fetch(`${WAB_SERVER}/api/wab/agent-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ message, sessionId }),
    });
    const result = await resp.json();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function login(email, password, sendResponse) {
  try {
    const resp = await fetch(`${WAB_SERVER}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await resp.json();
    if (result.token) {
      authToken = result.token;
      chrome.storage.local.set({ wab_token: result.token });
      sendResponse({ success: true, user: result.user });
    } else {
      sendResponse({ error: result.error || 'Login failed' });
    }
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ─── Local Analysis (offline fallback) ───────────────────────────────

function localAnalyze(data) {
  const products = [];

  if (data.jsonLd && data.jsonLd.length > 0) products.push(...data.jsonLd);
  if (data.meta && data.meta.price) products.push(data.meta);
  if (data.cards) {
    for (const card of data.cards) {
      if (card.title || card.price) {
        products.push({ name: card.title, price: card.price, method: 'dom-cards' });
      }
    }
  }

  return products;
}

// ─── Tab cleanup ─────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  tabData.delete(tabId);
  priceAlerts.delete(tabId);
});
