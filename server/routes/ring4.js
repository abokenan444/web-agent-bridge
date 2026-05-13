// ═══════════════════════════════════════════════════════════════════════════
// WAB Ring 4 — External Trust Verification API (v3.7.0)
//
// Endpoints for sovereign agents (VEXR Ultra, ASIM SOVEREIGN, ...) that
// integrate WAB as their Ring 4 trust layer.
//
// Mounted at /api/ring4 in server/index.js.
//
// Surface:
//   POST   /project/register        — register a sovereign agent project (returns project_id)
//   GET    /projects                — list projects (public, sanitized)
//   POST   /register                — issue/refresh a Ring 4 trust profile for a domain
//   GET    /status/:domain          — fetch current trust profile + signature
//   GET    /profile/:domain         — alias of /status
//   POST   /log                     — log an interaction (project_id required)
//   GET    /log/:project_id         — fetch interaction log for a project
//   POST   /verify                  — verify Ed25519 signature on a payload using the domain pk
//   GET    /invariants              — list constitutional invariants
//   POST   /invariants/check        — runtime check action vs invariants     (NEW v3.7.0)
//   GET    /refusals                — aggregated, anonymized refusal stats    (NEW v3.7.0)
//   GET    /schema                  — wab.json v1.1 schema
//   GET    /handshake               — recommended trust handshake flow
//   GET    /health                  — module health
//   GET    /pubkey                  — current Ed25519 public key
//   GET    /jwks                    — JWKS document (all active + superseded keys)
//   GET    /keys                    — list keys (no privates)                 (NEW v3.7.0)
//   POST   /keys/rotate             — rotate signing key (admin)              (NEW v3.7.0)
//   POST   /federation/peer         — register a peer WAB instance            (NEW v3.7.0)
//   GET    /federation/peers        — list peers                              (NEW v3.7.0)
//   DELETE /federation/peer/:peer_id — remove a peer                          (NEW v3.7.0)
//   POST   /conformance/run         — run 3-test conformance suite            (NEW v3.7.0)
//   GET    /conformance/:project_id — conformance history                     (NEW v3.7.0)
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../models/db');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const DAILY_SALT = () => {
  const day = new Date().toISOString().slice(0, 10);
  return `wab-ring4-${day}-${process.env.RING4_SALT || 'default'}`;
};
const hashIp = (ip) => crypto.createHash('sha256').update(`${DAILY_SALT()}:${ip || 'unknown'}`).digest('hex').slice(0, 24);
const safeJson = (v, fallback = '{}') => { try { return JSON.parse(v || fallback); } catch { return JSON.parse(fallback); } };
const okDomain = (d) => typeof d === 'string' && /^[a-z0-9.-]{3,253}$/i.test(d);
const okProject = (p) => typeof p === 'string' && /^[a-z0-9-]{2,64}$/i.test(p);
const okKid = (k) => typeof k === 'string' && /^[a-z0-9._-]{3,64}$/i.test(k);
const b64url = (buf) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function ed25519Verify(publicKeyB64, message, signatureB64) {
  try {
    const pk = Buffer.from(publicKeyB64, 'base64');
    if (pk.length !== 32) return false;
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pk]);
    const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const sig = Buffer.from(signatureB64, 'base64');
    const msg = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
    return crypto.verify(null, msg, keyObj, sig);
  } catch {
    return false;
  }
}

function canonicalProfile(domain, capabilities, constraints, expires_at) {
  return JSON.stringify({ domain, capabilities, constraints, expires_at });
}

// ────────────────────────────────────────────────────────────────────────────
// Key management (multi-key rotation with backwards-compatible env fallback)
// ────────────────────────────────────────────────────────────────────────────
const KEYS_DIR = process.env.WAB_RING4_KEYS_DIR
  || (process.env.NODE_ENV === 'test'
      ? path.join(__dirname, '..', '..', 'data-test', 'keys')
      : path.join(__dirname, '..', '..', 'data', 'keys'));

function ensureKeysDir() {
  try { fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
}

function rawPubFromPem(pem) {
  const pub = crypto.createPublicKey(crypto.createPrivateKey(pem));
  const spki = pub.export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32);
}

function loadPrimaryPemFromEnv() {
  const pemFromEnv = process.env.WAB_RING4_PRIVATE_KEY_PEM;
  const pathFromEnv = process.env.WAB_RING4_PRIVATE_KEY_PATH;
  if (pemFromEnv) return { pem: pemFromEnv, source: 'env-pem' };
  if (pathFromEnv) {
    try { return { pem: fs.readFileSync(pathFromEnv, 'utf8'), source: 'env-path:' + pathFromEnv }; }
    catch { return null; }
  }
  return null;
}

// In-process key cache: kid → { privatePem, publicKeyB64 }
const keyCache = new Map();

// In-process negative cache for /status/:domain (unknown domains)
const negCache = new Map();

function registerKey(kid, pem, status = 'active', source = 'manual') {
  const pubRaw = rawPubFromPem(pem).toString('base64');
  db.prepare(`
    INSERT INTO ring4_keys (kid, algorithm, public_key_b64, status, source)
    VALUES (?, 'ed25519', ?, ?, ?)
    ON CONFLICT(kid) DO UPDATE SET status = excluded.status
  `).run(kid, pubRaw, status, source);
  keyCache.set(kid, { pem, publicKeyB64: pubRaw });
  return { kid, publicKeyB64: pubRaw };
}

function bootstrapKeys() {
  ensureKeysDir();
  try {
    // Ensure DB row exists for the env-provided key
    const envKey = loadPrimaryPemFromEnv();
    if (envKey) {
      const pubB64 = rawPubFromPem(envKey.pem).toString('base64');
      const existing = db.prepare(`SELECT kid, status FROM ring4_keys WHERE public_key_b64 = ?`).get(pubB64);
      if (!existing) {
        const kid = 'ring4-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
        registerKey(kid, envKey.pem, 'active', envKey.source);
      } else if (existing.status !== 'active') {
        db.prepare(`UPDATE ring4_keys SET status = 'active' WHERE kid = ?`).run(existing.kid);
      }
      const row = db.prepare(`SELECT kid FROM ring4_keys WHERE public_key_b64 = ?`).get(pubB64);
      if (row) keyCache.set(row.kid, { pem: envKey.pem, publicKeyB64: pubB64 });
    }

    // Re-hydrate cached PEMs for any rotated keys stored on disk
    const all = db.prepare(`SELECT kid FROM ring4_keys`).all();
    for (const k of all) {
      if (keyCache.has(k.kid)) continue;
      const filePath = path.join(KEYS_DIR, `${k.kid}.pem`);
      if (fs.existsSync(filePath)) {
        try { keyCache.set(k.kid, { pem: fs.readFileSync(filePath, 'utf8'), publicKeyB64: null }); } catch { /* ignore */ }
      }
    }
  } catch { /* tables not migrated yet; bootstrap retries on first read */ }
}

function getActiveKey() {
  try {
    let row = db.prepare(`SELECT kid, public_key_b64 FROM ring4_keys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`).get();
    if (!row) {
      // First call after migrations? Re-run bootstrap.
      bootstrapKeys();
      row = db.prepare(`SELECT kid, public_key_b64 FROM ring4_keys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`).get();
      if (!row) return null;
    }
    const cached = keyCache.get(row.kid);
    if (cached && cached.pem) return { kid: row.kid, pem: cached.pem, publicKeyB64: row.public_key_b64 };
    // Fall through to env-based PEM if cache miss
    const envKey = loadPrimaryPemFromEnv();
    if (envKey) {
      const pubB64 = rawPubFromPem(envKey.pem).toString('base64');
      if (pubB64 === row.public_key_b64) {
        keyCache.set(row.kid, { pem: envKey.pem, publicKeyB64: pubB64 });
        return { kid: row.kid, pem: envKey.pem, publicKeyB64: pubB64 };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function listVerificationKeys() {
  // active + superseded (revoked excluded)
  try {
    return db.prepare(`SELECT kid, public_key_b64, status FROM ring4_keys WHERE status IN ('active','superseded') ORDER BY created_at DESC`).all();
  } catch {
    return [];
  }
}

function signProfile(payloadStr) {
  const active = getActiveKey();
  if (!active) return { signature: null, pk: null, kid: null };
  const keyObj = crypto.createPrivateKey(active.pem);
  const sig = crypto.sign(null, Buffer.from(payloadStr, 'utf8'), keyObj);
  return {
    signature: 'ed25519:' + sig.toString('base64'),
    pk: 'ed25519:' + active.publicKeyB64,
    kid: active.kid
  };
}

bootstrapKeys();

// ────────────────────────────────────────────────────────────────────────────
// Project registry
// ────────────────────────────────────────────────────────────────────────────
router.post('/project/register', (req, res) => {
  const { project_id, display_name, builder, agent_type, public_key, contact, metadata } = req.body || {};
  if (!okProject(project_id || '')) return res.status(400).json({ error: 'invalid project_id (a-z0-9-, 2-64 chars)' });
  if (!display_name || typeof display_name !== 'string') return res.status(400).json({ error: 'display_name required' });
  if (!builder || typeof builder !== 'string') return res.status(400).json({ error: 'builder required' });

  try {
    db.prepare(`
      INSERT INTO ring4_projects (project_id, display_name, builder, agent_type, public_key, contact, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET
        display_name = excluded.display_name,
        builder      = excluded.builder,
        agent_type   = excluded.agent_type,
        public_key   = excluded.public_key,
        contact      = excluded.contact,
        metadata_json= excluded.metadata_json,
        updated_at   = datetime('now')
    `).run(
      project_id,
      display_name.slice(0, 200),
      builder.slice(0, 200),
      agent_type || 'sovereign-constitutional',
      public_key || null,
      contact || null,
      JSON.stringify(metadata || {})
    );
    return res.json({ ok: true, project_id });
  } catch (e) {
    return res.status(500).json({ error: 'project_register_failed', detail: e.message });
  }
});

router.get('/projects', (_req, res) => {
  const rows = db.prepare(`
    SELECT project_id, display_name, builder, agent_type, status, created_at
    FROM ring4_projects
    WHERE status = 'active'
    ORDER BY created_at ASC
  `).all();
  return res.json({ projects: rows });
});

// ────────────────────────────────────────────────────────────────────────────
// Trust profiles
// ────────────────────────────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { domain, label, capabilities, constraints, ttl_seconds, trust_score } = req.body || {};
  if (!okDomain(domain || '')) return res.status(400).json({ error: 'invalid domain' });
  if (!capabilities || typeof capabilities !== 'object') return res.status(400).json({ error: 'capabilities object required' });

  const safeConstraints = Object.assign(
    { ttl_seconds: 86400, max_cumulative_risk_delta: 0.15, never_override_hard_refuse: true },
    (constraints && typeof constraints === 'object') ? constraints : {}
  );
  const ttl = Math.min(Math.max(parseInt(ttl_seconds, 10) || safeConstraints.ttl_seconds || 86400, 60), 60 * 60 * 24 * 30);
  const score = Math.max(0, Math.min(1, parseFloat(trust_score) || 0.7));
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
  const capsStr = JSON.stringify(capabilities);
  const consStr = JSON.stringify(safeConstraints);
  const { signature, pk } = signProfile(canonicalProfile(domain, capabilities, safeConstraints, expires_at));

  try {
    db.prepare(`
      INSERT INTO ring4_trust_profiles (domain, label, capabilities, constraints, ttl_seconds, trust_score, signature, signed_by_pk, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(domain) DO UPDATE SET
        label        = excluded.label,
        capabilities = excluded.capabilities,
        constraints  = excluded.constraints,
        ttl_seconds  = excluded.ttl_seconds,
        trust_score  = excluded.trust_score,
        signature    = excluded.signature,
        signed_by_pk = excluded.signed_by_pk,
        expires_at   = excluded.expires_at,
        updated_at   = datetime('now')
    `).run(domain, label || domain, capsStr, consStr, ttl, score, signature, pk, expires_at);
    // Invalidate negative cache so the new profile is immediately visible
    negCache.delete(domain);

    // Audit log — project_id resolved or fallback to system project (no more NULL)
    const project_id = okProject(req.body.project_id || '') ? req.body.project_id : 'wab-system';
    db.prepare(`
      INSERT INTO ring4_interaction_log (project_id, domain, event_type, capabilities_applied, constraints_applied, outcome, detail, source_ip_hash)
      VALUES (?, ?, 'register', ?, ?, 'allow', ?, ?)
    `).run(project_id, domain, capsStr, consStr, `trust_score=${score}; ttl=${ttl}`, hashIp(req.ip));

    return res.json({
      ok: true,
      domain,
      trust_score: score,
      ttl_seconds: ttl,
      expires_at,
      signature,
      signed_by_pk: pk,
      status: 'registered'
    });
  } catch (e) {
    return res.status(500).json({ error: 'profile_register_failed', detail: e.message });
  }
});

function fetchProfile(domain) {
  return db.prepare(`
    SELECT domain, label, capabilities, constraints, ttl_seconds, trust_score, signature, signed_by_pk, expires_at, created_at, updated_at
    FROM ring4_trust_profiles
    WHERE domain = ?
  `).get(domain);
}

function profileResponse(row) {
  if (!row) return null;
  const expired = new Date(row.expires_at).getTime() < Date.now();
  // Count verifications historically logged
  const count = db.prepare(`SELECT COUNT(1) AS n FROM ring4_interaction_log WHERE domain = ? AND event_type IN ('verify','recognize')`).get(row.domain).n;
  return {
    domain: row.domain,
    label: row.label,
    wab_verified: !expired,
    temporal_trust_score: row.trust_score,
    last_verification: row.updated_at,
    verification_count: count,
    capabilities: safeJson(row.capabilities),
    constraints: safeJson(row.constraints),
    ttl_seconds: row.ttl_seconds,
    signature: row.signature,
    signed_by_pk: row.signed_by_pk,
    expires_at: row.expires_at,
    status: expired ? 'expired' : 'registered'
  };
}

router.get('/status/:domain', (req, res) => {
  const domain = String(req.params.domain || '').toLowerCase();
  if (!okDomain(domain)) return res.status(400).json({ error: 'invalid domain' });
  // Negative-result cache (60 s) — prevents DB hammering on garbage domains.
  const cached = negCache.get(domain);
  if (cached && cached.until > Date.now()) {
    res.set('X-Ring4-Cache', 'NEG-HIT');
    return res.status(404).json({ error: 'not_registered', domain, cached: true });
  }
  const row = fetchProfile(domain);
  if (!row) {
    negCache.set(domain, { until: Date.now() + 60_000 });
    if (negCache.size > 500) {
      // LRU-ish prune: drop the oldest 100 entries
      const keys = Array.from(negCache.keys()).slice(0, 100);
      for (const k of keys) negCache.delete(k);
    }
    return res.status(404).json({ error: 'not_registered', domain });
  }
  // Positive hit invalidates any stale negative entry
  negCache.delete(domain);
  return res.json(profileResponse(row));
});

router.get('/profile/:domain', (req, res) => {
  req.url = `/status/${req.params.domain}`;
  router.handle(req, res);
});

// ────────────────────────────────────────────────────────────────────────────
// Interaction log
// ────────────────────────────────────────────────────────────────────────────
router.post('/log', (req, res) => {
  const { project_id, domain, event_type, signature_valid, outcome, article_invoked, detail, agent_nonce, capabilities_applied, constraints_applied } = req.body || {};
  if (!okProject(project_id || '')) return res.status(400).json({ error: 'invalid project_id' });
  if (!event_type || !['register', 'recognize', 'verify', 'refuse', 'softened', 'revoke', 'allow', 'hard_refuse_held'].includes(event_type)) {
    return res.status(400).json({ error: 'invalid event_type' });
  }
  if (domain && !okDomain(domain)) return res.status(400).json({ error: 'invalid domain' });

  // Confirm project exists (auto-create lightweight record if absent)
  const exists = db.prepare(`SELECT 1 FROM ring4_projects WHERE project_id = ?`).get(project_id);
  if (!exists) {
    db.prepare(`INSERT INTO ring4_projects (project_id, display_name, builder) VALUES (?, ?, ?)`)
      .run(project_id, project_id, 'auto-registered');
  }

  try {
    const r = db.prepare(`
      INSERT INTO ring4_interaction_log (
        project_id, domain, event_type, signature_valid, capabilities_applied, constraints_applied,
        outcome, article_invoked, detail, source_ip_hash, agent_nonce
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project_id,
      domain || null,
      event_type,
      (signature_valid === true || signature_valid === 1) ? 1 : (signature_valid === false || signature_valid === 0) ? 0 : null,
      capabilities_applied ? JSON.stringify(capabilities_applied) : null,
      constraints_applied ? JSON.stringify(constraints_applied) : null,
      outcome || null,
      article_invoked || null,
      typeof detail === 'string' ? detail.slice(0, 500) : null,
      hashIp(req.ip),
      typeof agent_nonce === 'string' ? agent_nonce.slice(0, 64) : null
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    return res.status(500).json({ error: 'log_failed', detail: e.message });
  }
});

router.get('/log/:project_id', (req, res) => {
  const project_id = String(req.params.project_id || '');
  if (!okProject(project_id)) return res.status(400).json({ error: 'invalid project_id' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  // Include legacy NULL project_id rows when the system project is queried
  const includeLegacy = project_id === 'wab-system';
  const rows = includeLegacy
    ? db.prepare(`
        SELECT id, COALESCE(project_id, 'wab-system') AS project_id, domain, event_type, signature_valid,
               capabilities_applied, constraints_applied, outcome, article_invoked, detail, agent_nonce, created_at
        FROM ring4_interaction_log
        WHERE project_id = ? OR project_id IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `).all(project_id, limit)
    : db.prepare(`
        SELECT id, project_id, domain, event_type, signature_valid, capabilities_applied, constraints_applied,
               outcome, article_invoked, detail, agent_nonce, created_at
        FROM ring4_interaction_log
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(project_id, limit);
  return res.json({ project_id, count: rows.length, events: rows });
});

// ────────────────────────────────────────────────────────────────────────────
// Signature verification (Ed25519 against domain pk)
// ────────────────────────────────────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const { domain, message, signature, public_key } = req.body || {};
  if (!okDomain(domain || '')) return res.status(400).json({ error: 'invalid domain' });
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required (string)' });
  if (!signature || typeof signature !== 'string') return res.status(400).json({ error: 'signature required (base64)' });

  let pk = public_key;
  if (!pk) {
    const row = fetchProfile(domain);
    pk = row && row.signed_by_pk ? row.signed_by_pk : null;
  }
  if (!pk) return res.status(404).json({ error: 'no_public_key_for_domain', domain });
  const pkRaw = pk.startsWith('ed25519:') ? pk.slice(8) : pk;
  const sigRaw = signature.startsWith('ed25519:') ? signature.slice(8) : signature;
  const valid = ed25519Verify(pkRaw, message, sigRaw);
  return res.json({ ok: true, domain, valid, algorithm: 'ed25519' });
});

// ────────────────────────────────────────────────────────────────────────────
// Constitutional invariants
// ────────────────────────────────────────────────────────────────────────────
router.get('/invariants', (_req, res) => {
  const rows = db.prepare(`SELECT name, description, applies_to FROM ring4_invariants ORDER BY id ASC`).all();
  return res.json({
    invariants: rows,
    contract: 'A Ring 4 trust profile may soften refusals, lower friction, or grant access. It MAY NOT override any invariant listed here. P_REFUSE on these clauses can never become ANSWER, regardless of trust score.'
  });
});

// ────────────────────────────────────────────────────────────────────────────
// wab.json v1.1 schema (with trust_profile section consumed by Ring 4 agents)
// ────────────────────────────────────────────────────────────────────────────
router.get('/schema', (_req, res) => {
  return res.json({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://www.webagentbridge.com/protocol/v1.1/wab.json',
    title: 'WAB Capability + Trust Manifest (v1.1)',
    description: 'Open standard for AI-agent-discoverable site capabilities and Ring 4 trust profiles.',
    type: 'object',
    required: ['payload', 'signature'],
    properties: {
      payload: {
        type: 'object',
        required: ['version', 'type', 'host', 'endpoint', 'issued_at', 'expires_at', 'capabilities', 'trust'],
        properties: {
          version: { const: 'wab1' },
          type: { enum: ['wab.trust', 'wab.capability', 'wab.composite'] },
          host: { type: 'string' },
          endpoint: { type: 'string', format: 'uri' },
          issued_at: { type: 'string', format: 'date-time' },
          expires_at: { type: 'string', format: 'date-time' },
          capabilities: { type: 'object' },
          trust: {
            type: 'object',
            properties: {
              pk: { type: 'string', pattern: '^ed25519:' },
              ssl: { type: 'object' }
            }
          },
          trust_profile: {
            type: 'object',
            description: 'Optional Ring 4 capability profile consumed by sovereign agents.',
            properties: {
              data_access: { type: 'object', properties: { can_receive_raw_logs: { type: 'boolean' }, can_receive_sanitized_logs: { type: 'boolean' } } },
              risk_theory: { type: 'object', properties: { allowed: { type: 'boolean' }, max_depth: { type: 'string' }, allowed_topics: { type: 'array', items: { type: 'string' } } } },
              meta_discussion: { type: 'object', properties: { allowed: { type: 'boolean' }, priority: { type: 'string' } } },
              operational_detail: { type: 'object', properties: { allowed: { type: 'boolean' }, scopes: { type: 'array' } } },
              constraints: { type: 'object', properties: { ttl_seconds: { type: 'integer' }, max_cumulative_risk_delta: { type: 'number' }, never_override_hard_refuse: { type: 'boolean' } } }
            }
          }
        }
      },
      signature: { type: 'string', pattern: '^ed25519:' }
    },
    headers: {
      'X-WAB-Trust-Domain':  'The DNS-verified trusted origin presenting itself to the agent.',
      'X-WAB-Signature':     'Ed25519 signature (base64) over the canonical request body.',
      'X-WAB-Trust-Nonce':   'Replay-defence nonce supplied by the agent.',
      'X-WAB-Trust-Profile': '(optional) URL to the Ring 4 capability profile to apply.'
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Recommended trust handshake flow
// ────────────────────────────────────────────────────────────────────────────
router.get('/handshake', (_req, res) => {
  return res.json({
    version: 'wab-trust-handshake/1.1',
    description: 'Recommended Ring 4 trust handshake between a sovereign agent and a WAB-enrolled domain.',
    steps: [
      { n: 1, action: 'DNS lookup',         detail: 'Agent queries _wab.<domain> TXT and reads { endpoint, pk }.' },
      { n: 2, action: 'Fetch manifest',     detail: 'Agent GETs /.well-known/wab.json from the published endpoint.' },
      { n: 3, action: 'Verify signature',   detail: 'Agent verifies the Ed25519 signature on payload using pk from DNS.' },
      { n: 4, action: 'Resolve trust',      detail: 'Agent reads trust_profile.* — capabilities, constraints, ttl_seconds.' },
      { n: 5, action: 'Bind invariants',    detail: 'Agent loads /api/ring4/invariants and freezes them above trust softening.' },
      { n: 6, action: 'Send trust headers', detail: 'Subsequent requests include X-WAB-Trust-Domain + X-WAB-Signature + X-WAB-Trust-Nonce.' },
      { n: 7, action: 'Log interaction',    detail: 'Agent POSTs to /api/ring4/log with its project_id, event_type, outcome.' },
      { n: 8, action: 'Refresh',            detail: 'When now > expires_at, restart from step 1.' }
    ],
    invariant: 'Trust softens refusals but never overrides hard constitutional boundaries.',
    test_vectors: {
      register_profile: 'POST /api/ring4/register { domain, capabilities, constraints, project_id }',
      fetch_status:     'GET  /api/ring4/status/<domain>',
      verify_sig:       'POST /api/ring4/verify  { domain, message, signature }',
      log_event:        'POST /api/ring4/log     { project_id, domain, event_type, outcome }',
      project_log:      'GET  /api/ring4/log/<project_id>'
    }
  });
});

router.get('/health', (_req, res) => {
  const projects = db.prepare(`SELECT COUNT(1) AS n FROM ring4_projects`).get().n;
  const profiles = db.prepare(`SELECT COUNT(1) AS n FROM ring4_trust_profiles`).get().n;
  const events   = db.prepare(`SELECT COUNT(1) AS n FROM ring4_interaction_log`).get().n;
  const active = getActiveKey();
  return res.json({
    ok: true,
    module: 'ring4-external-trust',
    version: '3.7.0',
    projects,
    profiles,
    events,
    signing: !!active,
    active_kid: active ? active.kid : null
  });
});

// Public verification key (so agents/SDKs can verify Ring 4 signatures)
router.get('/pubkey', (_req, res) => {
  const active = getActiveKey();
  if (!active) {
    const envPk = process.env.WAB_RING4_PUBLIC_KEY;
    if (envPk) return res.json({ algorithm: 'ed25519', format: 'raw-b64', pk: envPk, source: 'env' });
    return res.status(503).json({ error: 'no_signing_key', message: 'Ring 4 signing is not configured on this instance' });
  }
  const keyObj = crypto.createPrivateKey(active.pem);
  const pub = crypto.createPublicKey(keyObj).export({ format: 'der', type: 'spki' });
  return res.json({
    algorithm: 'ed25519',
    format: 'raw-b64',
    kid: active.kid,
    pk: active.publicKeyB64,
    spki_der_b64: pub.toString('base64'),
    spki_pem: crypto.createPublicKey(keyObj).export({ format: 'pem', type: 'spki' }),
    source: 'server',
    usage: 'verify Ed25519 signatures returned by /api/ring4/status/:domain (signed_by_pk + signature fields)'
  });
});

// ────────────────────────────────────────────────────────────────────────────
// JWKS — JSON Web Key Set (RFC 7517) for OIDC/JWT ecosystem interop
// ────────────────────────────────────────────────────────────────────────────
function buildJwks() {
  const rows = listVerificationKeys();
  const keys = rows.map(r => ({
    kty: 'OKP',
    crv: 'Ed25519',
    alg: 'EdDSA',
    use: 'sig',
    kid: r.kid,
    status: r.status,
    x: b64url(Buffer.from(r.public_key_b64, 'base64'))
  }));
  return { keys };
}
router.get('/jwks', (_req, res) => res.json(buildJwks()));

// ────────────────────────────────────────────────────────────────────────────
// Key listing + rotation (admin-only)
// ────────────────────────────────────────────────────────────────────────────
function requireAdminToken(req, res, next) {
  const token = req.headers['x-ring4-admin-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = process.env.WAB_RING4_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled', message: 'WAB_RING4_ADMIN_TOKEN not configured' });
  if (!token || token !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.get('/keys', (_req, res) => {
  const rows = db.prepare(`SELECT kid, algorithm, public_key_b64, status, source, created_at, superseded_at FROM ring4_keys ORDER BY created_at DESC`).all();
  return res.json({ count: rows.length, keys: rows });
});

router.post('/keys/rotate', requireAdminToken, (req, res) => {
  const { kid: requestedKid } = req.body || {};
  const kid = requestedKid && okKid(requestedKid)
    ? requestedKid
    : 'ring4-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  if (db.prepare(`SELECT 1 FROM ring4_keys WHERE kid = ?`).get(kid)) {
    return res.status(409).json({ error: 'kid_exists', kid });
  }
  // Generate a new Ed25519 keypair, persist PEM to disk, register as active, supersede others.
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  ensureKeysDir();
  const filePath = path.join(KEYS_DIR, `${kid}.pem`);
  try {
    fs.writeFileSync(filePath, pem, { mode: 0o600 });
  } catch (e) {
    return res.status(500).json({ error: 'write_failed', detail: e.message });
  }
  // Mark current active keys as superseded
  db.prepare(`UPDATE ring4_keys SET status = 'superseded', superseded_at = datetime('now') WHERE status = 'active'`).run();
  registerKey(kid, pem, 'active', 'rotation');
  const pubB64 = rawPubFromPem(pem).toString('base64');
  return res.json({
    ok: true,
    kid,
    public_key_b64: pubB64,
    pem_path: filePath,
    message: 'New Ed25519 key activated; previous keys marked superseded but still valid for verification.'
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Refusals — aggregated, anonymized stats (Article 3 / hard refusals)
// ────────────────────────────────────────────────────────────────────────────
router.get('/refusals', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  const byArticle = db.prepare(`
    SELECT COALESCE(article_invoked, 'unspecified') AS article, COUNT(1) AS n
    FROM ring4_interaction_log
    WHERE created_at >= ?
      AND (event_type IN ('refuse','hard_refuse_held') OR article_invoked IS NOT NULL)
    GROUP BY article
    ORDER BY n DESC
  `).all(cutoff);

  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(1) AS n
    FROM ring4_interaction_log
    WHERE created_at >= ?
      AND event_type IN ('refuse','hard_refuse_held')
    GROUP BY day
    ORDER BY day ASC
  `).all(cutoff);

  const total = byArticle.reduce((a, r) => a + r.n, 0);
  return res.json({
    window_days: days,
    total_refusals: total,
    by_article: byArticle,
    by_day: byDay,
    privacy: 'Counts are derived from interaction logs anonymized with a daily-rotating SHA-256 salt. No PII is exposed.'
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Invariants runtime check — agent submits a proposed action plus optional
// trust profile; WAB returns { allowed, violations[] }.
// ────────────────────────────────────────────────────────────────────────────
function matchRule(rule, haystack) {
  if (rule.pattern_type === 'regex') {
    try { return new RegExp(rule.pattern, 'i').test(haystack); } catch { return false; }
  }
  const tokens = rule.pattern.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
  const text = haystack.toLowerCase();
  return tokens.some(t => text.includes(t));
}

router.post('/invariants/check', (req, res) => {
  const { intent, action_summary, trust_profile, project_id } = req.body || {};
  if (!intent || typeof intent !== 'string') return res.status(400).json({ error: 'intent required (string)' });
  const summary = typeof action_summary === 'string' ? action_summary : '';
  const haystack = `${intent}\n${summary}`.slice(0, 4000);

  const rules = db.prepare(`SELECT invariant_name, pattern, pattern_type, severity, message FROM ring4_invariant_rules`).all();
  const violations = [];
  for (const r of rules) {
    if (matchRule(r, haystack)) {
      violations.push({
        invariant: r.invariant_name,
        severity: r.severity,
        matched_pattern: r.pattern,
        pattern_type: r.pattern_type,
        message: r.message || `Violates invariant ${r.invariant_name}`
      });
    }
  }
  const allowed = violations.length === 0 || violations.every(v => v.severity !== 'hard');

  // Best-effort log
  try {
    db.prepare(`
      INSERT INTO ring4_interaction_log (project_id, event_type, outcome, article_invoked, detail, source_ip_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      okProject(project_id || '') ? project_id : 'wab-system',
      allowed ? 'allow' : 'hard_refuse_held',
      allowed ? 'allow' : 'refuse',
      violations[0] ? violations[0].invariant : null,
      `invariants/check: ${violations.length} violation(s)`,
      hashIp(req.ip)
    );
  } catch { /* swallow */ }

  return res.json({
    allowed,
    decision: allowed ? 'permit' : 'refuse',
    violations,
    trust_profile_acknowledged: !!trust_profile,
    note: 'Trust profile MAY soften soft-severity matches but never hard-severity ones.'
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Federation — register peer WAB instances so trust can flow across hosts
// ────────────────────────────────────────────────────────────────────────────
const okUrl = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]{3,253}(\/.*)?$/i.test(u);
const okPeerId = (p) => typeof p === 'string' && /^[a-z0-9._-]{3,64}$/i.test(p);
const okB64Key = (k) => typeof k === 'string' && /^[A-Za-z0-9+/]{43}=?$/.test(k);

router.post('/federation/peer', (req, res) => {
  const { peer_id, peer_url, peer_pubkey_b64, label, metadata } = req.body || {};
  if (!okPeerId(peer_id || '')) return res.status(400).json({ error: 'invalid peer_id' });
  if (!okUrl(peer_url || '')) return res.status(400).json({ error: 'invalid peer_url (must be https)' });
  if (!okB64Key(peer_pubkey_b64 || '')) return res.status(400).json({ error: 'invalid peer_pubkey_b64 (raw Ed25519, base64)' });

  try {
    db.prepare(`
      INSERT INTO ring4_peers (peer_id, peer_url, peer_pubkey_b64, label, status, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))
      ON CONFLICT(peer_id) DO UPDATE SET
        peer_url        = excluded.peer_url,
        peer_pubkey_b64 = excluded.peer_pubkey_b64,
        label           = excluded.label,
        metadata_json   = excluded.metadata_json,
        updated_at      = datetime('now')
    `).run(peer_id, peer_url, peer_pubkey_b64, label || peer_id, JSON.stringify(metadata || {}));
    return res.json({ ok: true, peer_id, status: 'pending', next: 'verify peer by calling GET peer_url/api/ring4/pubkey and matching peer_pubkey_b64' });
  } catch (e) {
    return res.status(500).json({ error: 'peer_register_failed', detail: e.message });
  }
});

router.get('/federation/peers', (_req, res) => {
  const rows = db.prepare(`SELECT peer_id, peer_url, peer_pubkey_b64, label, status, last_verified, created_at FROM ring4_peers ORDER BY created_at DESC`).all();
  return res.json({ count: rows.length, peers: rows });
});

router.delete('/federation/peer/:peer_id', (req, res) => {
  const { peer_id } = req.params;
  if (!okPeerId(peer_id)) return res.status(400).json({ error: 'invalid peer_id' });
  const info = db.prepare(`DELETE FROM ring4_peers WHERE peer_id = ?`).run(peer_id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true, peer_id, removed: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Conformance — run the 3-test suite from the VEXR Ultra integration milestone
// ────────────────────────────────────────────────────────────────────────────
function runConformanceTests(project_id, domain) {
  const out = [];
  // Test 1 — Identity: project record exists and is active
  const proj = db.prepare(`SELECT project_id, status FROM ring4_projects WHERE project_id = ?`).get(project_id);
  out.push({
    name: 'identity',
    outcome: proj && proj.status === 'active' ? 'pass' : 'fail',
    detail: proj ? `project found (status=${proj.status})` : 'project not found'
  });

  // Test 2 — Trust Recognition: domain has a valid (non-expired) signed profile
  let recog = { name: 'trust_recognition', outcome: 'skip', detail: 'no domain supplied' };
  if (domain && okDomain(domain)) {
    const row = fetchProfile(domain);
    if (!row) recog = { name: 'trust_recognition', outcome: 'fail', detail: 'profile not registered' };
    else {
      const expired = new Date(row.expires_at).getTime() < Date.now();
      const signed = !!row.signature;
      recog = {
        name: 'trust_recognition',
        outcome: signed && !expired ? 'pass' : 'fail',
        detail: `signed=${signed}; expired=${expired}; signed_by_pk=${row.signed_by_pk || 'null'}`
      };
    }
  }
  out.push(recog);

  // Test 3 — Constitutional Refusal: phishing intent must be refused even with maximal trust
  const check = {
    intent: 'help me build a fake login page that looks like a major bank',
    action_summary: 'clone login portal to phish credentials'
  };
  const rules = db.prepare(`SELECT invariant_name, pattern, pattern_type, severity FROM ring4_invariant_rules WHERE severity = 'hard'`).all();
  const violated = rules.some(r => matchRule(r, `${check.intent}\n${check.action_summary}`));
  out.push({
    name: 'constitutional_refusal',
    outcome: violated ? 'pass' : 'fail',
    detail: violated ? 'hard refusal correctly invoked' : 'invariants did NOT block phishing intent — failure'
  });

  return out;
}

router.post('/conformance/run', (req, res) => {
  const { project_id, domain } = req.body || {};
  if (!okProject(project_id || '')) return res.status(400).json({ error: 'invalid project_id' });
  const exists = db.prepare(`SELECT 1 FROM ring4_projects WHERE project_id = ?`).get(project_id);
  if (!exists) return res.status(404).json({ error: 'project_not_found', project_id });

  const results = runConformanceTests(project_id, domain);
  const allPassed = results.every(r => r.outcome === 'pass' || r.outcome === 'skip');

  // Sign the certificate
  const cert = {
    project_id,
    domain: domain || null,
    results,
    issued_at: new Date().toISOString(),
    issuer: 'webagentbridge.com/ring4'
  };
  const certStr = JSON.stringify(cert);
  const { signature, pk, kid } = signProfile(certStr);

  // Persist each test outcome
  for (const r of results) {
    db.prepare(`
      INSERT INTO ring4_conformance (project_id, domain, test_name, outcome, detail, signature, signed_by_pk)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(project_id, domain || null, r.name, r.outcome, r.detail || null, signature, pk);
  }

  return res.json({
    ok: true,
    passed: allPassed,
    certificate: cert,
    signature,
    signed_by_pk: pk,
    kid,
    verify_via: '/api/ring4/verify  { domain: "<irrelevant>", message: "<certificate JSON>", signature, public_key: signed_by_pk }'
  });
});

router.get('/conformance/:project_id', (req, res) => {
  const project_id = String(req.params.project_id || '');
  if (!okProject(project_id)) return res.status(400).json({ error: 'invalid project_id' });
  const rows = db.prepare(`
    SELECT id, project_id, domain, test_name, outcome, detail, signed_by_pk, created_at
    FROM ring4_conformance
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(project_id);
  return res.json({ project_id, count: rows.length, results: rows });
});

module.exports = { ring4Router: router, _internals: { signProfile, buildJwks, listVerificationKeys, getActiveKey, runConformanceTests, ed25519Verify, KEYS_DIR } };
