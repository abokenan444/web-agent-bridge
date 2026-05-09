/**
 * /api/diagnose — granular activation diagnostics for /activate page.
 *
 * Returns a structured table of checks the UI can render directly.
 * Each check is independent; we never short-circuit so the user sees
 * EVERYTHING that's wrong (not just the first failure).
 */

'use strict';

const express = require('express');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const router = express.Router();

const DOH_RESOLVERS = [
  { name: 'cloudflare', url: 'https://1.1.1.1/dns-query', host: 'cloudflare-dns.com' },
  { name: 'google',     url: 'https://dns.google/resolve' }
];

function _sanitizeDomain(s) {
  if (!s || typeof s !== 'string') return '';
  return s.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function _fetchJson(urlStr, { timeoutMs = 5000, headers = {}, sniHost = null } = {}) {
  return new Promise((resolve) => {
    let url; try { url = new URL(urlStr); } catch { return resolve(null); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      method: 'GET', host: url.hostname, port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      family: 4,
      servername: sniHost || url.hostname,
      headers: { accept: 'application/dns-json', host: sniHost || url.hostname, ...headers },
      timeout: timeoutMs, rejectUnauthorized: true
    }, (res) => {
      const chunks = []; let len = 0;
      res.on('data', (c) => { len += c.length; if (len > 256 * 1024) { res.destroy(); return; } chunks.push(c); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, json: null }); }
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function _fetchText(urlStr, { timeoutMs = 6000, maxBytes = 256 * 1024, headers = {}, followRedirect = true, depth = 0 } = {}) {
  return new Promise((resolve) => {
    let url; try { url = new URL(urlStr); } catch { return resolve(null); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      method: 'GET', host: url.hostname, port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      headers: { 'user-agent': 'WAB-Diagnose/1.0', accept: 'application/json,*/*', ...headers },
      timeout: timeoutMs, rejectUnauthorized: false
    }, (res) => {
      if (followRedirect && depth < 3 && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        try {
          const next = new URL(res.headers.location, url).toString();
          res.destroy();
          return resolve(_fetchText(next, { timeoutMs, maxBytes, headers, followRedirect, depth: depth + 1 }).then((r) => r ? { ...r, redirected: true, finalUrl: next } : null));
        } catch { /* fall through */ }
      }
      const chunks = []; let len = 0;
      res.on('data', (c) => { len += c.length; if (len > maxBytes) { res.destroy(); return; } chunks.push(c); });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        finalUrl: urlStr
      }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function _queryDoH(resolver, name, type) {
  // Note: omit `&do=1` — Cloudflare returns HTTP 400 for it; we still parse AD flag from the JSON response
  const url = `${resolver.url}?name=${encodeURIComponent(name)}&type=${type}`;
  const r = await _fetchJson(url, { timeoutMs: 6000, sniHost: resolver.host || null });
  if (!r || !r.json) return { resolver: resolver.name, ok: false, error: 'no_response' };
  return {
    resolver: resolver.name,
    ok: true,
    status: r.json.Status,
    ad: !!r.json.AD,
    answers: (r.json.Answer || []).filter((a) => a.type === 16).map((a) => String(a.data || '').replace(/^"+|"+$/g, '').replace(/"\s*"/g, ''))
  };
}

// ─────────────────────────────────────────────────────────────────────
//  POST /api/diagnose  { domain }
//  GET  /api/diagnose?domain=
// ─────────────────────────────────────────────────────────────────────

async function diagnose(domain) {
  const checks = [];
  const t0 = Date.now();

  // ── 1) DNS TXT _wab via 3 resolvers in parallel ───────────────────
  const fqdn = `_wab.${domain}`;
  const dohResults = await Promise.all(DOH_RESOLVERS.map((r) => _queryDoH(r, fqdn, 'TXT').catch(() => ({ resolver: r.name, ok: false, error: 'exception' }))));
  const successResolvers = dohResults.filter((r) => r.ok && (r.answers || []).length > 0);
  const wabRecords = Array.from(new Set(successResolvers.flatMap((r) => r.answers))).filter((s) => /v\s*=\s*wab/i.test(s));
  const dnssecAd = dohResults.some((r) => r.ad);

  checks.push({
    id: 'dns_txt',
    title: 'DNS TXT record at _wab',
    status: wabRecords.length > 0 ? 'pass' : 'fail',
    detail: wabRecords.length > 0
      ? `Found via ${successResolvers.length}/${DOH_RESOLVERS.length} resolvers`
      : 'No `v=wab1` TXT record found at `_wab.' + domain + '`',
    fix: wabRecords.length > 0 ? null : 'Add a TXT record where Name=_wab and Value starts with v=wab1; endpoint=https://' + domain + '/.well-known/wab.json — then wait 1–5 minutes for propagation.',
    data: { fqdn, raw: wabRecords, resolvers: dohResults }
  });

  // Partial propagation warning
  if (wabRecords.length > 0 && successResolvers.length < DOH_RESOLVERS.length) {
    checks.push({
      id: 'dns_propagation',
      title: 'DNS propagation across resolvers',
      status: 'warn',
      detail: `Only ${successResolvers.length}/${DOH_RESOLVERS.length} public resolvers see your record yet`,
      fix: 'This is normal during the first 1–10 minutes. Re-run in a couple of minutes.',
      data: { resolvers: dohResults }
    });
  }

  checks.push({
    id: 'dnssec',
    title: 'DNSSEC (recommended)',
    status: dnssecAd ? 'pass' : 'info',
    detail: dnssecAd ? 'AD flag set — record is DNSSEC-validated' : 'No DNSSEC. Optional but adds trust.',
    fix: dnssecAd ? null : 'Enable DNSSEC at your registrar (Cloudflare → DNS → DNSSEC). Optional.',
    data: { ad: dnssecAd }
  });

  // ── 2) Parse endpoint from TXT ────────────────────────────────────
  let endpoint = null;
  let multiSegmentWarning = false;
  let extraQuotesWarning = false;
  for (const raw of wabRecords) {
    const m = /endpoint\s*=\s*([^;\s]+)/i.exec(raw);
    if (m) { endpoint = m[1]; break; }
    if (/"\s*"/.test(raw)) multiSegmentWarning = true;
    if (/^"|"$/.test(raw)) extraQuotesWarning = true;
  }
  if (!endpoint) {
    // synthesize a default for the rest of the checks
    endpoint = `https://${domain}/.well-known/wab.json`;
  }

  if (multiSegmentWarning) {
    checks.push({
      id: 'txt_multi_segment',
      title: 'TXT record split across segments',
      status: 'warn',
      detail: 'Record looks split into multiple "x" "y" segments — fine per RFC 7208 but may confuse simple parsers.',
      fix: 'Re-paste as a single quoted string if your DNS panel allows it.'
    });
  }
  if (extraQuotesWarning) {
    checks.push({
      id: 'txt_extra_quotes',
      title: 'Extra quotation marks in TXT value',
      status: 'warn',
      detail: 'Some panels (e.g. older cPanel) wrap values in extra quotes.',
      fix: 'Edit the TXT record and remove leading/trailing quotes from the Value field.'
    });
  }

  // ── 3) Endpoint must be HTTPS ─────────────────────────────────────
  let endpointUrl;
  try { endpointUrl = new URL(endpoint); } catch { /* */ }
  checks.push({
    id: 'endpoint_https',
    title: 'Endpoint uses HTTPS',
    status: endpointUrl && endpointUrl.protocol === 'https:' ? 'pass' : 'fail',
    detail: endpointUrl ? `endpoint = ${endpoint}` : 'Could not parse endpoint URL from TXT',
    fix: endpointUrl && endpointUrl.protocol === 'https:' ? null : 'Use https:// in your endpoint= value (http:// is rejected by AI agents).'
  });

  // ── 4) Fetch wab.json ─────────────────────────────────────────────
  const fetchRes = endpointUrl ? await _fetchText(endpoint, { timeoutMs: 7000 }) : null;
  if (!fetchRes) {
    checks.push({
      id: 'wabjson_reachable',
      title: 'wab.json reachable',
      status: 'fail',
      detail: 'Could not connect to ' + endpoint,
      fix: 'Make sure the file exists at this exact URL and your firewall/Cloudflare does not block requests with `User-Agent: WAB-Diagnose`.'
    });
  } else {
    checks.push({
      id: 'wabjson_reachable',
      title: 'wab.json reachable',
      status: fetchRes.status >= 200 && fetchRes.status < 300 ? 'pass' : 'fail',
      detail: `HTTP ${fetchRes.status}` + (fetchRes.redirected ? ` (redirected to ${fetchRes.finalUrl})` : ''),
      fix: fetchRes.status === 404 ? 'Create the file at /.well-known/wab.json on your server (must be at this exact path).'
        : fetchRes.status >= 500 ? 'Your server returned an error. Check server logs.'
        : fetchRes.status >= 300 ? 'The URL redirects. Update your endpoint to the final URL to avoid double hops.'
        : null,
      data: { status: fetchRes.status, finalUrl: fetchRes.finalUrl }
    });

    if (fetchRes.status >= 200 && fetchRes.status < 300) {
      // ── 5) Content-Type ────────────────────────────────────────────
      const ct = String(fetchRes.headers['content-type'] || '').toLowerCase();
      const isJson = /^application\/json/.test(ct) || /^application\/wab\+json/.test(ct);
      checks.push({
        id: 'wabjson_content_type',
        title: 'Content-Type is application/json',
        status: isJson ? 'pass' : 'warn',
        detail: ct ? `Content-Type: ${ct}` : 'No Content-Type header sent',
        fix: isJson ? null : 'Configure your server to serve /.well-known/wab.json with `Content-Type: application/json`. Many AI clients reject text/html.',
        data: { content_type: ct }
      });

      // ── 6) Valid JSON ──────────────────────────────────────────────
      let parsed = null;
      try { parsed = JSON.parse(fetchRes.body); } catch (e) {
        checks.push({
          id: 'wabjson_valid',
          title: 'wab.json is valid JSON',
          status: 'fail',
          detail: e.message.slice(0, 160),
          fix: 'Validate your file at jsonlint.com — common mistakes: trailing commas, single quotes instead of double, BOM, comments.'
        });
      }
      if (parsed) {
        checks.push({ id: 'wabjson_valid', title: 'wab.json is valid JSON', status: 'pass', detail: 'Parses cleanly' });

        // ── 7) Required fields ──────────────────────────────────────
        const inner = parsed.payload || parsed;
        const missing = [];
        if (!inner.version) missing.push('version');
        if (!inner.name && !inner.site) missing.push('name (or site)');
        if (!Array.isArray(inner.actions) && !inner.capabilities) missing.push('actions[] or capabilities{}');
        checks.push({
          id: 'wabjson_fields',
          title: 'Required fields present',
          status: missing.length === 0 ? 'pass' : 'warn',
          detail: missing.length === 0 ? 'version + name + (actions or capabilities) all present' : 'Missing: ' + missing.join(', '),
          fix: missing.length ? 'See https://www.webagentbridge.com/docs for the minimal schema.' : null
        });

        // ── 8) Signed envelope (optional but recommended) ───────────
        const signed = !!parsed.signature;
        checks.push({
          id: 'wabjson_signed',
          title: 'Signed (Ed25519, recommended)',
          status: signed ? 'pass' : 'info',
          detail: signed ? 'Signature present — agents can verify authenticity' : 'Unsigned. Optional but boosts trust score.',
          fix: signed ? null : 'Run `node scripts/sign-wab-domain.js` from the WAB repo to add a signature.'
        });

        // ── 9) Action count ─────────────────────────────────────────
        const actionsCount = Array.isArray(inner.actions) ? inner.actions.length
          : (inner.capabilities && typeof inner.capabilities === 'object') ? Object.keys(inner.capabilities).length
          : 0;
        checks.push({
          id: 'actions_count',
          title: 'Declares at least one action',
          status: actionsCount > 0 ? 'pass' : 'warn',
          detail: `${actionsCount} action${actionsCount === 1 ? '' : 's'} declared`,
          fix: actionsCount === 0 ? 'Add at least one action to actions[] (e.g. discovery, search). See /adopt for a generator.' : null
        });
      }
    }
  }

  // ── 10) TLS/cert sanity (best effort) ────────────────────────────
  if (endpointUrl && endpointUrl.protocol === 'https:') {
    const tlsResult = await new Promise((resolve) => {
      let done = false;
      try {
        const sock = tls.connect({ host: endpointUrl.hostname, port: 443, servername: endpointUrl.hostname, rejectUnauthorized: false }, () => {
          if (done) return; done = true;
          const c = sock.getPeerCertificate(false);
          const ok = sock.authorized;
          const validTo = c && c.valid_to ? c.valid_to : null;
          let daysLeft = null;
          if (validTo) {
            try { daysLeft = Math.floor((new Date(validTo).getTime() - Date.now()) / 86400000); } catch { /* */ }
          }
          sock.end();
          resolve({ authorized: ok, valid_to: validTo, days_left: daysLeft, error: sock.authorizationError ? String(sock.authorizationError) : null });
        });
        sock.setTimeout(4000, () => { if (!done) { done = true; sock.destroy(); resolve(null); } });
        sock.on('error', () => { if (!done) { done = true; resolve(null); } });
      } catch { resolve(null); }
    });
    if (tlsResult) {
      const status = tlsResult.authorized && (tlsResult.days_left === null || tlsResult.days_left > 7) ? 'pass'
        : tlsResult.authorized && tlsResult.days_left <= 7 ? 'warn'
        : 'fail';
      checks.push({
        id: 'tls_cert',
        title: 'TLS certificate valid',
        status,
        detail: tlsResult.authorized ? `Valid${tlsResult.days_left != null ? `, expires in ${tlsResult.days_left} days` : ''}` : ('Not authorized: ' + (tlsResult.error || 'unknown')),
        fix: status === 'fail' ? 'Renew your certificate (Let\'s Encrypt is free).'
          : status === 'warn' ? 'Certificate expires in less than 7 days — renew soon.'
          : null,
        data: tlsResult
      });
    }
  }

  // ── 11) Cloudflare-specific hints ────────────────────────────────
  const server = (fetchRes && (fetchRes.headers['server'] || fetchRes.headers['cf-ray'])) || '';
  const cfRay = fetchRes && fetchRes.headers['cf-ray'];
  if (cfRay || /cloudflare/i.test(String(server))) {
    const cfCache = String(fetchRes.headers['cf-cache-status'] || '');
    checks.push({
      id: 'cf_cache',
      title: 'Cloudflare cache status',
      status: /HIT|REVALIDATED/i.test(cfCache) ? 'warn' : 'info',
      detail: cfCache ? `cf-cache-status: ${cfCache}` : 'Detected Cloudflare in front of your endpoint',
      fix: /HIT|REVALIDATED/i.test(cfCache)
        ? 'Cloudflare is caching wab.json. Add a Page Rule: URL=*example.com/.well-known/* → Cache Level: Bypass. Otherwise updates won\'t reach AI agents for hours.'
        : 'If you see stale responses, add a Page Rule to bypass cache for /.well-known/*.'
    });
  }

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    info: checks.filter((c) => c.status === 'info').length
  };

  return {
    ok: summary.fail === 0,
    domain,
    fqdn,
    endpoint,
    elapsed_ms: Date.now() - t0,
    summary,
    checks
  };
}

router.get('/', async (req, res) => {
  const domain = _sanitizeDomain(req.query.domain || '');
  if (!domain) return res.status(400).json({ ok: false, error: 'domain query param required' });
  try { res.json(await diagnose(domain)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/', express.json(), async (req, res) => {
  const domain = _sanitizeDomain((req.body && req.body.domain) || req.query.domain || '');
  if (!domain) return res.status(400).json({ ok: false, error: 'domain required' });
  try { res.json(await diagnose(domain)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
