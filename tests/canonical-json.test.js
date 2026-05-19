/**
 * RFC 8785 JSON Canonicalization — v3.11.0
 */

const { canonicalize, canonicalDigest } = require('../server/services/canonical-json');

describe('canonical-json (RFC 8785)', () => {
  test('object keys are sorted', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('nested objects are sorted recursively', () => {
    expect(canonicalize({ z: { b: 1, a: 2 }, a: 1 }))
      .toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  test('arrays preserve order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  test('-0 collapses to 0', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize(0)).toBe('0');
  });

  test('non-finite numbers throw', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
  });

  test('undefined inside object is stripped', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  test('undefined inside array becomes null (JSON-compatible)', () => {
    expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]');
  });

  test('control characters are escaped', () => {
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
    expect(canonicalize('\u0001')).toBe('"\\u0001"');
  });

  test('quotes and backslashes are escaped', () => {
    expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  test('booleans and null', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(null)).toBe('null');
  });

  test('functions / symbols / bigint throw', () => {
    expect(() => canonicalize(() => 1)).toThrow();
    expect(() => canonicalize(Symbol('x'))).toThrow();
    expect(() => canonicalize(BigInt(1))).toThrow();
  });

  test('deterministic digest is stable across key orderings', () => {
    const a = canonicalDigest({ x: 1, y: [1, 2, 3], z: { b: 'two', a: 'one' } });
    const b = canonicalDigest({ z: { a: 'one', b: 'two' }, y: [1, 2, 3], x: 1 });
    expect(a).toBe(b);
  });
});
