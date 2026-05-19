'use strict';

const { systemPrompt, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } = require('../sdk/system-prompt');
const { WABLiveTool, runWabFlow } = require('../packages/langchain/wab-tool');

describe('Canonical WAB agent system prompt', () => {
  test('exposes a stable, non-empty prompt with a version', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(500);
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('mentions the WAB contract pillars', () => {
    expect(SYSTEM_PROMPT).toMatch(/\.well-known\/wab\.json/);
    expect(SYSTEM_PROMPT).toMatch(/verify-live/);
    expect(SYSTEM_PROMPT).toMatch(/statuses\.revoked/);
    expect(SYSTEM_PROMPT).toMatch(/Agent Transaction Primitive|ATP/);
  });

  test('systemPrompt() returns canonical text by default', () => {
    expect(systemPrompt()).toBe(SYSTEM_PROMPT);
  });

  test('systemPrompt({agentName, agentVersion}) appends identity', () => {
    const out = systemPrompt({ agentName: 'unit-test', agentVersion: '9.9.9' });
    expect(out.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(out).toMatch(/unit-test\/9\.9\.9/);
  });
});

describe('WABLiveTool', () => {
  test('exposes the expected tool shape', () => {
    const t = new WABLiveTool();
    expect(t.name).toBe('wab_live');
    expect(typeof t.description).toBe('string');
    expect(t.description.length).toBeGreaterThan(40);
    const schema = t.schema || (t.constructor && t.constructor.schema);
    // when @langchain/core present, schema lives on instance; when absent, also on instance
    const effectiveSchema = t.schema;
    expect(effectiveSchema.required).toEqual(['domain', 'action']);
    expect(effectiveSchema.properties.domain.type).toBe('string');
    expect(effectiveSchema.properties.action.type).toBe('string');
  });

  test('respects name/description overrides', () => {
    const t = new WABLiveTool({ name: 'custom_tool', description: 'custom desc' });
    expect(t.name).toBe('custom_tool');
    expect(t.description).toBe('custom desc');
  });

  test('runWabFlow rejects missing domain/action', async () => {
    const r1 = await runWabFlow({ action: 'noop' });
    expect(r1.ok).toBe(false);
    expect(r1.stage).toBe('input');
    const r2 = await runWabFlow({ domain: 'example.com' });
    expect(r2.ok).toBe(false);
    expect(r2.stage).toBe('input');
  });

  test('runWabFlow blocks revoked domains before execution', async () => {
    const realFetch = global.fetch;
    let executeCalled = false;
    global.fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/.well-known/wab.json')) {
        return new Response(JSON.stringify({ actions: [{ name: 'buy' }] }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (u.endsWith('/api/verify-live')) {
        return new Response(JSON.stringify({
          ok: true,
          statuses: { dns_ok: 'yes', bridge_live: 'yes', signature_ok: 'yes', revoked: 'yes' },
          revocation: { id: 'rev_test', type: 'revoked', reason_code: 'fraud',
            decided_at: new Date().toISOString(), status: 'final' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/api/wab/execute')) {
        executeCalled = true;
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    try {
      const r = await runWabFlow(
        { domain: 'bad-shop.example', action: 'buy', params: {} },
        { registry: 'https://api.test' }
      );
      expect(r.ok).toBe(false);
      expect(r.stage).toBe('revoked');
      expect(r.revocation && r.revocation.reason_code).toBe('fraud');
      expect(executeCalled).toBe(false);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('runWabFlow executes when verify-live passes', async () => {
    const realFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/.well-known/wab.json')) {
        return new Response(JSON.stringify({
          actions: [{ name: 'search' }],
          endpoints: { execute: 'https://good.example/api/wab/execute' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/api/verify-live')) {
        return new Response(JSON.stringify({
          ok: true,
          statuses: { dns_ok: 'yes', bridge_live: 'yes', signature_ok: 'yes', revoked: 'no' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/api/wab/execute')) {
        return new Response(JSON.stringify({ ok: true, result: [{ id: 1 }] }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    };
    try {
      const r = await runWabFlow(
        { domain: 'good.example', action: 'search', params: { q: 'shoes' } },
        { registry: 'https://api.test' }
      );
      expect(r.ok).toBe(true);
      expect(r.stage).toBe('execute');
      expect(r.action).toBe('search');
      expect(r.result && r.result.ok).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('runWabFlow returns no_wab_json when discovery fails', async () => {
    const realFetch = global.fetch;
    global.fetch = async () => new Response('nope', { status: 404 });
    try {
      const r = await runWabFlow({ domain: 'plain-site.example', action: 'buy' });
      expect(r.ok).toBe(false);
      expect(r.stage).toBe('discover');
      expect(r.hint).toMatch(/not WAB-verified/);
    } finally {
      global.fetch = realFetch;
    }
  });
});
