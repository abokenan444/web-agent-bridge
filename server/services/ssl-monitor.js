/**
 * server/services/ssl-monitor.js
 * Extended Trust Layer — Certificate Companion & SSL Health Monitoring.
 *
 * Periodically inspects SSL certificates for every active site, persists state
 * in `ssl_monitor`, appends new certs to `cert_history` (CT log), and emails
 * the site owner when the certificate is within 7 days of expiry. The cron
 * runs once per day inside the main process; can be disabled via env
 * `WAB_SSL_MONITOR=off`.
 */
'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const ssl = require('./ssl-inspector');

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? `wab-test-${process.env.JEST_WORKER_ID || '1'}.db` : 'wab.db';

let _db = null;
function db() {
  if (!_db) { _db = new Database(path.join(DATA_DIR, DB_FILE)); }
  return _db;
}

const ALERT_DAYS = Number(process.env.WAB_SSL_ALERT_DAYS || 7);
const ALERT_REPEAT_HOURS = Number(process.env.WAB_SSL_ALERT_REPEAT_HOURS || 24);

function classify(daysLeft) {
  if (daysLeft == null) return 'error';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= ALERT_DAYS) return 'expiring';
  return 'active';
}

/**
 * Inspect one host, persist state + CT log entry + alert if needed.
 * Returns { host, status, days_until_expiry, alerted }.
 */
async function checkHost(host, opts = {}) {
  const info = await ssl.inspect(host, 443);
  const now = new Date().toISOString();

  if (!info.ok) {
    db().prepare(`
      INSERT INTO ssl_monitor (host, status, error, last_checked_at, enabled, owner_user_id)
      VALUES (?, 'error', ?, ?, 1, ?)
      ON CONFLICT(host) DO UPDATE SET
        status='error', error=excluded.error, last_checked_at=excluded.last_checked_at
    `).run(host, info.error || 'unknown', now, opts.userId || null);
    return { host, status: 'error', error: info.error };
  }

  const status = classify(info.days_until_expiry);

  db().prepare(`
    INSERT INTO ssl_monitor (host, fingerprint_sha256, issuer, valid_to, days_until_expiry,
                             status, error, last_checked_at, enabled, owner_user_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)
    ON CONFLICT(host) DO UPDATE SET
      fingerprint_sha256=excluded.fingerprint_sha256,
      issuer=excluded.issuer,
      valid_to=excluded.valid_to,
      days_until_expiry=excluded.days_until_expiry,
      status=excluded.status,
      error=NULL,
      last_checked_at=excluded.last_checked_at
  `).run(host, info.fingerprint_sha256, info.issuer, info.valid_to,
         info.days_until_expiry, status, now, opts.userId || null);

  // Append to CT log if fingerprint not seen for this host yet.
  try {
    db().prepare(`
      INSERT OR IGNORE INTO cert_history
        (host, fingerprint_sha256, issuer, subject, serial, valid_from, valid_to, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(host, info.fingerprint_sha256, info.issuer, info.subject, info.serial,
           info.valid_from, info.valid_to, opts.source || 'monitor');
  } catch (_) { /* table may not exist yet */ }

  let alerted = false;
  if (status === 'expiring' || status === 'expired') {
    alerted = await maybeSendAlert(host, info, status, opts);
  }

  return { host, status, days_until_expiry: info.days_until_expiry, alerted };
}

async function maybeSendAlert(host, info, status, opts) {
  const row = db().prepare(`SELECT last_alert_at, owner_user_id FROM ssl_monitor WHERE host = ?`).get(host);
  if (row && row.last_alert_at) {
    const last = new Date(row.last_alert_at).getTime();
    if (Date.now() - last < ALERT_REPEAT_HOURS * 3600 * 1000) return false;
  }

  let to = opts.alertEmail || process.env.WAB_SSL_ALERT_EMAIL;
  try {
    if (!to && row && row.owner_user_id) {
      const u = db().prepare('SELECT email FROM users WHERE id = ?').get(row.owner_user_id);
      if (u && u.email) to = u.email;
    }
  } catch (_) { /* users table may not exist in tests */ }

  if (!to) return false;

  try {
    const { sendEmail } = require('./email');
    await sendEmail({
      to, template: 'sslExpiringAlert',
      data: {
        host,
        daysLeft: Math.max(0, info.days_until_expiry),
        validTo: info.valid_to,
        issuer: info.issuer,
        fingerprint: info.fingerprint_sha256,
      },
    });
    db().prepare(`UPDATE ssl_monitor SET last_alert_at = ? WHERE host = ?`)
      .run(new Date().toISOString(), host);
    return true;
  } catch (_) { return false; }
}

/** Run a sweep across every active site domain (and optional extra hosts). */
async function runSweep({ extraHosts = [] } = {}) {
  let hosts = [...extraHosts];
  try {
    const rows = db().prepare(
      "SELECT DISTINCT LOWER(REPLACE(domain, 'http://', '')) AS host, user_id FROM sites WHERE active = 1"
    ).all();
    for (const r of rows) {
      const h = (r.host || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, 'www.');
      if (!h) continue;
      hosts.push({ host: h, userId: r.user_id });
    }
  } catch (_) { /* sites table may not exist */ }

  const results = [];
  for (const item of hosts) {
    const host = typeof item === 'string' ? item : item.host;
    const userId = typeof item === 'string' ? null : item.userId;
    try {
      results.push(await checkHost(host, { userId }));
    } catch (e) {
      results.push({ host, status: 'error', error: e.message });
    }
  }
  return results;
}

let _interval = null;
function start() {
  if (_interval || process.env.WAB_SSL_MONITOR === 'off') return;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  // Run immediately, then once per day.
  setTimeout(() => runSweep().catch(() => {}), 30_000);
  _interval = setInterval(() => runSweep().catch(() => {}), 24 * 3600 * 1000);
  if (_interval.unref) _interval.unref();
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { checkHost, runSweep, classify, start, stop };
