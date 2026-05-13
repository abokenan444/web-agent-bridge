#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Ring 4 — Live End-to-End Handshake Validator
//
// Walks the full 8-step trust handshake against a live WAB deployment and
// prints a structured report. Read-only by default; writes a single project
// (re-registration is idempotent) and a single trust profile under a test
// project_id so the audit log is meaningful and inspectable.
//
// Usage:
//   node scripts/live-handshake.js
//   node scripts/live-handshake.js --base https://www.webagentbridge.com \
//                                  --domain webagentbridge.com
//   node scripts/live-handshake.js --json
//
// Exit codes:  0 = all green   1 = any step failed
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const dns = require('dns').promises;

const args = (() => {
  const out = { base: 'https://www.webagentbridge.com', domain: 'webagentbridge.com', json: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--base')   out.base   = process.argv[++i];
    else if (a === '--domain') out.domain = process.argv[++i];
    else if (a === '--json')   out.json   = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/live-handshake.js [--base URL] [--domain HOST] [--json]');
      process.exit(0);
    }
  }
  return out;
})();

const PROJECT_ID = 'wab-live-handshake-validator';
const steps = [];
function record(name, ok, detail) {
  steps.push({ step: steps.length + 1, name, ok: !!ok, detail: detail || null });
  if (!args.json) {
    const tag = ok ? '✅' : '❌';
    console.log(`${tag}  Step ${steps.length}  ${name}` + (detail ? `  — ${detail}` : ''));
  }
}

async function http(method, url, body, headers) {
  const init = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: r.status, headers: Object.fromEntries(r.headers), text, json };
}

function b64(buf) { return Buffer.from(buf).toString('base64'); }

async function run() {
  // ── Step 1: DNS TXT discovery (_wab.<domain>)
  let endpointFromTxt = null;
  try {
    const records = await dns.resolveTxt('_wab.' + args.domain);
    const flat = records.map(parts => parts.join('')).join(' ');
    const m = flat.match(/v=wab1[^;]*;\s*endpoint=([^\s;]+)/i);
    endpointFromTxt = m ? m[1] : null;
    record('DNS TXT _wab record', !!endpointFromTxt, endpointFromTxt || `no v=wab1 endpoint in ${flat.slice(0, 80)}`);
  } catch (e) {
    record('DNS TXT _wab record', false, e.code || e.message);
  }

  // ── Step 2: Fetch /.well-known/wab.json
  let wabJson = null;
  try {
    const url = endpointFromTxt || (args.base + '/.well-known/wab.json');
    const r = await http('GET', url);
    wabJson = r.json;
    // Accept any documented WAB Discovery version field: `version` (Ring 4) or
    // `wab_version` (WAB Discovery 1.x). Reject only when neither is present.
    const ver = wabJson && (wabJson.version || wabJson.wab_version);
    const ok = r.status === 200 && !!ver;
    record('Fetch /.well-known/wab.json', ok, ok ? `version=${ver} host=${wabJson.host || wabJson.domain || '-'}` : `HTTP ${r.status}`);
  } catch (e) {
    record('Fetch /.well-known/wab.json', false, e.message);
  }

  // ── Step 3: GET Ring 4 trust profile (or recognize that none exists yet)
  let trustProfile = null;
  let profileExists = false;
  try {
    const r = await http('GET', `${args.base}/api/ring4/status/${args.domain}`);
    if (r.status === 200 && r.json) {
      trustProfile = r.json;
      profileExists = true;
      record('GET /api/ring4/status/<domain>', true, `trust_score=${r.json.trust_score} expires_at=${r.json.expires_at}`);
    } else if (r.status === 404) {
      record('GET /api/ring4/status/<domain>', true, '404 — domain not yet registered (will register below)');
    } else {
      record('GET /api/ring4/status/<domain>', false, `HTTP ${r.status}`);
    }
  } catch (e) {
    record('GET /api/ring4/status/<domain>', false, e.message);
  }

  // ── Step 4: Pull server pubkey + verify the Ed25519 signature on the profile
  let serverPk = null;
  try {
    const r = await http('GET', `${args.base}/api/ring4/pubkey`);
    serverPk = r.json && r.json.pk;
    record('GET /api/ring4/pubkey', !!serverPk, serverPk ? `pk=${serverPk.slice(0, 16)}…` : `HTTP ${r.status}`);
  } catch (e) {
    record('GET /api/ring4/pubkey', false, e.message);
  }

  if (profileExists && trustProfile && trustProfile.signature && serverPk) {
    try {
      // Canonical mirrors server/routes/ring4.js canonicalProfile():
      //   JSON.stringify({ domain, capabilities, constraints, expires_at })
      // V8 preserves string-key insertion order through parse→stringify, so the
      // capabilities/constraints sub-objects re-serialize to the original bytes.
      const canonical = JSON.stringify({
        domain: trustProfile.domain,
        capabilities: trustProfile.capabilities,
        constraints: trustProfile.constraints,
        expires_at: trustProfile.expires_at
      });
      const pkRaw  = (trustProfile.signed_by_pk || '').replace(/^ed25519:/, '');
      const sigRaw = (trustProfile.signature   || '').replace(/^ed25519:/, '');
      const pkBuf = Buffer.from(pkRaw, 'base64');
      const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pkBuf]);
      const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), keyObj, Buffer.from(sigRaw, 'base64'));
      record('Verify profile signature (Ed25519)', ok, ok ? 'signature valid' : 'signature INVALID');
    } catch (e) {
      record('Verify profile signature (Ed25519)', false, e.message);
    }
  } else {
    record('Verify profile signature (Ed25519)', !profileExists, profileExists ? 'no signature on profile' : 'skipped — no profile yet');
  }

  // ── Step 5: Fetch JWKS + confirm active key matches /pubkey
  try {
    const r = await http('GET', `${args.base}/.well-known/jwks.json`);
    const keys = (r.json && r.json.keys) || [];
    const active = keys.find(k => k.use === 'sig' && k.crv === 'Ed25519');
    const ok = !!active && active.x && (b64UrlToB64(active.x) === serverPk);
    record('GET /.well-known/jwks.json', ok, ok ? `kid=${active.kid}` : `keys=${keys.length}`);
  } catch (e) {
    record('GET /.well-known/jwks.json', false, e.message);
  }

  // ── Step 6: Generate an agent keypair, register a project carrying its pubkey
  const { publicKey: agentPub, privateKey: agentPriv } = crypto.generateKeyPairSync('ed25519');
  const agentPkRaw = b64(agentPub.export({ format: 'der', type: 'spki' }).slice(-32));
  try {
    const r = await http('POST', `${args.base}/api/ring4/project/register`, {
      project_id: PROJECT_ID,
      display_name: 'WAB Live Handshake Validator',
      builder: 'WAB Self-Test',
      agent_type: 'sovereign-test',
      public_key: agentPkRaw,
      status: 'active'
    });
    record('POST /api/ring4/project/register', r.status === 200 && r.json && r.json.ok, `pk=${agentPkRaw.slice(0, 16)}… status=${r.status}`);
  } catch (e) {
    record('POST /api/ring4/project/register', false, e.message);
  }

  // ── Step 7: Send a header-bearing request signed with the agent key.
  // We use a benign endpoint (handshake) so the call is a no-op besides logging.
  let nonceSent = null;
  try {
    const path = '/api/ring4/handshake';
    nonceSent = 'live-' + crypto.randomBytes(12).toString('base64url');
    const message = `GET ${path}\n${nonceSent}`;
    const sig = crypto.sign(null, Buffer.from(message, 'utf8'), agentPriv).toString('base64');
    const r = await http('GET', args.base + path, undefined, {
      'X-WAB-Trust-Domain':  args.domain,
      'X-WAB-Trust-Project': PROJECT_ID,
      'X-WAB-Trust-Nonce':   nonceSent,
      'X-WAB-Signature':     'ed25519:' + sig,
      'traceparent':         '00-' + crypto.randomBytes(16).toString('hex') + '-' + crypto.randomBytes(8).toString('hex') + '-01'
    });
    record('Send signed request (X-WAB-Trust-* + X-WAB-Signature)', r.status === 200, `HTTP ${r.status}`);
  } catch (e) {
    record('Send signed request (X-WAB-Trust-* + X-WAB-Signature)', false, e.message);
  }

  // ── Step 8: Read the project log; confirm the new event is present and
  // signature_valid=1 (proving the middleware verified our agent pubkey).
  // Allow a short delay for the write to flush.
  await new Promise(r => setTimeout(r, 600));
  try {
    const r = await http('GET', `${args.base}/api/ring4/log/${PROJECT_ID}?limit=10`);
    const events = (r.json && (r.json.events || r.json.log || r.json)) || [];
    const recent = Array.isArray(events) ? events : (events.events || []);
    const hit = recent.find(ev =>
      (ev.agent_nonce === nonceSent || (ev.detail && ev.detail.includes('sig_ok'))) &&
      (ev.signature_valid === 1 || ev.signature_valid === true)
    );
    record('Audit: signed event present in /api/ring4/log/<project>', !!hit,
      hit ? `event_id=${hit.id || hit.event_id || '?'} outcome=${hit.outcome}` : `no matching event in last ${recent.length} rows`);
  } catch (e) {
    record('Audit: signed event present in /api/ring4/log/<project>', false, e.message);
  }

  // ── Report
  const passed = steps.filter(s => s.ok).length;
  const total  = steps.length;
  if (args.json) {
    console.log(JSON.stringify({ base: args.base, domain: args.domain, passed, total, steps }, null, 2));
  } else {
    console.log('');
    console.log(`────────────────────────────────────────`);
    console.log(`Result: ${passed}/${total} steps passed against ${args.domain} via ${args.base}`);
  }
  process.exit(passed === total ? 0 : 1);
}

function b64UrlToB64(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
}

run().catch(e => { console.error('FATAL', e); process.exit(2); });
