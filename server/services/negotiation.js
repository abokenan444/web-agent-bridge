/**
 * Real-time Negotiation Engine
 * ════════════════════════════════════════════════════════════════════════
 * Enables AI agents to negotiate prices and terms with WAB-enabled sites
 * in real-time. The agent can propose deals, and the site's wab.js script
 * responds based on configurable negotiation rules.
 *
 * Flow:
 *  1. Agent discovers a product/service with a listed price
 *  2. Agent opens a "negotiation channel" via WAB protocol
 *  3. Agent sends a proposal (e.g. "5% discount for instant payment")
 *  4. Site's negotiation rules evaluate and respond
 *  5. Both parties agree or the agent moves on
 *
 * This gives small independent sites a competitive edge — they can offer
 * flexible pricing that large rigid platforms cannot match.
 */

const { db } = require('../models/db');
const crypto = require('crypto');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS negotiation_rules (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    condition_type TEXT NOT NULL CHECK(condition_type IN (
      'instant_payment','bulk_order','repeat_customer','off_peak',
      'first_time','loyalty','agent_reputation','custom'
    )),
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed','free_shipping','bonus_item')),
    discount_value REAL NOT NULL,
    max_discount_pct REAL DEFAULT 20.0,
    min_order_value REAL DEFAULT 0,
    requires_agent_reputation REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    usage_count INTEGER DEFAULT 0,
    max_uses_per_day INTEGER DEFAULT 100,
    daily_use_count INTEGER DEFAULT 0,
    last_reset TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS negotiation_sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    item_id TEXT,
    item_name TEXT,
    original_price REAL NOT NULL,
    proposed_price REAL,
    final_price REAL,
    discount_applied REAL DEFAULT 0,
    discount_type TEXT,
    rule_matched TEXT,
    status TEXT DEFAULT 'open' CHECK(status IN (
      'open','agent_proposed','site_countered','agreed','rejected','expired','completed'
    )),
    agent_arguments TEXT DEFAULT '[]',
    site_responses TEXT DEFAULT '[]',
    rounds INTEGER DEFAULT 0,
    max_rounds INTEGER DEFAULT 3,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS negotiation_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    original_price REAL,
    final_price REAL,
    savings_pct REAL,
    outcome TEXT CHECK(outcome IN ('deal','no_deal','expired')),
    completed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES negotiation_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_neg_rules_site ON negotiation_rules(site_id);
  CREATE INDEX IF NOT EXISTS idx_neg_sessions_site ON negotiation_sessions(site_id);
  CREATE INDEX IF NOT EXISTS idx_neg_sessions_agent ON negotiation_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_neg_sessions_status ON negotiation_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_neg_history_site ON negotiation_history(site_id);
`);

// ─── Constants ───────────────────────────────────────────────────────

const SESSION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ROUNDS = 5;

// ─── Rule Management (Site-side) ─────────────────────────────────────

function createRule(siteId, {
  ruleName, conditionType, discountType, discountValue,
  maxDiscountPct = 20, minOrderValue = 0, requiresAgentReputation = 0
}) {
  const id = crypto.randomBytes(12).toString('hex');

  db.prepare(`
    INSERT INTO negotiation_rules
    (id, site_id, rule_name, condition_type, discount_type, discount_value,
     max_discount_pct, min_order_value, requires_agent_reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, siteId, ruleName, conditionType, discountType, discountValue,
    maxDiscountPct, minOrderValue, requiresAgentReputation);

  return { ruleId: id };
}

function getRules(siteId) {
  return db.prepare(`
    SELECT * FROM negotiation_rules WHERE site_id = ? AND active = 1
  `).all(siteId);
}

function updateRule(ruleId, updates) {
  const allowed = ['rule_name', 'discount_value', 'max_discount_pct', 'min_order_value',
    'requires_agent_reputation', 'active', 'max_uses_per_day'];
  const sets = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (sets.length > 0) {
    values.push(ruleId);
    db.prepare(`UPDATE negotiation_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
}

// ─── Negotiation Session ─────────────────────────────────────────────

function openSession(siteId, agentId, { itemId, itemName, originalPrice }) {
  const id = crypto.randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString();

  db.prepare(`
    INSERT INTO negotiation_sessions
    (id, site_id, agent_id, item_id, item_name, original_price, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, siteId, agentId, itemId || null, itemName || 'unknown', originalPrice, expiresAt);

  return {
    sessionId: id,
    originalPrice,
    expiresAt,
    availableStrategies: getAvailableStrategies(siteId, originalPrice)
  };
}

function getAvailableStrategies(siteId, price) {
  const rules = db.prepare(`
    SELECT condition_type, discount_type, max_discount_pct
    FROM negotiation_rules
    WHERE site_id = ? AND active = 1 AND min_order_value <= ?
  `).all(siteId, price);

  return rules.map(r => ({
    strategy: r.condition_type,
    type: r.discount_type,
    maxDiscount: r.max_discount_pct + '%'
  }));
}

// ─── Agent Proposal ──────────────────────────────────────────────────

function agentPropose(sessionId, { strategy, proposedDiscount, arguments: args = [] }) {
  const session = db.prepare('SELECT * FROM negotiation_sessions WHERE id = ?').get(sessionId);
  if (!session) return { error: 'session_not_found' };
  if (session.status === 'expired' || new Date(session.expires_at) < new Date()) {
    db.prepare("UPDATE negotiation_sessions SET status = 'expired' WHERE id = ?").run(sessionId);
    return { error: 'session_expired' };
  }
  if (session.status === 'agreed' || session.status === 'completed') {
    return { error: 'session_already_concluded' };
  }
  if (session.rounds >= MAX_ROUNDS) {
    return { error: 'max_rounds_reached' };
  }

  // Find matching rules
  const rules = db.prepare(`
    SELECT * FROM negotiation_rules
    WHERE site_id = ? AND active = 1 AND condition_type = ?
      AND min_order_value <= ?
  `).all(session.site_id, strategy, session.original_price);

  if (rules.length === 0) {
    // No matching rule — site rejects
    const agentArgs = safeParseJSON(session.agent_arguments);
    agentArgs.push({ round: session.rounds + 1, strategy, proposedDiscount, args });

    const siteResponses = safeParseJSON(session.site_responses);
    siteResponses.push({
      round: session.rounds + 1,
      response: 'rejected',
      reason: 'no_applicable_rule',
      message: 'Sorry, we don\'t offer discounts for this condition.'
    });

    db.prepare(`
      UPDATE negotiation_sessions
      SET status = 'rejected', rounds = rounds + 1,
          agent_arguments = ?, site_responses = ?
      WHERE id = ?
    `).run(JSON.stringify(agentArgs), JSON.stringify(siteResponses), sessionId);

    return { status: 'rejected', reason: 'no_applicable_rule', round: session.rounds + 1 };
  }

  // Check daily limits
  const rule = rules[0];
  resetDailyCountIfNeeded(rule);

  if (rule.daily_use_count >= rule.max_uses_per_day) {
    return { status: 'rejected', reason: 'daily_limit_reached' };
  }

  // Calculate discount
  const requestedPct = Math.min(proposedDiscount, rule.max_discount_pct);
  let actualDiscount = 0;
  let finalPrice = session.original_price;

  switch (rule.discount_type) {
    case 'percentage':
      actualDiscount = Math.min(requestedPct, rule.discount_value);
      finalPrice = session.original_price * (1 - actualDiscount / 100);
      break;
    case 'fixed':
      actualDiscount = Math.min(rule.discount_value, session.original_price * (rule.max_discount_pct / 100));
      finalPrice = session.original_price - actualDiscount;
      break;
    case 'free_shipping':
      actualDiscount = rule.discount_value;
      finalPrice = session.original_price;
      break;
    case 'bonus_item':
      actualDiscount = 0;
      finalPrice = session.original_price;
      break;
  }

  finalPrice = Math.round(finalPrice * 100) / 100;

  // Determine if we counter or agree
  const agentArgs = safeParseJSON(session.agent_arguments);
  agentArgs.push({ round: session.rounds + 1, strategy, proposedDiscount, args });

  const siteResponses = safeParseJSON(session.site_responses);

  let status;
  if (proposedDiscount <= rule.discount_value) {
    // Agent asked for less than or equal to what site offers — agree immediately
    status = 'agreed';
    siteResponses.push({
      round: session.rounds + 1,
      response: 'accepted',
      discount: actualDiscount,
      discountType: rule.discount_type,
      finalPrice,
      message: generateAcceptMessage(rule, actualDiscount, finalPrice)
    });
  } else if (session.rounds + 1 >= session.max_rounds) {
    // Last round — site makes final offer
    status = 'agreed';
    siteResponses.push({
      round: session.rounds + 1,
      response: 'final_offer',
      discount: rule.discount_value,
      discountType: rule.discount_type,
      finalPrice,
      message: `Final offer: ${rule.discount_value}% off. Price: $${finalPrice}`
    });
  } else {
    // Counter-offer
    status = 'site_countered';
    const counterDiscount = Math.min(
      rule.discount_value,
      proposedDiscount * 0.7 + rule.discount_value * 0.3
    );
    const counterPrice = session.original_price * (1 - counterDiscount / 100);

    siteResponses.push({
      round: session.rounds + 1,
      response: 'counter',
      counterDiscount: Math.round(counterDiscount * 100) / 100,
      counterPrice: Math.round(counterPrice * 100) / 100,
      message: generateCounterMessage(rule, counterDiscount, counterPrice, session.rounds + 1)
    });
  }

  db.prepare(`
    UPDATE negotiation_sessions
    SET status = ?, rounds = rounds + 1, proposed_price = ?,
        final_price = CASE WHEN ? = 'agreed' THEN ? ELSE final_price END,
        discount_applied = CASE WHEN ? = 'agreed' THEN ? ELSE discount_applied END,
        discount_type = ?, rule_matched = ?,
        agent_arguments = ?, site_responses = ?,
        completed_at = CASE WHEN ? IN ('agreed','rejected') THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(
    status, session.original_price * (1 - proposedDiscount / 100),
    status, finalPrice,
    status, actualDiscount,
    rule.discount_type, rule.id,
    JSON.stringify(agentArgs), JSON.stringify(siteResponses),
    status, sessionId
  );

  // Update rule usage
  if (status === 'agreed') {
    db.prepare('UPDATE negotiation_rules SET usage_count = usage_count + 1, daily_use_count = daily_use_count + 1 WHERE id = ?').run(rule.id);

    // Record history
    const historyId = crypto.randomBytes(12).toString('hex');
    const savingsPct = ((session.original_price - finalPrice) / session.original_price) * 100;
    db.prepare(`
      INSERT INTO negotiation_history (id, session_id, site_id, agent_id, original_price, final_price, savings_pct, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'deal')
    `).run(historyId, sessionId, session.site_id, session.agent_id, session.original_price, finalPrice, Math.round(savingsPct * 100) / 100);
  }

  const lastResponse = siteResponses[siteResponses.length - 1];
  return {
    status,
    round: session.rounds + 1,
    response: lastResponse
  };
}

// ─── Deal Confirmation ───────────────────────────────────────────────

function confirmDeal(sessionId) {
  const session = db.prepare('SELECT * FROM negotiation_sessions WHERE id = ?').get(sessionId);
  if (!session) return { error: 'session_not_found' };
  if (session.status !== 'agreed') return { error: 'no_deal_to_confirm' };

  db.prepare("UPDATE negotiation_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(sessionId);

  return {
    confirmed: true,
    originalPrice: session.original_price,
    finalPrice: session.final_price,
    savings: Math.round((session.original_price - session.final_price) * 100) / 100,
    savingsPct: Math.round(((session.original_price - session.final_price) / session.original_price) * 100 * 100) / 100
  };
}

// ─── Analytics ───────────────────────────────────────────────────────

function getNegotiationStats(siteId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN outcome = 'deal' THEN 1 ELSE 0 END) as deals_made,
      AVG(CASE WHEN outcome = 'deal' THEN savings_pct ELSE NULL END) as avg_savings,
      SUM(CASE WHEN outcome = 'deal' THEN original_price - final_price ELSE 0 END) as total_discount_given,
      SUM(CASE WHEN outcome = 'deal' THEN final_price ELSE 0 END) as total_revenue_via_negotiation
    FROM negotiation_history WHERE site_id = ?
  `).get(siteId);

  const popularStrategies = db.prepare(`
    SELECT nr.condition_type, COUNT(*) as usage
    FROM negotiation_sessions ns
    JOIN negotiation_rules nr ON ns.rule_matched = nr.id
    WHERE ns.site_id = ? AND ns.status = 'completed'
    GROUP BY nr.condition_type
    ORDER BY usage DESC
  `).all(siteId);

  return {
    ...stats,
    avg_savings: stats.avg_savings ? Math.round(stats.avg_savings * 100) / 100 : 0,
    popularStrategies
  };
}

function getAgentSavings(agentId) {
  return db.prepare(`
    SELECT
      COUNT(*) as deals_made,
      SUM(original_price - final_price) as total_saved,
      AVG(savings_pct) as avg_savings_pct
    FROM negotiation_history WHERE agent_id = ? AND outcome = 'deal'
  `).get(agentId);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function safeParseJSON(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

function resetDailyCountIfNeeded(rule) {
  const today = new Date().toISOString().slice(0, 10);
  if (rule.last_reset !== today) {
    db.prepare("UPDATE negotiation_rules SET daily_use_count = 0, last_reset = ? WHERE id = ?").run(today, rule.id);
    rule.daily_use_count = 0;
  }
}

function generateAcceptMessage(rule, discount, finalPrice) {
  const messages = {
    instant_payment: `Great! Instant payment earns you ${discount}% off. Your price: $${finalPrice}`,
    bulk_order: `Bulk order discount applied: ${discount}% off. Total: $${finalPrice}`,
    repeat_customer: `Welcome back! Loyal customer discount: ${discount}% off. Price: $${finalPrice}`,
    off_peak: `Off-peak special: ${discount}% off. Your price: $${finalPrice}`,
    first_time: `First-time buyer welcome discount: ${discount}% off! Price: $${finalPrice}`,
    loyalty: `Loyalty reward: ${discount}% off. Price: $${finalPrice}`,
    agent_reputation: `Your agent's reputation earns you ${discount}% off. Price: $${finalPrice}`,
    custom: `Special deal: ${discount}% off. Price: $${finalPrice}`
  };
  return messages[rule.condition_type] || messages.custom;
}

function generateCounterMessage(rule, counterDiscount, counterPrice, round) {
  return `Round ${round}: We can offer ${counterDiscount}% off (price: $${counterPrice}). ` +
    `We typically offer up to ${rule.discount_value}% for ${rule.condition_type.replace(/_/g, ' ')}.`;
}

module.exports = {
  createRule,
  getRules,
  updateRule,
  openSession,
  agentPropose,
  confirmDeal,
  getNegotiationStats,
  getAgentSavings
};
