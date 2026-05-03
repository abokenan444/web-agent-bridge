/**
 * provider-clients.js — server-side adapters for managed DNS providers.
 *
 * Each adapter implements:
 *   testCredentials(creds, config) -> { ok, detail }
 *   listDomains(creds, config)     -> [{ domain, zone_id }]
 *   enableWAB(creds, config, domain, txtValue)  -> { ok, detail, recordId? }
 *   disableWAB(creds, config, domain)           -> { ok, detail }
 *
 * Credentials are stored AES-256-GCM encrypted in provider_accounts.credentials.
 * They are decrypted only inside this module, in-memory, per request.
 *
 * Outbound requests use safeFetch (SSRF-resistant, redirect-validated).
 */

'use strict';

const crypto = require('crypto');
const { safeFetch } = require('../utils/safe-fetch');

/* ───────────────────────────── helpers ──────────────────────────────── */

async function jsonOrThrow(res, providerName) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = (body && (body.error || body.message || body.errors || body.Code)) || text || res.statusText;
    const err = new Error(`${providerName} ${res.status}: ${typeof detail === 'string' ? detail.slice(0, 240) : JSON.stringify(detail).slice(0, 240)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function withTimeout(ms = 12000, max = 256 * 1024) {
  return { timeoutMs: ms, maxBytes: max };
}

// cPanel + Plesk + WHM commonly use non-standard ports.
const CPANEL_PORTS = [80, 443, 2082, 2083, 2086, 2087];
const PLESK_PORTS  = [80, 443, 8443, 8880];
function withCpanelOpts() { return { ...withTimeout(15000, 1024 * 1024), allowedPorts: CPANEL_PORTS }; }
function withPleskOpts()  { return { ...withTimeout(15000, 1024 * 1024), allowedPorts: PLESK_PORTS }; }

/* ─────────────────────────── 1. Cloudflare ──────────────────────────── */
// Credentials: { api_token } — Account/Zone-scoped Cloudflare API token.

const cloudflare = {
  type: 'cloudflare',
  label: 'Cloudflare',
  credential_fields: [
    { key: 'api_token', label: 'API Token', type: 'password', required: true,
      help: 'Create at https://dash.cloudflare.com/profile/api-tokens with Zone:Read + Zone:DNS:Edit.' },
  ],

  async testCredentials({ api_token }) {
    const res = await safeFetch(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      { headers: { Authorization: `Bearer ${api_token}` } },
      withTimeout()
    );
    const body = await jsonOrThrow(res, 'Cloudflare');
    return { ok: !!(body && body.success), detail: (body && body.result && body.result.status) || 'unknown' };
  },

  async listDomains({ api_token }) {
    const res = await safeFetch(
      'https://api.cloudflare.com/client/v4/zones?per_page=50',
      { headers: { Authorization: `Bearer ${api_token}` } },
      withTimeout()
    );
    const body = await jsonOrThrow(res, 'Cloudflare');
    return (body.result || []).map(z => ({ domain: z.name, zone_id: z.id, status: z.status }));
  },

  async _findRecord({ api_token }, zone_id) {
    const url = `https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?type=TXT&name=_wab.${(await this._zoneName({ api_token }, zone_id))}`;
    const res = await safeFetch(url, { headers: { Authorization: `Bearer ${api_token}` } }, withTimeout());
    const body = await jsonOrThrow(res, 'Cloudflare');
    return (body.result || [])[0] || null;
  },

  async _zoneName({ api_token }, zone_id) {
    const res = await safeFetch(
      `https://api.cloudflare.com/client/v4/zones/${zone_id}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
      withTimeout()
    );
    const body = await jsonOrThrow(res, 'Cloudflare');
    return body.result.name;
  },

  async enableWAB({ api_token }, _config, domain, txtValue, opts = {}) {
    const zone_id = opts.zone_id || (await this._zoneIdForDomain({ api_token }, domain));
    if (!zone_id) throw new Error('Zone not found for ' + domain);
    const existing = await this._findRecord({ api_token }, zone_id);
    const payload = { type: 'TXT', name: '_wab', content: txtValue, ttl: 3600 };
    let res;
    if (existing) {
      res = await safeFetch(
        `https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${existing.id}`,
        { method: 'PUT', headers: { Authorization: `Bearer ${api_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        withTimeout()
      );
    } else {
      res = await safeFetch(
        `https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records`,
        { method: 'POST', headers: { Authorization: `Bearer ${api_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        withTimeout()
      );
    }
    const body = await jsonOrThrow(res, 'Cloudflare');
    return { ok: !!body.success, recordId: body.result && body.result.id, detail: existing ? 'updated' : 'created' };
  },

  async disableWAB({ api_token }, _config, domain, opts = {}) {
    const zone_id = opts.zone_id || (await this._zoneIdForDomain({ api_token }, domain));
    if (!zone_id) throw new Error('Zone not found for ' + domain);
    const existing = await this._findRecord({ api_token }, zone_id);
    if (!existing) return { ok: true, detail: 'already-absent' };
    const res = await safeFetch(
      `https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${existing.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${api_token}` } },
      withTimeout()
    );
    await jsonOrThrow(res, 'Cloudflare');
    return { ok: true, detail: 'deleted' };
  },

  async _zoneIdForDomain({ api_token }, domain) {
    const res = await safeFetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
      withTimeout()
    );
    const body = await jsonOrThrow(res, 'Cloudflare');
    return (body.result || [])[0] && body.result[0].id;
  },
};

/* ─────────────────────────── 2. GoDaddy ─────────────────────────────── */
// Credentials: { api_key, api_secret }

const godaddy = {
  type: 'godaddy',
  label: 'GoDaddy',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'text', required: true },
    { key: 'api_secret', label: 'API Secret', type: 'password', required: true,
      help: 'Production keys at https://developer.godaddy.com/keys (50+ domain accounts only).' },
  ],

  _hdr({ api_key, api_secret }) {
    return { Authorization: `sso-key ${api_key}:${api_secret}`, 'Content-Type': 'application/json' };
  },

  async testCredentials(creds) {
    const res = await safeFetch('https://api.godaddy.com/v1/domains?limit=1', { headers: this._hdr(creds) }, withTimeout());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GoDaddy ${res.status}: ${text.slice(0, 200)}`);
    }
    return { ok: true, detail: 'auth-ok' };
  },

  async listDomains(creds) {
    const res = await safeFetch('https://api.godaddy.com/v1/domains?limit=200', { headers: this._hdr(creds) }, withTimeout(15000, 1024 * 1024));
    const body = await jsonOrThrow(res, 'GoDaddy');
    return (body || []).map(d => ({ domain: d.domain, zone_id: null, status: d.status }));
  },

  async enableWAB(creds, _config, domain, txtValue) {
    const url = `https://api.godaddy.com/v1/domains/${encodeURIComponent(domain)}/records/TXT/_wab`;
    const res = await safeFetch(url, {
      method: 'PUT', headers: this._hdr(creds), body: JSON.stringify([{ data: txtValue, ttl: 3600 }]),
    }, withTimeout());
    if (!res.ok) throw new Error(`GoDaddy ${res.status}: ${await res.text()}`);
    return { ok: true, detail: 'put' };
  },

  async disableWAB(creds, _config, domain) {
    const url = `https://api.godaddy.com/v1/domains/${encodeURIComponent(domain)}/records/TXT/_wab`;
    const res = await safeFetch(url, {
      method: 'PUT', headers: this._hdr(creds), body: '[]',
    }, withTimeout());
    if (!res.ok) throw new Error(`GoDaddy ${res.status}: ${await res.text()}`);
    return { ok: true, detail: 'cleared' };
  },
};

/* ─────────────────────────── 3. Azure DNS ───────────────────────────── */
// Credentials: { tenant_id, client_id, client_secret }
// Config: { subscription_id, resource_group, zone_name }

const azure = {
  type: 'azure',
  label: 'Azure DNS',
  credential_fields: [
    { key: 'tenant_id', label: 'Tenant ID', type: 'text', required: true },
    { key: 'client_id', label: 'Client ID (App Registration)', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true,
      help: 'Service Principal must have "DNS Zone Contributor" role on the zone.' },
  ],
  config_fields: [
    { key: 'subscription_id', label: 'Subscription ID', type: 'text', required: true },
    { key: 'resource_group', label: 'Resource Group', type: 'text', required: true },
    { key: 'zone_name', label: 'DNS Zone Name', type: 'text', required: true,
      help: 'The zone you want to manage, e.g. example.com' },
  ],

  async _accessToken({ tenant_id, client_id, client_secret }) {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant_id)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id, client_secret,
      scope: 'https://management.azure.com/.default',
    });
    const res = await safeFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    }, withTimeout());
    const j = await jsonOrThrow(res, 'Azure AD');
    if (!j.access_token) throw new Error('Azure: no access_token returned');
    return j.access_token;
  },

  async testCredentials(creds, config) {
    const token = await this._accessToken(creds);
    if (!config || !config.subscription_id) return { ok: true, detail: 'auth-ok' };
    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(config.subscription_id)}` +
      (config.resource_group && config.zone_name
        ? `/resourceGroups/${encodeURIComponent(config.resource_group)}/providers/Microsoft.Network/dnsZones/${encodeURIComponent(config.zone_name)}?api-version=2018-05-01`
        : '?api-version=2022-12-01');
    const res = await safeFetch(url, { headers: { Authorization: `Bearer ${token}` } }, withTimeout());
    if (!res.ok && res.status !== 404) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: res.ok ? 'zone-found' : 'auth-ok-zone-missing' };
  },

  async listDomains(creds, config) {
    if (!config || !config.zone_name) return [];
    return [{ domain: config.zone_name, zone_id: config.zone_name, status: 'configured' }];
  },

  async enableWAB(creds, config, domain, txtValue) {
    const token = await this._accessToken(creds);
    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(config.subscription_id)}` +
      `/resourceGroups/${encodeURIComponent(config.resource_group)}/providers/Microsoft.Network/dnsZones/` +
      `${encodeURIComponent(config.zone_name)}/TXT/_wab?api-version=2018-05-01`;
    const res = await safeFetch(url, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { TTL: 3600, TXTRecords: [{ value: [txtValue] }] } }),
    }, withTimeout());
    if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'put' };
  },

  async disableWAB(creds, config) {
    const token = await this._accessToken(creds);
    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(config.subscription_id)}` +
      `/resourceGroups/${encodeURIComponent(config.resource_group)}/providers/Microsoft.Network/dnsZones/` +
      `${encodeURIComponent(config.zone_name)}/TXT/_wab?api-version=2018-05-01`;
    const res = await safeFetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, withTimeout());
    if (!res.ok && res.status !== 404) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: res.status === 404 ? 'already-absent' : 'deleted' };
  },
};

/* ─────────────────────────── 4. GCP DNS ─────────────────────────────── */
// Credentials: { service_account_json } — full JSON key file pasted in.

const gcp = {
  type: 'gcp',
  label: 'Google Cloud DNS',
  credential_fields: [
    { key: 'service_account_json', label: 'Service Account JSON', type: 'textarea', required: true,
      help: 'Paste the full JSON key. Service account must have "DNS Administrator" role.' },
  ],
  config_fields: [
    { key: 'project_id', label: 'Project ID', type: 'text', required: true },
    { key: 'managed_zone', label: 'Managed Zone Name', type: 'text', required: true,
      help: 'Cloud DNS zone resource name (not the DNS name).' },
  ],

  _parseSA(json) {
    let sa;
    try { sa = typeof json === 'string' ? JSON.parse(json) : json; }
    catch (e) { throw new Error('Invalid service account JSON: ' + e.message); }
    if (!sa.client_email || !sa.private_key) throw new Error('SA JSON missing client_email/private_key');
    return sa;
  },

  async _accessToken({ service_account_json }) {
    const sa = this._parseSA(service_account_json);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/ndev.clouddns.readwrite',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
    };
    const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const headerB = b64u(JSON.stringify(header));
    const claimB  = b64u(JSON.stringify(claim));
    const signing = `${headerB}.${claimB}`;
    const sig = crypto.createSign('RSA-SHA256').update(signing).sign(sa.private_key);
    const jwt = `${signing}.${sig.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;

    const res = await safeFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    }, withTimeout());
    const j = await jsonOrThrow(res, 'Google OAuth');
    return j.access_token;
  },

  async testCredentials(creds, config) {
    const token = await this._accessToken(creds);
    if (!config || !config.project_id || !config.managed_zone) return { ok: true, detail: 'auth-ok' };
    const url = `https://dns.googleapis.com/dns/v1/projects/${encodeURIComponent(config.project_id)}/managedZones/${encodeURIComponent(config.managed_zone)}`;
    const res = await safeFetch(url, { headers: { Authorization: `Bearer ${token}` } }, withTimeout());
    if (!res.ok) throw new Error(`GCP ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'zone-found' };
  },

  async listDomains(creds, config) {
    if (!config || !config.project_id) return [];
    const token = await this._accessToken(creds);
    const res = await safeFetch(
      `https://dns.googleapis.com/dns/v1/projects/${encodeURIComponent(config.project_id)}/managedZones`,
      { headers: { Authorization: `Bearer ${token}` } }, withTimeout(15000, 1024 * 1024)
    );
    const body = await jsonOrThrow(res, 'GCP');
    return (body.managedZones || []).map(z => ({ domain: (z.dnsName || '').replace(/\.$/, ''), zone_id: z.name, status: z.visibility }));
  },

  async _existing(token, project_id, managed_zone, fqdn) {
    const url = `https://dns.googleapis.com/dns/v1/projects/${encodeURIComponent(project_id)}/managedZones/${encodeURIComponent(managed_zone)}/rrsets?name=${encodeURIComponent(fqdn)}&type=TXT`;
    const res = await safeFetch(url, { headers: { Authorization: `Bearer ${token}` } }, withTimeout());
    const j = await jsonOrThrow(res, 'GCP');
    return (j.rrsets || [])[0] || null;
  },

  async _change(token, project_id, managed_zone, body) {
    const url = `https://dns.googleapis.com/dns/v1/projects/${encodeURIComponent(project_id)}/managedZones/${encodeURIComponent(managed_zone)}/changes`;
    const res = await safeFetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, withTimeout());
    if (!res.ok) throw new Error(`GCP ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return jsonOrThrow(res, 'GCP');
  },

  async enableWAB(creds, config, domain, txtValue) {
    const token = await this._accessToken(creds);
    const fqdn = `_wab.${domain}.`;
    const existing = await this._existing(token, config.project_id, config.managed_zone, fqdn);
    const additions = [{ name: fqdn, type: 'TXT', ttl: 3600, rrdatas: [`"${txtValue}"`] }];
    const body = existing ? { additions, deletions: [existing] } : { additions };
    await this._change(token, config.project_id, config.managed_zone, body);
    return { ok: true, detail: existing ? 'updated' : 'created' };
  },

  async disableWAB(creds, config, domain) {
    const token = await this._accessToken(creds);
    const fqdn = `_wab.${domain}.`;
    const existing = await this._existing(token, config.project_id, config.managed_zone, fqdn);
    if (!existing) return { ok: true, detail: 'already-absent' };
    await this._change(token, config.project_id, config.managed_zone, { deletions: [existing] });
    return { ok: true, detail: 'deleted' };
  },
};

/* ─────────────────────────── 5. Route 53 ────────────────────────────── */
// Credentials: { access_key_id, secret_access_key }
// Config:      { hosted_zone_id }

const route53 = {
  type: 'route53',
  label: 'AWS Route 53',
  credential_fields: [
    { key: 'access_key_id', label: 'AWS Access Key ID', type: 'text', required: true },
    { key: 'secret_access_key', label: 'AWS Secret Access Key', type: 'password', required: true,
      help: 'IAM user/role needs route53:ChangeResourceRecordSets + ListResourceRecordSets on the hosted zone.' },
  ],
  config_fields: [
    { key: 'hosted_zone_id', label: 'Hosted Zone ID', type: 'text', required: true,
      help: 'e.g. Z2FDTNDATAQYW2 — find in Route 53 console.' },
  ],

  async _sigv4Request({ access_key_id, secret_access_key }, method, path, body, query = '') {
    const region = 'us-east-1';
    const service = 'route53';
    const host = 'route53.amazonaws.com';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = crypto.createHash('sha256').update(body || '').digest('hex');
    const canonHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-date';
    const canonRequest = [method, path, query, canonHeaders, signedHeaders, payloadHash].join('\n');

    const algo = 'AWS4-HMAC-SHA256';
    const credScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [algo, amzDate, credScope, crypto.createHash('sha256').update(canonRequest).digest('hex')].join('\n');

    const kDate    = crypto.createHmac('sha256', 'AWS4' + secret_access_key).update(dateStamp).digest();
    const kRegion  = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const sig      = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const auth = `${algo} Credential=${access_key_id}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
    return {
      url: `https://${host}${path}${query ? '?' + query : ''}`,
      headers: { 'Authorization': auth, 'x-amz-date': amzDate, 'Content-Type': 'text/xml' },
    };
  },

  async testCredentials(creds, config) {
    const path = config && config.hosted_zone_id
      ? `/2013-04-01/hostedzone/${config.hosted_zone_id}`
      : '/2013-04-01/hostedzone';
    const sig = await this._sigv4Request(creds, 'GET', path, '');
    const res = await safeFetch(sig.url, { headers: sig.headers }, withTimeout());
    if (!res.ok) throw new Error(`Route 53 ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'auth-ok' };
  },

  async listDomains(creds) {
    const sig = await this._sigv4Request(creds, 'GET', '/2013-04-01/hostedzone', '');
    const res = await safeFetch(sig.url, { headers: sig.headers }, withTimeout(15000, 1024 * 1024));
    if (!res.ok) throw new Error(`Route 53 ${res.status}`);
    const xml = await res.text();
    const out = [];
    const re = /<HostedZone>[\s\S]*?<Id>\/hostedzone\/([^<]+)<\/Id>[\s\S]*?<Name>([^<]+)<\/Name>/g;
    let m; while ((m = re.exec(xml))) out.push({ domain: m[2].replace(/\.$/, ''), zone_id: m[1] });
    return out;
  },

  _changeBody(action, fqdn, txtValue) {
    const escaped = txtValue.replace(/"/g, '\\"');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch><Changes><Change>
    <Action>${action}</Action>
    <ResourceRecordSet>
      <Name>${fqdn}</Name><Type>TXT</Type><TTL>3600</TTL>
      <ResourceRecords><ResourceRecord><Value>"${escaped}"</Value></ResourceRecord></ResourceRecords>
    </ResourceRecordSet>
  </Change></Changes></ChangeBatch>
</ChangeResourceRecordSetsRequest>`;
  },

  async enableWAB(creds, config, domain, txtValue) {
    const fqdn = `_wab.${domain}.`;
    const body = this._changeBody('UPSERT', fqdn, txtValue);
    const sig = await this._sigv4Request(creds, 'POST', `/2013-04-01/hostedzone/${config.hosted_zone_id}/rrset/`, body);
    const res = await safeFetch(sig.url, { method: 'POST', headers: sig.headers, body }, withTimeout());
    if (!res.ok) throw new Error(`Route 53 ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'upsert' };
  },

  async disableWAB(creds, config, domain) {
    const fqdn = `_wab.${domain}.`;
    // Need the existing TXT first to construct DELETE
    const path = `/2013-04-01/hostedzone/${config.hosted_zone_id}/rrset/`;
    const query = `name=${encodeURIComponent(fqdn)}&type=TXT&maxitems=1`;
    const sig0 = await this._sigv4Request(creds, 'GET', path, '', query);
    const r0 = await safeFetch(sig0.url, { headers: sig0.headers }, withTimeout());
    if (!r0.ok) throw new Error(`Route 53 ${r0.status}`);
    const xml = await r0.text();
    const m = /<ResourceRecordSet>([\s\S]*?<Name>_wab\.[\s\S]*?)<\/ResourceRecordSet>/i.exec(xml);
    if (!m) return { ok: true, detail: 'already-absent' };
    const valMatch = /<Value>"?([^<"]+)"?<\/Value>/.exec(m[1]);
    if (!valMatch) return { ok: true, detail: 'already-absent' };
    const body = this._changeBody('DELETE', fqdn, valMatch[1]);
    const sig = await this._sigv4Request(creds, 'POST', path, body);
    const res = await safeFetch(sig.url, { method: 'POST', headers: sig.headers, body }, withTimeout());
    if (!res.ok) throw new Error(`Route 53 ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'deleted' };
  },
};

/* ─────────────────────────── 6. cPanel ──────────────────────────────── */
// Credentials: { username, api_token } + Config: { server_url }

const cpanel = {
  type: 'cpanel',
  label: 'cPanel / WHM',
  credential_fields: [
    { key: 'username', label: 'cPanel Username', type: 'text', required: true },
    { key: 'api_token', label: 'API Token', type: 'password', required: true,
      help: 'Create at cPanel → Manage API Tokens.' },
  ],
  config_fields: [
    { key: 'server_url', label: 'cPanel Server URL', type: 'text', required: true,
      help: 'e.g. https://cpanel.example.com:2083 — must be HTTPS.' },
  ],

  _hdr({ username, api_token }) { return { Authorization: `cpanel ${username}:${api_token}` }; },

  _validateUrl(server_url) {
    if (!/^https:\/\//i.test(server_url)) throw new Error('cPanel server_url must be HTTPS');
    return server_url.replace(/\/+$/, '');
  },

  async testCredentials(creds, config) {
    const base = this._validateUrl(config.server_url);
    const url = `${base}/execute/DomainInfo/list_domains`;
    const res = await safeFetch(url, { headers: this._hdr(creds) }, withCpanelOpts());
    const j = await jsonOrThrow(res, 'cPanel');
    if (j.errors && j.errors.length) throw new Error('cPanel: ' + j.errors.join('; '));
    return { ok: true, detail: 'auth-ok' };
  },

  async listDomains(creds, config) {
    const base = this._validateUrl(config.server_url);
    const res = await safeFetch(`${base}/execute/DomainInfo/list_domains`, { headers: this._hdr(creds) }, withCpanelOpts());
    const j = await jsonOrThrow(res, 'cPanel');
    const data = j.data || {};
    const out = [];
    if (data.main_domain) out.push({ domain: data.main_domain, zone_id: data.main_domain });
    for (const d of data.addon_domains || []) out.push({ domain: d, zone_id: d });
    for (const d of data.parked_domains || []) out.push({ domain: d, zone_id: d });
    return out;
  },

  async enableWAB(creds, config, domain, txtValue) {
    const base = this._validateUrl(config.server_url);
    const url = `${base}/execute/ZoneEdit/add_zone_record?domain=${encodeURIComponent(domain)}&name=_wab&type=TXT&txtdata=${encodeURIComponent(txtValue)}&ttl=3600`;
    const res = await safeFetch(url, { headers: this._hdr(creds) }, withCpanelOpts());
    const j = await jsonOrThrow(res, 'cPanel');
    if (j.errors && j.errors.length) throw new Error('cPanel: ' + j.errors.join('; '));
    return { ok: true, detail: 'added' };
  },

  async disableWAB(creds, config, domain) {
    const base = this._validateUrl(config.server_url);
    const fetchUrl = `${base}/execute/ZoneEdit/fetchzone?domain=${encodeURIComponent(domain)}`;
    const fr = await safeFetch(fetchUrl, { headers: this._hdr(creds) }, withCpanelOpts());
    const fj = await jsonOrThrow(fr, 'cPanel');
    const records = (fj.data && fj.data.record) || [];
    const found = records.find(r => r.type === 'TXT' && (r.name === `_wab.${domain}.` || r.name === '_wab'));
    if (!found) return { ok: true, detail: 'already-absent' };
    const url = `${base}/execute/ZoneEdit/remove_zone_record?domain=${encodeURIComponent(domain)}&line=${found.line}`;
    const res = await safeFetch(url, { headers: this._hdr(creds) }, withCpanelOpts());
    const j = await jsonOrThrow(res, 'cPanel');
    if (j.errors && j.errors.length) throw new Error('cPanel: ' + j.errors.join('; '));
    return { ok: true, detail: 'removed' };
  },
};

/* ─────────────────────────── 7. Plesk ───────────────────────────────── */
// Credentials: { api_key | username+password } + Config: { server_url }

const plesk = {
  type: 'plesk',
  label: 'Plesk',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Plesk → Tools & Settings → REST API → Generate API Key.' },
  ],
  config_fields: [
    { key: 'server_url', label: 'Plesk Server URL', type: 'text', required: true,
      help: 'e.g. https://plesk.example.com:8443 — must be HTTPS.' },
  ],

  _validateUrl(server_url) {
    if (!/^https:\/\//i.test(server_url)) throw new Error('Plesk server_url must be HTTPS');
    return server_url.replace(/\/+$/, '');
  },

  _hdr({ api_key }) { return { 'X-API-Key': api_key, 'Content-Type': 'application/json' }; },

  async testCredentials(creds, config) {
    const base = this._validateUrl(config.server_url);
    const res = await safeFetch(`${base}/api/v2/server`, { headers: this._hdr(creds) }, withPleskOpts());
    if (!res.ok) throw new Error(`Plesk ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'auth-ok' };
  },

  async listDomains(creds, config) {
    const base = this._validateUrl(config.server_url);
    const res = await safeFetch(`${base}/api/v2/domains`, { headers: this._hdr(creds) }, withPleskOpts());
    const j = await jsonOrThrow(res, 'Plesk');
    return (j || []).map(d => ({ domain: d.name, zone_id: d.id, status: d.hosting_type }));
  },

  async _findRecordId(creds, base, domain) {
    const res = await safeFetch(`${base}/api/v2/dns/records?domain=${encodeURIComponent(domain)}`, { headers: this._hdr(creds) }, withPleskOpts());
    const j = await jsonOrThrow(res, 'Plesk');
    const found = (j || []).find(r => r.type === 'TXT' && (r.host === `_wab.${domain}.` || r.host === '_wab'));
    return found ? found.id : null;
  },

  async enableWAB(creds, config, domain, txtValue) {
    const base = this._validateUrl(config.server_url);
    const existingId = await this._findRecordId(creds, base, domain);
    if (existingId) {
      await safeFetch(`${base}/api/v2/dns/records/${existingId}`, { method: 'DELETE', headers: this._hdr(creds) }, withPleskOpts());
    }
    const res = await safeFetch(`${base}/api/v2/dns/records`, {
      method: 'POST', headers: this._hdr(creds),
      body: JSON.stringify({ domain, type: 'TXT', host: '_wab', value: txtValue, ttl: 3600 }),
    }, withPleskOpts());
    if (!res.ok) throw new Error(`Plesk ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: existingId ? 'replaced' : 'created' };
  },

  async disableWAB(creds, config, domain) {
    const base = this._validateUrl(config.server_url);
    const existingId = await this._findRecordId(creds, base, domain);
    if (!existingId) return { ok: true, detail: 'already-absent' };
    const res = await safeFetch(`${base}/api/v2/dns/records/${existingId}`, { method: 'DELETE', headers: this._hdr(creds) }, withPleskOpts());
    if (!res.ok) throw new Error(`Plesk ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return { ok: true, detail: 'deleted' };
  },
};

/* ─────────────────────────── 8. Namecheap ───────────────────────────── */
// Credentials: { api_user, api_key, client_ip }

const namecheap = {
  type: 'namecheap',
  label: 'Namecheap',
  credential_fields: [
    { key: 'api_user', label: 'API User', type: 'text', required: true },
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Enable API at https://ap.www.namecheap.com/settings/tools/apiaccess/' },
    { key: 'client_ip', label: 'Whitelisted IP', type: 'text', required: true,
      help: 'Server-side calls require IP allow-listing. Use this server\'s public IP.' },
  ],

  async _call(creds, command, params = {}) {
    const url = new URL('https://api.namecheap.com/xml.response');
    url.searchParams.set('ApiUser', creds.api_user);
    url.searchParams.set('UserName', creds.api_user);
    url.searchParams.set('ApiKey', creds.api_key);
    url.searchParams.set('ClientIp', creds.client_ip);
    url.searchParams.set('Command', command);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await safeFetch(url.toString(), {}, withTimeout(15000, 512 * 1024));
    const xml = await res.text();
    if (xml.includes('Status="ERROR"')) {
      const m = /<Error[^>]*>([^<]+)<\/Error>/.exec(xml);
      throw new Error('Namecheap: ' + (m ? m[1] : 'unknown error'));
    }
    return xml;
  },

  async testCredentials(creds) {
    await this._call(creds, 'namecheap.domains.getList', { PageSize: '10' });
    return { ok: true, detail: 'auth-ok' };
  },

  async listDomains(creds) {
    const xml = await this._call(creds, 'namecheap.domains.getList', { PageSize: '100' });
    const out = [];
    const re = /<Domain[^>]*Name="([^"]+)"[^>]*>/g;
    let m; while ((m = re.exec(xml))) out.push({ domain: m[1], zone_id: null });
    return out;
  },

  _splitDomain(domain) {
    const parts = domain.split('.');
    if (parts.length < 2) throw new Error('Invalid domain: ' + domain);
    return { sld: parts[0], tld: parts.slice(1).join('.') };
  },

  async _getHosts(creds, sld, tld) {
    const xml = await this._call(creds, 'namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
    const out = [];
    const re = /<host\s+([^/]+)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = {};
      const ar = /(\w+)="([^"]*)"/g;
      let am; while ((am = ar.exec(m[1]))) attrs[am[1]] = am[2];
      out.push({
        Name: attrs.Name, Type: attrs.Type, Address: attrs.Address,
        MXPref: attrs.MXPref || '10', TTL: attrs.TTL || '1800',
      });
    }
    return out;
  },

  async _setHosts(creds, sld, tld, hosts) {
    const params = { SLD: sld, TLD: tld };
    hosts.forEach((h, i) => {
      const n = i + 1;
      params[`HostName${n}`] = h.Name;
      params[`RecordType${n}`] = h.Type;
      params[`Address${n}`] = h.Address;
      params[`MXPref${n}`] = h.MXPref || '10';
      params[`TTL${n}`] = h.TTL || '1800';
    });
    await this._call(creds, 'namecheap.domains.dns.setHosts', params);
  },

  async enableWAB(creds, _config, domain, txtValue) {
    const { sld, tld } = this._splitDomain(domain);
    const existing = await this._getHosts(creds, sld, tld);
    const others = existing.filter(h => !(h.Type === 'TXT' && h.Name === '_wab'));
    const next = [...others, { Name: '_wab', Type: 'TXT', Address: txtValue, MXPref: '10', TTL: '1800' }];
    await this._setHosts(creds, sld, tld, next);
    return { ok: true, detail: `set ${next.length} hosts` };
  },

  async disableWAB(creds, _config, domain) {
    const { sld, tld } = this._splitDomain(domain);
    const existing = await this._getHosts(creds, sld, tld);
    const others = existing.filter(h => !(h.Type === 'TXT' && h.Name === '_wab'));
    if (others.length === existing.length) return { ok: true, detail: 'already-absent' };
    await this._setHosts(creds, sld, tld, others);
    return { ok: true, detail: 'cleared' };
  },
};

/* ─────────────────────────── registry ───────────────────────────────── */

const adapters = {
  cloudflare, route53, azure, gcp, cpanel, plesk, godaddy, namecheap,
};

function getAdapter(type) {
  const a = adapters[type];
  if (!a) throw new Error('Unknown provider type: ' + type);
  return a;
}

function listProviders() {
  return Object.values(adapters).map(a => ({
    type: a.type,
    label: a.label,
    credential_fields: a.credential_fields,
    config_fields: a.config_fields || [],
  }));
}

module.exports = { getAdapter, listProviders };
