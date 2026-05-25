/**
 * SMTP Email Notification Service
 * Templates: welcome, registration, password_reset, contact
 */

const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const { getSmtpSettings, logNotification } = require('../models/db');

// WAB email headers (RFC 5322 X-* extension headers) — let receiving agents
// verify that a transactional email came from a WAB-enabled domain. Spec at
// https://webagentbridge.com/wab-email. Signing is opt-in via env:
//   WAB_EMAIL_HOST           — the domain that owns the wab.json manifest
//   WAB_EMAIL_SIGNING_KEY    — base64 Ed25519 private key (32 bytes raw)
const WAB_EMAIL_HOST = process.env.WAB_EMAIL_HOST || 'webagentbridge.com';
const WAB_EMAIL_KEY  = process.env.WAB_EMAIL_SIGNING_KEY || '';
let _wabSigningKey = null;
function _getSigningKey() {
  if (_wabSigningKey !== null) return _wabSigningKey;
  if (!WAB_EMAIL_KEY) { _wabSigningKey = false; return false; }
  try {
    const raw = Buffer.from(WAB_EMAIL_KEY, 'base64');
    if (raw.length !== 32) throw new Error('expected 32-byte ed25519 seed');
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw]);
    _wabSigningKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch (e) {
    console.warn('[wab-email] signing disabled:', e.message);
    _wabSigningKey = false;
  }
  return _wabSigningKey;
}
function buildWabHeaders({ from, to, subject, template, messageId, receipt }) {
  const headers = {
    'X-WAB-Manifest': `https://${WAB_EMAIL_HOST}/.well-known/wab.json`,
    'X-WAB-Action':   `email.${template || 'transactional'}`
  };
  if (receipt) headers['X-WAB-Receipt'] = receipt;
  const key = _getSigningKey();
  if (key) {
    const digest = crypto.createHash('sha256')
      .update(`${from}\n${to}\n${subject}\n${messageId}`)
      .digest();
    const sig = crypto.sign(null, digest, key).toString('base64');
    headers['X-WAB-Signature'] = `ed25519=${sig}`;
  }
  return headers;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text email subject lines (no HTML entities) */
function sanitizeSubjectPart(s) {
  if (s == null) return '';
  return String(s).replace(/[\r\n]/g, ' ').slice(0, 300);
}

let transporter = null;

function getTransporter() {
  const settings = getSmtpSettings();
  if (!settings || !settings.enabled || !settings.host) return null;

  transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port || 587,
    secure: !!settings.secure,
    auth: {
      user: settings.username,
      pass: settings.password
    }
  });

  return transporter;
}

const templates = {
  welcome: (data) => ({
    subject: `Welcome to Web Agent Bridge, ${sanitizeSubjectPart(data.name)}!`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">⚡</div>
          <h1 style="color:#3b82f6;margin:10px 0;">Web Agent Bridge</h1>
        </div>
        <h2 style="color:#f0f4ff;">Welcome aboard, ${escapeHtml(data.name)}!</h2>
        <p style="color:#94a3b8;line-height:1.8;">
          Your account has been successfully created. You're now ready to bridge AI agents with your websites.
        </p>
        <div style="background:#1a2236;border-radius:8px;padding:20px;margin:20px 0;">
          <h3 style="color:#3b82f6;margin-bottom:12px;">Quick Start:</h3>
          <ol style="color:#94a3b8;line-height:2;">
            <li>Add your website in the Dashboard</li>
            <li>Copy the installation snippet</li>
            <li>Paste it into your website's &lt;head&gt; tag</li>
            <li>AI agents can now interact with your site!</li>
          </ol>
        </div>
        <div style="text-align:center;margin-top:30px;">
          <a href="${data.dashboardUrl || 'https://webagentbridge.com/dashboard'}" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Go to Dashboard</a>
        </div>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge. All rights reserved.
        </p>
      </div>
    `
  }),

  registration: (data) => ({
    subject: 'Account Registration Confirmed — Web Agent Bridge',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">⚡</div>
          <h1 style="color:#3b82f6;margin:10px 0;">Web Agent Bridge</h1>
        </div>
        <h2>Registration Successful</h2>
        <p style="color:#94a3b8;">Hello ${escapeHtml(data.name)},</p>
        <p style="color:#94a3b8;line-height:1.8;">
          Your account has been registered successfully. Here are your account details:
        </p>
        <div style="background:#1a2236;border-radius:8px;padding:20px;margin:20px 0;">
          <p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Email:</strong> ${escapeHtml(data.email)}</p>
          <p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Name:</strong> ${escapeHtml(data.name)}</p>
          ${data.company ? `<p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Company:</strong> ${escapeHtml(data.company)}</p>` : ''}
        </div>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge
        </p>
      </div>
    `
  }),

  password_reset: (data) => ({
    subject: 'Password Reset — Web Agent Bridge',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">🔐</div>
          <h1 style="color:#3b82f6;margin:10px 0;">Password Reset</h1>
        </div>
        <p style="color:#94a3b8;">Hello ${escapeHtml(data.name)},</p>
        <p style="color:#94a3b8;line-height:1.8;">
          We received a request to reset your password. Click the button below to set a new password.
        </p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${data.resetUrl}" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
        </div>
        <p style="color:#64748b;font-size:13px;">
          This link expires in 1 hour. If you didn't request this, ignore this email.
        </p>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge
        </p>
      </div>
    `
  }),

  email_verification: (data) => ({
    subject: 'Verify your email — Web Agent Bridge',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">✉️</div>
          <h1 style="color:#3b82f6;margin:10px 0;">Verify your email</h1>
        </div>
        <p style="color:#94a3b8;">Hello ${escapeHtml(data.name)},</p>
        <p style="color:#94a3b8;line-height:1.8;">
          Thanks for signing up for Web Agent Bridge. Please confirm your email by clicking the button below.
        </p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${data.verifyUrl}" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email</a>
        </div>
        <p style="color:#64748b;font-size:13px;">
          This link expires in 7 days. If you didn't create an account, ignore this email.
        </p>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge
        </p>
      </div>
    `
  }),

  license_delivery: (data) => ({
    subject: `Your ${sanitizeSubjectPart(data.tier || 'WAB')} license is active — Web Agent Bridge`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">🎟️</div>
          <h1 style="color:#10b981;margin:10px 0;">Payment received</h1>
        </div>
        <p style="color:#94a3b8;">Hello ${escapeHtml(data.name || '')},</p>
        <p style="color:#94a3b8;line-height:1.8;">
          Your subscription to <strong style="color:#10b981;">${escapeHtml(String(data.tier || '').toUpperCase())}</strong> is now active.
          Below are your license details — keep them safe.
        </p>
        <div style="background:#1a2236;border-radius:8px;padding:20px;margin:20px 0;">
          ${data.siteDomain ? `<p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Site:</strong> ${escapeHtml(data.siteDomain)}</p>` : ''}
          ${data.licenseKey ? `<p style="color:#94a3b8;"><strong style="color:#f0f4ff;">License key:</strong> <code style="color:#f0f4ff;">${escapeHtml(data.licenseKey)}</code></p>` : ''}
          ${data.amount ? `<p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Amount:</strong> ${escapeHtml(data.amount)}</p>` : ''}
        </div>
        <div style="text-align:center;margin-top:30px;">
          <a href="${data.dashboardUrl || 'https://webagentbridge.com/dashboard'}" style="background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Open Dashboard</a>
        </div>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge
        </p>
      </div>
    `
  }),

  contact: (data) => ({
    subject: `New Contact Message: ${sanitizeSubjectPart(data.subject || 'No Subject')}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">📬</div>
          <h1 style="color:#3b82f6;margin:10px 0;">New Contact Message</h1>
        </div>
        <div style="background:#1a2236;border-radius:8px;padding:20px;margin:20px 0;">
          <p style="color:#94a3b8;"><strong style="color:#f0f4ff;">From:</strong> ${escapeHtml(data.fromName)} (${escapeHtml(data.fromEmail)})</p>
          <p style="color:#94a3b8;"><strong style="color:#f0f4ff;">Subject:</strong> ${escapeHtml(data.subject || 'N/A')}</p>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #334155;">
            <p style="color:#f0f4ff;line-height:1.8;">${escapeHtml(data.message)}</p>
          </div>
        </div>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          Sent via Web Agent Bridge contact form
        </p>
      </div>
    `
  }),

  tier_upgrade: (data) => ({
    subject: `Your plan has been upgraded to ${sanitizeSubjectPart(data.tier)} — Web Agent Bridge`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:40px;">🎉</div>
          <h1 style="color:#3b82f6;margin:10px 0;">Plan Upgraded!</h1>
        </div>
        <p style="color:#94a3b8;">Hello ${escapeHtml(data.name)},</p>
        <p style="color:#94a3b8;line-height:1.8;">
          Great news! Your plan has been upgraded to <strong style="color:#10b981;">${escapeHtml(String(data.tier).toUpperCase())}</strong>.
          ${data.reason ? `<br><br>Reason: ${escapeHtml(data.reason)}` : ''}
        </p>
        <div style="text-align:center;margin-top:30px;">
          <a href="${data.dashboardUrl || 'https://webagentbridge.com/dashboard'}" style="background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">View Dashboard</a>
        </div>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge
        </p>
      </div>
    `
  }),

  sslExpiringAlert: (data) => ({
    subject: `[WAB Trust] SSL certificate for ${data.host} expires in ${data.daysLeft} days`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#f0f4ff;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:40px;">🛡️</div>
          <h1 style="color:#f59e0b;margin:10px 0;">SSL Expiry Warning</h1>
        </div>
        <p style="color:#94a3b8;">Hello,</p>
        <p style="color:#94a3b8;line-height:1.7;">
          The SSL certificate on <strong style="color:#f0f4ff;">${escapeHtml(data.host)}</strong> will expire in
          <strong style="color:#f59e0b;">${data.daysLeft} days</strong> (on ${escapeHtml(data.validTo)}).
        </p>
        <div style="background:#1a2236;border-radius:8px;padding:18px;margin:18px 0;font-size:14px;">
          <div><strong>Issuer:</strong> ${escapeHtml(data.issuer || 'unknown')}</div>
          <div><strong>Fingerprint:</strong> <code style="font-size:11px;">${escapeHtml(data.fingerprint || '')}</code></div>
        </div>
        <p style="color:#94a3b8;line-height:1.7;">
          If you use Let's Encrypt or another auto-renewal system, please verify it is working.
          If renewal fails, agents that rely on the WAB trust layer will fall back to <em>signature-only</em> trust
          and the public ShieldQR scanner will downgrade your domain to <strong>yellow</strong>.
        </p>
        <p style="color:#64748b;font-size:12px;text-align:center;margin-top:30px;">
          &copy; ${new Date().getFullYear()} Web Agent Bridge — Extended Trust Layer
        </p>
      </div>
    `
  })
};

async function sendEmail({ to, template, data, userId }) {
  const transport = getTransporter();
  const settings = getSmtpSettings();

  if (!transport || !settings) {
    logNotification({ userId, emailTo: to, template, subject: `[${template}]`, status: 'failed', errorMessage: 'SMTP not configured' });
    return { success: false, error: 'SMTP not configured' };
  }

  const tmpl = templates[template];
  if (!tmpl) {
    logNotification({ userId, emailTo: to, template, subject: `[${template}]`, status: 'failed', errorMessage: 'Unknown template' });
    return { success: false, error: 'Unknown template' };
  }

  const { subject, html } = tmpl(data);

  try {
    const from = `"${settings.from_name}" <${settings.from_email}>`;
    const messageId = `<${crypto.randomBytes(12).toString('hex')}@${WAB_EMAIL_HOST}>`;
    const wabHeaders = buildWabHeaders({
      from: settings.from_email, to, subject, template,
      messageId, receipt: data && data.wab_receipt
    });
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      messageId,
      headers: wabHeaders
    });
    logNotification({ userId, emailTo: to, template, subject, status: 'sent' });
    return { success: true };
  } catch (err) {
    logNotification({ userId, emailTo: to, template, subject, status: 'failed', errorMessage: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail, templates };
