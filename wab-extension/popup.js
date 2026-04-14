/**
 * WAB Extension — Popup Logic
 * Communicates with background worker and displays analysis results.
 */

const sessionId = 'ext-' + Math.random().toString(36).slice(2, 10);

// ─── DOM refs ────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const content = $('#content');
const loading = $('#loading');
const pageInfo = $('#pageInfo');
const actionsSection = $('#actionsSection');

// ─── Init ────────────────────────────────────────────────────────────

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showEmpty('No active tab'); return; }

  // Show page info
  $('#pageUrl').textContent = tab.url;
  $('#pageTitle').textContent = tab.title;
  pageInfo.style.display = 'block';

  // Request extraction from content script
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'wab-get-page-data' }, (data) => {
      if (chrome.runtime.lastError || !data) {
        showEmpty('Cannot read this page. Try a shopping or travel site.');
        return;
      }
      displayResults(data);
    });
  } catch (_) {
    showEmpty('Extension cannot access this page.');
  }

  // Also get state from background
  chrome.runtime.sendMessage({ type: 'wab-get-state' }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state && !state.isLoggedIn) {
      $('#statusBadge').textContent = 'Offline';
      $('#statusBadge').classList.add('offline');
    }
  });
}

// ─── Display extraction results ──────────────────────────────────────

function displayResults(data) {
  loading.style.display = 'none';
  actionsSection.style.display = 'block';

  let html = '';

  // Products from JSON-LD or meta
  const products = [...(data.jsonLd || [])];
  if (data.meta && data.meta.price) products.push(data.meta);

  if (products.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">📦 Products Detected</div>`;
    for (const p of products.slice(0, 5)) {
      html += renderProduct(p);
    }
    html += `</div>`;
  }

  // Price cards from DOM
  if (data.cards && data.cards.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">🏷️ Listings Found (${data.cards.length})</div>`;
    for (const card of data.cards.slice(0, 5)) {
      html += `<div class="wab-product">
        <div class="wab-product-name">${esc(card.title || 'Unknown')}</div>
        ${card.price ? `<div class="wab-product-price">${esc(card.price)}</div>` : ''}
        <div class="wab-product-meta">
          ${card.rating ? `<span>⭐ ${esc(card.rating)}</span>` : ''}
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // Raw prices
  if (data.prices && data.prices.length > 0 && products.length === 0 && (!data.cards || data.cards.length === 0)) {
    html += `<div class="wab-section"><div class="wab-section-title">💲 Prices Found</div>`;
    for (const p of data.prices.slice(0, 8)) {
      html += `<div class="wab-insight">
        <span class="wab-insight-icon">💰</span>
        <span>${esc(p.raw)} <small style="color:#64748b;">(${esc(p.context || '')})</small></span>
      </div>`;
    }
    html += `</div>`;
  }

  // Dark patterns
  if (data.darkPatterns && data.darkPatterns.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">⚠️ Dark Patterns</div>`;
    for (const dp of data.darkPatterns) {
      html += `<div class="wab-alert ${dp.severity}">
        <span class="wab-alert-icon">🚩</span>
        <span>${esc(dp.type)} ${dp.fees ? '— ' + esc(dp.fees.join(', ')) : ''}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // WAB Bridge status
  html += `<div class="wab-section">
    <div class="wab-section-title">🔌 WAB Integration</div>
    <div class="wab-insight">
      <span class="wab-insight-icon">${data.hasWabBridge ? '✅' : '🌐'}</span>
      <span>${data.hasWabBridge
        ? `This site has WAB Bridge installed (${data.wabBridgeType || 'standard'}) — full negotiation & priority ranking!`
        : 'No WAB Bridge — using Universal Mode (read-only extraction)'}</span>
    </div>
    ${data.hasWabBridge ? `<div class="wab-insight">
      <span class="wab-insight-icon">🤝</span>
      <span>Auto-negotiation available — agents can request better prices directly</span>
    </div>
    <div class="wab-insight">
      <span class="wab-insight-icon">🌉</span>
      <span>This site gets priority in search results and deal rankings</span>
    </div>` : ''}
  </div>`;

  if (products.length === 0 && (!data.cards || data.cards.length === 0) && (!data.prices || data.prices.length === 0)) {
    html = `<div class="wab-empty">
      <div class="wab-empty-icon">🔍</div>
      <div class="wab-empty-text">No products or prices detected on this page.<br>Try visiting a shopping or travel website.</div>
    </div>`;
  }

  content.innerHTML = html;
}

function renderProduct(p) {
  return `<div class="wab-product">
    <div class="wab-product-name">${esc(p.name || 'Unknown Product')}</div>
    <div style="display: flex; align-items: baseline;">
      <div class="wab-product-price">${p.currency || '$'}${p.price || '?'}</div>
      ${p.originalPrice ? `<span class="wab-product-original">${p.currency || '$'}${p.originalPrice}</span>` : ''}
    </div>
    <div class="wab-product-meta">
      ${p.rating ? `<span>⭐ ${p.rating}</span>` : ''}
      ${p.reviewCount ? `<span>📝 ${p.reviewCount} reviews</span>` : ''}
      ${p.availability ? `<span>📦 ${p.availability}</span>` : ''}
      ${p.brand ? `<span>🏷️ ${p.brand}</span>` : ''}
      <span class="wab-fairness neutral">${p.method}</span>
    </div>
  </div>`;
}

// ─── Action buttons ──────────────────────────────────────────────────

$('#btnCompare')?.addEventListener('click', async () => {
  const pageTitle = $('#pageTitle').textContent;
  loading.style.display = 'block';
  content.innerHTML = '';

  chrome.runtime.sendMessage(
    { type: 'wab-compare', query: pageTitle, category: 'product' },
    (result) => {
      loading.style.display = 'none';
      if (result.error) { content.innerHTML = `<div class="wab-empty"><div class="wab-empty-text">${esc(result.error)}</div></div>`; return; }
      displayComparison(result);
    }
  );
});

$('#btnDeals')?.addEventListener('click', async () => {
  const pageTitle = $('#pageTitle').textContent;
  loading.style.display = 'block';
  content.innerHTML = '';

  chrome.runtime.sendMessage(
    { type: 'wab-find-deals', query: pageTitle, category: 'product' },
    (result) => {
      loading.style.display = 'none';
      if (result.error) { content.innerHTML = `<div class="wab-empty"><div class="wab-empty-text">${esc(result.error)}</div></div>`; return; }
      displayDeals(result);
    }
  );
});

$('#btnAnalyze')?.addEventListener('click', () => {
  const [tab] = []; // will be filled
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    loading.style.display = 'block';
    content.innerHTML = '';

    chrome.runtime.sendMessage({ type: 'wab-analyze' }, (result) => {
      loading.style.display = 'none';
      if (result?.error) { content.innerHTML = `<div class="wab-empty"><div class="wab-empty-text">${esc(result.error)}</div></div>`; return; }
      displayAnalysis(result);
    });
  });
});

// ─── Display comparison results ──────────────────────────────────────

function displayComparison(result) {
  let html = `<div class="wab-section"><div class="wab-section-title">🔍 Price Comparison (${result.sourcesChecked || 0} sources)</div>`;

  if (result.results && result.results.length > 0) {
    for (const r of result.results) {
      html += `<div class="wab-product">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="wab-product-name">${esc(r.name || r.source)}</div>
          <span class="wab-fairness ${r.size === 'small' ? 'recommended' : r.size === 'big' ? 'caution' : 'neutral'}">${esc(r.size || '')}</span>
        </div>
        <div class="wab-product-price">$${r.priceUsd || '?'}</div>
        <div class="wab-product-meta">
          <span>📍 ${esc(r.source)}</span>
          ${r.rating ? `<span>⭐ ${r.rating}</span>` : ''}
          <span>${esc(r.type || '')}</span>
        </div>
      </div>`;
    }
  } else {
    html += `<div class="wab-empty"><div class="wab-empty-text">No comparison data available</div></div>`;
  }

  html += `</div>`;

  // Alerts
  if (result.alerts && result.alerts.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">⚠️ Warnings</div>`;
    for (const a of result.alerts) {
      html += `<div class="wab-alert ${a.severity || 'medium'}">${esc(a.title || a.description || 'Warning')}</div>`;
    }
    html += `</div>`;
  }

  content.innerHTML = html;
}

function displayDeals(result) {
  let html = '';

  // Insights
  if (result.insights && result.insights.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">💡 Insights</div>`;
    for (const ins of result.insights) {
      html += `<div class="wab-insight">
        <span class="wab-insight-icon">${ins.icon || '💡'}</span>
        <span>${esc(ins.text)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Deals
  if (result.deals && result.deals.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">💰 Best Deals</div>`;
    for (const d of result.deals.slice(0, 8)) {
      html += `<div class="wab-product">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="wab-product-name">${d.badge || ''} ${esc(d.name || d.source)}</div>
          ${d.fairnessBadge ? `<span style="font-size:14px;">${d.fairnessBadge}</span>` : ''}
        </div>
        <div class="wab-product-price">$${d.priceUsd || '?'}</div>
        <div class="wab-product-meta">
          <span>📍 ${esc(d.source)}</span>
          ${d.sizeBadge ? `<span>${d.sizeBadge}</span>` : ''}
          ${d.directBadge ? `<span>${d.directBadge}</span>` : ''}
          <span>Score: ${d.score || 0}</span>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  content.innerHTML = html || `<div class="wab-empty"><div class="wab-empty-text">No deals found</div></div>`;
}

function displayAnalysis(result) {
  let html = '';

  if (result.alerts && result.alerts.length > 0) {
    html += `<div class="wab-section"><div class="wab-section-title">🛡️ Fraud Analysis</div>`;
    for (const a of result.alerts) {
      html += `<div class="wab-alert ${a.severity || 'medium'}">
        <span class="wab-alert-icon">${a.severity === 'high' ? '🚨' : '⚠️'}</span>
        <span><strong>${esc(a.title || '')}</strong><br>${esc(a.description || '')}</span>
      </div>`;
    }
    html += `</div>`;
  }

  if (result.trustScore !== undefined) {
    const color = result.trustScore >= 70 ? '#22c55e' : result.trustScore >= 40 ? '#f59e0b' : '#ef4444';
    html += `<div class="wab-section">
      <div class="wab-section-title">🛡️ Trust Score</div>
      <div style="text-align:center; padding: 16px;">
        <div style="font-size:40px; font-weight:700; color:${color};">${result.trustScore}</div>
        <div style="font-size:12px; color:#64748b;">out of 100</div>
      </div>
    </div>`;
  }

  content.innerHTML = html || `<div class="wab-section"><div class="wab-section-title">✅ No Issues Found</div><div class="wab-insight"><span>This page appears clean.</span></div></div>`;
}

// ─── Chat ────────────────────────────────────────────────────────────

$('#chatSend')?.addEventListener('click', sendChat);
$('#chatInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const input = $('#chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  // Show user message
  const msgDiv = document.createElement('div');
  msgDiv.className = 'wab-insight';
  msgDiv.innerHTML = `<span class="wab-insight-icon">👤</span><span>${esc(msg)}</span>`;
  content.appendChild(msgDiv);

  // Send to background
  chrome.runtime.sendMessage({ type: 'wab-chat', message: msg, sessionId }, (result) => {
    const respDiv = document.createElement('div');
    respDiv.className = 'wab-insight';
    if (result?.error) {
      respDiv.innerHTML = `<span class="wab-insight-icon">❌</span><span>${esc(result.error)}</span>`;
    } else {
      respDiv.innerHTML = `<span class="wab-insight-icon">🤖</span><span>${esc(result?.reply || result?.message || 'No response')}</span>`;
    }
    content.appendChild(respDiv);
    content.scrollTop = content.scrollHeight;
  });
}

// ─── Utils ───────────────────────────────────────────────────────────

function showEmpty(msg) {
  loading.style.display = 'none';
  content.innerHTML = `<div class="wab-empty">
    <div class="wab-empty-icon">🌐</div>
    <div class="wab-empty-text">${esc(msg)}</div>
  </div>`;
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ─── Start ───────────────────────────────────────────────────────────

init();
