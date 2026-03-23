/**
 * SMTP Email Notification Service
 * Templates: welcome, registration, password_reset, contact
 */

const nodemailer = require('nodemailer');
const { getSmtpSettings, logNotification } = require('../models/db');

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
    await transport.sendMail({
      from: `"${settings.from_name}" <${settings.from_email}>`,
      to,
      subject,
      html
    });
    logNotification({ userId, emailTo: to, template, subject, status: 'sent' });
    return { success: true };
  } catch (err) {
    logNotification({ userId, emailTo: to, template, subject, status: 'failed', errorMessage: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail, templates };
