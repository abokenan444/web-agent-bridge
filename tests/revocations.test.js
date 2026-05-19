/**
 * Site Revocations & Appeals — v3.11.0
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

const TEST_DB_FILE = path.join(__dirname, '..', 'data-test', 'wab-test.db');

let revocations, dbModule;

beforeAll(() => {
  if (fs.existsSync(TEST_DB_FILE)) {
    try { fs.rmSync(TEST_DB_FILE); } catch { /* ignore */ }
  }
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(path.sep + 'server' + path.sep) || k.includes(path.sep + 'data-test' + path.sep)) {
      delete require.cache[k];
    }
  });

  dbModule = require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
  revocations = require('../server/services/revocations');

  dbModule.db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, password, created_at)
    VALUES ('user_rev_owner',  'owner@rev.test',  'Owner',  'x', datetime('now')),
           ('user_rev_other',  'other@rev.test',  'Other',  'x', datetime('now'))
  `).run();

  dbModule.db.prepare(`
    INSERT OR IGNORE INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config, active)
    VALUES ('site_rev_1', 'user_rev_owner', 'example-rev.test', 'Rev1', '', 'pro', 'lk1', 'ak1', '{}', 1),
           ('site_rev_2', 'user_rev_owner', 'example-rev2.test','Rev2', '', 'pro', 'lk2', 'ak2', '{}', 1),
           ('site_rev_3', 'user_rev_owner', 'example-rev3.test','Rev3', '', 'pro', 'lk3', 'ak3', '{}', 1)
  `).run();
});

describe('revocations service', () => {
  test('owner_disable opens without an appeal window and finalizes immediately', () => {
    const r = revocations.openRevocation({
      siteId: 'site_rev_1', type: 'owner_disable',
      reasonCode: 'owner_request', reasonText: 'Pausing for redesign.',
      decidedBy: 'owner:user_rev_owner',
    });
    expect(r.status).toBe('final');
    expect(r.appeal_deadline).toBeNull();

    const active = revocations.getActiveByDomain('example-rev.test');
    expect(active).toBeTruthy();
    expect(active.type).toBe('owner_disable');

    // Sites flagged inactive.
    const site = dbModule.db.prepare(`SELECT active FROM sites WHERE id='site_rev_1'`).get();
    expect(site.active).toBe(0);
  });

  test('owner can reinstate their own disable', () => {
    const r = revocations.getActiveByDomain('example-rev.test');
    revocations.reinstate({ revocationId: r.id, actorId: 'user_rev_owner', actorType: 'user' });
    const site = dbModule.db.prepare(`SELECT active FROM sites WHERE id='site_rev_1'`).get();
    expect(site.active).toBe(1);
    expect(revocations.getActiveByDomain('example-rev.test')).toBeNull();
  });

  test('suspended revocation opens an appeal window', () => {
    const r = revocations.openRevocation({
      siteId: 'site_rev_2', type: 'suspended',
      reasonCode: 'policy_breach', reasonText: 'Reported abusive content.',
      decidedBy: 'admin:1',
    });
    expect(r.status).toBe('pending_appeal');
    expect(r.appeal_deadline).toBeTruthy();
    expect(new Date(r.appeal_deadline).getTime()).toBeGreaterThan(Date.now());
  });

  test('appeal submission flips status to appealed', () => {
    const r = revocations.getActiveByDomain('example-rev2.test');
    const app = revocations.submitAppeal({
      revocationId: r.id, ownerUserId: 'user_rev_owner',
      statement: 'We removed the reported content and added moderation.',
      remediationProof: 'https://example.com/proof',
    });
    expect(app.statement).toMatch(/removed/);
    const r2 = revocations.getById(r.id);
    expect(r2.status).toBe('appealed');
  });

  test('upheld appeal reinstates the site', () => {
    const r = revocations.getActiveByDomain('example-rev2.test');
    revocations.decideAppeal({
      revocationId: r.id, decision: 'upheld',
      decisionReason: 'Remediation confirmed', adminId: 1,
    });
    const r2 = revocations.getById(r.id);
    expect(r2.status).toBe('overturned');
    const site = dbModule.db.prepare(`SELECT active FROM sites WHERE id='site_rev_2'`).get();
    expect(site.active).toBe(1);
  });

  test('rejected appeal finalises the revocation', () => {
    const r = revocations.openRevocation({
      siteId: 'site_rev_3', type: 'revoked',
      reasonCode: 'malware', reasonText: 'Confirmed malware distribution.',
      decidedBy: 'admin:1',
    });
    revocations.submitAppeal({
      revocationId: r.id, ownerUserId: 'user_rev_owner',
      statement: 'False positive, please review.',
    });
    revocations.decideAppeal({
      revocationId: r.id, decision: 'rejected',
      decisionReason: 'Malware sample re-verified', adminId: 1,
    });
    const r2 = revocations.getById(r.id);
    expect(r2.status).toBe('final');
    const site = dbModule.db.prepare(`SELECT active FROM sites WHERE id='site_rev_3'`).get();
    expect(site.active).toBe(0);
  });

  test('cannot open a duplicate active revocation', () => {
    expect(() => revocations.openRevocation({
      siteId: 'site_rev_3', type: 'suspended',
      reasonCode: 'spam', reasonText: 'Another reason here.',
      decidedBy: 'admin:1',
    })).toThrow(/already/);
  });

  test('sweepExpired finalises lapsed pending_appeal rows', () => {
    // Insert a row with deadline in the past directly.
    dbModule.db.prepare(`
      INSERT INTO site_revocations
        (id, site_id, domain, type, reason_code, reason_text, decided_by, decided_at,
         appeal_deadline, status)
      VALUES ('rev_expired_1', 'site_rev_3', 'example-rev3.test', 'suspended',
              'spam', 'old report seeded', 'admin:1',
              datetime('now','-30 days'), datetime('now','-1 day'), 'pending_appeal')
    `).run();
    const n = revocations.sweepExpired();
    expect(n).toBeGreaterThanOrEqual(1);
    const row = dbModule.db.prepare(`SELECT status FROM site_revocations WHERE id='rev_expired_1'`).get();
    expect(row.status).toBe('final');
  });

  test('listPublic excludes owner_disable rows', () => {
    const pub = revocations.listPublic();
    expect(pub.every((r) => r.type !== 'owner_disable')).toBe(true);
  });
});
