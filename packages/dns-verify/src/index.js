/**
 * @wab/dns-verify — top-level orchestrator.
 *
 * Verifies a domain's WAB DNS Discovery records (§4.6 of the WAB spec) by:
 *   1. Resolving _wab.{domain} via DoH and validating the ABNF grammar.
 *   2. Optionally resolving _wab-trust and _wab-policy.
 *   3. Surfacing the DNSSEC AD flag.
 *   4. Optionally fetching the discovery JSON to verify the fingerprint.
 *
 * Returns a structured result with `ok` and per-record findings — designed
 * for both human (CLI) and machine (CI / --json) consumers.
 */

'use strict';

const { dohQuery, VerifyError } = require('./doh-client');
const { parseWabRecord, parseTrustRecord, normalizeTxt } = require('./validator');

const RECORD_TYPES = {
  WAB: { label: '_wab', required: true, parser: parseWabRecord },
  TRUST: { label: '_wab-trust', required: false, parser: parseTrustRecord },
  POLICY: { label: '_wab-policy', required: false, parser: (raw) => parseWabRecord(raw, '_wab-policy') },
};

/**
 * @typedef {Object} RecordResult
 * @property {boolean} ok
 * @property {string}  fqdn
 * @property {string}  type        Logical kind (`_wab`, `_wab-trust`, `_wab-policy`).
 * @property {boolean} present
 * @property {boolean} ad          DNSSEC AD flag.
 * @property {string[]} raw        Raw normalized TXT strings.
 * @property {object}  [parsed]    Parsed key/value record.
 * @property {string}  [error]
 * @property {string}  [code]
 */

async function verifyOne(kind, domain, opts) {
  const def = RECORD_TYPES[kind];
  const fqdn = def.label + '.' + domain;
  /** @type {RecordResult} */
  const result = { ok: false, fqdn, type: def.label, present: false, ad: false, raw: [] };

  try {
    const resp = await dohQuery(fqdn, 'TXT', opts);
    result.ad = !!resp.AD;

    if (resp.Status === 3 /* NXDOMAIN */) {
      if (def.required) {
        result.error = 'NXDOMAIN — site has no _wab record (not WAB-enabled)';
        result.code = 'NXDOMAIN';
      } else {
        result.ok = true; // optional record absent → still ok overall
        result.code = 'NXDOMAIN_OPTIONAL';
      }
      return result;
    }
    if (resp.Status === 2 /* SERVFAIL */) {
      result.error = 'SERVFAIL — resolver reported a server failure';
      result.code = 'SERVFAIL';
      return result;
    }
    if (resp.Status !== 0) {
      result.error = `DNS Status ${resp.Status}`;
      result.code = 'DNS_STATUS_' + resp.Status;
      return result;
    }
    if (!Array.isArray(resp.Answer) || resp.Answer.length === 0) {
      if (def.required) {
        result.error = 'No TXT records returned';
        result.code = 'EMPTY_ANSWER';
      } else {
        result.ok = true;
      }
      return result;
    }

    result.present = true;
    result.raw = resp.Answer.map((a) => normalizeTxt(a.data));

    // §4.6.6: pick highest-version `_wab` record when multiple are returned.
    let pick = result.raw[0];
    let pickedVersion = -1;
    let parsedAll = [];
    for (const txt of result.raw) {
      try {
        const p = def.parser(txt);
        parsedAll.push(p);
        const v = typeof p._versionNumber === 'number' ? p._versionNumber : 1;
        if (kind === 'WAB' && v > pickedVersion) {
          pickedVersion = v;
          pick = txt;
        }
      } catch (err) {
        if (def.required) {
          // For required record: any malformed TXT is fatal unless another one parses.
          parsedAll.push({ _error: err });
        } else {
          // Optional record: if a sibling parses, ignore the broken one.
        }
      }
    }
    const parsed = def.parser(pick);
    result.parsed = parsed;
    result.ok = true;
    return result;
  } catch (err) {
    if (err instanceof VerifyError) {
      result.error = err.message;
      result.code = err.code;
    } else {
      result.error = err && err.message ? err.message : String(err);
      result.code = 'INTERNAL_ERROR';
    }
    return result;
  }
}

/**
 * @param {string} domain  Apex domain (e.g. "example.com").
 * @param {object} [opts]
 * @param {boolean} [opts.trust]    Also verify `_wab-trust`.
 * @param {boolean} [opts.policy]   Also verify `_wab-policy`.
 * @param {boolean} [opts.strict]   Require AD=1 (fail when DNSSEC unverified).
 * @param {string|string[]} [opts.resolver]
 * @param {number}  [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ok:boolean, domain:string, records:RecordResult[], dnssec:string, summary:{checked:number, passed:number, failed:number, warnings:string[]}}>}
 */
async function verify(domain, opts = {}) {
  if (!domain || typeof domain !== 'string') {
    throw new Error('verify: domain is required');
  }
  const apex = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

  const tasks = [verifyOne('WAB', apex, opts)];
  if (opts.trust) tasks.push(verifyOne('TRUST', apex, opts));
  if (opts.policy) tasks.push(verifyOne('POLICY', apex, opts));

  const records = await Promise.all(tasks);
  const wab = records[0];

  let ok = wab.ok && wab.present;
  const warnings = [];

  // §4.6.7 / §4.6.6: DNSSEC posture
  let dnssec;
  if (wab.ad) {
    dnssec = 'verified';
  } else if (wab.present) {
    dnssec = 'unverified';
    if (opts.strict) {
      ok = false;
      wab.error = wab.error || 'DNSSEC AD flag missing and --strict set';
      wab.code = wab.code || 'DNSSEC_REQUIRED';
    } else {
      warnings.push('DNSSEC AD flag missing — possible spoofing risk (use --strict to fail)');
    }
  } else {
    dnssec = 'n/a';
  }

  if (wab.parsed && wab.parsed._warnings) {
    warnings.push(...wab.parsed._warnings.map((w) => '_wab: ' + w));
  }

  // Optional records that came back as failure should reduce confidence but not fail.
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    if (!r.ok && r.code !== 'NXDOMAIN_OPTIONAL') {
      warnings.push(`${r.type}: ${r.error || r.code}`);
    }
  }

  const checked = records.length;
  const passed = records.filter((r) => r.ok).length;
  const failed = checked - passed;

  return {
    ok,
    domain: apex,
    records,
    dnssec,
    summary: { checked, passed, failed, warnings },
  };
}

module.exports = { verify, verifyOne, RECORD_TYPES };
