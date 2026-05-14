/**
 * server/services/ssl-ct-monitor.js
 *
 * Certificate Transparency monitor for the WAB Extended Trust Layer.
 *
 * Polls public CT logs (crt.sh) every WAB_CT_INTERVAL_HOURS (default 6h)
 * for every host in `ssl_monitor` with `ct_monitor_enabled = 1`. When a
 * new certificate fingerprint is observed, the row is appended to
 * `cert_history` (source='ct_log'), `ct_pending_resign` is flagged, and
 * the site owner is emailed. If `WAB_AUTO_RESIGN=true`, the wab.json is
 * re-signed automatically by spawning `scripts/sign-wab-domain.js`.
 *
 * Disabled unless WAB_CT_MONITOR=true (off by default for safety).
 */
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';

let _db = null;
function db() {
  if (!_db) _db = new Database(path.join(DATA_DIR, DB_FILE));
  return _db;
}

const CT_API = process.env.WAB_CT_API_BASE || 'https://crt.sh';
const REQUEST_TIMEOUT_MS = Number(process.env.WAB_CT_TIMEOUT_MS || 15000);
const PER_HOST_DELAY_MS = Number(process.env.WAB_CT_DELAY_MS || 1500);

// ---------- crt.sh fetch ---------------------------------------------------

async function fetchLatestCert(host) {
  const url = `${CT_API}/?q=${encodeURIComponent(host)}&output=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'WAB-CT-Monitor/1.0 (+https://www.webagentbridge.com)' },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  // crt.sh returns one row per identity in a cert; dedupe by serial+issuer and pick newest by not_before.
  const sorted = data
    .filter((c) => c && c.not_before)
    .sort((a, b) => new Date(b.not_before) - new Date(a.not_before));
  return sorted[0] || null;
}

// crt.sh does NOT return a SHA-256 fingerprint directly; we use a stable
// composite identifier (serial + issuer + not_before) as the "thumbprint"
// for change detection. ssl-inspector remains the source of truth for the
// real fingerprint when re-signing locally.
function ctThumbprint(cert) {
  if (!cert) return null;
  return [cert.serial_number || '', cert.issuer_name || '', cert.not_before || '']
    .join('|')
    .toLowerCase();
}

// ---------- per-host check -------------------------------------------------

async function checkDomain(host) {
  const row = db().prepare(
    `SELECT host, ct_last_thumbprint, owner_user_id, fingerprint_sha256
       FROM ssl_monitor WHERE host = ? AND ct_monitor_enabled = 1`
  ).get(host);
  if (!row) return { host, skipped: true };

  const cert = await fetchLatestCert(host);
  const now = new Date().toISOString();

  if (!cert) {
    db().prepare(`UPDATE ssl_monitor SET ct_last_checked = ? WHERE host = ?`).run(now, host);
    return { host, found: false };
  }

  const tp = ctThumbprint(cert);
  if (row.ct_last_thumbprint && row.ct_last_thumbprint === tp) {
    db().prepare(`UPDATE ssl_monitor SET ct_last_checked = ? WHERE host = ?`).run(now, host);
    return { host, changed: false };
  }

  // New certificate observed in CT logs.
  try {
    db().prepare(`
      INSERT OR IGNORE INTO cert_history
        (host, fingerprint_sha256, issuer, subject, serial, valid_from, valid_to, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ct_log')
    `).run(
      host,
      tp,
      cert.issuer_name || null,
      cert.common_name || cert.name_value || null,
      cert.serial_number || null,
      cert.not_before || null,
      cert.not_after || null,
    );
  } catch (_) { /* table may not exist in tests */ }

  db().prepare(`
    UPDATE ssl_monitor
       SET ct_pending_resign = 1,
           ct_last_checked   = ?,
           ct_last_thumbprint = ?
     WHERE host = ?
  `).run(now, tp, host);

  // Notify owner (best-effort).
  await notifyOwner(host, row.owner_user_id, cert).catch(() => {});

  // Optional auto re-sign.
  if (String(process.env.WAB_AUTO_RESIGN).toLowerCase() === 'true') {
    const ok = await runResign(host).catch(() => false);
    if (ok) {
      db().prepare(`UPDATE ssl_monitor SET ct_pending_resign = 0 WHERE host = ?`).run(host);
    }
  }

  return { host, changed: true, thumbprint: tp };
}

// ---------- helpers --------------------------------------------------------

async function notifyOwner(host, userId, cert) {
  let to = process.env.WAB_SSL_ALERT_EMAIL;
  try {
    if (!to && userId) {
      const u = db().prepare('SELECT email FROM users WHERE id = ?').get(userId);
      if (u && u.email) to = u.email;
    }
  } catch (_) { /* no users table */ }
  if (!to) return false;

  try {
    const { sendEmail } = require('./email');
    await sendEmail({
      to,
      template: 'sslExpiringAlert', // re-use existing template; subject reflects re-sign
      data: {
        host,
        daysLeft: cert.not_after
          ? Math.max(0, Math.ceil((new Date(cert.not_after) - Date.now()) / 86400000))
          : null,
        validTo: cert.not_after,
        issuer: cert.issuer_name,
        fingerprint: cert.serial_number,
        ctEvent: true,
      },
    });
    return true;
  } catch (_) {
    return false;
  }
}

function runResign(host) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'sign-wab-domain.js');
    const child = spawn(process.execPath, [script, host], { stdio: 'pipe' });
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(!killed && code === 0);
    });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// ---------- sweep ----------------------------------------------------------

async function runCTMonitor() {
  let hosts = [];
  try {
    hosts = db().prepare(
      `SELECT host FROM ssl_monitor WHERE ct_monitor_enabled = 1 AND enabled = 1`
    ).all();
  } catch (_) {
    return { error: 'ssl_monitor table missing' };
  }
  const results = [];
  for (const { host } of hosts) {
    try {
      results.push(await checkDomain(host));
    } catch (err) {
      results.push({ host, error: err.message });
    }
    await new Promise((r) => setTimeout(r, PER_HOST_DELAY_MS));
  }
  return { count: results.length, results };
}

// ---------- cron -----------------------------------------------------------

let _interval = null;
function start() {
  if (_interval) return;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  if (String(process.env.WAB_CT_MONITOR).toLowerCase() !== 'true') return;
  const hours = Number(process.env.WAB_CT_INTERVAL_HOURS || 6);
  console.log(`[ct-monitor] enabled, sweeping every ${hours}h`);
  // Initial run after 60s so the server boot is unaffected.
  setTimeout(() => runCTMonitor().catch(() => {}), 60_000);
  _interval = setInterval(() => runCTMonitor().catch(() => {}), hours * 3600 * 1000);
  if (_interval.unref) _interval.unref();
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { runCTMonitor, checkDomain, fetchLatestCert, ctThumbprint, start, stop };
