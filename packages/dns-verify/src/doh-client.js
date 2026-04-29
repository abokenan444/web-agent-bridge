/**
 * @wab/dns-verify — DoH client.
 *
 * Sends a DNS-over-HTTPS query (RFC 8484, application/dns-json variant)
 * and returns the parsed JSON answer. Supports multiple resolvers with
 * automatic failover and DNSSEC AD-flag capture (do=1).
 *
 * No external deps — uses Node 18+ global fetch.
 */

'use strict';

const DEFAULT_RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net/dns-query',
];

const RR_TYPE = { A: 1, CNAME: 5, TXT: 16, AAAA: 28, CAA: 257 };

/**
 * Query a DoH resolver.
 * @param {string} name  Fully-qualified domain to query.
 * @param {string} type  Record type, e.g. "TXT".
 * @param {object} [opts]
 * @param {string|string[]} [opts.resolver]   Override default resolver list.
 * @param {number}          [opts.timeoutMs]  Per-resolver timeout (default 5000).
 * @param {typeof fetch}    [opts.fetch]      Injected fetch (for tests).
 * @returns {Promise<{Status:number, AD:boolean, Answer?:Array, resolver:string, attempts:number}>}
 */
async function dohQuery(name, type, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('No global fetch available — Node 18+ required');
  }
  const list = Array.isArray(opts.resolver)
    ? opts.resolver
    : opts.resolver
      ? [opts.resolver]
      : DEFAULT_RESOLVERS;

  const timeoutMs = opts.timeoutMs || 5000;
  const errors = [];
  let attempts = 0;

  for (const base of list) {
    attempts++;
    const url =
      base +
      (base.includes('?') ? '&' : '?') +
      'name=' +
      encodeURIComponent(name) +
      '&type=' +
      encodeURIComponent(type) +
      '&do=1'; // request DNSSEC AD flag

    let timer;
    let aborter;
    try {
      aborter = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (aborter) timer = setTimeout(() => aborter.abort(), timeoutMs);
      const res = await f(url, {
        headers: { accept: 'application/dns-json' },
        signal: aborter ? aborter.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        errors.push({ resolver: base, code: 'HTTP_' + res.status });
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // 4xx other than throttling/timeout: bad query, don't retry
          throw new VerifyError('DOH_REQUEST_REJECTED', `DoH ${res.status} from ${base}`);
        }
        continue; // try next resolver
      }
      const data = await res.json();
      const want = RR_TYPE[type.toUpperCase()];
      if (Array.isArray(data.Answer) && want) {
        data.Answer = data.Answer.filter((a) => a.type === want);
      }
      return Object.assign({}, data, { resolver: base, attempts });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err instanceof VerifyError) throw err;
      errors.push({ resolver: base, error: err && err.message });
      continue;
    }
  }

  throw new VerifyError('DOH_UNREACHABLE', 'All DoH resolvers failed: ' + JSON.stringify(errors));
}

class VerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'VerifyError';
  }
}

module.exports = { dohQuery, DEFAULT_RESOLVERS, RR_TYPE, VerifyError };
