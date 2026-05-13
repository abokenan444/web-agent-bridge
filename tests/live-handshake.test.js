// ═══════════════════════════════════════════════════════════════════════════
// tests/live-handshake.test.js
//
// End-to-end live Ring 4 handshake test. Skipped by default; runs when the
// environment variable WAB_LIVE_BASE is set to a reachable WAB deployment.
//
//   WAB_LIVE_BASE=https://www.webagentbridge.com \
//   WAB_LIVE_DOMAIN=webagentbridge.com \
//   npx jest tests/live-handshake.test.js --runInBand
//
// Steps mirror scripts/live-handshake.js. Read-only against the API surface
// except for project registration (idempotent) and one audited GET request.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const dns    = require('dns').promises;

const BASE   = process.env.WAB_LIVE_BASE || '';
const DOMAIN = process.env.WAB_LIVE_DOMAIN || 'webagentbridge.com';
const PROJECT_ID = 'wab-live-handshake-validator';

const live = BASE ? describe : describe.skip;

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
function b64UrlToB64(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
}

live(`Ring 4 — Live Handshake (${BASE || 'skipped'})`, () => {
  jest.setTimeout(30000);

  const ctx = {};

  test('1. DNS TXT _wab record advertises a v=wab1 endpoint', async () => {
    const records = await dns.resolveTxt('_wab.' + DOMAIN);
    const flat = records.map(parts => parts.join('')).join(' ');
    const m = flat.match(/v=wab1[^;]*;\s*endpoint=([^\s;]+)/i);
    expect(m).toBeTruthy();
    ctx.endpoint = m[1];
  });

  test('2. Fetch /.well-known/wab.json', async () => {
    const r = await http('GET', ctx.endpoint || (BASE + '/.well-known/wab.json'));
    expect(r.status).toBe(200);
    expect(r.json).toBeTruthy();
    // Accept any documented WAB Discovery version field
    expect(r.json.version || r.json.wab_version).toBeTruthy();
  });

  test('3. GET /api/ring4/status/<domain> returns a registered profile', async () => {
    const r = await http('GET', `${BASE}/api/ring4/status/${DOMAIN}`);
    expect(r.status).toBe(200);
    expect(r.json).toBeTruthy();
    expect(r.json.signature).toMatch(/^ed25519:/);
    expect(r.json.signed_by_pk).toMatch(/^ed25519:/);
    ctx.profile = r.json;
  });

  test('4. GET /api/ring4/pubkey matches profile.signed_by_pk', async () => {
    const r = await http('GET', `${BASE}/api/ring4/pubkey`);
    expect(r.status).toBe(200);
    expect(r.json && r.json.pk).toBeTruthy();
    const profilePk = ctx.profile.signed_by_pk.replace(/^ed25519:/, '');
    expect(r.json.pk).toBe(profilePk);
    ctx.serverPk = r.json.pk;
  });

  test('5. Profile Ed25519 signature verifies against the server pubkey', () => {
    const canonical = JSON.stringify({
      domain: ctx.profile.domain,
      capabilities: ctx.profile.capabilities,
      constraints: ctx.profile.constraints,
      expires_at: ctx.profile.expires_at
    });
    const pkRaw  = ctx.profile.signed_by_pk.replace(/^ed25519:/, '');
    const sigRaw = ctx.profile.signature.replace(/^ed25519:/, '');
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pkRaw, 'base64')]);
    const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), keyObj, Buffer.from(sigRaw, 'base64'));
    expect(ok).toBe(true);
  });

  test('6. /.well-known/jwks.json publishes the active Ed25519 key', async () => {
    const r = await http('GET', `${BASE}/.well-known/jwks.json`);
    expect(r.status).toBe(200);
    const keys = (r.json && r.json.keys) || [];
    const active = keys.find(k => k.use === 'sig' && k.crv === 'Ed25519');
    expect(active).toBeTruthy();
    expect(b64UrlToB64(active.x)).toBe(ctx.serverPk);
  });

  test('7. Register a test project carrying our agent pubkey', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    ctx.agentPriv = privateKey;
    ctx.agentPkRaw = b64(publicKey.export({ format: 'der', type: 'spki' }).slice(-32));
    const r = await http('POST', `${BASE}/api/ring4/project/register`, {
      project_id: PROJECT_ID,
      display_name: 'WAB Live Handshake Validator',
      builder: 'WAB Self-Test',
      agent_type: 'sovereign-test',
      public_key: ctx.agentPkRaw,
      status: 'active'
    });
    expect(r.status).toBe(200);
    expect(r.json && r.json.ok).toBe(true);
  });

  test('8. Signed header request is accepted and verified by the middleware', async () => {
    const path = '/api/ring4/handshake';
    ctx.nonce = 'live-' + crypto.randomBytes(12).toString('base64url');
    const message = `GET ${path}\n${ctx.nonce}`;
    const sig = crypto.sign(null, Buffer.from(message, 'utf8'), ctx.agentPriv).toString('base64');
    const r = await http('GET', BASE + path, undefined, {
      'X-WAB-Trust-Domain':  DOMAIN,
      'X-WAB-Trust-Project': PROJECT_ID,
      'X-WAB-Trust-Nonce':   ctx.nonce,
      'X-WAB-Signature':     'ed25519:' + sig,
      'traceparent': '00-' + crypto.randomBytes(16).toString('hex') + '-' + crypto.randomBytes(8).toString('hex') + '-01'
    });
    expect(r.status).toBe(200);
  });

  test('9. Audit log records the verified interaction (signature_valid=1)', async () => {
    await new Promise(r => setTimeout(r, 700));
    const r = await http('GET', `${BASE}/api/ring4/log/${PROJECT_ID}?limit=20`);
    expect(r.status).toBe(200);
    const events = (r.json && (r.json.events || r.json.log)) || (Array.isArray(r.json) ? r.json : []);
    const hit = events.find(ev =>
      (ev.agent_nonce === ctx.nonce || (ev.detail && ev.detail.includes('sig_ok'))) &&
      (ev.signature_valid === 1 || ev.signature_valid === true)
    );
    expect(hit).toBeTruthy();
    expect(hit.outcome).toBe('allow');
  });
});
