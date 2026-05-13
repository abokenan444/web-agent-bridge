/**
 * server/routes/activate.js
 * Self-Serve One-Click WAB activation engine.
 *
 * Endpoints (mounted at /api/activate):
 *   POST /prepare                 - Generate keypair + signed wab.json + TXT record value.
 *   GET  /manifest/:token         - Download generated wab.json (10-min TTL).
 *   POST /cloudflare/deploy       - Add/update _wab TXT record via Cloudflare API.
 *   POST /vercel/deploy           - Add _wab TXT record via Vercel DNS API.
 *   POST /netlify/deploy          - Add _wab TXT record via Netlify DNS API.
 *   POST /verify                  - Re-run trust scoring against the domain.
 *   GET  /cloudflare-worker/:token - Generate ready-to-paste Cloudflare Worker script.
 *
 * Security model:
 *   - User-supplied API tokens are used ONCE per request and never persisted.
 *   - Generated private keys are returned to the user ONCE in the prepare response
 *     and held in memory for 10 minutes (only for /manifest download convenience).
 *   - All provider calls happen server-side so user's API token never reaches
 *     the client-visible network from a third-party origin.
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const wabCrypto = require('../services/wab-crypto');
const sslInspector = require('../services/ssl-inspector');

const TTL_MS = 10 * 60 * 1000;
const activations = new Map();

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of activations.entries()) {
    if (v.created_at < cutoff) activations.delete(k);
  }
}, 60 * 1000).unref();

function normalizeDomain(d) {
  return String(d || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:.*$/, '');
}

function isValidDomain(d) {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d) && d.length <= 253;
}

function apexAndSub(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return { apex: domain, sub: '' };
  // Naive 2-label apex (good enough for .com/.io/.net; user can override).
  // For multi-label TLDs (.co.uk) we fallback to last 2 labels which Cloudflare
  // will reject if wrong — surfaced as zone_not_found.
  const apex = parts.slice(-2).join('.');
  const sub = parts.slice(0, -2).join('.');
  return { apex, sub };
}

function txtNameForWab(domain) {
  const { apex, sub } = apexAndSub(domain);
  return sub ? `_wab.${sub}` : '_wab';
}

function fullTxtName(domain) {
  return `_wab.${domain}`;
}

/** Build the TXT record value string from a manifest summary. */
function buildTxtValue({ endpoint, publicKey, capabilities, ssl }) {
  const parts = [
    'v=wab1',
    `endpoint=${endpoint}`,
    `pk=ed25519:${publicKey}`,
  ];
  for (const [k, v] of Object.entries(capabilities || {})) {
    if (v === true) parts.push(`${k}=enabled`);
  }
  if (ssl && ssl.fingerprint_sha256) {
    parts.push(`ssl_thumbprint=${ssl.fingerprint_sha256}`);
    parts.push(`ssl_expires=${ssl.valid_to}`);
  }
  return parts.join('; ');
}

/* ─────────────────────────────────────────────────────────────────────────
 * POST /prepare
 * Body: { domain, endpoint?, capabilities? }
 * ───────────────────────────────────────────────────────────────────────── */
router.post('/prepare', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const domain = normalizeDomain(req.body?.domain);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'invalid_domain', detail: 'Use a public domain like example.com' });
    }
    const endpoint = (typeof req.body?.endpoint === 'string' && /^https:\/\//.test(req.body.endpoint))
      ? req.body.endpoint
      : `https://${domain}/.well-known/wab.json`;

    const capabilities = {
      shieldqr: req.body?.capabilities?.shieldqr !== false,
      shieldlink: req.body?.capabilities?.shieldlink !== false,
      ...((req.body?.capabilities && typeof req.body.capabilities === 'object') ? req.body.capabilities : {}),
    };

    // Generate Ed25519 keypair (raw 32-byte base64).
    const kp = wabCrypto.generateKeyPair();

    // Best-effort SSL probe (skip if domain unreachable on 443 — manifest still valid).
    let ssl = null;
    try {
      const r = await sslInspector.inspect(domain, 443, 5000);
      if (r && r.ok) {
        ssl = {
          fingerprint_sha256: r.fingerprint_sha256,
          valid_to: r.valid_to,
          issuer: r.issuer,
          days_until_expiry: r.days_until_expiry,
        };
      }
    } catch (_) { /* tolerable — SSL fields optional in TXT */ }

    const now = new Date();
    const manifest = {
      version: '1.3',
      type: 'wab-discovery',
      host: domain,
      endpoint,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
      capabilities,
      pk: `ed25519:${kp.public_key}`,
    };
    if (ssl) {
      manifest.ssl = {
        fingerprint_sha256: ssl.fingerprint_sha256,
        valid_to: ssl.valid_to,
      };
    }

    const signed = wabCrypto.signManifest(manifest, kp.private_key, { embed_public_key: true });

    // Self-verify (catches any sync bug before user pastes).
    const ver = wabCrypto.verifyManifest(signed, kp.public_key);
    if (!ver.ok) {
      return res.status(500).json({ error: 'self_verify_failed', detail: ver.reason });
    }

    const txtValue = buildTxtValue({ endpoint, publicKey: kp.public_key, capabilities, ssl });

    // Suggest TXT records — apex + www variant (if domain is itself an apex).
    const parts = domain.split('.');
    const isApex = parts.length === 2;
    const txtRecords = [
      { name: fullTxtName(domain), label_for_cloudflare: txtNameForWab(domain), type: 'TXT', value: txtValue },
    ];
    if (isApex) {
      txtRecords.push({
        name: `_wab.www.${domain}`,
        label_for_cloudflare: '_wab.www',
        type: 'TXT',
        value: txtValue,
      });
    }

    const token = crypto.randomBytes(18).toString('base64url');
    activations.set(token, {
      domain,
      endpoint,
      manifest: signed,
      txt_value: txtValue,
      txt_records: txtRecords,
      public_key: kp.public_key,
      private_key: kp.private_key,
      key_id: kp.fingerprint,
      capabilities,
      ssl,
      created_at: Date.now(),
    });

    return res.json({
      token,
      expires_in_seconds: TTL_MS / 1000,
      domain,
      endpoint,
      manifest: signed,
      txt_value: txtValue,
      txt_records: txtRecords,
      key: {
        algorithm: 'ed25519',
        public_key: kp.public_key,
        private_key: kp.private_key,
        fingerprint: kp.fingerprint,
        warning: 'Save the private key offline. It is the only way to re-sign the manifest later. We do not retain it after this session expires.',
      },
      ssl,
      hosting_options: {
        manual: `Upload wab.json to your site at ${endpoint}`,
        cloudflare_worker: `GET /api/activate/cloudflare-worker/${token} for a copy-paste Worker script`,
        vercel_rewrite: { 'rewrites': [{ source: '/.well-known/wab.json', destination: '/api/wab' }] },
        netlify_redirect: '/.well-known/wab.json /wab.json 200',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'prepare_failed', detail: e.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * GET /manifest/:token  → downloadable wab.json
 * ───────────────────────────────────────────────────────────────────────── */
router.get('/manifest/:token', (req, res) => {
  const a = activations.get(req.params.token);
  if (!a) return res.status(404).json({ error: 'expired_or_unknown' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wab.json"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(a.manifest, null, 2));
});

/* ─────────────────────────────────────────────────────────────────────────
 * GET /cloudflare-worker/:token  → ready-to-paste Worker script
 * Lets users with Cloudflare in front of a site they can't easily modify
 * serve wab.json without touching their origin.
 * ───────────────────────────────────────────────────────────────────────── */
router.get('/cloudflare-worker/:token', (req, res) => {
  const a = activations.get(req.params.token);
  if (!a) return res.status(404).json({ error: 'expired_or_unknown' });
  const manifestJson = JSON.stringify(a.manifest, null, 2);
  const script = `// WAB Discovery Worker — auto-generated by webagentbridge.com
// Deploy this Worker and add a route for: ${a.domain}/.well-known/wab.json
// Generated: ${new Date().toISOString()}
const MANIFEST = ${manifestJson};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/.well-known/wab.json') {
      return new Response(JSON.stringify(MANIFEST), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      });
    }
    return fetch(request);
  },
};
`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wab-worker-${a.domain}.js"`);
  res.send(script);
});

/* ─────────────────────────────────────────────────────────────────────────
 * Provider integrations
 * ───────────────────────────────────────────────────────────────────────── */
async function cfFetch(path, apiToken, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.success !== false, status: r.status, data };
}

router.post('/cloudflare/deploy', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { token, api_token, also_www = true } = req.body || {};
    if (!token || !api_token) return res.status(400).json({ error: 'missing_params' });
    const a = activations.get(token);
    if (!a) return res.status(404).json({ error: 'expired_activation' });
    if (typeof api_token !== 'string' || api_token.length < 20 || api_token.length > 200) {
      return res.status(400).json({ error: 'invalid_api_token' });
    }

    const { apex } = apexAndSub(a.domain);

    // 1. Find zone
    const zones = await cfFetch(`/zones?name=${encodeURIComponent(apex)}`, api_token);
    if (!zones.ok) {
      return res.status(400).json({
        error: 'cloudflare_auth_failed',
        detail: zones.data?.errors || zones.data?.message || `HTTP ${zones.status}`,
      });
    }
    const zone = zones.data.result?.[0];
    if (!zone) {
      return res.status(404).json({
        error: 'zone_not_found',
        detail: `No Cloudflare zone for ${apex}. Add the domain to Cloudflare first, or your token lacks Zone:Read permission.`,
      });
    }

    // 2. Compute names to write (use Cloudflare-style short names)
    const recordsToWrite = a.txt_records
      .filter(r => also_www || !r.name.startsWith('_wab.www.'))
      .map(r => ({
        name: r.name,  // Cloudflare accepts FQDN
        value: r.value,
      }));

    const results = [];
    for (const rec of recordsToWrite) {
      // Look for any existing wab TXT at this name
      const existing = await cfFetch(
        `/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(rec.name)}&per_page=100`,
        api_token
      );
      const prior = existing.data?.result?.find(r => (r.content || '').includes('v=wab1'));

      let r;
      if (prior) {
        r = await cfFetch(`/zones/${zone.id}/dns_records/${prior.id}`, api_token, {
          method: 'PUT',
          body: JSON.stringify({ type: 'TXT', name: rec.name, content: rec.value, ttl: 300 }),
        });
        results.push({
          name: rec.name, action: 'updated', success: r.ok,
          errors: r.ok ? null : r.data?.errors || r.data,
        });
      } else {
        r = await cfFetch(`/zones/${zone.id}/dns_records`, api_token, {
          method: 'POST',
          body: JSON.stringify({ type: 'TXT', name: rec.name, content: rec.value, ttl: 300 }),
        });
        results.push({
          name: rec.name, action: 'created', success: r.ok,
          errors: r.ok ? null : r.data?.errors || r.data,
        });
      }
    }

    const allOk = results.every(r => r.success);
    return res.json({
      success: allOk,
      provider: 'cloudflare',
      zone: { id: zone.id, name: zone.name, status: zone.status },
      records: results,
      next: allOk
        ? `DNS deployed. Wait ~1-5 min then POST /api/activate/verify to confirm trust score.`
        : 'Some records failed. Check token permissions: Zone:DNS:Edit on the zone.',
    });
  } catch (e) {
    return res.status(500).json({ error: 'cloudflare_deploy_failed', detail: e.message });
  }
});

router.post('/vercel/deploy', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { token, api_token, team_id } = req.body || {};
    if (!token || !api_token) return res.status(400).json({ error: 'missing_params' });
    const a = activations.get(token);
    if (!a) return res.status(404).json({ error: 'expired_activation' });
    if (typeof api_token !== 'string' || api_token.length < 20) {
      return res.status(400).json({ error: 'invalid_api_token' });
    }

    const { apex } = apexAndSub(a.domain);
    const teamQs = team_id ? `?teamId=${encodeURIComponent(team_id)}` : '';
    const results = [];

    for (const rec of a.txt_records) {
      // Vercel expects subdomain part only (or '@' for apex).
      let recName;
      if (rec.name === `_wab.${apex}`) recName = '_wab';
      else recName = rec.name.replace(new RegExp(`\\.${apex.replace(/\./g, '\\.')}$`), '');

      const r = await fetch(`https://api.vercel.com/v2/domains/${encodeURIComponent(apex)}/records${teamQs}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${api_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: recName, type: 'TXT', value: rec.value, ttl: 300 }),
      });
      const data = await r.json().catch(() => ({}));
      results.push({
        name: rec.name,
        action: r.ok ? 'created' : 'failed',
        success: r.ok,
        record_id: data?.uid || null,
        errors: r.ok ? null : (data?.error || data),
      });
    }

    const allOk = results.every(r => r.success);
    return res.json({
      success: allOk,
      provider: 'vercel',
      domain: apex,
      records: results,
      next: allOk
        ? 'DNS deployed. Wait ~1-5 min then POST /api/activate/verify.'
        : 'Some records failed. Vercel DNS only works if the domain uses Vercel nameservers.',
    });
  } catch (e) {
    return res.status(500).json({ error: 'vercel_deploy_failed', detail: e.message });
  }
});

router.post('/netlify/deploy', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { token, api_token } = req.body || {};
    if (!token || !api_token) return res.status(400).json({ error: 'missing_params' });
    const a = activations.get(token);
    if (!a) return res.status(404).json({ error: 'expired_activation' });
    if (typeof api_token !== 'string' || api_token.length < 20) {
      return res.status(400).json({ error: 'invalid_api_token' });
    }

    const { apex } = apexAndSub(a.domain);

    // 1. Find DNS zone
    const zonesResp = await fetch('https://api.netlify.com/api/v1/dns_zones', {
      headers: { Authorization: `Bearer ${api_token}` },
    });
    if (!zonesResp.ok) {
      return res.status(400).json({ error: 'netlify_auth_failed', detail: `HTTP ${zonesResp.status}` });
    }
    const zones = await zonesResp.json();
    const zone = zones.find(z => z.name === apex);
    if (!zone) {
      return res.status(404).json({
        error: 'zone_not_found',
        detail: `No Netlify DNS zone for ${apex}. Add the domain to Netlify DNS first.`,
      });
    }

    const results = [];
    for (const rec of a.txt_records) {
      const r = await fetch(`https://api.netlify.com/api/v1/dns_zones/${zone.id}/dns_records`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${api_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'TXT', hostname: rec.name, value: rec.value, ttl: 300 }),
      });
      const data = await r.json().catch(() => ({}));
      results.push({
        name: rec.name,
        action: r.ok ? 'created' : 'failed',
        success: r.ok,
        record_id: data?.id || null,
        errors: r.ok ? null : data,
      });
    }
    const allOk = results.every(r => r.success);
    return res.json({ success: allOk, provider: 'netlify', zone: { id: zone.id, name: zone.name }, records: results });
  } catch (e) {
    return res.status(500).json({ error: 'netlify_deploy_failed', detail: e.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * POST /verify — proxy to /api/discovery/trust/:domain
 * ───────────────────────────────────────────────────────────────────────── */
router.post('/verify', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const domain = normalizeDomain(req.body?.domain);
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
    const port = process.env.PORT || 3000;
    const r = await fetch(`http://127.0.0.1:${port}/api/discovery/trust/${encodeURIComponent(domain)}?nocache=${Date.now()}`);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'verify_failed', detail: e.message });
  }
});

module.exports = router;
