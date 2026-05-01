// ═══════════ Bilingual toggle ═══════════
window.setLang = function (lang) {
  const isAr = lang === 'ar';
  document.documentElement.lang = isAr ? 'ar' : 'en';
  document.documentElement.dir = isAr ? 'rtl' : 'ltr';
  const enBtn = document.getElementById('enBtn');
  const arBtn = document.getElementById('arBtn');
  if (enBtn) enBtn.classList.toggle('active', !isAr);
  if (arBtn) arBtn.classList.toggle('active', isAr);
  document.querySelectorAll('[data-en]').forEach((el) => {
    el.textContent = isAr ? (el.getAttribute('data-ar') || el.textContent) : (el.getAttribute('data-en') || el.textContent);
  });
};

// ═══════════ Live DoH Verifier ═══════════
window.verifyDns = async function () {
  const domain = (document.getElementById('dnsDomain').value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const resolver = document.getElementById('dnsResolver').value;
  const status = document.getElementById('dnsStatus');
  const out = document.getElementById('dnsOut');
  if (!domain) {
    status.innerHTML = '<span class="danger">Please enter a domain.</span>';
    return;
  }
  const fqdn = '_wab.' + domain;
  status.innerHTML = '<span class="warn">Querying ' + fqdn + ' …</span>';
  out.textContent = '';
  try {
    const url = resolver + '?name=' + encodeURIComponent(fqdn) + '&type=TXT';
    const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
    const answers = (data.Answer || []).filter((a) => a.type === 16);
    if (!answers.length) {
      status.innerHTML = '<span class="danger">No _wab TXT record found for <b>' + domain + '</b>. The domain has not enabled WAB DNS Discovery (yet).</span>';
      return;
    }
    const value = answers.map((a) => (a.data || '').replace(/^"|"$/g, '').replace(/" "/g, '')).join(' ');
    const versionMatch = /v=([^;\s]+)/.exec(value);
    const endpointMatch = /endpoint=([^;\s]+)/.exec(value);
    if (versionMatch && endpointMatch && versionMatch[1].startsWith('wab')) {
      status.innerHTML = '<span class="ok">✓ Valid WAB record found. Version: <b>' + versionMatch[1] + '</b> · Endpoint: <a href="' + endpointMatch[1] + '" target="_blank" style="color:#7dd3fc">' + endpointMatch[1] + '</a></span>';
    } else {
      status.innerHTML = '<span class="warn">TXT record found but it does not match the WAB format (v=wab1; endpoint=…).</span>';
    }
  } catch (err) {
    status.innerHTML = '<span class="danger">Lookup failed: ' + ((err && err.message) || err) + '</span>';
  }
};

window.copyExample = function () {
  const txt = 'v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json';
  navigator.clipboard.writeText(txt).then(() => {
    const s = document.getElementById('dnsStatus');
    s.innerHTML = '<span class="ok">✓ Example record copied to clipboard.</span>';
  });
};

function _statePill(label, ok) {
  return '<span style="display:inline-block;margin:3px 6px 3px 0;padding:4px 9px;border-radius:999px;font-size:.74rem;border:1px solid ' +
    (ok ? 'rgba(74,222,128,.5);color:#4ade80;background:rgba(74,222,128,.12)' : 'rgba(248,113,113,.4);color:#f87171;background:rgba(248,113,113,.1)') +
    '">' + label + '</span>';
}

function renderProof(data) {
  const status = document.getElementById('proofStatus');
  const out = document.getElementById('proofOut');
  const txt = document.getElementById('proofTxt');
  const wab = document.getElementById('proofWabJson');
  const use = document.getElementById('useCaseValue');
  const badges = document.getElementById('stateBadges');
  const discoverPathBadge = document.getElementById('proofDiscoverPathBadge');
  if (!status || !out || !txt || !wab || !use || !badges) return;

  const states = data.statuses || {};
  badges.innerHTML = [
    _statePill('Registered', states.registered === 'yes'),
    _statePill('DNS Verified', states.dns_verified === 'yes'),
    _statePill('Agent-Ready', states.agent_ready === 'yes'),
    _statePill('Production', states.production === 'yes'),
  ].join('');

  const rawTxt = ((data.dns && data.dns.records) || [])[0] || '—';
  txt.textContent = rawTxt;
  const wabUrl = data.wab_json && data.wab_json.url;
  wab.innerHTML = wabUrl ? ('<a href="' + wabUrl + '" target="_blank" style="color:#7dd3fc">' + wabUrl + '</a>') : '—';
  use.textContent = (data.wab_json && data.wab_json.use_case) || '—';
  out.textContent = JSON.stringify(data, null, 2);

  const agentOk = data.execution_proof && data.execution_proof.ok;
  const coreOk = data.dns && data.dns.ok && data.wab_json && data.wab_json.ok;

  if (discoverPathBadge) {
    const discoverStep = data.execution_proof && data.execution_proof.steps
      ? data.execution_proof.steps.find((s) => s.key === 'agent_discover_call')
      : null;
    const detail = discoverStep && typeof discoverStep.detail === 'string' ? discoverStep.detail : '';
    const usedFallback = detail.includes('fallback /agent-bridge.json succeeded');
    const usedPrimary = detail.includes('GET /api/wab/discover succeeded');

    if (usedFallback) {
      discoverPathBadge.style.display = 'block';
      discoverPathBadge.innerHTML = '<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(250,204,21,.15);border:1px solid rgba(250,204,21,.45);color:#fde68a;font-size:.78rem;font-weight:700;letter-spacing:.03em">Fallback Used: /agent-bridge.json</span>';
    } else if (usedPrimary) {
      discoverPathBadge.style.display = 'block';
      discoverPathBadge.innerHTML = '<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.45);color:#86efac;font-size:.78rem;font-weight:700;letter-spacing:.03em">Primary Path: /api/wab/discover</span>';
    } else if (discoverStep && discoverStep.ok === false) {
      const detailText = detail ? (' — ' + detail.replace(/"/g, '&quot;')) : '';
      discoverPathBadge.style.display = 'block';
      discoverPathBadge.innerHTML = '<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.45);color:#fca5a5;font-size:.78rem;font-weight:700;letter-spacing:.03em" title="' + detail.replace(/"/g, '&quot;') + '">Discovery Path Failed' + detailText + '</span>';
    } else {
      discoverPathBadge.style.display = 'none';
      discoverPathBadge.innerHTML = '';
    }
  }

  status.innerHTML = '<span class="' + ((agentOk || coreOk) ? 'ok' : 'danger') + '">' +
    ((agentOk || coreOk)
      ? '✓ Verifiable proof ready.'
      : '✗ Verification incomplete. Check DNS record, endpoint, and agent flow.') +
    '</span>';
}

window.verifyLiveProof = async function () {
  const domain = (document.getElementById('dnsDomain').value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const status = document.getElementById('proofStatus');
  if (!status) return;
  if (!domain) {
    status.innerHTML = '<span class="danger">Please enter a domain.</span>';
    return;
  }
  status.innerHTML = '<span class="warn">Running live verification…</span>';
  try {
    const res = await fetch('/api/discovery/verify-live?domain=' + encodeURIComponent(domain));
    const data = await res.json();
    renderProof(data);
  } catch (err) {
    status.innerHTML = '<span class="danger">Verification failed: ' + ((err && err.message) || err) + '</span>';
  }
};

window.testWithAgent = async function () {
  const domain = (document.getElementById('dnsDomain').value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const status = document.getElementById('proofStatus');
  if (!status) return;
  if (!domain) {
    status.innerHTML = '<span class="danger">Please enter a domain.</span>';
    return;
  }
  status.innerHTML = '<span class="warn">Running agent flow (discover → ping)…</span>';
  try {
    const res = await fetch('/api/discovery/test-agent?domain=' + encodeURIComponent(domain));
    const data = await res.json();
    renderProof(data);
  } catch (err) {
    status.innerHTML = '<span class="danger">Agent test failed: ' + ((err && err.message) || err) + '</span>';
  }
};

window.toggleAdvanced = function () {
  const blocks = document.querySelectorAll('.advanced-block');
  blocks.forEach((el) => {
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
  });
};

// ═══════════ Canonical records — live status ═══════════
const RR_TYPE = { TXT: 16, CAA: 257, A: 1, AAAA: 28, CNAME: 5 };

function _decodeCAARdata(hex) {
  try {
    const bytes = hex.replace(/\\#\s*\d+\s*/, '').replace(/\s+/g, '');
    const buf = bytes.match(/.{1,2}/g).map((b) => parseInt(b, 16));
    const tagLen = buf[1];
    let tag = '';
    let val = '';
    for (let i = 0; i < tagLen; i++) tag += String.fromCharCode(buf[2 + i]);
    for (let i = 2 + tagLen; i < buf.length; i++) val += String.fromCharCode(buf[i]);
    return { tag, value: val };
  } catch {
    return null;
  }
}

function _normalizeAnswer(answer, type) {
  const data = answer.data || '';
  if (type === 'CAA') {
    const decoded = _decodeCAARdata(data);
    if (decoded) return decoded.tag + ' ' + decoded.value;
    return data;
  }
  return data.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
}

async function _doh(name, type) {
  const url = 'https://cloudflare-dns.com/dns-query?name=' +
    encodeURIComponent(name) + '&type=' + encodeURIComponent(type) + '&do=1';
  const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
  const data = await res.json();
  const want = RR_TYPE[type];
  const answers = (data.Answer || []).filter((a) => a.type === want)
    .map((a) => _normalizeAnswer(a, type));
  Object.defineProperty(answers, '_ad', { value: !!data.AD, enumerable: false });
  return answers;
}

async function checkDnssecForWab() {
  const el = document.getElementById('dnssecLiveStatus');
  const rowState = document.getElementById('dnssecRowState');
  if (!el) return;
  try {
    const ans = await _doh('_wab.webagentbridge.com', 'TXT');
    if (ans._ad) {
      el.className = 'ok';
      el.textContent = '✓ DNSSEC validated (AD=1) at resolver';
      if (rowState) {
        rowState.className = 'ok';
        rowState.textContent = '✓ DNSSEC validated';
      }
    } else {
      el.className = 'warn';
      el.textContent = '⚠ DNSSEC not yet enabled on this zone (AD=0). Roadmap: enable DS at registrar.';
    }
  } catch {
    el.className = 'warn';
    el.textContent = '… could not verify (DoH unreachable)';
  }
}

async function checkCanonicalRecords() {
  const rows = document.querySelectorAll('#recordsTable tr[data-record]');
  const summary = document.getElementById('recordsLiveStatus');
  let pass = 0;
  let fail = 0;
  const tasks = Array.from(rows).map(async (row) => {
    const cell = row.querySelector('.live-cell');
    const name = row.dataset.record;
    const type = row.dataset.rtype;
    const match = row.dataset.match;
    try {
      const answers = await _doh(name, type);
      const hit = answers.some((a) => a.toLowerCase().includes(match.toLowerCase()));
      if (hit) {
        cell.innerHTML = '<span class="ok" title="Verified live via Cloudflare DoH">✓ live</span>';
        pass++;
      } else {
        cell.innerHTML = '<span class="danger" title="Record not yet propagated or missing">✗ missing</span>';
        fail++;
      }
    } catch {
      cell.innerHTML = '<span class="warn" title="Lookup failed">… error</span>';
    }
  });
  await Promise.allSettled(tasks);
  const total = pass + fail;
  summary.innerHTML = '<span class="' + (fail === 0 ? 'ok' : 'warn') + '">' +
    (fail === 0
      ? '✓ All ' + total + ' canonical records verified live (Cloudflare DoH).'
      : '⚠ ' + pass + '/' + total + ' records live — ' + fail + ' missing or propagating.') + '</span>';
}

function bindHandlers() {
  const enBtn = document.getElementById('enBtn');
  const arBtn = document.getElementById('arBtn');
  const verifyBtn = document.getElementById('dnsVerifyBtn');
  const copyBtn = document.getElementById('dnsCopyBtn');
  const advancedBtn = document.getElementById('dnsAdvancedToggleBtn');
  const proofVerifyBtn = document.getElementById('dnsProofVerifyBtn');
  const proofAgentBtn = document.getElementById('dnsProofAgentBtn');

  if (enBtn) enBtn.addEventListener('click', () => window.setLang('en'));
  if (arBtn) arBtn.addEventListener('click', () => window.setLang('ar'));
  if (verifyBtn) verifyBtn.addEventListener('click', () => window.verifyDns());
  if (copyBtn) copyBtn.addEventListener('click', () => window.copyExample());
  if (advancedBtn) advancedBtn.addEventListener('click', () => window.toggleAdvanced());
  if (proofVerifyBtn) proofVerifyBtn.addEventListener('click', () => window.verifyLiveProof());
  if (proofAgentBtn) proofAgentBtn.addEventListener('click', () => window.testWithAgent());
}

document.addEventListener('DOMContentLoaded', () => {
  bindHandlers();
  checkCanonicalRecords().catch(() => {});
  checkDnssecForWab().catch(() => {});
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (!navbar) return;
    navbar.style.background = window.scrollY > 50
      ? 'rgba(7, 13, 25, 0.92)'
      : 'rgba(7, 13, 25, 0.78)';
  });
});

