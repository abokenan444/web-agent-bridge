#!/usr/bin/env node
/**
 * WAB Governance Demo
 * ───────────────────
 * Walks through the full Layer-3 governance pipeline:
 *
 *   1) register agent → get one-time token
 *   2) define permission boundaries (Stripe read-only + refund <$50 + ClickUp write)
 *   3) try a forbidden action  → DENIED
 *   4) try an allowed action   → ALLOWED + audited
 *   5) try a high-value refund → APPROVAL_REQUIRED → human approves → executed
 *   6) verify audit chain      → tamper-evident
 *   7) kill switch             → all subsequent actions DENIED
 *
 * Run:
 *   node examples/governance-agent.js
 *   WAB_API=http://localhost:3000 node examples/governance-agent.js
 */

'use strict';

const { WABGovernance } = require('../sdk');

const API = process.env.WAB_API || 'http://localhost:3000';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const log  = (msg) => console.log(msg);
const head = (n, msg) => log(`\n${c.bold}${c.cyan}── ${n}. ${msg} ──${c.reset}`);
const ok   = (m) => log(`  ${c.green}✓${c.reset} ${m}`);
const no   = (m) => log(`  ${c.red}✗${c.reset} ${m}`);
const info = (m) => log(`  ${c.dim}${m}${c.reset}`);

async function main() {
  log(`${c.bold}${c.magenta}WAB Agent Governance Demo${c.reset}  ${c.dim}(API: ${API})${c.reset}`);

  // ── 1) Register a fresh agent identity
  head(1, 'Register agent');
  const reg = await WABGovernance.register({
    apiBase: API,
    displayName: 'Demo Agent — Stripe + ClickUp',
    metadata: { demo: true, created: Date.now() },
  });
  ok(`agent_id   = ${reg.agent_id}`);
  ok(`agent_token (shown ONCE) = ${reg.agent_token.slice(0, 12)}…`);

  const gov = new WABGovernance({
    apiBase:    API,
    agentId:    reg.agent_id,
    agentToken: reg.agent_token,
    // Auto-approve in this demo (a real app would post to Slack/email).
    onApprovalRequired: async (req) => {
      info(`[human approval] resource=${req.resource} action=${req.action} amount=${req.amount}`);
      info('[human approval] auto-approving in demo (3s think...)');
      await sleep(3000);
      return 'approved';
    },
    approvalTimeoutMs: 30_000,
  });

  // ── 2) Define policies
  head(2, 'Define permission boundaries');
  await gov.definePolicy({ resource: 'stripe', action: 'read',  scope: 'customers' });
  ok('stripe:read on customers');
  await gov.definePolicy({
    resource: 'stripe', action: 'write', scope: 'refunds',
    max_amount: 50, currency: 'USD', daily_cap: 200,
  });
  ok('stripe:write on refunds  (max $50/call, $200/day)');
  await gov.definePolicy({
    resource: 'stripe', action: 'write', scope: 'refunds-large',
    max_amount: 5000, currency: 'USD', requires_approval: true,
  });
  ok('stripe:write on refunds-large  (≤$5000, REQUIRES HUMAN APPROVAL)');
  await gov.definePolicy({
    resource: 'clickup', action: 'write', scope: 'tasks', per_call_rate: 30,
  });
  ok('clickup:write on tasks  (rate-limited 30/min)');

  // ── 3) Forbidden action
  head(3, 'Attempt forbidden action: gmail:write');
  try {
    await gov.guard({ resource: 'gmail', action: 'write', scope: 'inbox' },
      async () => { throw new Error('should not run'); });
    no('UNEXPECTED: action ran (governance failed)');
  } catch (e) {
    ok(`correctly blocked: ${e.message}`);
  }

  // ── 4) Allowed read
  head(4, 'Allowed action: stripe:read on customers');
  const r = await gov.guard(
    { resource: 'stripe', action: 'read', scope: 'customers' },
    async () => ({ count: 12, sample: [{ id: 'cus_abc', email: 'demo@x' }] }),
  );
  ok(`executed in ${r.elapsed_ms}ms — result keys: ${Object.keys(r.result).join(', ')}`);

  // ── 5) Small refund: under cap, no approval
  head(5, 'Small refund: $9.99 (under cap)');
  const r2 = await gov.guard(
    { resource: 'stripe', action: 'write', scope: 'refunds',
      amount: 9.99, currency: 'USD',
      params: { charge: 'ch_xyz', reason: 'duplicate' } },
    async () => ({ refund_id: 're_demo_' + Date.now(), status: 'succeeded' }),
  );
  ok(`refund posted: ${r2.result.refund_id}`);

  // ── 6) Refund OVER per-call cap → DENIED instantly
  head(6, 'Refund $9999 with cap=$50 → DENY');
  try {
    await gov.guard(
      { resource: 'stripe', action: 'write', scope: 'refunds',
        amount: 9999, currency: 'USD' },
      async () => 'should not run',
    );
    no('UNEXPECTED: action ran');
  } catch (e) {
    ok(`correctly blocked: ${e.message}`);
  }

  // ── 7) Large refund routed through approval gate
  head(7, 'Large refund $499.99 → APPROVAL GATE');
  const r3 = await gov.guard(
    { resource: 'stripe', action: 'write', scope: 'refunds-large',
      amount: 499.99, currency: 'USD',
      params: { charge: 'ch_big', reason: 'fraud_dispute' },
      reason: 'high_value_refund_requires_review' },
    async () => ({ refund_id: 're_big_' + Date.now(), status: 'succeeded' }),
  );
  ok(`approved + executed: ${r3.result.refund_id}`);

  // ── 8) Audit log + chain verification
  head(8, 'Audit log + tamper check');
  const audit = await gov.getAudit({ limit: 20 });
  info(`last ${audit.audit.length} events:`);
  for (const ev of audit.audit.slice(0, 8)) {
    const tag = ev.decision === 'deny' ? c.red : ev.decision === 'pending' ? c.yellow : c.green;
    log(`    ${tag}${(ev.decision || '·').padEnd(8)}${c.reset}` +
        ` ${(ev.event_type || '').padEnd(18)} ${ev.resource || ''}/${ev.action || ''}` +
        ` ${ev.scope ? '['+ev.scope+'] ' : ''}${ev.amount ? '$'+ev.amount : ''}`);
  }
  const v = await gov.verifyAudit();
  if (v.ok) ok(`chain verified: ${v.count} entries, head=${(v.head || '').slice(0, 12)}…`);
  else      no(`chain BROKEN at id=${v.broken_at}`);

  // ── 9) Kill switch
  head(9, 'Kill switch');
  await gov.kill('demo_complete');
  ok('agent killed');
  try {
    await gov.guard({ resource: 'stripe', action: 'read', scope: 'customers' },
      async () => 'should not run');
    no('UNEXPECTED: action ran after kill');
  } catch (e) {
    ok(`post-kill action blocked: ${e.message}`);
  }

  log(`\n${c.bold}${c.green}✓ Demo complete${c.reset}\n`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => {
  console.error(`\n${c.red}Demo failed:${c.reset}`, e.message);
  process.exit(1);
});
