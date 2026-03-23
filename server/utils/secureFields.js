/**
 * Optional AES-256-GCM encryption for sensitive DB fields (e.g. SMTP password).
 * Set CREDENTIALS_ENCRYPTION_KEY (any long random string) to enable at-rest encryption.
 */

const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || String(raw).length < 8) return null;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptOptional(plain) {
  if (plain == null || plain === '') return plain;
  const key = getKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptOptional(stored) {
  if (stored == null || stored === '') return stored;
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) {
    console.warn('[WAB] CREDENTIALS_ENCRYPTION_KEY missing; cannot decrypt stored credential');
    return null;
  }
  try {
    const rest = stored.slice(PREFIX.length);
    const [ivHex, tagHex, dataHex] = rest.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[WAB] Decrypt failed:', e.message);
    return null;
  }
}

module.exports = { encryptOptional, decryptOptional };
