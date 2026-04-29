'use strict';

/**
 * Scoped Session Tokens — comprehensive test suite for the Safety Shield.
 *
 * Covers: parsing, formatting, hierarchy & intersection (delegation),
 * destructive-verb classification (default list + wab.json overrides),
 * end-to-end authorisation matrix, and HTTP integration via supertest.
 *
 * Goal: lock the WAB SPEC §8.9 reference behaviour against regressions.
 */

const request = require('supertest');
const ts = require('../server/security/token-scope');

const {
  parseScope,
  formatScope,
  intersectScopes,
  authorize,
  isDestructiveAction,
  ScopeError,
  DEFAULT_DESTRUCTIVE_VERBS,
} = ts;

// ════════════════════════════════════════════════════════════════════
// 1. Scope parsing
// ════════════════════════════════════════════════════════════════════

describe('token-scope: parseScope', () => {
  test('null/undefined/"" → legacy unscoped admin/*', () => {
    for (const v of [null, undefined, '', '*']) {
      const s = parseScope(v);
      expect(s.access).toBe('admin');
      expect(s.envs).toBeNull();
      expect(s.resources).toEqual(['*']);
      expect(s.legacyUnscoped).toBe(true);
    }
  });

  test('simple access string', () => {
    const s = parseScope('read');
    expect(s.access).toBe('read');
    expect(s.envs).toBeNull();
    expect(s.resources).toEqual(['*']);
    expect(s.legacyUnscoped).toBe(false);
  });

  test('access aliases: readonly/ro → read', () => {
    expect(parseScope('readonly').access).toBe('read');
    expect(parseScope('ro').access).toBe('read');
    expect(parseScope('RO').access).toBe('read');
  });

  test('access aliases: rw → write, full → admin', () => {
    expect(parseScope('rw').access).toBe('write');
    expect(parseScope('full').access).toBe('admin');
  });

  test('compact string with env: read:staging', () => {
    const s = parseScope('read:staging');
    expect(s.access).toBe('read');
    expect([...s.envs]).toEqual(['staging']);
  });

  test('compact string with multi-env: write:staging,prod', () => {
    const s = parseScope('write:staging,prod');
    expect(s.access).toBe('write');
    expect([...s.envs].sort()).toEqual(['production', 'staging']);
  });

  test('compact string with resources: read:*:cart.*,orders.*', () => {
    const s = parseScope('read:*:cart.*,orders.*');
    expect(s.envs).toBeNull();
    expect(s.resources).toEqual(['cart.*', 'orders.*']);
  });

  test('object form { access, env, resources }', () => {
    const s = parseScope({ access: 'write', env: ['staging'], resources: ['orders.*'] });
    expect(s.access).toBe('write');
    expect([...s.envs]).toEqual(['staging']);
    expect(s.resources).toEqual(['orders.*']);
  });

  test('object form with env as comma string', () => {
    const s = parseScope({ access: 'read', env: 'staging,production' });
    expect([...s.envs].sort()).toEqual(['production', 'staging']);
  });

  test('object form with environment alias key', () => {
    const s = parseScope({ access: 'read', environment: 'live' });
    expect([...s.envs]).toEqual(['production']);
  });

  test('rejects unknown access level', () => {
    expect(() => parseScope('superuser')).toThrow(ScopeError);
    try { parseScope('superuser'); } catch (e) { expect(e.code).toBe('INVALID_SCOPE'); }
  });

  test('rejects unknown environment', () => {
    expect(() => parseScope('read:mainnet')).toThrow(ScopeError);
  });

  test('rejects non-object/non-string', () => {
    expect(() => parseScope(42)).toThrow(ScopeError);
    expect(() => parseScope(true)).toThrow(ScopeError);
  });

  test('rejects invalid resource pattern (whitespace)', () => {
    expect(() => parseScope({ access: 'read', resources: ['bad pattern'] })).toThrow(ScopeError);
  });

  test('rejects oversized resource pattern', () => {
    const big = 'a'.repeat(300);
    expect(() => parseScope({ access: 'read', resources: [big] })).toThrow(ScopeError);
  });

  test('formatScope is stable & sorted', () => {
    const s = parseScope('write:prod,staging:orders.*');
    expect(formatScope(s)).toBe('write:production,staging:orders.*');
  });

  test('formatScope of unscoped → "*"', () => {
    expect(formatScope(null)).toBe('*');
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Destructive-verb classification
// ════════════════════════════════════════════════════════════════════

describe('token-scope: isDestructiveAction', () => {
  test('default verbs are recognised', () => {
    for (const v of DEFAULT_DESTRUCTIVE_VERBS) {
      expect(isDestructiveAction(v)).toBe(true);
    }
  });

  test('default verbs match within compound names', () => {
    expect(isDestructiveAction('delete-account')).toBe(true);
    expect(isDestructiveAction('volume.purge')).toBe(true);
    expect(isDestructiveAction('drop_table')).toBe(true);
    expect(isDestructiveAction('USER.WIPE')).toBe(true);
  });

  test('non-destructive verbs are not flagged', () => {
    for (const v of ['read', 'list', 'click', 'navigate', 'addItem', 'login']) {
      expect(isDestructiveAction(v)).toBe(false);
    }
  });

  test('site config can EXTEND with destructiveActions', () => {
    expect(isDestructiveAction('finalize-invoice', { destructiveActions: ['finalize-invoice'] })).toBe(true);
  });

  test('site config can SUPPRESS with nonDestructiveActions', () => {
    // "delete-draft" matches the default "delete" but the site says it's safe.
    expect(isDestructiveAction('delete-draft', { nonDestructiveActions: ['delete-draft'] })).toBe(false);
  });

  test('nonDestructive override beats explicit destructive (most permissive declarative)', () => {
    expect(isDestructiveAction('delete', {
      destructiveActions: ['delete'],
      nonDestructiveActions: ['delete'],
    })).toBe(false);
  });

  test('null/empty action → not destructive', () => {
    expect(isDestructiveAction(null)).toBe(false);
    expect(isDestructiveAction('')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Authorisation matrix
// ════════════════════════════════════════════════════════════════════

describe('token-scope: authorize — environment gate', () => {
  test('staging-only token + production action → ENV_MISMATCH', () => {
    const scope = parseScope('write:staging');
    const d = authorize(scope, { name: 'updateOrder', env: 'production' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('ENV_MISMATCH');
    expect(d.reason).toMatch(/production/);
  });

  test('multi-env token includes both → allowed', () => {
    const scope = parseScope('write:staging,production');
    expect(authorize(scope, { name: 'updateOrder', env: 'staging' }).allowed).toBe(true);
    expect(authorize(scope, { name: 'updateOrder', env: 'production' }).allowed).toBe(true);
  });

  test('wildcard env token allows any', () => {
    const scope = parseScope('write');
    for (const env of ['sandbox', 'staging', 'production']) {
      expect(authorize(scope, { name: 'updateOrder', env }).allowed).toBe(true);
    }
  });

  test('env alias is normalised: "live" maps to production', () => {
    const scope = parseScope('write:production');
    expect(authorize(scope, { name: 'x', env: 'live' }).allowed).toBe(true);
  });
});

describe('token-scope: authorize — destructive gate', () => {
  test('read scope + destructive verb → DESTRUCTIVE_REQUIRES_WRITE', () => {
    const scope = parseScope('read');
    const d = authorize(scope, { name: 'deleteVolume', env: 'production' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });

  test('write scope + destructive verb → allowed', () => {
    const scope = parseScope('write:production');
    expect(authorize(scope, { name: 'deleteVolume', env: 'production' }).allowed).toBe(true);
  });

  test('admin scope + destructive verb → allowed', () => {
    const scope = parseScope('admin');
    expect(authorize(scope, { name: 'drop_database', env: 'production' }).allowed).toBe(true);
  });

  test('read scope + destructive verb DENIED even in staging', () => {
    const scope = parseScope('read:staging');
    const d = authorize(scope, { name: 'truncate-orders', env: 'staging' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });

  test('explicit destructive=true override even for non-listed verb', () => {
    const scope = parseScope('read');
    const d = authorize(scope, { name: 'doStuff', env: 'production', destructive: true });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });

  test('site nonDestructiveActions removes the destructive flag (still subject to access)', () => {
    const scope = parseScope('read');
    const cfg = { nonDestructiveActions: ['delete-draft'] };
    // Removing the destructive flag does NOT also bypass the access-level
    // gate: "delete-draft" is still a write-like action by default. The site
    // owner can grant read scope by also passing action_kind explicitly.
    const dWrite = authorize(scope, { name: 'delete-draft', env: 'production' }, cfg);
    expect(dWrite.allowed).toBe(false);
    expect(dWrite.code).toBe('READONLY_VIOLATION');

    const dRead = authorize(scope, { name: 'delete-draft', action_kind: 'read', env: 'production' }, cfg);
    expect(dRead.allowed).toBe(true);
  });

  test('site destructiveActions extends list — read scope blocked', () => {
    const scope = parseScope('read');
    const cfg = { destructiveActions: ['finalize-invoice'] };
    const d = authorize(scope, { name: 'finalize-invoice', env: 'production' }, cfg);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });
});

describe('token-scope: authorize — access level gate', () => {
  test('read scope on read-like action → allowed', () => {
    const scope = parseScope('read');
    expect(authorize(scope, { name: 'list-orders', env: 'production' }).allowed).toBe(true);
    expect(authorize(scope, { name: 'getProfile', env: 'production' }).allowed).toBe(true);
    expect(authorize(scope, { name: 'searchProducts', env: 'production' }).allowed).toBe(true);
  });

  test('read scope on write-like action → READONLY_VIOLATION', () => {
    const scope = parseScope('read');
    const d = authorize(scope, { name: 'updateProfile', env: 'production' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('READONLY_VIOLATION');
  });

  test('write scope on read action → allowed (hierarchy)', () => {
    const scope = parseScope('write');
    expect(authorize(scope, { name: 'list-orders', env: 'production' }).allowed).toBe(true);
  });

  test('explicit action_kind overrides name heuristic', () => {
    const scope = parseScope('read');
    // Name looks read-like but action_kind says write.
    const d = authorize(scope, { name: 'list-orders', action_kind: 'write', env: 'production' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('READONLY_VIOLATION');
  });

  test('admin required → write scope denied with INSUFFICIENT_SCOPE', () => {
    const scope = parseScope('write');
    const d = authorize(scope, { name: 'config', action_kind: 'admin', env: 'production' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('token-scope: authorize — resource glob gate', () => {
  test('exact resource match', () => {
    const scope = parseScope({ access: 'write', env: '*', resources: ['orders/cart'] });
    expect(authorize(scope, { name: 'update', env: 'production', resource: 'orders/cart' }).allowed).toBe(true);
  });

  test('glob match: orders.*', () => {
    const scope = parseScope({ access: 'write', resources: ['orders.*'] });
    expect(authorize(scope, { name: 'update', env: 'production', resource: 'orders.cart' }).allowed).toBe(true);
    expect(authorize(scope, { name: 'update', env: 'production', resource: 'orders.history' }).allowed).toBe(true);
  });

  test('out-of-scope resource → RESOURCE_OUT_OF_SCOPE', () => {
    const scope = parseScope({ access: 'write', resources: ['orders.*'] });
    const d = authorize(scope, { name: 'update', env: 'production', resource: 'users.delete' });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('RESOURCE_OUT_OF_SCOPE');
  });

  test('wildcard resource allows anything', () => {
    const scope = parseScope({ access: 'write', resources: ['*'] });
    expect(authorize(scope, { name: 'update', env: 'production', resource: 'whatever' }).allowed).toBe(true);
  });
});

describe('token-scope: authorize — legacy unscoped backward-compat', () => {
  test('null scope behaves as admin/* (legacy)', () => {
    const d = authorize(null, { name: 'deleteVolume', env: 'production' });
    expect(d.allowed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Delegation (intersection)
// ════════════════════════════════════════════════════════════════════

describe('token-scope: intersectScopes', () => {
  test('child stricter than parent on access → ok, returns child', () => {
    const parent = parseScope('admin:production');
    const child = parseScope('read:production');
    const r = intersectScopes(parent, child);
    expect(r.access).toBe('read');
    expect([...r.envs]).toEqual(['production']);
  });

  test('child wider than parent on access → INSUFFICIENT_SCOPE', () => {
    const parent = parseScope('read:production');
    const child = parseScope('admin:production');
    expect(() => intersectScopes(parent, child)).toThrow(ScopeError);
    try { intersectScopes(parent, child); } catch (e) { expect(e.code).toBe('INSUFFICIENT_SCOPE'); }
  });

  test('child env outside parent env → ENV_MISMATCH', () => {
    const parent = parseScope('write:staging');
    const child = parseScope('write:production');
    expect(() => intersectScopes(parent, child)).toThrow(ScopeError);
    try { intersectScopes(parent, child); } catch (e) { expect(e.code).toBe('ENV_MISMATCH'); }
  });

  test('parent env=*  child env=staging → returns staging', () => {
    const parent = parseScope('write');
    const child = parseScope('write:staging');
    const r = intersectScopes(parent, child);
    expect([...r.envs]).toEqual(['staging']);
  });

  test('parent env=staging  child env=* → inherits staging', () => {
    const parent = parseScope('write:staging');
    const child = parseScope('write');
    const r = intersectScopes(parent, child);
    expect([...r.envs]).toEqual(['staging']);
  });

  test('child resource not covered by parent → INSUFFICIENT_SCOPE', () => {
    const parent = parseScope({ access: 'write', resources: ['orders.*'] });
    const child = parseScope({ access: 'write', resources: ['users.*'] });
    expect(() => intersectScopes(parent, child)).toThrow(ScopeError);
  });

  test('child resource subset of parent glob → ok', () => {
    const parent = parseScope({ access: 'write', resources: ['orders.*'] });
    const child = parseScope({ access: 'write', resources: ['orders.cart'] });
    const r = intersectScopes(parent, child);
    expect(r.resources).toEqual(['orders.cart']);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. HTTP integration (supertest against the live Express app)
// ════════════════════════════════════════════════════════════════════

describe('Scoped tokens over HTTP — /api/wab/authenticate + /api/wab/actions', () => {
  let app;
  let siteId;
  let apiKey;
  const { db } = require('../server/models/db');

  beforeAll(() => {
    // The server module starts background timers; this is fine for jest with --forceExit.
    app = require('../server/index');

    // Seed a test user (required by FK) + site with api_key & permissive config.
    const id = 'scope-test-site-' + Date.now();
    const userId = 'scope-test-user-' + Date.now();
    apiKey = 'wab_test_' + require('crypto').randomBytes(8).toString('hex');
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password, name, created_at)
      VALUES (?, ?, 'x', 'scope-test-user', datetime('now'))
    `).run(userId, `${userId}@example.test`);
    db.prepare(`
      INSERT INTO sites (id, user_id, domain, name, license_key, api_key, tier, active, config)
      VALUES (?, ?, ?, ?, ?, ?, 'free', 1, ?)
    `).run(
      id,
      userId,
      'scope-test.example',
      'Scope Test Site',
      'test-license-' + id,
      apiKey,
      JSON.stringify({
        environment: 'production',
        agentPermissions: {
          click: true, fillForms: true, scroll: true, navigate: true,
          apiAccess: true, readContent: true, extractData: true,
          delete: true, deleteVolume: true,
        },
        destructiveActions: ['finalize-invoice'],
      })
    );
    siteId = id;
  });

  afterAll(() => {
    try { db.prepare('DELETE FROM sites WHERE id = ?').run(siteId); } catch (_) {}
  });

  async function authenticate(scope) {
    const body = { siteId, apiKey };
    if (scope !== undefined) body.scope = scope;
    const res = await request(app).post('/api/wab/authenticate').send(body);
    return res;
  }

  test('authenticate without scope → legacy unscoped, scope echoed as "*"', async () => {
    const res = await authenticate(undefined);
    expect(res.status).toBe(200);
    expect(res.body.result.scope).toBe('*');
    expect(res.body.result.token).toBeDefined();
  });

  test('authenticate with valid scope → echoed canonically', async () => {
    const res = await authenticate('read:staging');
    expect(res.status).toBe(200);
    expect(res.body.result.scope).toBe('read:staging:*');
  });

  test('authenticate with invalid scope → 400 invalid_scope', async () => {
    const res = await authenticate('superuser');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_scope');
  });

  test('read-scope token cannot click (write action) → READONLY_VIOLATION', async () => {
    const auth = await authenticate('read:production');
    const token = auth.body.result.token;
    const res = await request(app)
      .post('/api/wab/actions/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { selector: '#x' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('READONLY_VIOLATION');
  });

  test('staging-only token cannot act on production site → ENV_MISMATCH', async () => {
    const auth = await authenticate('write:staging');
    const token = auth.body.result.token;
    const res = await request(app)
      .post('/api/wab/actions/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { selector: '#x' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ENV_MISMATCH');
  });

  test('read-scope token cannot perform destructive action → DESTRUCTIVE_REQUIRES_WRITE', async () => {
    const auth = await authenticate('read:production');
    const token = auth.body.result.token;
    const res = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });

  test('read-scope token CAN call read-like action', async () => {
    const auth = await authenticate('read:production');
    const token = auth.body.result.token;
    const res = await request(app)
      .post('/api/wab/actions/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ selector: '#x' });
    // The /actions/:name path will allow read; "read" maps to readContent perm
    // which is enabled in the seed.
    expect(res.status).toBe(200);
  });

  test('write-scope token in production CAN perform destructive action (admin perm enabled)', async () => {
    const auth = await authenticate('write:production');
    const token = auth.body.result.token;
    // SPEC §8.10 — destructive actions now require a 2-step dry-run.
    const dr = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: true });
    expect(dr.status).toBe(200);
    expect(dr.body.result.dry_run).toBe(true);
    const res = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: false, plan_id: dr.body.result.plan_id });
    expect(res.status).toBe(200);
    expect(res.body.result.success).toBe(true);
  });

  test('site-extended destructive verb (finalize-invoice) blocks read-scope', async () => {
    // Need to add finalize-invoice to permissions first so we test the SCOPE
    // gate, not the permission gate. Site config seeded with destructiveActions.
    db.prepare(`
      UPDATE sites SET config = json_set(
        config, '$.agentPermissions.finalize-invoice', json('true')
      ) WHERE id = ?
    `).run(siteId);

    const auth = await authenticate('read:production');
    const token = auth.body.result.token;
    const res = await request(app)
      .post('/api/wab/actions/finalize-invoice')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DESTRUCTIVE_REQUIRES_WRITE');
  });
});
