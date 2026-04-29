'use strict';

/**
 * WAB Safety Shield — Human-Gate Transports (SPEC §8.11)
 *
 * Real-world delivery channels for the 6-digit confirmation code.
 *
 * Each transport is a pure async function:
 *   (challenge) => Promise<{ ok: boolean, channel: string, error?: string }>
 *
 * Where `challenge` is:
 *   {
 *     challenge_id, code, site_id, action_name, actor_id,
 *     expires_at, siteConfig
 *   }
 *
 * The `siteConfig.humanGate` object configures the transport. Available
 * built-in transports:
 *
 *   • null     — no-op (default; tests + offline)
 *   • webhook  — POST signed JSON to siteConfig.humanGate.webhook.url
 *   • email    — minimal SMTP via nodemailer (lazy-required)
 *   • console  — stderr log (development convenience)
 *
 * Custom transports can still be registered with humanGate.setTransport.
 * Transports must NEVER log the plaintext code anywhere persistent.
 */

const crypto = require('crypto');

// ────────────────────────────────────────────────────────────────────
// webhook transport
// ────────────────────────────────────────────────────────────────────

/**
 * Sign the JSON body with HMAC-SHA256(secret, body) and POST it.
 * Receivers verify with the X-WAB-Signature header.
 *
 * Required: siteConfig.humanGate.webhook.url
 * Optional: siteConfig.humanGate.webhook.secret  (HMAC key; recommended)
 *           siteConfig.humanGate.webhook.headers (extra static headers)
 *           siteConfig.humanGate.webhook.timeoutMs (default 5000)
 */
async function webhookTransport(challenge) {
  const cfg = challenge.siteConfig?.humanGate?.webhook || {};
  if (!cfg.url || !/^https?:\/\//i.test(cfg.url)) {
    return { ok: false, channel: 'webhook', error: 'missing_or_invalid_webhook_url' };
  }
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, channel: 'webhook', error: 'no_fetch_available' };
  }

  const payload = {
    type: 'wab.human_gate.challenge',
    spec: '8.11',
    challenge_id: challenge.challenge_id,
    code: challenge.code,
    site_id: challenge.site_id,
    action_name: challenge.action_name,
    actor_id: challenge.actor_id || null,
    expires_at: challenge.expires_at,
    issued_at: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
  if (cfg.secret) {
    const sig = crypto.createHmac('sha256', cfg.secret).update(body).digest('hex');
    headers['X-WAB-Signature'] = `sha256=${sig}`;
  }

  const timeoutMs = Math.max(500, Math.min(30000, cfg.timeoutMs || 5000));
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers,
      body,
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) {
      return { ok: false, channel: 'webhook', error: `http_${res.status}` };
    }
    return { ok: true, channel: 'webhook' };
  } catch (err) {
    return { ok: false, channel: 'webhook', error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network_error') };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────────
// email transport (lazy nodemailer)
// ────────────────────────────────────────────────────────────────────

/**
 * Send the code via SMTP. Requires `nodemailer` to be installed.
 *
 * Required: siteConfig.humanGate.email.to
 * Optional: siteConfig.humanGate.email.from   (default: WAB_HUMAN_GATE_FROM env or 'noreply@wab.local')
 *           siteConfig.humanGate.email.smtp   ({ host, port, secure, auth: { user, pass } })
 *
 * If smtp is omitted, falls back to env-based config:
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
 */
async function emailTransport(challenge) {
  const cfg = challenge.siteConfig?.humanGate?.email || {};
  if (!cfg.to) return { ok: false, channel: 'email', error: 'missing_email_to' };

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return { ok: false, channel: 'email', error: 'nodemailer_not_installed' };
  }

  const smtp = cfg.smtp || {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    } : undefined,
  };
  if (!smtp.host) return { ok: false, channel: 'email', error: 'no_smtp_host' };

  try {
    const transporter = nodemailer.createTransport(smtp);
    const from = cfg.from || process.env.WAB_HUMAN_GATE_FROM || 'noreply@wab.local';
    const subject = `[WAB] Approval needed: ${challenge.action_name}`;
    const text =
      `An AI agent is requesting a high-risk action on your site.\n\n` +
      `  Site:    ${challenge.site_id}\n` +
      `  Action:  ${challenge.action_name}\n` +
      `  Actor:   ${challenge.actor_id || '(unknown)'}\n` +
      `  Expires: ${challenge.expires_at}\n\n` +
      `Approval code: ${challenge.code}\n\n` +
      `If you did NOT initiate this, do nothing — the request will expire.\n` +
      `Do not share this code. SPEC: https://webagentbridge.com/docs/SPEC.md#811-out-of-band-human-gate\n`;
    await transporter.sendMail({ from, to: cfg.to, subject, text });
    return { ok: true, channel: 'email' };
  } catch (err) {
    return { ok: false, channel: 'email', error: err.message || 'smtp_error' };
  }
}

// ────────────────────────────────────────────────────────────────────
// console transport (dev convenience)
// ────────────────────────────────────────────────────────────────────

async function consoleTransport(challenge) {
  // Intentionally writes to stderr only; never to a log file or audit row.
  process.stderr.write(
    `[wab:human-gate] challenge=${challenge.challenge_id} ` +
    `site=${challenge.site_id} action=${challenge.action_name} ` +
    `code=${challenge.code} expires=${challenge.expires_at}\n`
  );
  return { ok: true, channel: 'console' };
}

// ────────────────────────────────────────────────────────────────────
// public surface — register all on a humanGate instance
// ────────────────────────────────────────────────────────────────────

function registerAll(humanGate) {
  humanGate.setTransport('webhook', webhookTransport);
  humanGate.setTransport('email', emailTransport);
  humanGate.setTransport('console', consoleTransport);
}

module.exports = {
  webhookTransport,
  emailTransport,
  consoleTransport,
  registerAll,
};
