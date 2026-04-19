/**
 * WAB Platform Demo — Frontend Application
 * Connects to the isolated demo backend API
 */

// ─── Configuration ─────────────────────────────────────────────────────────────
// API URL — always use relative /api path (proxied by the demo server)
const API_BASE = window.WAB_API_URL || '/api';
let chatSessionId = null;

// ─── Tab System ────────────────────────────────────────────────────────────────
document.querySelectorAll('.demo-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.demo-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.demo-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('.code-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.code-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`code-${tab.dataset.code}`).classList.add('active');
  });
});

// ─── Live Stats ────────────────────────────────────────────────────────────────
async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE}/demo/stats`);
    const data = await res.json();
    const el = id => document.getElementById(id);
    if (el('stat-agents')) el('stat-agents').textContent = data.agentsConnected?.toLocaleString() || '12,847';
    if (el('stat-uptime')) el('stat-uptime').textContent = data.uptime || '99.97%';
    if (el('stat-latency')) el('stat-latency').textContent = data.avgResponseTime || '142ms';
    if (el('scamBlocked')) el('scamBlocked').textContent = data.scamBlocked?.toLocaleString() || '0';
    if (el('adsBlocked')) el('adsBlocked').textContent = data.adsBlocked?.toLocaleString() || '1,247';
  } catch (e) { /* silently fail */ }
}
fetchStats();
setInterval(fetchStats, 15000);

// ─── Agent Chat ────────────────────────────────────────────────────────────────
function addChatMessage(role, content, actions = []) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-message chat-message--${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'agent' ? 'W' : 'U';

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message-content';

  // Convert markdown-like formatting
  const formatted = content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\| (.*?) \|/g, (m) => m) // keep tables as-is for now
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');

  msgDiv.innerHTML = formatted;

  if (actions.length > 0) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'quick-action';
      btn.textContent = action;
      btn.onclick = () => sendQuickMessage(action);
      actionsDiv.appendChild(btn);
    });
    msgDiv.appendChild(actionsDiv);
  }

  div.appendChild(avatar);
  div.appendChild(msgDiv);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function addTypingIndicator() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-message chat-message--agent';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="message-avatar">W</div>
    <div class="message-content">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

async function sendAgentMessage() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  sendBtn.disabled = true;
  addChatMessage('user', message);
  addTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/demo/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: chatSessionId, context: {} }),
    });
    const data = await res.json();
    chatSessionId = data.sessionId;

    removeTypingIndicator();
    addChatMessage('agent', data.reply, data.suggestedActions || []);

    // Update intent display
    if (data.intent) {
      const intentDisplay = document.getElementById('intentDisplay');
      intentDisplay.innerHTML = `
        <div class="intent-result">
          <div class="intent-label">${data.intent}</div>
          <div class="intent-confidence">Confidence: ${Math.round(data.confidence * 100)}%</div>
          <div class="intent-bar"><div class="intent-bar-fill" style="width:${data.confidence * 100}%"></div></div>
        </div>`;
    }
  } catch (e) {
    removeTypingIndicator();
    addChatMessage('agent', 'Sorry, I encountered an error connecting to the demo backend. Please try again.');
  }
  sendBtn.disabled = false;
}

function sendQuickMessage(msg) {
  document.getElementById('chatInput').value = msg;
  sendAgentMessage();
}

document.getElementById('chatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendAgentMessage();
});

// ─── Fairness System ───────────────────────────────────────────────────────────
function setFairnessUrl(url) {
  document.getElementById('fairnessUrl').value = url;
}

async function runFairnessCheck() {
  const url = document.getElementById('fairnessUrl').value.trim();
  if (!url) return;

  const resultEl = document.getElementById('fairnessResult');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span class="loading-text">Analyzing platform fairness across 15+ signals...</span>
    </div>`;

  try {
    const res = await fetch(`${API_BASE}/demo/fairness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const d = await res.json();

    const scoreColor = d.color || '#0ea5e9';
    const breakdown = d.breakdown || {};

    resultEl.innerHTML = `
      <div class="fairness-result">
        <div class="fairness-header">
          <div>
            <div class="fairness-domain">${d.domain}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Category: ${d.category} · Size: ${d.platformSize}</div>
          </div>
          <div class="fairness-score-big">
            <div class="score-circle" style="color:${scoreColor};border-color:${scoreColor}">
              <span>${d.overall}</span>
              <span class="score-circle-label" style="color:${scoreColor}">${d.verdict}</span>
            </div>
          </div>
        </div>
        <div class="fairness-body">
          <div class="fairness-breakdown">
            ${Object.entries(breakdown).map(([key, b]) => {
              const color = b.score >= 75 ? 'var(--accent-green)' : b.score >= 50 ? 'var(--accent-blue)' : b.score >= 30 ? 'var(--accent-amber)' : 'var(--accent-red)';
              return `
                <div class="breakdown-item">
                  <div class="breakdown-label">${b.label}</div>
                  <div class="breakdown-bar-wrap">
                    <div class="breakdown-bar">
                      <div class="breakdown-bar-fill" style="width:${b.score}%;background:${color}"></div>
                    </div>
                    <span class="breakdown-score" style="color:${color}">${b.score}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${b.description}</div>
                </div>`;
            }).join('')}
          </div>
          <div class="fairness-recommendation" style="border-color:${scoreColor}">
            ${d.recommendation}
          </div>
        </div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="loading-state"><span class="loading-text" style="color:var(--accent-red)">Error connecting to demo API. Please try again.</span></div>`;
  }
}

// ─── Scam Shield ──────────────────────────────────────────────────────────────
function setShieldUrl(url) {
  document.getElementById('shieldUrl').value = url;
}

async function runShieldCheck() {
  const url = document.getElementById('shieldUrl').value.trim();
  if (!url) return;

  const resultEl = document.getElementById('shieldResult');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span class="loading-text">Scanning against 47 threat databases...</span>
    </div>`;

  try {
    const res = await fetch(`${API_BASE}/demo/shield`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const d = await res.json();

    const riskColor = d.riskScore >= 70 ? 'var(--accent-red)' : d.riskScore >= 40 ? 'var(--accent-amber)' : 'var(--accent-green)';
    const iconClass = d.riskScore >= 70 ? 'danger' : d.riskScore >= 40 ? 'warn' : 'safe';
    const iconEmoji = d.riskScore >= 70 ? '🚨' : d.riskScore >= 40 ? '⚠️' : '✅';
    const levelClass = d.riskLevel === 'critical' ? 'high' : d.riskLevel;

    resultEl.innerHTML = `
      <div class="shield-result">
        <div class="shield-header">
          <div class="shield-verdict">
            <div class="shield-icon shield-icon--${iconClass}">${iconEmoji}</div>
            <div>
              <div class="shield-domain">${d.domain}</div>
              <span class="shield-level shield-level--${levelClass}">${d.riskLevel.toUpperCase()}</span>
            </div>
          </div>
          <div class="risk-bar-wrap" style="margin-top:12px">
            <span style="font-size:12px;color:var(--text-muted);min-width:70px">Risk Score</span>
            <div class="risk-bar">
              <div class="risk-bar-fill" style="width:${d.riskScore}%;background:${riskColor}"></div>
            </div>
            <span class="risk-label" style="color:${riskColor}">${d.riskScore}%</span>
          </div>
        </div>
        <div class="shield-checks">
          ${(d.checks || []).map(c => `
            <div class="check-item">
              <span class="check-icon">${c.passed ? '✅' : '❌'}</span>
              <div>
                <div class="check-name">${c.name}</div>
                <div class="check-detail">${c.detail}</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="shield-recommendation" style="border-color:${riskColor}">
          ${d.recommendation}
        </div>
      </div>`;

    // Update live stats
    fetchStats();
  } catch (e) {
    resultEl.innerHTML = `<div class="loading-state"><span class="loading-text" style="color:var(--accent-red)">Error connecting to demo API. Please try again.</span></div>`;
  }
}

// ─── Deals Engine ─────────────────────────────────────────────────────────────
function setDealsQuery(query) {
  document.getElementById('dealsQuery').value = query;
}

async function runDealsSearch() {
  const query = document.getElementById('dealsQuery').value.trim();
  if (!query) return;

  const resultEl = document.getElementById('dealsResult');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span class="loading-text">Scanning 50,000+ sites for best deals on "${query}"...</span>
    </div>`;

  try {
    const res = await fetch(`${API_BASE}/demo/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const d = await res.json();

    const fairnessColor = score => score >= 80 ? 'var(--accent-green)' : score >= 65 ? 'var(--accent-blue)' : score >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)';
    const badgeClass = badge => badge === 'Best Value' ? 'best' : badge === 'Good Deal' || badge === 'Fair Price' ? 'good' : 'warn';

    resultEl.innerHTML = `
      <div class="deals-result">
        <div class="deals-header">
          <div class="deals-query">Results for <strong>"${d.query}"</strong> — ${d.totalResults} platforms analyzed</div>
          <div class="deals-savings">💰 Save up to ${d.savings?.percentage || '21%'} vs. marketplace pricing</div>
        </div>
        ${(d.deals || []).map((deal, i) => `
          <div class="deal-card ${i === 0 ? 'deal-card--best' : ''}">
            <div class="deal-rank">#${i + 1}</div>
            <div class="deal-info">
              <div class="deal-platform">
                ${deal.platform}
                ${deal.badge ? `<span class="deal-badge deal-badge--${badgeClass(deal.badge)}">${deal.badge}</span>` : ''}
              </div>
              <div class="deal-domain">${deal.domain}</div>
              <div class="deal-fairness">
                <div class="fairness-mini-bar">
                  <div class="fairness-mini-fill" style="width:${deal.fairness}%;background:${fairnessColor(deal.fairness)}"></div>
                </div>
                <span class="fairness-mini-score">Fairness: ${deal.fairness}/100</span>
              </div>
              <div class="deal-fees">${deal.hiddenFees}</div>
            </div>
            <div class="deal-price-wrap">
              <div class="deal-price">$${deal.price.toFixed(2)}</div>
              ${deal.originalPrice && deal.originalPrice !== deal.price ? `<div class="deal-original">$${deal.originalPrice.toFixed(2)}</div>` : ''}
              ${deal.savings ? `<div style="font-size:12px;color:var(--accent-green);font-weight:600;margin-top:4px">Save ${deal.savings}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="loading-state"><span class="loading-text" style="color:var(--accent-red)">Error connecting to demo API. Please try again.</span></div>`;
  }
}

// ─── Copy Code ────────────────────────────────────────────────────────────────
function copyCode(type) {
  const el = document.getElementById(`embed-${type}`);
  if (!el) return;
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

// ─── Smooth Scroll ────────────────────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// ─── Auto-run first fairness check on load ────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    // Pre-warm the API
    fetch(`${API_BASE}/health`).catch(() => {});
  }, 500);
});
