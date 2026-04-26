'use strict';

/**
 * Sensitive Action Gate — Human-in-the-Loop confirmation for destructive
 * or financially-impactful agent actions.
 *
 * Threat: prompt-injection or compromised agent issues `purchase`, `transfer`,
 * `delete-account`, etc. without user intent.
 *
 * Defense:
 *   1. Maintain a static list of sensitive action verbs.
 *   2. If a request payload references one of those verbs, require either:
 *        - X-WAB-Confirm header containing an HMAC over the request body, OR
 *        - explicit `confirmed:true` flag set by an authenticated *user* token
 *          (not just an agent token).
 *   3. Otherwise return 412 with a confirmation challenge so the
 *      orchestrator can surface the prompt to a human.
 *
 * The HMAC is computed using process.env.HITL_SECRET (falls back to a
 * derived secret on first start) over `${actorId}:${actionKey}:${nonce}`.
 *
 * This is a defense-in-depth gate — site-level policies in
 * control-plane/policy-engine remain authoritative.
 */

const crypto = require('crypto');

const SENSITIVE_VERBS = new Set([
  'purchase',
  'checkout',
  'pay',
  'payment',
  'transfer',
  'wire',
  'send-money',
  'withdraw',
  'delete',
  'delete-account',
  'wipe',
  'unsubscribe-all',
  'cancel-subscription',
  'submit-payment',
  'authorize',
  'sign-contract',
  'change-password',
  'change-email',
  'export-data',
  'grant-admin',
  'revoke-access',
]);

let _runtimeSecret = process.env.HITL_SECRET;
function _secret() {
  if (_runtimeSecret) return _runtimeSecret;
  // Derive a stable per-process secret if none configured. Note: this means
  // confirmations don't survive restarts, which is acceptable (HITL tokens
  // are short-lived by design).
  _runtimeSecret = crypto.randomBytes(32).toString('hex');
  return _runtimeSecret;
}

function _flatten(obj, depth = 0, out = []) {
  if (depth > 4 || obj == null) return out;
  if (typeof obj === 'string') { out.push(obj.toLowerCase()); return out; }
  if (Array.isArray(obj)) { obj.forEach((v) => _flatten(v, depth + 1, out)); return out; }
  if (typeof obj === 'object') { Object.values(obj).forEach((v) => _flatten(v, depth + 1, out)); }
  return out;
}

function detectSensitiveAction(body) {
  const candidates = _flatten(body || {});
  for (const v of candidates) {
    if (typeof v !== 'string') continue;
    // Match verb tokens: "purchase", "checkout.confirm", etc.
    const tokens = v.split(/[\s.\-_/:]+/);
    for (const t of tokens) {
      if (SENSITIVE_VERBS.has(t)) return t;
    }
  }
  return null;
}

function makeChallenge(actorId, actionKey) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts = Date.now();
  const payload = `${actorId || 'anon'}:${actionKey}:${nonce}:${ts}`;
  const hmac = crypto.createHmac('sha256', _secret()).update(payload).digest('hex');
  return { nonce, ts, signature: hmac, expiresInMs: 5 * 60 * 1000 };
}

function verifyConfirmation(header, actorId, actionKey) {
  if (!header || typeof header !== 'string') return false;
  const parts = header.split('.');
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  const tsNum = parseInt(ts, 10);
  if (!nonce || !sig || !tsNum) return false;
  if (Date.now() - tsNum > 5 * 60 * 1000) return false; // 5 min window
  const payload = `${actorId || 'anon'}:${actionKey}:${nonce}:${tsNum}`;
  const expected = crypto.createHmac('sha256', _secret()).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Express middleware. Apply to runtime/execute/policy routes.
 * Bypassed when X-WAB-Confirm verifies, or when an authenticated USER token
 * (req.user) explicitly sets `confirmed:true` in the body.
 */
function sensitiveActionGate(req, res, next) {
  const action = detectSensitiveAction(req.body);
  if (!action) return next();

  const actorId = req.user?.id || req.agentId || req.session?.agentId || req.ip;
  const actionKey = `${req.method}:${req.baseUrl || ''}${req.path}:${action}`;

  // 1) User-supplied confirmation header (preferred)
  const header = req.headers['x-wab-confirm'];
  if (header && verifyConfirmation(header, actorId, action)) {
    req._hitlConfirmed = action;
    return next();
  }

  // 2) Logged-in user explicitly confirmed in body
  if (req.user && req.body && req.body.confirmed === true && req.body.confirmedAction === action) {
    req._hitlConfirmed = action;
    return next();
  }

  // Otherwise issue a challenge.
  const challenge = makeChallenge(actorId, action);
  return res.status(412).json({
    error: 'Human-in-the-loop confirmation required',
    code: 'HITL_REQUIRED',
    sensitiveAction: action,
    challenge: {
      nonce: challenge.nonce,
      ts: challenge.ts,
      signature: challenge.signature,
      headerName: 'X-WAB-Confirm',
      headerValue: `${challenge.nonce}.${challenge.ts}.${challenge.signature}`,
      expiresInMs: challenge.expiresInMs,
    },
    hint: 'Resubmit the same request with the X-WAB-Confirm header carrying the headerValue above, after a human has approved the action.',
  });
}

module.exports = {
  sensitiveActionGate,
  detectSensitiveAction,
  makeChallenge,
  verifyConfirmation,
  SENSITIVE_VERBS,
};
