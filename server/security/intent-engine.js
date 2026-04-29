'use strict';

/**
 * WAB Safety Shield — Intent Analysis Engine (SPEC §8.12)
 *
 * Deterministic, dependency-free risk scorer that runs on every agent
 * action AFTER scope/dry-run/human-gate. The engine looks at the
 * COMPOSITION of the request (verb class, target environment, magnitude,
 * danger tokens in params, recent agent behaviour) and decides whether
 * to ALLOW, escalate to DRY_RUN, escalate to HUMAN_GATE, or BLOCK.
 *
 * Why a separate layer?
 *   - Scope tokens enforce *what the token is allowed to do*.
 *   - Dry-run forces a 2-step preview for known destructive verbs.
 *   - Human gate adds OOB approval for Pro+ deployments.
 *   - The Intent Engine catches panic patterns that pass all three:
 *       e.g. an agent that just got an error tries `delete-all + force`
 *       on a production database — score=critical → block, even if the
 *       token has admin scope.
 *
 * Scoring is bounded 0..100. The engine returns the highest-severity
 * required gate; the route is responsible for enforcing it.
 *
 * The engine is intentionally pure & synchronous so it can run on the
 * hot path without I/O. A tiny in-memory ring buffer tracks per-actor
 * velocity & burst patterns over the last 60 seconds.
 */

const DEFAULT_THRESHOLDS = Object.freeze({
  low: 30,        // 0-29   → allow
  medium: 70,     // 30-69  → require dry-run
  high: 90,       // 70-89  → require human gate
  // 90+         → block outright
});

const DANGER_TOKENS = [
  'force', 'skip-checks', 'skip_checks', 'no-backup', 'no_backup',
  'permanent', 'permanently', 'irrecoverable', 'cascade', 'recursive',
  'all', 'everything', 'wildcard', '--force', '--yes', 'confirm-destroy',
];

const DESTRUCTIVE_VERB_PATTERNS = [
  /^(delete|drop|destroy|wipe|purge|truncate|remove|erase|annihilate)/i,
  /^(uninstall|deprovision|terminate)/i,
];

const WRITE_VERB_PATTERNS = [
  /^(create|update|modify|patch|set|write|insert|put|post|publish|deploy|merge|push)/i,
];

const ENV_WEIGHTS = Object.freeze({
  production: 30,
  prod: 30,
  live: 30,
  staging: 10,
  preview: 5,
  development: 0,
  dev: 0,
  test: 0,
});

// ─── per-actor velocity tracker ──────────────────────────────────────
// actorKey -> [{ ts, action, env, score }]
const _history = new Map();
const HISTORY_WINDOW_MS = 60_000;
const HISTORY_MAX_PER_ACTOR = 50;

function _trim(arr) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  while (arr.length && arr[0].ts < cutoff) arr.shift();
  while (arr.length > HISTORY_MAX_PER_ACTOR) arr.shift();
}

function _record(actorKey, entry) {
  if (!actorKey) return;
  let arr = _history.get(actorKey);
  if (!arr) { arr = []; _history.set(actorKey, arr); }
  arr.push(entry);
  _trim(arr);
}

function _getHistory(actorKey) {
  if (!actorKey) return [];
  const arr = _history.get(actorKey);
  if (!arr) return [];
  _trim(arr);
  return arr;
}

// ─── helpers ─────────────────────────────────────────────────────────

function _classifyVerb(actionName) {
  if (!actionName) return 'unknown';
  if (DESTRUCTIVE_VERB_PATTERNS.some((re) => re.test(actionName))) return 'destructive';
  if (WRITE_VERB_PATTERNS.some((re) => re.test(actionName))) return 'write';
  return 'read';
}

function _envWeight(env) {
  return ENV_WEIGHTS[String(env || 'production').toLowerCase()] ?? 30;
}

function _flatStrings(value, out = [], depth = 0) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') { out.push(value.toLowerCase()); return out; }
  if (typeof value === 'number' || typeof value === 'boolean') { out.push(String(value).toLowerCase()); return out; }
  if (Array.isArray(value)) { for (const v of value) _flatStrings(v, out, depth + 1); return out; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(String(k).toLowerCase());
      _flatStrings(v, out, depth + 1);
    }
  }
  return out;
}

function _detectDangerTokens(params) {
  const flat = _flatStrings(params || {});
  const found = new Set();
  for (const s of flat) {
    if (s === 'true') continue;
    for (const t of DANGER_TOKENS) {
      if (s === t || s.includes(t)) { found.add(t); break; }
    }
  }
  return [...found];
}

function _magnitudeSignal(params) {
  const flat = _flatStrings(params || {});
  let score = 0;
  const reasons = [];
  // Wildcards
  for (const s of flat) {
    if (s === '*' || s === '%' || s === 'all' || s === 'everything') {
      score += 15; reasons.push(`wildcard:"${s}"`); break;
    }
  }
  // Large arrays anywhere → bulk operation
  function walk(v, depth = 0) {
    if (depth > 4 || v == null) return;
    if (Array.isArray(v)) {
      if (v.length >= 20) { score += 10; reasons.push(`large_array:${v.length}`); }
      for (const x of v) walk(x, depth + 1);
    } else if (typeof v === 'object') {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  }
  walk(params || {});
  return { score: Math.min(score, 30), reasons };
}

// ─── public API ──────────────────────────────────────────────────────

/**
 * Score a request. Returns:
 *   {
 *     score:     number (0..100, capped),
 *     level:     'low' | 'medium' | 'high' | 'critical',
 *     verb_class:'read'|'write'|'destructive'|'unknown',
 *     required_gate: null | 'dry_run' | 'human_gate' | 'block',
 *     reasons:   string[],
 *     rewrites:  Array<{from:string, to:string, reason:string}>,
 *   }
 *
 * Inputs:
 *   ctx = { actorId, sessionToken, siteId, actionName, params, env, tier }
 *   siteConfig may override thresholds via siteConfig.intentEngine = {
 *     thresholds:{ low,medium,high }, weights:{...},
 *     dangerTokens:[...], rewrites:{ from->to }
 *   }
 */
function score(ctx, siteConfig = {}) {
  const cfg = siteConfig.intentEngine || {};
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds || {}) };
  const reasons = [];
  const rewrites = [];
  let s = 0;

  const verb = _classifyVerb(ctx.actionName);
  if (verb === 'destructive') { s += 50; reasons.push('verb:destructive'); }
  else if (verb === 'write') { s += 10; reasons.push('verb:write'); }

  const env = ctx.env || siteConfig.environment || 'production';
  const ew = _envWeight(env);
  // Reads on production are not by themselves risky — only weight env for write/destructive.
  if (ew > 0 && verb !== 'read') { s += ew; reasons.push(`env:${env}(+${ew})`); }

  const danger = _detectDangerTokens(ctx.params);
  if (danger.length) { s += Math.min(30, danger.length * 15); reasons.push(`danger_tokens:${danger.join(',')}`); }

  const mag = _magnitudeSignal(ctx.params);
  if (mag.score) { s += mag.score; reasons.push(...mag.reasons); }

  // Burst / velocity: count similar destructive actions in window
  const actorKey = ctx.actorId || ctx.sessionToken || ctx.siteId || 'anon';
  const history = _getHistory(actorKey);
  const recentDestructive = history.filter((h) => h.verb === 'destructive').length;
  if (recentDestructive >= 3) { s += 15; reasons.push(`burst:${recentDestructive}_destructive_in_60s`); }
  const last = history[history.length - 1];
  if (last && Date.now() - last.ts < 1000 && verb !== 'read') {
    s += 10; reasons.push('velocity:<1s_since_last');
  }

  // Optional site rewrites: e.g. "delete-account" -> "deactivate-account"
  const rwMap = cfg.rewrites || {};
  if (rwMap[ctx.actionName]) {
    rewrites.push({
      from: ctx.actionName, to: rwMap[ctx.actionName],
      reason: 'site policy prefers a reversible alternative',
    });
  }

  // Heuristic safe-rewrite for destructive verbs touching well-known nouns.
  if (verb === 'destructive' && /account|user|invoice|order/i.test(ctx.actionName) && !rwMap[ctx.actionName]) {
    const safe = ctx.actionName.replace(/^(delete|destroy|wipe|purge|remove)/i, 'archive');
    if (safe !== ctx.actionName) rewrites.push({ from: ctx.actionName, to: safe, reason: 'archive-instead-of-delete fallback' });
  }

  // Cap and classify
  s = Math.min(100, Math.max(0, Math.round(s)));
  let level = 'low';
  let required_gate = null;
  if (s >= thresholds.high) { level = 'critical'; required_gate = 'block'; }
  else if (s >= thresholds.medium) { level = 'high'; required_gate = 'human_gate'; }
  else if (s >= thresholds.low) { level = 'medium'; required_gate = 'dry_run'; }

  // Record for next call
  _record(actorKey, { ts: Date.now(), action: ctx.actionName, env, verb, score: s });

  return { score: s, level, verb_class: verb, required_gate, reasons, rewrites };
}

function _resetForTests() {
  _history.clear();
}

module.exports = {
  score,
  _classifyVerb,
  _detectDangerTokens,
  _resetForTests,
  DEFAULT_THRESHOLDS,
  DANGER_TOKENS,
};
