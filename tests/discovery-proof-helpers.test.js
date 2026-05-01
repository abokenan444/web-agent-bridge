'use strict';

const { _internals } = require('../server/routes/discovery');

describe('discovery proof helpers', () => {
  test('sanitizeDomain strips scheme, path, port, and www', () => {
    expect(_internals.sanitizeDomain('https://www.Example.com:8443/a/b')).toBe('example.com');
    expect(_internals.sanitizeDomain('http://demo.site.local/test')).toBe('demo.site.local');
  });

  test('sanitizeDomain handles empty input', () => {
    expect(_internals.sanitizeDomain('')).toBe('');
    expect(_internals.sanitizeDomain(null)).toBe('');
  });

  test('deriveEndpointFromRecord prefers parsed endpoint', () => {
    const endpoint = _internals.deriveEndpointFromRecord(
      ['v=wab1; endpoint=https://a.com/.well-known/wab.json'],
      { endpoint: 'https://b.com/.well-known/wab.json' }
    );
    expect(endpoint).toBe('https://b.com/.well-known/wab.json');
  });

  test('deriveEndpointFromRecord falls back to raw TXT parsing', () => {
    const endpoint = _internals.deriveEndpointFromRecord(
      ['v=wab1; endpoint=https://a.com/.well-known/wab.json'],
      null
    );
    expect(endpoint).toBe('https://a.com/.well-known/wab.json');
  });

  test('summarizeUseCase returns explicit use_case when present', () => {
    const val = _internals.summarizeUseCase({ use_case: 'booking' });
    expect(val).toBe('booking');
  });

  test('summarizeUseCase falls back to category', () => {
    const val = _internals.summarizeUseCase({ provider: { category: 'messaging' } });
    expect(val).toBe('messaging');
  });

  test('summarizeUseCase infers from commands', () => {
    const val = _internals.summarizeUseCase({ capabilities: { commands: ['checkout', 'read'] } });
    expect(val).toBe('checkout');
  });

  test('hostAllowList includes domain and wildcard plus endpoint host', () => {
    const list = _internals.hostAllowList('example.com', 'api.example.net');
    expect(list).toEqual(expect.arrayContaining([
      'example.com', '*.example.com', 'api.example.net', '*.api.example.net',
    ]));
  });

  test('pickUsageAction prefers use-case specific action names', () => {
    const picked = _internals.pickUsageAction([
      { name: 'search' },
      { name: 'createBooking' },
      { name: 'readContent' },
    ], 'booking');
    expect(picked).toEqual({ name: 'createBooking' });
  });

  test('pickUsageAction falls back to safe defaults', () => {
    const picked = _internals.pickUsageAction([
      { name: 'readContent' },
      { name: 'click' },
    ], 'unknown-use-case');
    expect(picked).toEqual({ name: 'readContent' });
  });

  test('buildActionParams returns booking template for booking use-case', () => {
    const params = _internals.buildActionParams('createBooking', 'booking');
    expect(params).toMatchObject({
      check_in: expect.any(String),
      check_out: expect.any(String),
      guests: 2,
    });
  });

  test('buildActionParams returns messaging template for messaging use-case', () => {
    const params = _internals.buildActionParams('sendMessage', 'messaging');
    expect(params).toMatchObject({
      channel: 'support',
      message: expect.any(String),
    });
  });
});
