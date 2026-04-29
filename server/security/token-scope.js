'use strict';

/**
 * WAB Safety Shield — Scoped Session Tokens
 *
 * Implements the runtime side of WAB SPEC §8.7 (Scoped Session Tokens).
 *
 * Threat model: a leaked or compromised session token issued for one
 * environment / one access level (e.g. `read` in `staging`) MUST NOT be
 * usable to perform a destructive operation in production. This is the
 * safety primitive that prevents PocketOS-class incidents where a single
 * unscoped token straddles staging and production with full write access.
 *
 * Design:
 *   - Scope is a triplet  (access, env, resources)
 *       access     : 'read' | 'write' | 'admin'        (hierarchy: admin > write > read)
 *       env        : 'sandbox' | 'staging' | 'production' | '*'  ('*' = any)
 *       resources  : array of glob patterns OR ['*']    (default ['*'])
 *   - A separate boolean axis: destructive=true is required for any command
 *     that matches the SPEC default destructive verb list OR the site's
 *     wab.json `destructiveActions` array. `read` scope NEVER allows
 *     destructive, regardless of environment. `admin` always does.
 *   - Scopes can only be NARROWED, never widened. When a token issuer is
 *     itself scoped (delegation), the issued scope is the intersection of
 *     parent and requested.
 *
 * Error codes (returned to clients):
 *   INVALID_SCOPE              — scope string/object did not parse
 *   INSUFFICIENT_SCOPE         — token doesn't satisfy required access level
 *   ENV_MISMATCH               — token env doesn't include requested env
 *   READONLY_VIOLATION         — read-scope token tried to perform a write
 *   DESTRUCTIVE_REQUIRES_WRITE — token cannot perform destructive ops
 *   RESOURCE_OUT_OF_SCOPE      — resource glob doesn't include the target
 *
 * This module is intentionally pure (no DB, no Express deps) so it can be
 * unit-tested in isolation.
 */

// ─── Constants ───────────────────────────────────────────────────────

const ACCESS_LEVELS = ['read', 'write', 'admin'];
const ENVIRONMENTS = ['sandbox', 'staging', 'production'];
const ANY_ENV = '*';
const ANY_RESOURCE = '*';

// SPEC §8.7.3 — default destructive verb list (lower-case). Sites may
// extend this via wab.json `destructiveActions: [...]` and may suppress
// individual verbs via `nonDestructiveActions: [...]`.
const DEFAULT_DESTRUCTIVE_VERBS = Object.freeze([
  'delete', 'destroy', 'drop', 'truncate', 'purge', 'wipe', 'erase',
  'remove', 'unlink', 'rm', 'rmdir',
  'reset', 'reinit', 'reformat', 'format',
  'shutdown', 'terminate', 'kill',
  'revoke', 'disable', 'deactivate',
  'volume-delete', 'volumedelete', 'db-drop', 'database-drop',
]);

const DESTRUCTIVE_VERBS_SET = new Set(DEFAULT_DESTRUCTIVE_VERBS);

// ─── Aliases (legacy / human-friendly inputs) ────────────────────────

const ACCESS_ALIASES = {
  readonly: 'read',
  ro: 'read',
  read: 'read',
  rw: 'write',
  write: 'write',
  full: 'admin',
  admin: 'admin',
};

const ENV_ALIASES = {
  prod: 'production',
  production: 'production',
  live: 'production',
  staging: 'staging',
  stage: 'staging',
  test: 'sandbox',
  sandbox: 'sandbox',
  dev: 'sandbox',
  development: 'sandbox',
};

// ─── Errors ──────────────────────────────────────────────────────────

class ScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
  }
}

// ─── Parsing & canonicalisation ──────────────────────────────────────

/**
 * Parse arbitrary scope input into a canonical object.
 *
 * Accepts:
 *   - undefined / null            → admin/* (legacy unscoped tokens)
 *   - string  "readonly"          → { access:'read', env:['*'], resources:['*'] }
 *   - string  "read:staging"      → { access:'read', env:['staging'], resources:['*'] }
 *   - string  "write:staging,prod"→ { access:'write', env:['staging','production'], resources:['*'] }
 *   - string  "read:*:cart.*"     → { access:'read', env:['*'], resources:['cart.*'] }
 *   - object  { access, env, resources }
 *
 * Returns canonical: { access, envs:Set<string>|null, resources:string[],
 *                      legacyUnscoped:bool }
 *
 * envs === null  ⇨  any environment ('*')
 *
 * Throws ScopeError('INVALID_SCOPE') on malformed input.
 */
function parseScope(input) {
  // Legacy: no scope provided. Pre-§8.7 behaviour preserved for backward compat.
  if (input == null || input === '' || input === '*') {
    return {
      access: 'admin',
      envs: null,
      resources: ['*'],
      legacyUnscoped: true,
    };
  }

  let access;
  let envParts;
  let resources;

  if (typeof input === 'string') {
    const segments = input.split(':').map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) throw new ScopeError('INVALID_SCOPE', 'empty scope string');
    access = _normalizeAccess(segments[0]);
    envParts = segments[1] ? segments[1].split(',').map((s) => s.trim()) : ['*'];
    resources = segments[2] ? segments[2].split(',').map((s) => s.trim()) : ['*'];
  } else if (typeof input === 'object') {
    access = _normalizeAccess(input.access || input.level || 'read');
    const rawEnv = input.env != null ? input.env : (input.environment != null ? input.environment : '*');
    envParts = Array.isArray(rawEnv) ? rawEnv : String(rawEnv).split(',');
    envParts = envParts.map((s) => String(s).trim()).filter(Boolean);
    if (envParts.length === 0) envParts = ['*'];
    const rawRes = input.resources != null ? input.resources : '*';
    resources = Array.isArray(rawRes) ? rawRes : [String(rawRes)];
    resources = resources.map((s) => String(s).trim()).filter(Boolean);
    if (resources.length === 0) resources = ['*'];
  } else {
    throw new ScopeError('INVALID_SCOPE', `unsupported scope input type: ${typeof input}`);
  }

  // Resolve envs.
  let envs;
  if (envParts.includes('*') || envParts.includes(ANY_ENV)) {
    envs = null;
  } else {
    envs = new Set();
    for (const e of envParts) {
      const norm = ENV_ALIASES[e.toLowerCase()];
      if (!norm) throw new ScopeError('INVALID_SCOPE', `unknown environment "${e}"`);
      envs.add(norm);
    }
    if (envs.size === 0) envs = null;
  }

  // Validate resource patterns: limit to ASCII-safe glob, no spaces, ≤256 chars.
  for (const r of resources) {
    if (r.length > 256 || /[\s\x00-\x1f]/.test(r)) {
      throw new ScopeError('INVALID_SCOPE', `invalid resource pattern "${r}"`);
    }
  }

  return { access, envs, resources, legacyUnscoped: false };
}

function _normalizeAccess(raw) {
  const a = ACCESS_ALIASES[String(raw).toLowerCase()];
  if (!a) throw new ScopeError('INVALID_SCOPE', `unknown access level "${raw}"`);
  return a;
}

/** Stable string form for logging / token serialisation. */
function formatScope(scope) {
  if (!scope) return '*';
  if (scope.legacyUnscoped) return '*';
  const env = scope.envs == null ? '*' : Array.from(scope.envs).sort().join(',');
  const res = scope.resources.join(',');
  return `${scope.access}:${env}:${res}`;
}

// ─── Hierarchy & intersection ────────────────────────────────────────

function _accessRank(a) {
  return ACCESS_LEVELS.indexOf(a);
}

/**
 * Return the most restrictive scope that satisfies BOTH parent and child.
 * Used when an issuer (already scoped) delegates a narrower scope to a
 * sub-token — the result must never exceed the parent's authority.
 *
 * Throws ScopeError('INSUFFICIENT_SCOPE') if child requests more than parent.
 */
function intersectScopes(parent, child) {
  const p = _ensureScope(parent);
  const c = _ensureScope(child);

  // Access: must be ≤ parent.
  if (_accessRank(c.access) > _accessRank(p.access)) {
    throw new ScopeError('INSUFFICIENT_SCOPE',
      `requested access "${c.access}" exceeds parent "${p.access}"`);
  }

  // Envs.
  let envs;
  if (p.envs == null) {
    envs = c.envs == null ? null : new Set(c.envs);
  } else if (c.envs == null) {
    envs = new Set(p.envs);
  } else {
    envs = new Set([...c.envs].filter((e) => p.envs.has(e)));
    if (envs.size === 0) {
      throw new ScopeError('ENV_MISMATCH', 'requested environments not allowed by parent');
    }
  }

  // Resources: child must be a subset (or '*' which inherits parent).
  let resources;
  if (c.resources.length === 1 && c.resources[0] === '*') {
    resources = [...p.resources];
  } else if (p.resources.length === 1 && p.resources[0] === '*') {
    resources = [...c.resources];
  } else {
    // Each child pattern must be covered by at least one parent pattern.
    for (const cp of c.resources) {
      const ok = p.resources.some((pp) => _resourceCovers(pp, cp));
      if (!ok) {
        throw new ScopeError('INSUFFICIENT_SCOPE',
          `requested resource "${cp}" exceeds parent`);
      }
    }
    resources = [...c.resources];
  }

  return { access: c.access, envs, resources, legacyUnscoped: false };
}

function _resourceCovers(parentPattern, childPattern) {
  // Conservative: only consider trailing-* globs and exact equality.
  if (parentPattern === '*' || parentPattern === childPattern) return true;
  if (parentPattern.endsWith('.*') || parentPattern.endsWith('/*')) {
    const prefix = parentPattern.slice(0, -1);
    return childPattern === prefix.slice(0, -1) || childPattern.startsWith(prefix);
  }
  return false;
}

function _ensureScope(s) {
  return s && typeof s === 'object' && 'access' in s ? s : parseScope(s);
}

// ─── Destructive verb classification ─────────────────────────────────

/**
 * Decide whether `actionName` (within `siteConfig`) is destructive.
 *
 * Order:
 *   1. siteConfig.nonDestructiveActions[]  → forces non-destructive (override)
 *   2. siteConfig.destructiveActions[]     → forces destructive
 *   3. SPEC default destructive verb list  → fallback
 */
function isDestructiveAction(actionName, siteConfig = {}) {
  if (!actionName) return false;
  const raw = String(actionName);
  // Insert a separator at camelCase boundaries BEFORE lowercasing so we can
  // catch forms like "deleteVolume", "dropTable", "purgeBackups".
  const camelExpanded = raw.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const lower = camelExpanded;

  const nonD = Array.isArray(siteConfig.nonDestructiveActions)
    ? siteConfig.nonDestructiveActions.map((s) => String(s).toLowerCase())
    : [];
  if (nonD.includes(raw.toLowerCase()) || nonD.includes(lower)) return false;

  const extra = Array.isArray(siteConfig.destructiveActions)
    ? siteConfig.destructiveActions.map((s) => String(s).toLowerCase())
    : [];
  if (extra.includes(raw.toLowerCase()) || extra.includes(lower)) return true;

  // Token-split match against the camelCase-expanded form.
  const tokens = lower.split(/[\s.\-_/:]+/).filter(Boolean);
  for (const t of tokens) {
    if (DESTRUCTIVE_VERBS_SET.has(t)) return true;
    if (extra.includes(t)) return true;
  }
  return false;
}

// ─── Authorisation decision ──────────────────────────────────────────

/**
 * The single authoritative authorisation check.
 *
 * @param {object} scope    Canonical scope (from parseScope).
 * @param {object} command  { name, env, resource, action_kind?, destructive? }
 *                          - name        : action identifier (e.g. 'delete')
 *                          - env         : 'production' | 'staging' | 'sandbox'
 *                          - resource    : optional resource id (e.g. 'orders.cart')
 *                          - action_kind : 'read' | 'write' | 'admin'
 *                                          (defaults: 'admin' if destructive,
 *                                           'write' if name not GET-like, else 'read')
 *                          - destructive : boolean override (otherwise inferred
 *                                          via isDestructiveAction + siteConfig)
 * @param {object} siteConfig parsed wab.json
 *
 * @returns {{allowed: true} | {allowed: false, code: string, reason: string}}
 */
function authorize(scope, command, siteConfig = {}) {
  const sc = _ensureScope(scope);
  const cmd = command || {};
  const env = cmd.env ? ENV_ALIASES[String(cmd.env).toLowerCase()] || cmd.env : null;

  // 1. Environment match.
  if (sc.envs != null && env && !sc.envs.has(env)) {
    return {
      allowed: false,
      code: 'ENV_MISMATCH',
      reason: `token does not include environment "${env}" (allowed: ${[...sc.envs].join(',')})`,
    };
  }

  // 2. Destructive flag.
  const destructive = cmd.destructive === true ||
    isDestructiveAction(cmd.name, siteConfig);

  if (destructive) {
    if (sc.access === 'read') {
      return {
        allowed: false,
        code: 'DESTRUCTIVE_REQUIRES_WRITE',
        reason: `destructive action "${cmd.name}" cannot be performed by a read-scope token`,
      };
    }
    // write and admin both pass the destructive gate; site policy may still
    // require admin via an explicit action_kind hint below.
  }

  // 3. Access level.
  const requiredAccess = _requiredAccessForCommand(cmd, destructive);
  if (_accessRank(sc.access) < _accessRank(requiredAccess)) {
    const code = (sc.access === 'read' && requiredAccess === 'write')
      ? 'READONLY_VIOLATION'
      : 'INSUFFICIENT_SCOPE';
    return {
      allowed: false,
      code,
      reason: `command requires "${requiredAccess}" but token has "${sc.access}"`,
    };
  }

  // 4. Resource glob.
  if (cmd.resource && !_resourceMatchesAny(cmd.resource, sc.resources)) {
    return {
      allowed: false,
      code: 'RESOURCE_OUT_OF_SCOPE',
      reason: `resource "${cmd.resource}" not in token scope`,
    };
  }

  return { allowed: true };
}

function _requiredAccessForCommand(cmd, destructive) {
  if (cmd.action_kind && ACCESS_LEVELS.includes(cmd.action_kind)) return cmd.action_kind;
  if (destructive) return 'write';
  const READ_ONLY_PATTERNS = /^(read|get|list|search|find|view|page-info|ping|discover|actions)/i;
  if (cmd.name && READ_ONLY_PATTERNS.test(String(cmd.name))) return 'read';
  return 'write';
}

function _resourceMatchesAny(target, patterns) {
  for (const p of patterns) {
    if (p === '*' || p === target) return true;
    if (p.endsWith('.*') || p.endsWith('/*')) {
      const prefix = p.slice(0, -1);
      if (target === prefix.slice(0, -1) || target.startsWith(prefix)) return true;
    }
  }
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────

module.exports = {
  // parsing
  parseScope,
  formatScope,
  intersectScopes,
  // policy
  authorize,
  isDestructiveAction,
  // diagnostics / introspection
  ScopeError,
  ACCESS_LEVELS,
  ENVIRONMENTS,
  DEFAULT_DESTRUCTIVE_VERBS,
};
