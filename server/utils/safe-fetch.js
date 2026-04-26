'use strict';

/**
 * Safe Fetch — SSRF-resistant HTTP client.
 *
 * Mitigations applied:
 *   1. Scheme allow-list (http/https only).
 *   2. Optional domain allow-list (string globs or "*").
 *   3. DNS resolution + private/reserved/loopback/link-local CIDR block.
 *   4. Re-validation on EVERY redirect hop (manual redirect handling).
 *   5. Hard timeout via AbortController.
 *   6. Max response body size (default 5 MB) — drains and aborts.
 *   7. Optional Content-Type allow-list.
 *
 * NEVER call native `fetch(url)` directly with user-supplied URLs anywhere
 * inside this server process. Use this helper.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

const PRIVATE_V4_CIDRS = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],   // link-local (AWS metadata 169.254.169.254 lives here)
  ['100.64.0.0', 10],    // CGNAT
  ['0.0.0.0', 8],
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved
  ['198.18.0.0', 15],    // benchmarking
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],     // TEST-NET-1
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
];

const PRIVATE_V6_PREFIXES = ['::1', 'fc', 'fd', 'fe80', 'ff', '::ffff:127.', '::ffff:10.', '::ffff:192.168.', '::ffff:172.', '::', '64:ff9b::'];

function _ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function _isPrivateV4(ip) {
  const ipInt = _ipToInt(ip);
  return PRIVATE_V4_CIDRS.some(([base, bits]) => {
    const baseInt = _ipToInt(base);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  });
}

function _isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  return PRIVATE_V6_PREFIXES.some((p) => lower === p || lower.startsWith(p));
}

function isPrivateAddress(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) return _isPrivateV4(ip);
  if (net.isIPv6(ip)) return _isPrivateV6(ip);
  return true; // unknown → treat as private
}

function _matchesGlob(host, pattern) {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2).toLowerCase();
    return host === suffix || host.endsWith('.' + suffix);
  }
  return host.toLowerCase() === pattern.toLowerCase();
}

function _allowedHost(host, allowList) {
  if (!allowList || allowList.length === 0) return true; // no list = allow public
  return allowList.some((p) => _matchesGlob(host, p));
}

async function _assertSafeHost(hostname) {
  // If it's already an IP literal, validate directly.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`SSRF blocked: private/reserved IP ${hostname}`);
    }
    return;
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err.code || err.message}`);
  }
  if (!records || records.length === 0) {
    throw new Error(`DNS returned no records for ${hostname}`);
  }
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private/reserved address ${r.address}`);
    }
  }
}

/**
 * Validate a URL string against the SSRF policy.
 * @returns {URL} parsed URL
 */
async function validateUrl(rawUrl, options = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    throw new Error('Invalid URL');
  }
  const allowedSchemes = options.allowedSchemes || ['http:', 'https:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new Error(`Scheme ${parsed.protocol} not allowed`);
  }
  if (options.requireHttps && parsed.protocol !== 'https:') {
    throw new Error('HTTPS required');
  }
  // Block credentials in URLs (defeats some auth-smuggling attacks).
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URLs are not allowed');
  }
  // Restrict ports to defaults unless explicitly allowed.
  const allowedPorts = options.allowedPorts || [80, 443];
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (!allowedPorts.includes(port)) {
    throw new Error(`Port ${port} not allowed`);
  }
  if (!_allowedHost(parsed.hostname, options.allowList)) {
    throw new Error(`Host ${parsed.hostname} not in allow-list`);
  }
  await _assertSafeHost(parsed.hostname);
  return parsed;
}

/**
 * SSRF-resistant fetch.
 * Manually follows redirects so each hop is re-validated.
 */
async function safeFetch(rawUrl, init = {}, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024; // 5 MB
  const timeoutMs = opts.timeoutMs ?? 10000;
  const allowList = opts.allowList;
  const allowedContentTypes = opts.allowedContentTypes; // e.g. ['text/html','application/json']

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await validateUrl(currentUrl, { allowList, allowedSchemes: opts.allowedSchemes, requireHttps: opts.requireHttps, allowedPorts: opts.allowedPorts });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return _enforceBody(res, maxBytes, allowedContentTypes);
      if (hop === maxRedirects) throw new Error('Too many redirects');
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }

    return _enforceBody(res, maxBytes, allowedContentTypes);
  }
  throw new Error('Redirect loop');
}

async function _enforceBody(res, maxBytes, allowedContentTypes) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (allowedContentTypes && !allowedContentTypes.some((t) => ct.startsWith(t))) {
    res.body?.cancel?.().catch(() => {});
    throw new Error(`Content-Type ${ct || 'unknown'} not allowed`);
  }
  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared && declared > maxBytes) {
    res.body?.cancel?.().catch(() => {});
    throw new Error(`Response too large (${declared} bytes, max ${maxBytes})`);
  }
  if (!res.body) return res;

  // Buffer the response while enforcing size.
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  // Return a Response-like wrapper matching the parts callers actually use.
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    url: res.url,
    redirected: res.redirected,
    async text() { return buf.toString('utf8'); },
    async json() { return JSON.parse(buf.toString('utf8')); },
    async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
    async buffer() { return buf; },
  };
}

module.exports = {
  safeFetch,
  validateUrl,
  isPrivateAddress,
};
