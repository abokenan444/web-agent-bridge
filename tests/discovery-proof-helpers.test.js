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
});
