'use strict';

const { genHappy, genRevoked, genNoWab, genAtp, genReadOnly } = require('../scripts/build-agent-dataset');
const { SYSTEM_PROMPT } = require('../sdk/system-prompt');

function assertChatRecord(rec, pattern) {
  expect(rec.meta.pattern).toBe(pattern);
  expect(Array.isArray(rec.messages)).toBe(true);
  expect(rec.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
  expect(rec.messages[1].role).toBe('user');
  // there is at least one assistant turn with tool_calls and a matching tool result
  const toolCalls = rec.messages.find(m => m.role === 'assistant' && Array.isArray(m.tool_calls));
  expect(toolCalls).toBeTruthy();
  const ids = toolCalls.tool_calls.map(c => c.id);
  for (const id of ids) {
    expect(rec.messages.some(m => m.role === 'tool' && m.tool_call_id === id)).toBe(true);
  }
  // final assistant turn is plain text
  const last = rec.messages[rec.messages.length - 1];
  expect(last.role).toBe('assistant');
  expect(typeof last.content).toBe('string');
  expect(last.content.length).toBeGreaterThan(0);
}

describe('WAB agent dataset generators', () => {
  test('happy pattern produces a valid chat record', () => {
    assertChatRecord(genHappy(), 'happy');
  });

  test('revoked pattern surfaces revocation reason and refuses', () => {
    const rec = genRevoked();
    assertChatRecord(rec, 'revoked');
    const toolMsg = rec.messages.find(m => m.role === 'tool');
    const parsed = JSON.parse(toolMsg.content);
    expect(parsed.stage).toBe('revoked');
    expect(parsed.revocation).toBeTruthy();
    const finalMsg = rec.messages[rec.messages.length - 1];
    expect(finalMsg.content.toLowerCase()).toMatch(/revoked|will not transact|refuse/);
  });

  test('no_wab pattern refuses to transact', () => {
    const rec = genNoWab();
    assertChatRecord(rec, 'no_wab');
    const finalMsg = rec.messages[rec.messages.length - 1];
    expect(finalMsg.content.toLowerCase()).toMatch(/wab|not.*verified|read-only|alternative/);
  });

  test('atp pattern uses two-tool flow with intent + execute', () => {
    const rec = genAtp();
    assertChatRecord(rec, 'atp');
    const calls = rec.messages.filter(m => m.role === 'assistant' && m.tool_calls).flatMap(m => m.tool_calls);
    const names = calls.map(c => c.function.name);
    expect(names).toContain('atp_intent');
    expect(names).toContain('atp_execute');
  });

  test('read_only pattern picks a non-mutating action', () => {
    const rec = genReadOnly();
    assertChatRecord(rec, 'read_only');
    const calls = rec.messages.find(m => m.role === 'assistant' && m.tool_calls).tool_calls;
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.action).toMatch(/search|list|get|check|price/);
  });
});
