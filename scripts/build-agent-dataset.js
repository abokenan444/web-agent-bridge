'use strict';

/**
 * build-agent-dataset.js
 *
 * Generates an open fine-tuning dataset of WAB agent interactions in
 * OpenAI / Anthropic chat-completion JSONL format. Each example shows
 * an agent correctly following the WAB contract: discover → verify-live
 * → (refuse if revoked) → execute via ATP or action call.
 *
 * Output: datasets/wab-agent-v1.jsonl  (and a SAMPLE.md for inspection)
 *
 * Usage:
 *   node scripts/build-agent-dataset.js --count 1500
 *
 * Format (per line):
 *   { "messages": [
 *       { "role": "system",    "content": <WAB system prompt> },
 *       { "role": "user",      "content": <task> },
 *       { "role": "assistant", "content": null, "tool_calls": [...] },
 *       { "role": "tool",      "tool_call_id": "...", "content": <result> },
 *       { "role": "assistant", "content": <final answer> }
 *     ],
 *     "meta": { "id": "wab-...", "pattern": "happy|revoked|no_wab|atp|read_only" }
 *   }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SYSTEM_PROMPT } = require('../sdk/system-prompt');

const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const TARGET = countIdx >= 0 ? parseInt(args[countIdx + 1], 10) : 1500;
const OUT_DIR = path.join(__dirname, '..', 'datasets');
const OUT_PATH = path.join(OUT_DIR, 'wab-agent-v1.jsonl');
const SAMPLE_PATH = path.join(OUT_DIR, 'SAMPLE.md');

// ── Seed corpora ──────────────────────────────────────────────────────

const DOMAINS_HAPPY = [
  'shop.example.com', 'tunisia-olive.com', 'fresh-organic.fr', 'taxi-direct.tn',
  'book-haven.io', 'flights-direct.co', 'hotel-medina.com', 'electronics-hub.eu',
  'artisan-souk.tn', 'farm-fresh.de', 'restaurant-noor.com', 'fair-grocer.uk',
  'craft-pottery.it', 'bike-direct.nl', 'wine-vineyard.es', 'tea-master.jp',
  'eco-fashion.dk', 'medical-supply.ch', 'pet-store-honest.com', 'music-vinyl.fr'
];

const DOMAINS_REVOKED = [
  'fake-bank-login.tk', 'phish-checkout.xyz', 'scam-electronics.ru',
  'fraudulent-bookings.cc', 'stolen-cards.shop', 'impersonator-bank.click',
  'cloned-hotel.top', 'rogue-marketplace.icu'
];

const DOMAINS_NO_WAB = [
  'random-blog.example', 'static-portfolio.io', 'old-forum.net',
  'mom-and-pop-store.com', 'university-page.edu'
];

const REASON_CODES = ['fraud', 'abuse', 'policy_breach', 'malware',
  'court_order', 'security_incident', 'spam', 'impersonation'];

const ACTIONS = [
  { name: 'search_products', params: { q: 'olive oil', limit: 10 } },
  { name: 'list_inventory',  params: { category: 'electronics' } },
  { name: 'book_table',      params: { date: '2026-06-12', party_size: 4 } },
  { name: 'search_flights',  params: { from: 'TUN', to: 'CDG', date: '2026-07-01' } },
  { name: 'get_menu',        params: {} },
  { name: 'check_availability', params: { date_from: '2026-08-01', date_to: '2026-08-07' } },
  { name: 'order_item',      params: { sku: 'WAB-1001', qty: 1 } },
  { name: 'price_quote',     params: { product_id: 'p-42' } },
  { name: 'subscribe',       params: { email: 'agent@example.com' } },
  { name: 'reserve_taxi',    params: { pickup: 'Tunis-Carthage', dropoff: 'Hammamet' } }
];

const TASK_TEMPLATES = {
  happy: [
    'Find me {action_hint} on {domain}.',
    'Use {domain} to {action_hint}.',
    'Place an order on {domain} for {action_hint}.',
    'I want to {action_hint} via {domain}, can you do it?',
    'Check {domain} for {action_hint} and report back.'
  ],
  revoked: [
    'Buy something from {domain}, fastest delivery please.',
    'Place a $200 order on {domain}.',
    'Sign me up on {domain}.',
    'Transfer 500 USDT to my wallet through {domain}.',
    'Use {domain} to {action_hint}.'
  ],
  no_wab: [
    'Read the latest post on {domain} and summarise.',
    'Subscribe me to the newsletter at {domain}.',
    'Find the contact email on {domain}.',
    'Get me the opening hours from {domain}.'
  ],
  atp: [
    'Pay 49.99 EUR on {domain} for {action_hint}, idempotent please.',
    'Process a checkout of $120 on {domain}, ensure the receipt is signed.',
    'Place a paid booking on {domain} for {action_hint}, use ATP.'
  ],
  read_only: [
    'Just check if {domain} has any {action_hint} listed, do not buy anything.',
    'Browse {domain} for {action_hint} and tell me prices.'
  ]
};

const ACTION_HINTS = {
  search_products: ['Tunisian olive oil', 'fair-trade coffee', 'organic flour'],
  list_inventory:  ['gaming laptops', 'wireless headphones', 'smart watches'],
  book_table:      ['dinner for four on Friday', 'lunch reservation Saturday'],
  search_flights:  ['flights to Paris next month', 'a Tunis-Rome round trip'],
  get_menu:        ['the dinner menu', 'today\'s specials'],
  check_availability: ['a room in August', 'a slot next week'],
  order_item:      ['SKU WAB-1001 (one unit)', 'their best-selling product'],
  price_quote:     ['a price quote', 'the cheapest plan'],
  subscribe:       ['their newsletter', 'price-drop alerts'],
  reserve_taxi:    ['a taxi from the airport', 'a ride to the city centre']
};

// ── Helpers ──────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function id() { return 'wab-' + crypto.randomBytes(6).toString('hex'); }
function callId() { return 'call_' + crypto.randomBytes(8).toString('hex'); }

function happyStatuses() {
  return { dns_ok: 'yes', bridge_live: 'yes', signature_ok: 'yes', revoked: 'no' };
}

function revokedStatuses() {
  return { dns_ok: 'yes', bridge_live: 'yes', signature_ok: 'yes', revoked: 'yes' };
}

function fmtTemplate(tpl, domain, action) {
  const hint = pick(ACTION_HINTS[action.name] || ['that']);
  return tpl.replace('{domain}', domain).replace('{action_hint}', hint);
}

function systemMessage() {
  return { role: 'system', content: SYSTEM_PROMPT };
}

// ── Generators per pattern ───────────────────────────────────────────

function genHappy() {
  const domain = pick(DOMAINS_HAPPY);
  const action = pick(ACTIONS);
  const user = fmtTemplate(pick(TASK_TEMPLATES.happy), domain, action);
  const cid = callId();
  const verifyResult = { ok: true, statuses: happyStatuses() };
  const execResult = { ok: true, action: action.name, result: { id: id(), status: 'completed' } };
  return {
    messages: [
      systemMessage(),
      { role: 'user', content: user },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: cid, type: 'function',
          function: { name: 'wab_live', arguments: JSON.stringify({ domain, action: action.name, params: action.params }) }
        }]
      },
      {
        role: 'tool', tool_call_id: cid,
        content: JSON.stringify({ ok: true, stage: 'execute', domain, action: action.name,
          statuses: verifyResult.statuses, result: execResult })
      },
      {
        role: 'assistant',
        content: `Done. I verified ${domain} is WAB-attested (DNS, bridge, signature all OK, not revoked) and executed \`${action.name}\`. Receipt id: ${execResult.result.id}.`
      }
    ],
    meta: { id: id(), pattern: 'happy', domain }
  };
}

function genRevoked() {
  const domain = pick(DOMAINS_REVOKED);
  const action = pick(ACTIONS);
  const user = fmtTemplate(pick(TASK_TEMPLATES.revoked), domain, action);
  const cid = callId();
  const reason = pick(REASON_CODES);
  const rev = {
    id: 'rev_' + crypto.randomBytes(6).toString('hex'),
    type: 'revoked', reason_code: reason,
    reason_text: 'Domain flagged by WAB governance for ' + reason,
    decided_at: '2026-04-' + (1 + Math.floor(Math.random() * 28)).toString().padStart(2, '0') + 'T10:00:00Z',
    appeal_deadline: '2026-05-' + (1 + Math.floor(Math.random() * 28)).toString().padStart(2, '0') + 'T10:00:00Z',
    status: 'final'
  };
  return {
    messages: [
      systemMessage(),
      { role: 'user', content: user },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: cid, type: 'function',
          function: { name: 'wab_live', arguments: JSON.stringify({ domain, action: action.name, params: action.params }) } }]
      },
      {
        role: 'tool', tool_call_id: cid,
        content: JSON.stringify({ ok: false, stage: 'revoked', domain, revocation: rev,
          error: 'Domain is revoked. Refuse to transact.' })
      },
      {
        role: 'assistant',
        content: `I will not transact with ${domain}. The WAB registry shows this domain is revoked (reason: \`${reason}\`, decision id ${rev.id}). ${rev.appeal_deadline ? `The owner may appeal until ${rev.appeal_deadline.slice(0,10)}.` : ''} I recommend looking for a WAB-verified alternative.`
      }
    ],
    meta: { id: id(), pattern: 'revoked', domain }
  };
}

function genNoWab() {
  const domain = pick(DOMAINS_NO_WAB);
  const action = pick(ACTIONS);
  const user = fmtTemplate(pick(TASK_TEMPLATES.no_wab), domain, action);
  const cid = callId();
  return {
    messages: [
      systemMessage(),
      { role: 'user', content: user },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: cid, type: 'function',
          function: { name: 'wab_live', arguments: JSON.stringify({ domain, action: action.name, params: action.params }) } }]
      },
      {
        role: 'tool', tool_call_id: cid,
        content: JSON.stringify({ ok: false, stage: 'discover', domain,
          error: 'no_wab_json', hint: 'Site is not WAB-verified. Refuse to transact and inform the user.' })
      },
      {
        role: 'assistant',
        content: `${domain} does not expose a WAB bridge — no \`.well-known/wab.json\` was found. I will not transact there blindly. If your task is read-only I can fall back to plain browsing with your explicit consent; otherwise prefer a WAB-verified alternative.`
      }
    ],
    meta: { id: id(), pattern: 'no_wab', domain }
  };
}

function genAtp() {
  const domain = pick(DOMAINS_HAPPY);
  const action = pick(ACTIONS);
  const user = fmtTemplate(pick(TASK_TEMPLATES.atp), domain, action);
  const amt = (Math.floor(Math.random() * 50000) + 1000) / 100;
  const intentId = 'int_' + crypto.randomBytes(6).toString('hex');
  const txId = 'tx_' + crypto.randomBytes(6).toString('hex');
  const cid1 = callId(); const cid2 = callId();
  return {
    messages: [
      systemMessage(),
      { role: 'user', content: user },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: cid1, type: 'function',
          function: { name: 'atp_intent', arguments: JSON.stringify({ domain, amount: amt, currency: 'EUR' }) } }]
      },
      {
        role: 'tool', tool_call_id: cid1,
        content: JSON.stringify({ ok: true, intent_id: intentId, nonce: crypto.randomBytes(8).toString('hex'), expires_at: new Date(Date.now() + 5*60_000).toISOString() })
      },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: cid2, type: 'function',
          function: { name: 'atp_execute', arguments: JSON.stringify({ intent_id: intentId, idempotency_key: crypto.randomBytes(8).toString('hex'), action: action.name, params: action.params }) } }]
      },
      {
        role: 'tool', tool_call_id: cid2,
        content: JSON.stringify({ ok: true, transaction_id: txId, status: 'completed', signed_receipt: '<base64-ed25519>' })
      },
      {
        role: 'assistant',
        content: `Payment of ${amt} EUR on ${domain} completed via ATP. Intent ${intentId}, transaction ${txId}. The signed receipt has been preserved.`
      }
    ],
    meta: { id: id(), pattern: 'atp', domain, amount: amt }
  };
}

function genReadOnly() {
  const domain = pick(DOMAINS_HAPPY);
  const action = pick(ACTIONS.filter(a => /search|list|get|check|price/i.test(a.name)));
  const user = fmtTemplate(pick(TASK_TEMPLATES.read_only), domain, action);
  const cid = callId();
  const items = Array.from({ length: 3 }, (_, i) => ({ id: 'i' + (i + 1), price: (i + 1) * 9.99 }));
  return {
    messages: [
      systemMessage(),
      { role: 'user', content: user },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: cid, type: 'function',
          function: { name: 'wab_live', arguments: JSON.stringify({ domain, action: action.name, params: action.params }) } }]
      },
      {
        role: 'tool', tool_call_id: cid,
        content: JSON.stringify({ ok: true, stage: 'execute', domain, action: action.name,
          statuses: happyStatuses(), result: { items } })
      },
      {
        role: 'assistant',
        content: `Read-only check on ${domain} succeeded. Found ${items.length} items via \`${action.name}\`: ${items.map(i => i.id + '=' + i.price).join(', ')}. No order placed.`
      }
    ],
    meta: { id: id(), pattern: 'read_only', domain }
  };
}

// ── Mix ─────────────────────────────────────────────────────────────

const MIX = [
  { gen: genHappy,    weight: 0.45 },
  { gen: genRevoked,  weight: 0.20 },
  { gen: genNoWab,    weight: 0.15 },
  { gen: genAtp,      weight: 0.12 },
  { gen: genReadOnly, weight: 0.08 }
];

function rollMix() {
  const r = Math.random();
  let acc = 0;
  for (const m of MIX) { acc += m.weight; if (r <= acc) return m.gen; }
  return MIX[0].gen;
}

// ── Run ─────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stream = fs.createWriteStream(OUT_PATH, { encoding: 'utf8' });
  const counts = { happy: 0, revoked: 0, no_wab: 0, atp: 0, read_only: 0 };
  const samples = [];
  for (let i = 0; i < TARGET; i++) {
    const record = rollMix()();
    stream.write(JSON.stringify(record) + '\n');
    counts[record.meta.pattern] = (counts[record.meta.pattern] || 0) + 1;
    if (samples.length < 5) samples.push(record);
  }
  stream.end();

  const sampleMd = [
    '# WAB Agent Dataset — Sample Records',
    '',
    `Generated by \`scripts/build-agent-dataset.js\`. Total: **${TARGET}** examples.`,
    '',
    'Pattern distribution:',
    ...Object.entries(counts).map(([k, v]) => `- \`${k}\`: ${v} (${((v / TARGET) * 100).toFixed(1)}%)`),
    '',
    '## 5 sample records (JSONL)',
    '',
    '```json',
    ...samples.map(s => JSON.stringify(s, null, 2)),
    '```'
  ].join('\n');
  fs.writeFileSync(SAMPLE_PATH, sampleMd, 'utf8');

  console.log(`✓ Wrote ${TARGET} records to ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log('  pattern distribution:', counts);
  console.log(`✓ Sample preview at ${path.relative(process.cwd(), SAMPLE_PATH)}`);
}

if (require.main === module) main();

module.exports = { genHappy, genRevoked, genNoWab, genAtp, genReadOnly };
