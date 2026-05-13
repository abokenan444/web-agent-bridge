// ═══════════════════════════════════════════════════════════════════════════
// WAB Trust Headers Middleware (Ring 4)
//
// Recognizes:
//   X-WAB-Trust-Domain  — the sovereign agent's declared trusted origin
//   X-WAB-Signature     — Ed25519 signature (base64, "ed25519:..." or raw)
//   X-WAB-Trust-Nonce   — replay-defence nonce
//
// Behavior:
//   - Looks up the domain's registered Ring 4 trust profile.
//   - If signature present, verifies it against the profile's signed_by_pk
//     using the canonical message:  `${method} ${path}\n${nonce}`
//   - Attaches `req.wabTrust = { domain, verified, profile, headers }`
//   - NEVER blocks the request. Downstream handlers decide what to do.
//   - Logs every recognition / verification event to ring4_interaction_log.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { db } = require('../models/db');

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

const DOMAIN_RE  = /^[a-z0-9.-]{3,253}$/i;
const NONCE_RE   = /^[A-Za-z0-9_\-]{8,128}$/;
const PROJECT_RE = /^[a-z0-9-]{2,64}$/i;
const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

function stripPrefix(s) {
  return typeof s === 'string' && s.startsWith('ed25519:') ? s.slice(8) : s;
}

function wabTrustMiddleware(req, _res, next) {
  // Trace context passthrough (always, even without trust headers).
  const traceparent = String(req.headers['traceparent'] || '').trim();
  const tracestate  = String(req.headers['tracestate'] || '').trim();
  const trace = TRACEPARENT_RE.test(traceparent)
    ? { traceparent, tracestate: tracestate || null }
    : null;

  const domain = String(req.headers['x-wab-trust-domain'] || '').toLowerCase().trim();
  if (!domain || !DOMAIN_RE.test(domain)) {
    if (trace) req.wabTrust = { recognized: false, verified: false, trace };
    return next();
  }

  const sigHdr     = String(req.headers['x-wab-signature'] || '').trim();
  const nonce      = String(req.headers['x-wab-trust-nonce'] || '').trim();
  const projectHdr = String(req.headers['x-wab-trust-project'] || '').trim();

  let profile = null;
  try {
    profile = db.prepare(`
      SELECT domain, label, capabilities, constraints, signed_by_pk, expires_at, trust_score
      FROM ring4_trust_profiles
      WHERE domain = ?
    `).get(domain);
  } catch { /* table not yet migrated */ }

  // Resolve verification key — prefer project pubkey when supplied, else profile.signed_by_pk.
  let verifyPk = null;
  let pkSource = null;
  if (projectHdr && PROJECT_RE.test(projectHdr)) {
    try {
      const proj = db.prepare(`SELECT public_key FROM ring4_projects WHERE project_id = ?`).get(projectHdr);
      if (proj && proj.public_key) { verifyPk = proj.public_key; pkSource = 'project'; }
    } catch { /* swallow */ }
  }
  if (!verifyPk && profile && profile.signed_by_pk) {
    verifyPk = profile.signed_by_pk;
    pkSource = 'profile';
  }

  const expired = profile ? new Date(profile.expires_at).getTime() < Date.now() : false;
  let verified = false;
  let verifyDetail = null;

  if (sigHdr && verifyPk && nonce && NONCE_RE.test(nonce)) {
    const sigRaw = stripPrefix(sigHdr);
    const pkRaw  = stripPrefix(verifyPk);
    const message = `${req.method} ${req.originalUrl || req.url}\n${nonce}`;
    verified = ed25519Verify(pkRaw, message, sigRaw);
    verifyDetail = verified ? `sig_ok(${pkSource})` : `sig_invalid(${pkSource})`;
  } else if (profile) {
    verifyDetail = 'recognized_without_signature';
  }

  req.wabTrust = {
    domain,
    recognized: !!profile,
    verified,
    expired,
    profile: profile ? {
      label: profile.label,
      trust_score: profile.trust_score,
      capabilities: safeJson(profile.capabilities),
      constraints: safeJson(profile.constraints),
      expires_at: profile.expires_at
    } : null,
    project_id: (projectHdr && PROJECT_RE.test(projectHdr)) ? projectHdr : null,
    pk_source: pkSource,
    nonce: nonce || null,
    detail: verifyDetail,
    trace
  };

  // Best-effort audit log (never blocks the request)
  if (profile) {
    try {
      db.prepare(`
        INSERT INTO ring4_interaction_log (project_id, domain, event_type, signature_valid, outcome, detail, agent_nonce)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.wabTrust.project_id || 'wab-system',
        domain,
        sigHdr ? 'verify' : 'recognize',
        sigHdr ? (verified ? 1 : 0) : null,
        expired ? 'expired' : (sigHdr ? (verified ? 'allow' : 'refuse') : 'recognize'),
        (trace ? `tp=${traceparent.slice(0, 36)}; ` : '') + (verifyDetail || ''),
        nonce || null
      );
    } catch { /* swallow */ }
  }

  next();
}

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

module.exports = { wabTrustMiddleware };
