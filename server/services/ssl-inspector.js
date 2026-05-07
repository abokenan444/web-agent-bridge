/**
 * server/services/ssl-inspector.js
 * Live TLS certificate inspector — used by sign-wab-domain.js, cron monitor,
 * and shieldqr verifier. Returns { ok, fingerprint_sha256, valid_to,
 * days_until_expiry, issuer, subject, fingerprint_b64 }.
 */
'use strict';

const tls = require('node:tls');

function inspect(host, port = 443, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs,
    }, () => {
      try {
        const cert = socket.getPeerCertificate(false);
        if (!cert || !cert.valid_to) { socket.end(); return resolve({ ok: false, error: 'no_cert' }); }
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / (24 * 3600 * 1000));
        const fpHex = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
        const fpB64 = fpHex ? Buffer.from(fpHex, 'hex').toString('base64') : null;
        socket.end();
        resolve({
          ok: true,
          fingerprint_sha256: fpHex,
          fingerprint_b64: fpB64,
          valid_to: validTo.toISOString(),
          valid_from: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
          days_until_expiry: daysLeft,
          issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN) || null,
          subject: cert.subject && cert.subject.CN || null,
          serial: cert.serialNumber || null,
        });
      } catch (e) { try { socket.end(); } catch (_) {} resolve({ ok: false, error: e.message }); }
    });
    socket.on('error', (err) => resolve({ ok: false, error: err.message }));
    socket.on('timeout', () => { try { socket.destroy(); } catch (_) {} resolve({ ok: false, error: 'timeout' }); });
  });
}

module.exports = { inspect };
