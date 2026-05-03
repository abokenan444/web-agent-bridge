/**
 * WAB Safe Mode — Agent-side trust gate.
 *
 * Splits the web into Trusted (WAB + valid signature) vs Untrusted, and
 * gives the agent a single function to ask before any action:
 *     await safeMode.evaluate(domain) → { level, verdict, allow_execute,
 *                                          allow_read, reason }
 *
 * Trust levels:
 *   3 — DNS + Ed25519 signature valid + telemetry score ≥ 60   (full execute)
 *   2 — DNS + valid wab.json (no signature OR no telemetry)    (limited execute)
 *   1 — Resolves but no _wab record / score below threshold    (read-only)
 *   0 — Compliance verdict = deny / suspicious                 (block)
 *
 * Usage (Node):
 *   const { WABSafeMode } = require('web-agent-bridge/sdk');
 *   const safe = new WABSafeMode({ apiBase: 'https://webagentbridge.com' });
 *   const v = await safe.evaluate('example.com');
 *   if (v.allow_execute) await agent.execute(...);
 *   else if (v.allow_read) await agent.readOnly(...);
 *   else throw new Error('Blocked by Safe Mode: ' + v.reason);
 */

'use strict';

const DEFAULT_API = 'https://webagentbridge.com';

const POLICIES = {
  strict:     { require_dnssec: true,  require_signature: true,  min_score: 75 },
  standard:   { require_dnssec: false, require_signature: true,  min_score: 60 },
  permissive: { require_dnssec: false, require_signature: false, min_score: 40 },
};

class WABSafeMode {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiBase='https://webagentbridge.com']
   * @param {'strict'|'standard'|'permissive'} [opts.policy='standard']
   * @param {number} [opts.cacheTtlMs=60000]   — verdicts cached this long
   * @param {number} [opts.timeoutMs=8000]
   * @param {function} [opts.fetch]            — fetch impl (defaults to global fetch)
   */
  constructor(opts = {}) {
    this.apiBase   = (opts.apiBase || DEFAULT_API).replace(/\/+$/, '');
    this.policy    = POLICIES[opts.policy] ? opts.policy : 'standard';
    this.cacheTtl  = Number.isFinite(opts.cacheTtlMs) ? opts.cacheTtlMs : 60_000;
    this.timeoutMs = Number.isFinite(opts.timeoutMs)  ? opts.timeoutMs  : 8_000;
    this._fetch    = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    this._cache    = new Map(); // domain → { at, value }
    if (!this._fetch) {
      // Node ≤ 17 fallback
      try { this._fetch = require('node-fetch'); } catch { /* user must supply */ }
    }
  }

  /** Normalises a domain or URL to bare hostname. */
  static normalizeDomain(input) {
    if (!input || typeof input !== 'string') return null;
    let s = input.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s) ? s : null;
  }

  async _get(path) {
    if (!this._fetch) throw new Error('Safe Mode requires fetch (Node 18+ or pass opts.fetch)');
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const r = await this._fetch(this.apiBase + path, ctl ? { signal: ctl.signal } : {});
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
    finally { if (timer) clearTimeout(timer); }
  }

  /**
   * Evaluate a domain and produce a verdict the agent can act on.
   * @param {string} domain
   * @param {object} [opts]
   * @param {boolean} [opts.live=false] — force a live trust check (skip cache).
   * @returns {Promise<{
   *   domain: string, level: 0|1|2|3,
   *   verdict: 'allow'|'restrict'|'deny',
   *   allow_execute: boolean, allow_read: boolean,
   *   score: number, score_label: string,
   *   reason: string, reasons: Array,
   *   trust: object|null, score_detail: object|null,
   *   compliance: object|null,
   *   evaluated_at: string,
   * }>}
   */
  async evaluate(domain, opts = {}) {
    const d = WABSafeMode.normalizeDomain(domain);
    if (!d) {
      return this._verdict(domain, 0, 'deny', 0, 'unrated',
        'invalid_domain', [{ code: 'invalid_domain', severity: 'deny' }],
        null, null, null);
    }

    const cached = this._cache.get(d);
    if (!opts.live && cached && (Date.now() - cached.at) < this.cacheTtl) return cached.value;

    // Optionally trigger a live trust check first so compliance has fresh data.
    let trust = null;
    if (opts.live) {
      trust = await this._get(`/api/discovery/trust/${encodeURIComponent(d)}`);
    }

    const [score, compliance] = await Promise.all([
      this._get(`/api/discovery/score/${encodeURIComponent(d)}`),
      this._get(`/api/discovery/compliance/${encodeURIComponent(d)}?policy=${this.policy}`),
    ]);

    // Derive trust level
    let level = 1;
    let reasonCode = 'no_signal';
    if (compliance) {
      if (compliance.verdict === 'deny') { level = 0; reasonCode = 'compliance_deny'; }
      else if (compliance.verdict === 'restrict') { level = 1; reasonCode = 'compliance_restrict'; }
      else { // allow
        const sigRate = score?.signature_valid_rate ?? compliance.signature_valid_rate ?? 0;
        const sc = compliance.score ?? score?.score ?? 0;
        if (sigRate > 0.5 && sc >= 60) { level = 3; reasonCode = 'trusted_full'; }
        else { level = 2; reasonCode = 'trusted_limited'; }
      }
    } else {
      level = 1;
      reasonCode = 'no_compliance_record';
    }

    const verdict = compliance?.verdict || (level === 0 ? 'deny' : level >= 2 ? 'allow' : 'restrict');
    const value = this._verdict(
      d, level, verdict,
      compliance?.score ?? score?.score ?? 0,
      compliance?.score_label ?? score?.label ?? 'unrated',
      reasonCode,
      compliance?.reasons || [],
      trust, score, compliance,
    );

    this._cache.set(d, { at: Date.now(), value });
    return value;
  }

  _verdict(domain, level, verdict, score, label, reason, reasons, trust, scoreDetail, compliance) {
    const allow_execute = level >= 2 && verdict === 'allow';
    const allow_read    = level >= 1 && verdict !== 'deny';
    return {
      domain,
      level,
      verdict,
      allow_execute,
      allow_read,
      score,
      score_label: label,
      reason,
      reasons,
      trust,
      score_detail: scoreDetail,
      compliance,
      policy: this.policy,
      evaluated_at: new Date().toISOString(),
    };
  }

  /**
   * Wrap an async action so it only runs if Safe Mode allows execute on the
   * given domain. Throws WABSafeModeError otherwise.
   */
  async guardExecute(domain, action) {
    const v = await this.evaluate(domain);
    if (!v.allow_execute) {
      const err = new WABSafeModeError(
        `Safe Mode blocked execute on ${v.domain} (level ${v.level}, verdict ${v.verdict}, ${v.reason})`,
        v,
      );
      throw err;
    }
    return await action(v);
  }

  /** Read-only variant: throws only if level === 0. */
  async guardRead(domain, action) {
    const v = await this.evaluate(domain);
    if (!v.allow_read) {
      throw new WABSafeModeError(
        `Safe Mode blocked read on ${v.domain} (level ${v.level}, verdict ${v.verdict})`,
        v,
      );
    }
    return await action(v);
  }

  /** Picks the highest-trust domain from a candidate list. */
  async pickBest(domains) {
    const evals = await Promise.all(
      (domains || []).map((d) => this.evaluate(d).catch(() => null)),
    );
    const sorted = evals.filter(Boolean).sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return (b.score || 0) - (a.score || 0);
    });
    return sorted[0] || null;
  }

  clearCache(domain) {
    if (domain) this._cache.delete(WABSafeMode.normalizeDomain(domain));
    else this._cache.clear();
  }
}

class WABSafeModeError extends Error {
  constructor(message, verdict) {
    super(message);
    this.name = 'WABSafeModeError';
    this.code = 'WAB_SAFE_MODE_BLOCKED';
    this.verdict = verdict;
  }
}

module.exports = { WABSafeMode, WABSafeModeError, POLICIES };
