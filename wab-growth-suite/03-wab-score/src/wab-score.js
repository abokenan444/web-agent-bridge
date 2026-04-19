// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Score System v2.5
// "Credit rating" for digital platforms — quarterly reports
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';

// ── Grade mapping ─────────────────────────────────────────────────────────
const GRADE_MAP = [
  { min: 95, grade: 'A+', label: 'Exceptional',  color: '#22c55e' },
  { min: 90, grade: 'A',  label: 'Excellent',    color: '#4ade80' },
  { min: 85, grade: 'A-', label: 'Very Good',    color: '#86efac' },
  { min: 80, grade: 'B+', label: 'Good',         color: '#a3e635' },
  { min: 75, grade: 'B',  label: 'Above Average',color: '#bef264' },
  { min: 70, grade: 'B-', label: 'Average',      color: '#fde047' },
  { min: 65, grade: 'C+', label: 'Below Average',color: '#fbbf24' },
  { min: 60, grade: 'C',  label: 'Fair',         color: '#fb923c' },
  { min: 50, grade: 'C-', label: 'Poor',         color: '#f87171' },
  { min: 40, grade: 'D',  label: 'Very Poor',    color: '#ef4444' },
  { min:  0, grade: 'F',  label: 'Failing',      color: '#dc2626' },
];

function getGrade(score) {
  return GRADE_MAP.find(g => score >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];
}

// ── WABScore class ────────────────────────────────────────────────────────
class WABScore {
  constructor(apiKey) {
    if (!apiKey) throw new Error('WAB API key required — https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VER,
      'X-WAB-Source': 'wab-score',
    };
  }

  async _post(endpoint, body) {
    const res = await fetch(`${WAB_API}/${endpoint}`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WAB Score API error ${res.status}`);
    return res.json();
  }

  async _get(endpoint, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${WAB_API}/${endpoint}${qs ? '?' + qs : ''}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`WAB Score API error ${res.status}`);
    return res.json();
  }

  // ── Get full WAB Score for a domain ──────────────────────────────────
  async getScore(domain) {
    const [fairness, security] = await Promise.all([
      this._post('fairness/check', { platform: domain }),
      this._post('shield/scan',    { url: `https://${domain}` }),
    ]);

    const fairnessScore  = fairness.score || 0;
    const securityScore  = security.status === 'SAFE' ? 100 : security.status === 'WARNING' ? 60 : 0;
    const compositeScore = Math.round(fairnessScore * 0.7 + securityScore * 0.3);
    const gradeInfo      = getGrade(compositeScore);

    return {
      domain,
      wab_score:        compositeScore,
      grade:            gradeInfo.grade,
      label:            gradeInfo.label,
      color:            gradeInfo.color,
      components: {
        fairness: {
          score:   fairnessScore,
          weight:  '70%',
          signals: fairness.signals_count || 15,
          verdict: fairness.verdict,
        },
        security: {
          score:   securityScore,
          weight:  '30%',
          status:  security.status,
          verdict: security.verdict,
        },
      },
      issued_at:  new Date().toISOString(),
      valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
      powered_by: 'WAB — Web Agent Bridge | https://www.webagentbridge.com',
    };
  }

  // ── Generate press-ready HTML report ─────────────────────────────────
  async generateReport(domain) {
    const score = await this.getScore(domain);
    return this._buildHTML(score);
  }

  // ── Generate embeddable badge HTML ────────────────────────────────────
  async getBadgeHTML(domain) {
    const score = await this.getScore(domain);
    return `
<div class="wab-score-badge" style="
  display:inline-flex;align-items:center;gap:12px;
  background:#fff;border:2px solid ${score.color};
  border-radius:12px;padding:12px 18px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  box-shadow:0 2px 8px rgba(0,0,0,0.1);
">
  <div style="text-align:center">
    <div style="font-size:28px;font-weight:900;color:${score.color};line-height:1">${score.grade}</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:2px">WAB SCORE</div>
  </div>
  <div>
    <div style="font-weight:700;font-size:15px;color:#1e293b">${score.label}</div>
    <div style="font-size:12px;color:#64748b">${score.wab_score}/100 · ${domain}</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:4px">
      <a href="https://www.webagentbridge.com/score/${domain}" target="_blank" style="color:#3b82f6;text-decoration:none">
        Powered by WAB — Web Agent Bridge
      </a>
    </div>
  </div>
</div>`.trim();
  }

  // ── Generate WAB Score JSON-LD (for SEO) ──────────────────────────────
  async getJsonLD(domain) {
    const score = await this.getScore(domain);
    return {
      '@context': 'https://schema.org',
      '@type': 'Rating',
      'ratingValue': score.wab_score,
      'bestRating': 100,
      'worstRating': 0,
      'ratingExplanation': `WAB Score ${score.grade} — ${score.label}`,
      'author': {
        '@type': 'Organization',
        'name': 'WAB — Web Agent Bridge',
        'url': 'https://www.webagentbridge.com',
      },
      'datePublished': score.issued_at,
    };
  }

  // ── Batch score multiple domains ──────────────────────────────────────
  async batchScore(domains) {
    const results = await Promise.allSettled(domains.map(d => this.getScore(d)));
    return results.map((r, i) => ({
      domain: domains[i],
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason.message }),
    })).sort((a, b) => (b.wab_score || 0) - (a.wab_score || 0));
  }

  // ── Internal: build HTML report ───────────────────────────────────────
  _buildHTML(score) {
    const { domain, wab_score, grade, label, color, components, issued_at } = score;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAB Score Report — ${domain}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 32px; }
    .report { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0f172a, #1e3a5f); color: #fff; padding: 32px; display: flex; align-items: center; gap: 24px; }
    .grade-circle { width: 80px; height: 80px; border-radius: 50%; background: ${color}; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 900; color: #fff; flex-shrink: 0; }
    .header-info h1 { font-size: 22px; margin-bottom: 4px; }
    .header-info p { color: #94a3b8; font-size: 14px; }
    .body { padding: 28px; }
    .score-bar { background: #f1f5f9; border-radius: 8px; height: 12px; margin: 8px 0 20px; overflow: hidden; }
    .score-fill { height: 100%; border-radius: 8px; background: ${color}; width: ${wab_score}%; transition: width 1s ease; }
    .component { background: #f8fafc; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
    .component h3 { font-size: 14px; margin-bottom: 8px; color: #475569; }
    .component .val { font-size: 24px; font-weight: 700; color: #1e293b; }
    .footer { border-top: 1px solid #f1f5f9; padding: 16px 28px; font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; }
    .footer a { color: #3b82f6; text-decoration: none; }
  </style>
</head>
<body>
<div class="report">
  <div class="header">
    <div class="grade-circle">${grade}</div>
    <div class="header-info">
      <h1>WAB Score: ${wab_score}/100</h1>
      <p>${domain} · ${label} · Issued ${new Date(issued_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</p>
    </div>
  </div>
  <div class="body">
    <h2 style="font-size:16px;margin-bottom:8px">Overall Score</h2>
    <div class="score-bar"><div class="score-fill"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="component">
        <h3>⚖️ Fairness (70%)</h3>
        <div class="val">${components.fairness.score}/100</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${components.fairness.verdict || 'Platform transparency analysis'}</div>
      </div>
      <div class="component">
        <h3>🛡️ Security (30%)</h3>
        <div class="val">${components.security.score}/100</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${components.security.verdict || 'URL threat analysis'}</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <span>Valid for 90 days from ${new Date(issued_at).toLocaleDateString()}</span>
    <a href="https://www.webagentbridge.com/score/${domain}" target="_blank">Powered by WAB — Web Agent Bridge</a>
  </div>
</div>
</body>
</html>`;
  }
}

module.exports = { WABScore, getGrade };
