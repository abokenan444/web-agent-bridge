/**
 * Agent Symphony Orchestrator — Autonomous Multi-Agent Collaboration
 *
 * Coordinates specialized agents (Researcher, Negotiator, Analyst, Guardian)
 * to execute complex tasks WITHOUT any external LLM dependency.
 * Each agent has built-in rule engines and heuristics.
 *
 * Symphony Phases:
 *   1. COMPOSE  — Assign roles based on task type
 *   2. DISCOVER — Researcher gathers site data via WAB schema
 *   3. ANALYZE  — Analyst evaluates options using learned preferences
 *   4. NEGOTIATE — Negotiator pursues best deal terms
 *   5. GUARD    — Guardian validates safety & fairness
 *   6. DECIDE   — Final consensus assembly from all agent outputs
 *
 * All processing is local — no tokens consumed, no data shared externally.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS symphony_compositions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    task TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT DEFAULT 'composing',
    phases_completed TEXT DEFAULT '[]',
    current_phase TEXT DEFAULT 'compose',
    final_decision TEXT,
    confidence REAL DEFAULT 0.0,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS symphony_roles (
    id TEXT PRIMARY KEY,
    composition_id TEXT NOT NULL,
    role TEXT NOT NULL,
    agent_id TEXT,
    status TEXT DEFAULT 'waiting',
    input TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    reasoning TEXT,
    confidence REAL DEFAULT 0.0,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (composition_id) REFERENCES symphony_compositions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS symphony_consensus (
    id TEXT PRIMARY KEY,
    composition_id TEXT NOT NULL,
    votes TEXT DEFAULT '{}',
    method TEXT DEFAULT 'weighted',
    result TEXT DEFAULT '{}',
    agreement_score REAL DEFAULT 0.0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (composition_id) REFERENCES symphony_compositions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS symphony_templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    task_type TEXT NOT NULL,
    roles TEXT NOT NULL,
    phase_order TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_symphony_comp_site ON symphony_compositions(site_id);
  CREATE INDEX IF NOT EXISTS idx_symphony_comp_status ON symphony_compositions(status);
  CREATE INDEX IF NOT EXISTS idx_symphony_roles_comp ON symphony_roles(composition_id);
  CREATE INDEX IF NOT EXISTS idx_symphony_consensus_comp ON symphony_consensus(composition_id);
`);

// ─── Default Templates ──────────────────────────────────────────────

const TEMPLATES = [
  {
    name: 'purchase_advisor',
    task_type: 'purchase',
    roles: ['researcher', 'analyst', 'negotiator', 'guardian'],
    phase_order: ['discover', 'analyze', 'negotiate', 'guard', 'decide'],
    description: 'End-to-end purchase advisory: discover products, analyze value, negotiate price, verify safety',
  },
  {
    name: 'price_hunter',
    task_type: 'price_comparison',
    roles: ['researcher', 'analyst', 'guardian'],
    phase_order: ['discover', 'analyze', 'guard', 'decide'],
    description: 'Cross-site price comparison and best-deal identification',
  },
  {
    name: 'deal_negotiator',
    task_type: 'negotiation',
    roles: ['researcher', 'negotiator', 'guardian'],
    phase_order: ['discover', 'negotiate', 'guard', 'decide'],
    description: 'Aggressive deal-seeking with safety verification',
  },
  {
    name: 'site_scout',
    task_type: 'exploration',
    roles: ['researcher', 'analyst'],
    phase_order: ['discover', 'analyze', 'decide'],
    description: 'Explore and catalog site capabilities',
  },
  {
    name: 'trust_auditor',
    task_type: 'verification',
    roles: ['researcher', 'guardian', 'analyst'],
    phase_order: ['discover', 'guard', 'analyze', 'decide'],
    description: 'Comprehensive trust and safety audit of a site',
  },
];

const _ensureTemplates = db.transaction(() => {
  const insert = db.prepare(`INSERT OR IGNORE INTO symphony_templates (id, name, task_type, roles, phase_order, description) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const t of TEMPLATES) {
    insert.run(crypto.randomUUID(), t.name, t.task_type, JSON.stringify(t.roles), JSON.stringify(t.phase_order), t.description);
  }
});
_ensureTemplates();

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertComposition: db.prepare(`INSERT INTO symphony_compositions (id, site_id, task, task_type) VALUES (?, ?, ?, ?)`),
  getComposition: db.prepare(`SELECT * FROM symphony_compositions WHERE id = ?`),
  updateComposition: db.prepare(`UPDATE symphony_compositions SET status = ?, current_phase = ?, phases_completed = ?, final_decision = ?, confidence = ?, duration_ms = ?, completed_at = ? WHERE id = ?`),
  getCompositionsBySite: db.prepare(`SELECT * FROM symphony_compositions WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`),
  getActiveCompositions: db.prepare(`SELECT * FROM symphony_compositions WHERE status IN ('composing', 'executing') ORDER BY created_at DESC`),

  insertRole: db.prepare(`INSERT INTO symphony_roles (id, composition_id, role, agent_id) VALUES (?, ?, ?, ?)`),
  getRoles: db.prepare(`SELECT * FROM symphony_roles WHERE composition_id = ? ORDER BY started_at ASC`),
  getRole: db.prepare(`SELECT * FROM symphony_roles WHERE composition_id = ? AND role = ?`),
  updateRole: db.prepare(`UPDATE symphony_roles SET status = ?, input = ?, output = ?, reasoning = ?, confidence = ?, started_at = COALESCE(started_at, datetime('now')), completed_at = ? WHERE id = ?`),

  insertConsensus: db.prepare(`INSERT INTO symphony_consensus (id, composition_id, votes, method, result, agreement_score) VALUES (?, ?, ?, ?, ?, ?)`),
  getConsensus: db.prepare(`SELECT * FROM symphony_consensus WHERE composition_id = ?`),

  getTemplate: db.prepare(`SELECT * FROM symphony_templates WHERE name = ?`),
  getTemplateByType: db.prepare(`SELECT * FROM symphony_templates WHERE task_type = ?`),
  getAllTemplates: db.prepare(`SELECT * FROM symphony_templates ORDER BY name`),

  getStats: db.prepare(`SELECT
    (SELECT COUNT(*) FROM symphony_compositions WHERE site_id = ?) as total_compositions,
    (SELECT COUNT(*) FROM symphony_compositions WHERE site_id = ? AND status = 'completed') as completed,
    (SELECT AVG(confidence) FROM symphony_compositions WHERE site_id = ? AND status = 'completed') as avg_confidence,
    (SELECT AVG(duration_ms) FROM symphony_compositions WHERE site_id = ? AND status = 'completed') as avg_duration_ms`),
};

// ─── Role Engines (Rule-Based AI) ────────────────────────────────────

const RoleEngines = {
  /**
   * Researcher — Discovers and catalogs site information
   */
  researcher: {
    execute(input) {
      const { siteData, task } = input;
      const findings = [];
      const capabilities = [];

      // Analyze schema if available
      if (siteData?.schema) {
        const schema = typeof siteData.schema === 'string' ? JSON.parse(siteData.schema) : siteData.schema;
        if (schema.actions) {
          for (const [name, def] of Object.entries(schema.actions)) {
            capabilities.push({ name, type: 'action', params: Object.keys(def.params || {}) });
          }
          findings.push(`Found ${Object.keys(schema.actions).length} available actions`);
        }
        if (schema.products) {
          findings.push(`Catalog: ${schema.products.length || 'unknown'} products available`);
        }
      }

      // Extract relevant data points from site data
      if (siteData?.products) {
        const products = Array.isArray(siteData.products) ? siteData.products : [];
        const prices = products.filter((p) => p.price).map((p) => ({ name: p.name, price: p.price }));
        if (prices.length > 0) {
          findings.push(`Price range: ${Math.min(...prices.map((p) => p.price))} - ${Math.max(...prices.map((p) => p.price))}`);
        }
      }

      if (siteData?.categories) findings.push(`Categories: ${siteData.categories.join(', ')}`);
      if (siteData?.policies) {
        if (siteData.policies.returns) findings.push(`Return policy: ${siteData.policies.returns}`);
        if (siteData.policies.shipping) findings.push(`Shipping: ${siteData.policies.shipping}`);
      }

      return {
        findings,
        capabilities,
        dataQuality: findings.length > 3 ? 'rich' : findings.length > 0 ? 'moderate' : 'sparse',
        confidence: Math.min(0.95, 0.3 + findings.length * 0.1),
        reasoning: `Discovered ${findings.length} data points and ${capabilities.length} capabilities`,
      };
    },
  },

  /**
   * Analyst — Evaluates options using scoring heuristics
   */
  analyst: {
    execute(input) {
      const { findings, products, preferences, task } = input;
      const analyses = [];

      // Score products if available
      if (products && Array.isArray(products)) {
        const scored = products.map((product) => {
          let score = 50; // base score
          const reasons = [];

          // Price scoring
          if (product.price !== undefined && preferences?.maxPrice) {
            const priceRatio = product.price / preferences.maxPrice;
            if (priceRatio <= 0.5) { score += 25; reasons.push('well under budget'); }
            else if (priceRatio <= 0.8) { score += 15; reasons.push('within budget'); }
            else if (priceRatio <= 1.0) { score += 5; reasons.push('near budget limit'); }
            else { score -= 20; reasons.push('over budget'); }
          }

          // Rating scoring
          if (product.rating !== undefined) {
            score += (product.rating - 3) * 10;
            if (product.rating >= 4.5) reasons.push('highly rated');
            if (product.rating < 3) reasons.push('poorly rated');
          }

          // Availability
          if (product.inStock === false) { score -= 30; reasons.push('out of stock'); }

          // Discount scoring
          if (product.discount) {
            score += Math.min(20, product.discount);
            reasons.push(`${product.discount}% discount`);
          }

          // Preference matching
          if (preferences?.preferredCategory && product.category === preferences.preferredCategory) {
            score += 10;
            reasons.push('matches preferred category');
          }

          return { ...product, score: Math.max(0, Math.min(100, score)), reasons };
        });

        scored.sort((a, b) => b.score - a.score);
        analyses.push({
          type: 'product_ranking',
          items: scored.slice(0, 10),
          bestOption: scored[0],
          worstOption: scored[scored.length - 1],
        });
      }

      // Value analysis from findings
      const valueInsights = [];
      if (findings) {
        for (const f of findings) {
          if (typeof f === 'string' && f.includes('Price range')) valueInsights.push(f);
          if (typeof f === 'string' && f.includes('discount')) valueInsights.push(f);
          if (typeof f === 'string' && f.includes('Return policy')) valueInsights.push(f);
        }
      }

      return {
        analyses,
        valueInsights,
        recommendation: analyses[0]?.items?.[0] || null,
        confidence: analyses.length > 0 ? 0.7 + analyses[0].items.length * 0.02 : 0.3,
        reasoning: `Analyzed ${analyses.length > 0 ? analyses[0].items.length : 0} options with ${valueInsights.length} value insights`,
      };
    },
  },

  /**
   * Negotiator — Pursues optimal deal terms
   */
  negotiator: {
    execute(input) {
      const { product, siteCapabilities, preferences, marketData } = input;
      const strategies = [];
      const terms = {};

      if (!product) {
        return { strategies: [], terms: {}, confidence: 0, reasoning: 'No product to negotiate' };
      }

      const price = product.price || 0;

      // Strategy: Volume discount
      if (siteCapabilities?.some((c) => c.name === 'bulk_order' || c.name === 'quantity_discount')) {
        strategies.push({ type: 'volume', description: 'Request bulk/quantity discount', priority: 2 });
        terms.quantity_discount = true;
      }

      // Strategy: Competitor price matching
      if (marketData?.competitorPrices) {
        const lowest = Math.min(...marketData.competitorPrices);
        if (lowest < price) {
          strategies.push({ type: 'price_match', description: `Competitor offers ${lowest} (${Math.round((1 - lowest / price) * 100)}% less)`, priority: 3 });
          terms.target_price = lowest;
        }
      }

      // Strategy: Loyalty/repeat customer
      if (preferences?.visitCount > 3) {
        strategies.push({ type: 'loyalty', description: 'Leverage repeat customer status', priority: 1 });
        terms.loyalty = true;
      }

      // Strategy: Bundle deal
      if (siteCapabilities?.some((c) => c.name === 'bundle' || c.name === 'add_to_cart')) {
        strategies.push({ type: 'bundle', description: 'Explore bundle pricing', priority: 1 });
        terms.bundle = true;
      }

      // Calculate target price
      let targetDiscount = 0;
      if (strategies.length > 0) targetDiscount = Math.min(35, strategies.length * 8 + 5);
      terms.target_price = terms.target_price || price * (1 - targetDiscount / 100);
      terms.max_acceptable = price * 0.95; // worst case: 5% off
      terms.ideal_price = price * (1 - targetDiscount / 100);

      strategies.sort((a, b) => b.priority - a.priority);

      return {
        strategies,
        terms,
        confidence: Math.min(0.9, 0.3 + strategies.length * 0.15),
        reasoning: `${strategies.length} negotiation strategies identified, target ${targetDiscount}% discount`,
      };
    },
  },

  /**
   * Guardian — Validates safety, fairness, and trust
   */
  guardian: {
    execute(input) {
      const { product, siteData, negotiationTerms, reputationData } = input;
      const warnings = [];
      const approvals = [];
      let riskScore = 0;

      // Price manipulation check
      if (product?.price && product?.originalPrice) {
        const realDiscount = (1 - product.price / product.originalPrice) * 100;
        if (product.discount && Math.abs(product.discount - realDiscount) > 5) {
          warnings.push({ type: 'price_manipulation', severity: 'high', detail: `Claimed discount (${product.discount}%) doesn't match actual (${Math.round(realDiscount)}%)` });
          riskScore += 30;
        }
      }

      // Reputation check
      if (reputationData) {
        if (reputationData.trustLevel === 'emerging') {
          warnings.push({ type: 'low_trust', severity: 'medium', detail: 'Site has low trust level' });
          riskScore += 15;
        }
        if (reputationData.attestationCount < 3) {
          warnings.push({ type: 'few_attestations', severity: 'low', detail: 'Limited reputation data' });
          riskScore += 10;
        }
        if (reputationData.trustLevel === 'verified' || reputationData.trustLevel === 'exemplary') {
          approvals.push('trusted_site');
        }
      }

      // Negotiation terms safety
      if (negotiationTerms?.target_price && product?.price) {
        if (negotiationTerms.target_price < product.price * 0.3) {
          warnings.push({ type: 'unrealistic_price', severity: 'medium', detail: 'Target price seems unrealistically low' });
          riskScore += 10;
        }
      }

      // Data quality check
      if (siteData) {
        if (!siteData.policies?.returns) {
          warnings.push({ type: 'no_return_policy', severity: 'medium', detail: 'No return policy found' });
          riskScore += 10;
        }
        if (!siteData.policies?.privacy) {
          warnings.push({ type: 'no_privacy_policy', severity: 'low', detail: 'No privacy policy found' });
          riskScore += 5;
        }
      }

      const safe = riskScore < 40;
      if (safe) approvals.push('risk_acceptable');

      return {
        safe,
        riskScore: Math.min(100, riskScore),
        warnings,
        approvals,
        confidence: warnings.length === 0 ? 0.9 : Math.max(0.3, 0.9 - warnings.length * 0.1),
        reasoning: `Risk score: ${riskScore}/100, ${warnings.length} warnings, ${approvals.length} approvals`,
      };
    },
  },
};

// ─── Core API ────────────────────────────────────────────────────────

/**
 * Compose a new symphony — select template and assign roles.
 */
function compose(siteId, task, taskType, agentIds = {}) {
  const template = stmts.getTemplateByType.get(taskType) || stmts.getTemplateByType.get('exploration');
  if (!template) throw new Error(`No template for task type: ${taskType}`);

  const roles = JSON.parse(template.roles);
  const id = crypto.randomUUID();
  stmts.insertComposition.run(id, siteId, task, taskType);

  // Assign roles
  const roleAssignments = [];
  for (const role of roles) {
    const roleId = crypto.randomUUID();
    const agentId = agentIds[role] || null;
    stmts.insertRole.run(roleId, id, role, agentId);
    roleAssignments.push({ id: roleId, role, agentId });
  }

  return {
    compositionId: id,
    template: template.name,
    roles: roleAssignments,
    phases: JSON.parse(template.phase_order),
    status: 'composing',
  };
}

/**
 * Execute a single phase of the symphony.
 */
function executePhase(compositionId, phaseName, phaseInput = {}) {
  const comp = stmts.getComposition.get(compositionId);
  if (!comp) throw new Error('Composition not found');

  const roles = stmts.getRoles.all(compositionId);
  const phasesCompleted = JSON.parse(comp.phases_completed || '[]');

  // Determine which role handles this phase
  const phaseRoleMap = {
    discover: 'researcher',
    analyze: 'analyst',
    negotiate: 'negotiator',
    guard: 'guardian',
  };

  const roleName = phaseRoleMap[phaseName];
  if (!roleName) {
    // 'decide' phase — run consensus
    return _runConsensus(compositionId, roles);
  }

  const role = roles.find((r) => r.role === roleName);
  if (!role) {
    return { phase: phaseName, skipped: true, reason: `No ${roleName} assigned` };
  }

  // Gather input from previous phases
  const previousOutputs = {};
  for (const r of roles) {
    if (r.output && r.output !== '{}') {
      previousOutputs[r.role] = JSON.parse(r.output);
    }
  }

  const fullInput = { ...previousOutputs, ...phaseInput };

  // Execute the role engine
  const engine = RoleEngines[roleName];
  if (!engine) throw new Error(`No engine for role: ${roleName}`);

  const output = engine.execute(fullInput);

  // Save role result
  stmts.updateRole.run(
    'completed', JSON.stringify(fullInput), JSON.stringify(output),
    output.reasoning || '', output.confidence || 0,
    new Date().toISOString(), role.id
  );

  // Update composition
  phasesCompleted.push(phaseName);
  stmts.updateComposition.run(
    'executing', phaseName, JSON.stringify(phasesCompleted),
    null, 0, 0, null, compositionId
  );

  return { phase: phaseName, role: roleName, output, phasesCompleted };
}

/**
 * Execute the entire symphony end-to-end.
 */
function perform(siteId, task, taskType, inputData = {}, agentIds = {}) {
  const startTime = Date.now();
  const composition = compose(siteId, task, taskType, agentIds);

  // Get template phase order
  const template = stmts.getTemplateByType.get(taskType);
  const phases = template ? JSON.parse(template.phase_order) : ['discover', 'decide'];

  const phaseResults = {};

  // Execute phases sequentially, piping outputs
  for (const phase of phases) {
    const phaseInput = { ...inputData };

    // Pipe previous phase outputs
    for (const [prevPhase, prevResult] of Object.entries(phaseResults)) {
      if (prevResult.output) {
        Object.assign(phaseInput, prevResult.output);
      }
    }

    const result = executePhase(composition.compositionId, phase, phaseInput);
    phaseResults[phase] = result;
  }

  const duration = Date.now() - startTime;

  // Get final decision
  const consensus = stmts.getConsensus.get(composition.compositionId);
  const finalDecision = consensus ? JSON.parse(consensus.result) : phaseResults;

  // Calculate overall confidence
  const roleOutputs = Object.values(phaseResults).filter((r) => r.output?.confidence);
  const avgConfidence = roleOutputs.length > 0
    ? roleOutputs.reduce((s, r) => s + r.output.confidence, 0) / roleOutputs.length
    : 0;

  // Finalize composition
  stmts.updateComposition.run(
    'completed', 'decide', JSON.stringify(Object.keys(phaseResults)),
    JSON.stringify(finalDecision), avgConfidence, duration,
    new Date().toISOString(), composition.compositionId
  );

  return {
    compositionId: composition.compositionId,
    template: composition.template,
    phases: phaseResults,
    decision: finalDecision,
    confidence: avgConfidence,
    duration_ms: duration,
    status: 'completed',
  };
}

// ─── Consensus Engine ────────────────────────────────────────────────

function _runConsensus(compositionId, roles) {
  const completedRoles = roles.filter((r) => r.output && r.output !== '{}');
  const votes = {};
  let totalConfidence = 0;

  for (const role of completedRoles) {
    const output = JSON.parse(role.output);
    votes[role.role] = {
      confidence: output.confidence || 0,
      recommendation: output.recommendation || output.strategies?.[0] || null,
      reasoning: output.reasoning || '',
      safe: output.safe !== undefined ? output.safe : true,
      riskScore: output.riskScore || 0,
    };
    totalConfidence += output.confidence || 0;
  }

  // Weighted consensus
  const result = {
    recommendation: null,
    reasoning: [],
    overallConfidence: completedRoles.length > 0 ? totalConfidence / completedRoles.length : 0,
    safe: true,
    participatingRoles: completedRoles.map((r) => r.role),
  };

  // Guardian veto check
  if (votes.guardian && !votes.guardian.safe) {
    result.safe = false;
    result.recommendation = { action: 'abort', reason: 'Guardian flagged safety concerns', riskScore: votes.guardian.riskScore };
    result.reasoning.push(`GUARDIAN VETO: ${votes.guardian.reasoning}`);
  } else {
    // Take analyst recommendation if available, otherwise researcher findings
    if (votes.analyst?.recommendation) {
      result.recommendation = votes.analyst.recommendation;
      result.reasoning.push(`Analyst: ${votes.analyst.reasoning}`);
    }
    if (votes.negotiator) {
      result.negotiation = votes.negotiator;
      result.reasoning.push(`Negotiator: ${votes.negotiator.reasoning}`);
    }
    if (votes.researcher) {
      result.reasoning.push(`Researcher: ${votes.researcher.reasoning}`);
    }
    if (votes.guardian) {
      result.reasoning.push(`Guardian: ${votes.guardian.reasoning}`);
    }
  }

  const consensusId = crypto.randomUUID();
  const agreementScore = _calculateAgreement(votes);

  stmts.insertConsensus.run(
    consensusId, compositionId, JSON.stringify(votes),
    'weighted', JSON.stringify(result), agreementScore
  );

  return {
    phase: 'decide',
    consensus: result,
    votes,
    agreementScore,
  };
}

function _calculateAgreement(votes) {
  const confidences = Object.values(votes).map((v) => v.confidence);
  if (confidences.length < 2) return 1.0;

  // Agreement = inverse of confidence variance
  const mean = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  const variance = confidences.reduce((s, c) => s + (c - mean) ** 2, 0) / confidences.length;
  return Math.max(0, 1 - variance);
}

// ─── Query API ───────────────────────────────────────────────────────

function getComposition(compositionId) {
  const comp = stmts.getComposition.get(compositionId);
  if (!comp) return null;
  const roles = stmts.getRoles.all(compositionId);
  const consensus = stmts.getConsensus.get(compositionId);
  return {
    ...comp,
    phases_completed: JSON.parse(comp.phases_completed || '[]'),
    final_decision: comp.final_decision ? JSON.parse(comp.final_decision) : null,
    roles: roles.map((r) => ({ ...r, input: JSON.parse(r.input || '{}'), output: JSON.parse(r.output || '{}') })),
    consensus: consensus ? { ...consensus, votes: JSON.parse(consensus.votes), result: JSON.parse(consensus.result) } : null,
  };
}

function getCompositions(siteId, limit = 20) {
  return stmts.getCompositionsBySite.all(siteId, limit).map((c) => ({
    ...c,
    phases_completed: JSON.parse(c.phases_completed || '[]'),
    final_decision: c.final_decision ? JSON.parse(c.final_decision) : null,
  }));
}

function getTemplates() {
  return stmts.getAllTemplates.all().map((t) => ({
    ...t, roles: JSON.parse(t.roles), phase_order: JSON.parse(t.phase_order),
  }));
}

function getStats(siteId) {
  return stmts.getStats.get(siteId, siteId, siteId, siteId);
}

module.exports = {
  compose, executePhase, perform,
  getComposition, getCompositions, getTemplates, getStats,
  RoleEngines,
};
