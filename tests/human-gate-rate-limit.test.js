'use strict';

/**
 * SPEC §8.11 — IP rate-limiter for /human-gate/approve.
 */

const rl = require('../server/security/human-gate-rate-limit');

beforeEach(() => rl._resetForTests());

describe('checkBeforeAttempt', () => {
  test('allows fresh IPs within default limit', () => {
    const r = rl.checkBeforeAttempt('1.2.3.4');
    expect(r.allowed).toBe(true);
    expect(r.remaining_attempts).toBe(rl.DEFAULT_ATTEMPT_LIMIT);
    expect(r.remaining_successes).toBe(rl.DEFAULT_SUCCESS_LIMIT);
  });

  test('returns allowed=true when no IP given', () => {
    const r = rl.checkBeforeAttempt(null);
    expect(r.allowed).toBe(true);
  });

  test('blocks after attemptLimit attempts within window', () => {
    rl.configure({ attemptLimit: 3, windowMs: 60_000 });
    rl.recordAttempt('9.9.9.9', false);
    rl.recordAttempt('9.9.9.9', false);
    rl.recordAttempt('9.9.9.9', false);
    const r = rl.checkBeforeAttempt('9.9.9.9');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('RATE_LIMIT_TOO_MANY_ATTEMPTS');
    expect(r.retry_after_ms).toBeGreaterThan(0);
  });

  test('attempts from one IP do not affect another', () => {
    rl.configure({ attemptLimit: 2 });
    rl.recordAttempt('1.1.1.1', false);
    rl.recordAttempt('1.1.1.1', false);
    expect(rl.checkBeforeAttempt('1.1.1.1').allowed).toBe(false);
    expect(rl.checkBeforeAttempt('2.2.2.2').allowed).toBe(true);
  });

  test('successes obey successLimit independently', () => {
    rl.configure({ attemptLimit: 100, successLimit: 2 });
    rl.recordAttempt('5.5.5.5', true);
    rl.recordAttempt('5.5.5.5', true);
    const r = rl.checkBeforeAttempt('5.5.5.5');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('RATE_LIMIT_TOO_MANY_APPROVALS');
  });

  test('expired entries pruned by sliding window', async () => {
    rl.configure({ attemptLimit: 2, windowMs: 50 });
    rl.recordAttempt('7.7.7.7', false);
    rl.recordAttempt('7.7.7.7', false);
    expect(rl.checkBeforeAttempt('7.7.7.7').allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(rl.checkBeforeAttempt('7.7.7.7').allowed).toBe(true);
  });

  test('successLimit takes precedence over attemptLimit when both exceeded', () => {
    rl.configure({ attemptLimit: 5, successLimit: 1 });
    rl.recordAttempt('3.3.3.3', true); // 1 success → at limit
    rl.recordAttempt('3.3.3.3', false);
    rl.recordAttempt('3.3.3.3', false);
    rl.recordAttempt('3.3.3.3', false);
    rl.recordAttempt('3.3.3.3', false); // 5 attempts → at limit
    const r = rl.checkBeforeAttempt('3.3.3.3');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('RATE_LIMIT_TOO_MANY_APPROVALS');
  });
});

describe('configure', () => {
  test('clamps windowMs minimum to 10', () => {
    rl.configure({ windowMs: 1 });
    expect(rl._stats().config.windowMs).toBe(10);
  });
  test('clamps windowMs maximum to 1 hour', () => {
    rl.configure({ windowMs: 24 * 60 * 60 * 1000 });
    expect(rl._stats().config.windowMs).toBe(60 * 60 * 1000);
  });
  test('attemptLimit minimum is 1', () => {
    rl.configure({ attemptLimit: 0 });
    expect(rl._stats().config.attemptLimit).toBe(1);
  });
});

describe('recordAttempt', () => {
  test('successful attempt counts toward both attempts and successes', () => {
    rl.recordAttempt('8.8.8.8', true);
    const s = rl._stats();
    expect(s.ips_with_attempts).toBe(1);
    expect(s.ips_with_successes).toBe(1);
  });
  test('failed attempt only counts toward attempts', () => {
    rl.recordAttempt('8.8.8.8', false);
    const s = rl._stats();
    expect(s.ips_with_attempts).toBe(1);
    expect(s.ips_with_successes).toBe(0);
  });
  test('null IP is a no-op', () => {
    rl.recordAttempt(null, true);
    rl.recordAttempt('', false);
    const s = rl._stats();
    expect(s.ips_with_attempts).toBe(0);
  });
});
