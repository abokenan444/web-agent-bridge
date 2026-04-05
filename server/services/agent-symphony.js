/**
 * Symphony Orchestrator — Multi-Agent Composition Engine
 *
 * Orchestrates complex workflows by composing multiple agent roles into
 * coordinated multi-phase pipelines. Each role contributes specialized analysis,
 * and the results are fused into a unified recommendation.
 *
 * Architecture:
 *   - 4 specialized role engines: Researcher, Analyst, Negotiator, Guardian
 *   - 6-phase pipeline: analyze → research → negotiate → guard → synthesize → decide
 *   - Templates define which phases execute and in what order
 *   - Cross-service integration: Analyst consults learning engine for preferences
 *   - All decisions are recorded back to the learning engine for future improvement
 *   - No data leaves the WAB instance — everything runs locally
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

// Drop legacy schema if columns are incompatible (v2.3.0 → v2.3.1 migration)
try {
  const cols = db.prepare("PRAGMA table_info(symphony_compositions)").all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('template')) {
    db.exec('DROP TABLE IF EXISTS symphony_compositions');
    db.exec('DROP TABLE IF EXISTS symphony_phase_logs');
  }
} catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS symphony_compositions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    template TEXT NOT NULL,
    input_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    phases_completed TEXT DEFAULT '[]',
    current_phase TEXT,
    result TEXT,
    error TEXT,
    duration_ms INTEGER,
    agent_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS symphony_phase_logs (
    id TEXT PRIMARY KEY,
    composition_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    role TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sym_comp_site ON symphony_compositions(site_id);
  CREATE INDEX IF NOT EXISTS idx_sym_comp_status ON symphony_compositions(status);
  CREATE INDEX IF NOT EXISTS idx_sym_comp_template ON symphony_compositions(template);
  CREATE INDEX IF NOT EXISTS idx_sym_phase_comp ON symphony_phase_logs(composition_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertComposition: db.prepare('INSERT INTO symphony_compositions (id, site_id, template, input_data, status, current_phase, agent_count) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateComposition: db.prepare("UPDATE symphony_compositions SET status = ?, phases_completed = ?, current_phase = ?, result = ?, error = ?, duration_ms = ?, completed_at = datetime('now') WHERE id = ?"),
  updatePhase: db.prepare('UPDATE symphony_compositions SET current_phase = ?, phases_completed = ? WHERE id = ?'),
  getComposition: db.prepare('SELECT * FROM symphony_compositions WHERE id = ?'),
  getCompositions: db.prepare('SELECT * FROM symphony_compositions WHERE site_id = ? ORDER BY created_at DESC LIMIT ?'),
  getRecentByTemplate: db.prepare('SELECT * FROM symphony_compositions WHERE site_id = ? AND template = ? ORDER BY created_at DESC LIMIT ?'),

  insertPhaseLog: db.prepare('INSERT INTO symphony_phase_logs (id, composition_id, phase, role, input, output, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  getPhaseLogs: db.prepare('SELECT * FROM symphony_phase_logs WHERE composition_id = ? ORDER BY created_at ASC'),

  getStats: db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration,
    COUNT(DISTINCT template) as templates_used
    FROM symphony_compositions WHERE site_id = ?`),
};

// ─── Templates ───────────────────────────────────────────────────────

const TEMPLATES = {
  'product-purchase': {
    name: 'Smart Product Purchase',
    description: 'Full analysis pipeline for purchase decisions',
    phases: ['analyze', 'research', 'negotiate', 'guard', 'synthesize'],
    roles: ['analyst', 'researcher', 'negotiator', 'guardian'],
  },
  'content-discovery': {
    name: 'Content Discovery',
    description: 'Find and evaluate content across sources',
    phases: ['research', 'analyze', 'synthesize'],
    roles: ['researcher', 'analyst'],
  },
  'security-audit': {
    name: 'Security Audit',
    description: 'Comprehensive security and privacy evaluation',
    phases: ['research', 'guard', 'analyze', 'synthesize'],
    roles: ['researcher', 'guardian', 'analyst'],
  },
  'price-optimization': {
    name: 'Price Optimization',
    description: 'Find the best price through research and negotiation',
    phases: ['research', 'negotiate', 'guard', 'synthesize'],
    roles: ['researcher', 'negotiator', 'guardian'],
  },
  'comparison-analysis': {
    name: 'Comparison Analysis',
    description: 'Compare multiple options with weighted criteria',
    phases: ['research', 'analyze', 'synthesize'],
    roles: ['researcher', 'analyst'],
  },
};

// ─── Role Engines ────────────────────────────────────────────────────

const ROLE_ENGINES = {
  /**
   * Researcher — gathers structured data from the schema and context.
   */
  researcher: {
    execute(schema, context, priorOutputs) {
      const result = { sources: [], findings: [], dataQuality: 'unknown' };

      // Collect available actions from schema
      if (schema && schema.actions && Array.isArray(schema.actions)) {
        for (const action of schema.actions) {
          result.sources.push({
            type: 'action',
            name: action.name || action.id || 'unnamed',
            available: true,
            fields: Array.isArray(action.fields) ? action.fields.length : 0,
          });
        }
      }

      // Analyze context data
      if (context.items && Array.isArray(context.items)) {
        for (const item of context.items) {
          const finding = { type: 'item', name: item.name || item.title || 'Unknown' };
          if (item.price !== undefined) finding.price = item.price;
          if (item.rating !== undefined) finding.rating = item.rating;
          if (item.availability !== undefined) finding.availability = item.availability;
          if (item.category) finding.category = item.category;
          result.findings.push(finding);
        }
      }

      // Pull context fields directly
      if (context.url) result.researchedUrl = context.url;
      if (context.query) result.researchQuery = context.query;
      if (context.budget) result.budgetConstraint = context.budget;

      // Factor in prior research if present
      if (priorOutputs.research) {
        result.priorResearch = priorOutputs.research.findings?.length || 0;
      }

      result.dataQuality = result.findings.length > 3 ? 'high' : result.findings.length > 0 ? 'medium' : 'low';
      result.sourcesCount = result.sources.length;
      result.findingsCount = result.findings.length;

      return result;
    },
  },

  /**
   * Analyst — evaluates data using scoring criteria AND learned preferences.
   */
  analyst: {
    execute(schema, context, priorOutputs) {
      const research = priorOutputs.research || {};
      const findings = research.findings || context.items || [];

      // Build criteria from context or defaults
      const criteria = context.criteria || this._defaultCriteria(context);

      // Load learned preferences if learning engine is available
      let preferences = null;
      try {
        const learning = require('./agent-learning');
        const siteId = context.siteId || context.site_id || 'default';
        const agentId = context.agentId || 'symphony-analyst';
        const domain = context.domain || 'purchase';
        preferences = learning.getPreferences(siteId, agentId, domain);
      } catch (_) {
        // Learning engine not available — continue without preferences
      }

      // Score items
      const scored = findings.map((item) => {
        let score = 0;
        let weights = 0;
        const breakdown = {};

        for (const [criterion, weight] of Object.entries(criteria)) {
          let val = 0;

          if (criterion === 'price' && item.price !== undefined) {
            const budget = context.budget || 100;
            val = Math.max(0, 1 - item.price / budget); // lower price = higher score
          } else if (criterion === 'rating' && item.rating !== undefined) {
            val = item.rating / 5; // normalize to [0,1]
          } else if (criterion === 'availability' && item.availability !== undefined) {
            val = item.availability ? 1 : 0;
          } else if (criterion === 'quality' && item.quality !== undefined) {
            val = Math.min(1, item.quality / 10);
          } else if (criterion === 'popularity' && item.reviews !== undefined) {
            val = Math.min(1, item.reviews / 1000); // 1000+ reviews = max
          } else {
            continue; // Skip criteria with no matching data
          }

          // Apply preference modifier: if user historically prefers this criterion, boost it
          let prefModifier = 1;
          if (preferences && preferences.profile) {
            const prefEntry = preferences.profile[criterion] || preferences.profile[`category:${criterion}`];
            if (prefEntry) {
              prefModifier = prefEntry.direction === 'preferred' ? 1.2 : 0.8;
            }
          }

          const adjustedWeight = weight * prefModifier;
          breakdown[criterion] = { value: Math.round(val * 100) / 100, weight: adjustedWeight };
          score += val * adjustedWeight;
          weights += adjustedWeight;
        }

        return {
          item: item.name || item.title || 'Unknown',
          score: weights > 0 ? Math.round((score / weights) * 1000) / 1000 : 0,
          breakdown,
          raw: item,
        };
      });

      scored.sort((a, b) => b.score - a.score);

      return {
        rankings: scored,
        topPick: scored[0] || null,
        criteriaUsed: criteria,
        preferencesApplied: preferences !== null,
        preferenceSummary: preferences
          ? { confidence: preferences.confidence, topActions: preferences.topActions }
          : null,
        itemsEvaluated: scored.length,
      };
    },

    _defaultCriteria(context) {
      const c = { price: 0.3, rating: 0.3 };
      if (context.budget) c.price = 0.4;
      c.availability = 0.2;
      c.quality = 0.15;
      c.popularity = 0.05;
      return c;
    },
  },

  /**
   * Negotiator — identifies deals, calculates savings potential, suggests tactics.
   */
  negotiator: {
    execute(schema, context, priorOutputs) {
      const analysis = priorOutputs.analyze || {};
      const topPick = analysis.topPick || {};
      const item = topPick.raw || context.items?.[0] || {};
      const price = item.price || context.price || 0;
      const budget = context.budget || price * 1.2;

      // Calculate negotiation position
      const marketData = this._estimateMarketData(price, context);
      const savingsTarget = Math.round(price * 0.15); // Target 15% savings

      const tactics = [];

      // Bundle discount
      if (context.items && context.items.length > 1) {
        tactics.push({
          tactic: 'bundle_discount',
          description: 'Request bundle pricing for multiple items',
          potentialSavings: Math.round(price * 0.1),
          applicability: 'high',
        });
      }

      // Timing-based discount
      if (marketData.priceVolatility > 0.1) {
        tactics.push({
          tactic: 'price_timing',
          description: 'Price shows volatility — waiting may yield lower price',
          potentialSavings: Math.round(price * marketData.priceVolatility),
          applicability: 'medium',
        });
      }

      // Coupon/promo
      if (schema && schema.actions) {
        const hasPromo = schema.actions.some((a) =>
          (a.name || '').toLowerCase().includes('coupon') ||
          (a.name || '').toLowerCase().includes('promo') ||
          (a.name || '').toLowerCase().includes('discount')
        );
        if (hasPromo) {
          tactics.push({
            tactic: 'promo_code',
            description: 'Promotional actions detected in schema',
            potentialSavings: Math.round(price * 0.2),
            applicability: 'high',
          });
        }
      }

      // Loyalty / repeat customer
      tactics.push({
        tactic: 'loyalty_inquiry',
        description: 'Check for loyalty program or returning customer discounts',
        potentialSavings: Math.round(price * 0.05),
        applicability: 'low',
      });

      // Compute position strength
      const withinBudget = price <= budget;
      const bestSavings = tactics.reduce((max, t) => Math.max(max, t.potentialSavings), 0);

      return {
        originalPrice: price,
        targetPrice: price - savingsTarget,
        budget,
        withinBudget,
        maxPotentialSavings: bestSavings,
        tactics,
        marketEstimate: marketData,
        recommendation: withinBudget
          ? (bestSavings > price * 0.1 ? 'negotiate' : 'proceed')
          : 'reconsider',
      };
    },

    _estimateMarketData(price, context) {
      // Estimate market position from available signals
      const priceVolatility = context.priceHistory
        ? Math.min(1, context.priceHistory.stddev / price)
        : 0.1;
      const supplyLevel = context.availability === false ? 'low' : 'normal';
      const demandSignal = context.reviews && context.reviews > 500 ? 'high' : 'moderate';

      return {
        estimatedFairValue: Math.round(price * 0.9),
        priceVolatility: Math.round(priceVolatility * 100) / 100,
        supplyLevel,
        demandSignal,
      };
    },
  },

  /**
   * Guardian — security, privacy, and trust evaluation.
   */
  guardian: {
    execute(schema, context, priorOutputs) {
      const risks = [];
      let riskScore = 0;

      // Trust level assessment
      const trustLevel = context.trustLevel || context.trust_level || 'unknown';
      if (trustLevel === 'unknown' || trustLevel === 'emerging') {
        risks.push({
          category: 'trust',
          severity: trustLevel === 'unknown' ? 'high' : 'medium',
          description: `Site has ${trustLevel} trust level`,
          mitigation: 'Verify site reputation before providing sensitive data',
        });
        riskScore += trustLevel === 'unknown' ? 30 : 15;
      }

      // Schema field sensitivity check
      if (schema && schema.actions) {
        for (const action of schema.actions) {
          if (!Array.isArray(action.fields)) continue;
          for (const field of action.fields) {
            const name = (field.name || field.label || '').toLowerCase();
            if (/password|credit.?card|cvv|ssn|social.?security/i.test(name)) {
              risks.push({
                category: 'data_sensitivity',
                severity: 'high',
                description: `Sensitive field detected: ${field.name || field.label}`,
                mitigation: 'Ensure HTTPS and validate site certificate',
              });
              riskScore += 25;
            } else if (/email|phone|address|zip|birth/i.test(name)) {
              risks.push({
                category: 'data_sensitivity',
                severity: 'medium',
                description: `PII field detected: ${field.name || field.label}`,
                mitigation: 'Review privacy policy before sharing',
              });
              riskScore += 10;
            }
          }
        }
      }

      // URL safety
      if (context.url) {
        const urlLower = context.url.toLowerCase();
        if (!urlLower.startsWith('https://')) {
          risks.push({
            category: 'connection_security',
            severity: 'high',
            description: 'Connection is not encrypted (no HTTPS)',
            mitigation: 'Avoid entering sensitive data on insecure connections',
          });
          riskScore += 30;
        }
      }

      // Price anomaly check
      if (priorOutputs.negotiate) {
        const neg = priorOutputs.negotiate;
        if (neg.originalPrice && neg.marketEstimate) {
          const priceDelta = Math.abs(neg.originalPrice - neg.marketEstimate.estimatedFairValue) / neg.originalPrice;
          if (priceDelta > 0.4) {
            risks.push({
              category: 'price_anomaly',
              severity: 'medium',
              description: `Price deviates ${Math.round(priceDelta * 100)}% from estimated fair value`,
              mitigation: 'Cross-reference price with other sources',
            });
            riskScore += 15;
          }
        }
      }

      riskScore = Math.min(100, riskScore);
      const verdict = riskScore > 50 ? 'block' : riskScore > 25 ? 'caution' : 'safe';

      return {
        riskScore,
        verdict,
        risks,
        riskCount: risks.length,
        trustLevel,
        recommendation: verdict === 'block'
          ? 'Do not proceed — significant risks detected'
          : verdict === 'caution'
            ? 'Proceed with caution — review risks'
            : 'Safe to proceed',
      };
    },
  },
};

// ─── Synthesis Engine ────────────────────────────────────────────────

function _synthesize(phaseOutputs, context) {
  const synthesis = {
    summary: {},
    recommendation: 'proceed',
    confidence: 0,
    factors: [],
  };

  // Merge research
  if (phaseOutputs.research) {
    synthesis.summary.dataQuality = phaseOutputs.research.dataQuality;
    synthesis.summary.sourcesFound = phaseOutputs.research.sourcesCount || 0;
    synthesis.summary.findingsCount = phaseOutputs.research.findingsCount || 0;
  }

  // Merge analysis
  if (phaseOutputs.analyze) {
    const analysis = phaseOutputs.analyze;
    synthesis.summary.topPick = analysis.topPick?.item || null;
    synthesis.summary.topScore = analysis.topPick?.score || 0;
    synthesis.summary.itemsEvaluated = analysis.itemsEvaluated || 0;
    synthesis.summary.preferencesApplied = analysis.preferencesApplied || false;
    synthesis.factors.push({
      factor: 'analysis',
      impact: analysis.topPick?.score > 0.7 ? 'positive' : 'neutral',
      detail: `Top pick scored ${analysis.topPick?.score || 0}`,
    });
  }

  // Merge negotiation
  if (phaseOutputs.negotiate) {
    const neg = phaseOutputs.negotiate;
    synthesis.summary.originalPrice = neg.originalPrice;
    synthesis.summary.targetPrice = neg.targetPrice;
    synthesis.summary.maxSavings = neg.maxPotentialSavings;
    synthesis.summary.withinBudget = neg.withinBudget;
    synthesis.summary.tacticsAvailable = neg.tactics?.length || 0;
    synthesis.factors.push({
      factor: 'negotiation',
      impact: neg.recommendation === 'negotiate' ? 'opportunity' : neg.recommendation === 'proceed' ? 'positive' : 'negative',
      detail: `${neg.recommendation} — potential savings $${neg.maxPotentialSavings || 0}`,
    });
  }

  // Merge guardian
  if (phaseOutputs.guard) {
    const guard = phaseOutputs.guard;
    synthesis.summary.riskScore = guard.riskScore;
    synthesis.summary.risks = guard.riskCount;
    synthesis.summary.securityVerdict = guard.verdict;
    synthesis.factors.push({
      factor: 'security',
      impact: guard.verdict === 'safe' ? 'positive' : guard.verdict === 'caution' ? 'neutral' : 'negative',
      detail: `Risk score ${guard.riskScore}/100 — ${guard.verdict}`,
    });

    // Guardian can override recommendation
    if (guard.verdict === 'block') {
      synthesis.recommendation = 'block';
    }
  }

  // Confidence: average of positive/neutral factor count ratio
  const pos = synthesis.factors.filter((f) => f.impact === 'positive' || f.impact === 'opportunity').length;
  synthesis.confidence = synthesis.factors.length > 0
    ? Math.round((pos / synthesis.factors.length) * 1000) / 1000
    : 0.5;

  if (synthesis.recommendation !== 'block') {
    synthesis.recommendation = synthesis.confidence >= 0.5 ? 'proceed' : 'reconsider';
  }

  return synthesis;
}

// ─── Phase To Role Mapping ───────────────────────────────────────────

const PHASE_ROLE_MAP = {
  analyze: 'analyst',
  research: 'researcher',
  negotiate: 'negotiator',
  guard: 'guardian',
  synthesize: null, // Handled by _synthesize
};

// ─── Orchestration ───────────────────────────────────────────────────

/**
 * Execute a full symphony composition.
 *
 * @param {string} siteId - Site identifier
 * @param {string} templateName - Template to use
 * @param {object} inputData - User-provided context (cloned to prevent mutation)
 * @param {object} [schema] - Site WAB schema
 * @returns {{ compositionId, status, result, phaseLogs, durationMs }}
 */
function perform(siteId, templateName, inputData = {}, schema = null) {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Unknown template: ${templateName}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  const compositionId = crypto.randomUUID();
  const startTime = Date.now();

  // Clone inputData to prevent mutation of caller's object
  const context = JSON.parse(JSON.stringify(inputData));
  context.siteId = siteId;

  stmts.insertComposition.run(
    compositionId, siteId, templateName,
    JSON.stringify(context), 'running',
    template.phases[0], template.roles.length
  );

  const phaseOutputs = {};
  const phaseLogs = [];
  const completedPhases = [];

  try {
    for (const phase of template.phases) {
      const phaseStart = Date.now();

      stmts.updatePhase.run(phase, JSON.stringify(completedPhases), compositionId);

      let output;
      if (phase === 'synthesize') {
        output = _synthesize(phaseOutputs, context);
      } else {
        const roleName = PHASE_ROLE_MAP[phase];
        const engine = ROLE_ENGINES[roleName];
        if (!engine) {
          output = { skipped: true, reason: `No engine for role: ${roleName}` };
        } else {
          output = engine.execute(schema, context, phaseOutputs);
        }
      }

      phaseOutputs[phase] = output;
      completedPhases.push(phase);

      const phaseDuration = Date.now() - phaseStart;
      const logId = crypto.randomUUID();
      stmts.insertPhaseLog.run(
        logId, compositionId, phase, PHASE_ROLE_MAP[phase] || 'orchestrator',
        JSON.stringify(phase === 'synthesize' ? {} : context),
        JSON.stringify(output), phaseDuration
      );
      phaseLogs.push({ phase, role: PHASE_ROLE_MAP[phase] || 'orchestrator', output, durationMs: phaseDuration });
    }

    const durationMs = Date.now() - startTime;
    const finalResult = phaseOutputs.synthesize || phaseOutputs[completedPhases[completedPhases.length - 1]];

    stmts.updateComposition.run(
      'completed', JSON.stringify(completedPhases), null,
      JSON.stringify(finalResult), null, durationMs, compositionId
    );

    // Record decision to learning engine for future improvements
    _recordToLearning(siteId, templateName, context, finalResult);

    return { compositionId, status: 'completed', result: finalResult, phaseLogs, durationMs };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    stmts.updateComposition.run(
      'failed', JSON.stringify(completedPhases), null,
      null, err.message, durationMs, compositionId
    );
    return { compositionId, status: 'failed', error: err.message, phaseLogs, durationMs };
  }
}

/**
 * Record composition result to the learning engine so future runs improve.
 */
function _recordToLearning(siteId, templateName, context, result) {
  try {
    const learning = require('./agent-learning');
    const domain = context.domain || templateName;
    const action = result?.recommendation || 'unknown';

    learning.recordDecision(siteId, 'symphony', domain, action, {
      template: templateName,
      confidence: result?.confidence,
      riskScore: result?.summary?.riskScore,
      topScore: result?.summary?.topScore,
    });
  } catch (_) {
    // Learning engine unavailable — silently continue
  }
}

// ─── Query API ───────────────────────────────────────────────────────

function getComposition(id) {
  const row = stmts.getComposition.get(id);
  if (!row) return null;
  return _deserializeComposition(row);
}

function getCompositions(siteId, limit = 20) {
  return stmts.getCompositions.all(siteId, limit).map(_deserializeComposition);
}

function getCompositionsByTemplate(siteId, template, limit = 10) {
  return stmts.getRecentByTemplate.all(siteId, template, limit).map(_deserializeComposition);
}

function getPhaseLogs(compositionId) {
  const rows = stmts.getPhaseLogs.all(compositionId);
  return rows.map((r) => ({
    ...r,
    input: JSON.parse(r.input || '{}'),
    output: JSON.parse(r.output || '{}'),
  }));
}

function getTemplates() {
  return TEMPLATES;
}

function getStats(siteId) {
  const row = stmts.getStats.get(siteId);
  return {
    total: row.total || 0,
    completed: row.completed || 0,
    failed: row.failed || 0,
    successRate: row.total > 0 ? Math.round(((row.completed || 0) / row.total) * 1000) / 1000 : 0,
    avgDuration: row.avg_duration ? Math.round(row.avg_duration) : 0,
    templatesUsed: row.templates_used || 0,
  };
}

function _deserializeComposition(row) {
  return {
    ...row,
    input_data: JSON.parse(row.input_data || '{}'),
    phases_completed: JSON.parse(row.phases_completed || '[]'),
    result: row.result ? JSON.parse(row.result) : null,
  };
}

module.exports = {
  perform, getComposition, getCompositions, getCompositionsByTemplate,
  getPhaseLogs, getTemplates, getStats,
};
