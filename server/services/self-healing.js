const { db } = require('../models/db');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS selector_registry (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    action_name TEXT NOT NULL,
    original_selector TEXT NOT NULL,
    current_selector TEXT NOT NULL,
    selector_type TEXT,
    element_signature TEXT DEFAULT '{}',
    confidence REAL DEFAULT 1.0,
    verified INTEGER DEFAULT 1,
    heal_count INTEGER DEFAULT 0,
    last_verified TEXT,
    last_healed TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS selector_corrections (
    id TEXT PRIMARY KEY,
    registry_id TEXT,
    site_id TEXT NOT NULL,
    old_selector TEXT NOT NULL,
    new_selector TEXT NOT NULL,
    corrected_by TEXT,
    reason TEXT,
    shared INTEGER DEFAULT 0,
    applied_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS healing_log (
    id TEXT PRIMARY KEY,
    registry_id TEXT,
    site_id TEXT NOT NULL,
    old_selector TEXT NOT NULL,
    new_selector TEXT,
    strategy TEXT,
    confidence REAL,
    success INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS element_snapshots (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    url TEXT NOT NULL,
    selector TEXT NOT NULL,
    snapshot TEXT DEFAULT '{}',
    captured_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_selector_registry_site ON selector_registry(site_id);
  CREATE INDEX IF NOT EXISTS idx_selector_registry_action ON selector_registry(action_name);
  CREATE INDEX IF NOT EXISTS idx_selector_registry_site_action ON selector_registry(site_id, action_name);
  CREATE INDEX IF NOT EXISTS idx_selector_corrections_site ON selector_corrections(site_id);
  CREATE INDEX IF NOT EXISTS idx_healing_log_site ON healing_log(site_id);
  CREATE INDEX IF NOT EXISTS idx_element_snapshots_site ON element_snapshots(site_id);
  CREATE INDEX IF NOT EXISTS idx_element_snapshots_site_url ON element_snapshots(site_id, url);
`);

// ═══════════════════════════════════════════════════════════════════════
// Prepared Statements
// ═══════════════════════════════════════════════════════════════════════

const stmts = {
  insertRegistry: db.prepare(`
    INSERT INTO selector_registry (id, site_id, action_name, original_selector, current_selector, selector_type, element_signature, confidence, last_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, datetime('now'))
  `),
  findRegistry: db.prepare(`
    SELECT * FROM selector_registry WHERE site_id = ? AND action_name = ?
  `),
  findRegistryById: db.prepare(`
    SELECT * FROM selector_registry WHERE id = ?
  `),
  updateRegistrySelector: db.prepare(`
    UPDATE selector_registry
    SET current_selector = ?, confidence = ?, heal_count = heal_count + 1,
        last_healed = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `),
  updateRegistryVerified: db.prepare(`
    UPDATE selector_registry
    SET verified = ?, confidence = ?, last_verified = datetime('now'), updated_at = datetime('now')
    WHERE site_id = ? AND action_name = ?
  `),
  insertCorrection: db.prepare(`
    INSERT INTO selector_corrections (id, registry_id, site_id, old_selector, new_selector, corrected_by, reason, shared)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateRegistryFromCorrection: db.prepare(`
    UPDATE selector_registry
    SET current_selector = ?, confidence = 1.0, heal_count = heal_count + 1,
        last_healed = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `),
  findSharedCorrections: db.prepare(`
    SELECT * FROM selector_corrections
    WHERE site_id = ? AND old_selector = ? AND shared = 1
    ORDER BY applied_count DESC
  `),
  incrementCorrectionApplied: db.prepare(`
    UPDATE selector_corrections SET applied_count = applied_count + 1 WHERE id = ?
  `),
  insertHealingLog: db.prepare(`
    INSERT INTO healing_log (id, registry_id, site_id, old_selector, new_selector, strategy, confidence, success)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getHealingLogBySite: db.prepare(`
    SELECT * FROM healing_log WHERE site_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  getHealingLogBySiteAction: db.prepare(`
    SELECT hl.* FROM healing_log hl
    JOIN selector_registry sr ON hl.registry_id = sr.id
    WHERE hl.site_id = ? AND sr.action_name = ?
    ORDER BY hl.created_at DESC LIMIT ?
  `),
  getSelectorsBySite: db.prepare(`
    SELECT * FROM selector_registry WHERE site_id = ?
  `),
  insertSnapshot: db.prepare(`
    INSERT INTO element_snapshots (id, site_id, url, selector, snapshot, captured_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `),
  getLatestSnapshot: db.prepare(`
    SELECT * FROM element_snapshots WHERE site_id = ? AND url = ? ORDER BY captured_at DESC LIMIT 1
  `),
};

// ═══════════════════════════════════════════════════════════════════════
// 1. Register Selector
// ═══════════════════════════════════════════════════════════════════════

function registerSelector(siteId, { actionName, selector, selectorType, elementSignature }) {
  const id = crypto.randomUUID();
  const sigJson = typeof elementSignature === 'string'
    ? elementSignature
    : JSON.stringify(elementSignature || {});

  stmts.insertRegistry.run(
    id, siteId, actionName, selector, selector,
    selectorType || 'css', sigJson
  );

  return { id, siteId, actionName, selector, selectorType: selectorType || 'css' };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Capture Element Signature
// ═══════════════════════════════════════════════════════════════════════

function captureElementSignature(elementData) {
  if (!elementData) return {};

  const tag = (elementData.tag || elementData.tagName || '').toLowerCase();
  const id = elementData.id || null;

  let classes = [];
  if (Array.isArray(elementData.classes)) {
    classes = elementData.classes.filter(Boolean).sort();
  } else if (typeof elementData.className === 'string') {
    classes = elementData.className.split(/\s+/).filter(Boolean).sort();
  }

  const attrs = {};
  const rawAttrs = elementData.attributes || elementData.attrs || {};
  const attrKeys = Object.keys(rawAttrs).sort();
  for (const key of attrKeys) {
    const lower = key.toLowerCase();
    if (lower === 'class' || lower === 'id' || lower === 'style') continue;
    attrs[lower] = rawAttrs[key];
  }

  const text = (elementData.text || elementData.textContent || elementData.innerText || '')
    .trim()
    .substring(0, 200);

  let parent = null;
  if (elementData.parent) {
    parent = {
      tag: (elementData.parent.tag || elementData.parent.tagName || '').toLowerCase(),
      id: elementData.parent.id || null,
      classes: Array.isArray(elementData.parent.classes)
        ? elementData.parent.classes.filter(Boolean).sort()
        : (elementData.parent.className || '').split(/\s+/).filter(Boolean).sort(),
    };
  }

  let siblings = [];
  if (Array.isArray(elementData.siblings)) {
    siblings = elementData.siblings.map(sib => ({
      tag: (sib.tag || sib.tagName || '').toLowerCase(),
      id: sib.id || null,
      classes: Array.isArray(sib.classes)
        ? sib.classes.filter(Boolean).sort()
        : (sib.className || '').split(/\s+/).filter(Boolean).sort(),
    }));
  }

  return {
    tag,
    id,
    classes,
    attributes: attrs,
    text,
    parent,
    siblings,
    capturedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Levenshtein Distance & Text Similarity
// ═══════════════════════════════════════════════════════════════════════

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a || !a.length) return b ? b.length : 0;
  if (!b || !b.length) return a.length;

  const m = a.length;
  const n = b.length;
  const dp = new Array(m + 1);

  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1);
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function textSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (levenshteinDistance(a, b) / maxLen);
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Heal Selector (Core Algorithm)
// ═══════════════════════════════════════════════════════════════════════

function healSelector(siteId, actionName, failedSelector, pageElements) {
  const registry = stmts.findRegistry.get(siteId, actionName);
  const registryId = registry ? registry.id : null;

  let storedSignature = {};
  if (registry) {
    try { storedSignature = JSON.parse(registry.element_signature || '{}'); } catch { /* empty */ }
  }

  if (!Array.isArray(pageElements) || pageElements.length === 0) {
    const logId = crypto.randomUUID();
    stmts.insertHealingLog.run(logId, registryId, siteId, failedSelector, null, 'none', 0, 0);
    return { healed: false, newSelector: null, strategy: null, confidence: 0 };
  }

  const candidates = [];

  for (const el of pageElements) {
    const sig = captureElementSignature(el);

    // Strategy 1: attribute_match — data-* attributes and aria-label
    const storedAttrs = storedSignature.attributes || {};
    const elAttrs = sig.attributes || {};
    let attrMatches = 0;
    let attrTotal = 0;
    for (const key of Object.keys(storedAttrs)) {
      if (key.startsWith('data-') || key === 'aria-label' || key.startsWith('aria-')) {
        attrTotal++;
        if (elAttrs[key] === storedAttrs[key]) attrMatches++;
      }
    }
    if (attrTotal > 0 && attrMatches > 0) {
      const conf = attrMatches / attrTotal;
      candidates.push({
        element: el,
        signature: sig,
        strategy: 'attribute_match',
        confidence: conf * 0.95,
        selector: buildCSSPath(el),
      });
    }

    // Strategy 2: id_match — partial ID matching
    if (storedSignature.id && sig.id) {
      const sim = textSimilarity(storedSignature.id, sig.id);
      if (sim > 0.5) {
        candidates.push({
          element: el,
          signature: sig,
          strategy: 'id_match',
          confidence: sim * 0.98,
          selector: `#${sig.id}`,
        });
      }
    }

    // Strategy 3: text_match — Levenshtein-based text similarity
    if (storedSignature.text && sig.text) {
      const sim = textSimilarity(
        storedSignature.text.toLowerCase(),
        sig.text.toLowerCase()
      );
      if (sim > 0.5) {
        candidates.push({
          element: el,
          signature: sig,
          strategy: 'text_match',
          confidence: sim * 0.85,
          selector: buildCSSPath(el),
        });
      }
    }

    // Strategy 4: structural_match — parent>nth-child path matching
    if (storedSignature.parent && sig.parent) {
      let structScore = 0;
      let structChecks = 0;

      if (storedSignature.tag && sig.tag) {
        structChecks++;
        if (storedSignature.tag === sig.tag) structScore++;
      }

      structChecks++;
      if (storedSignature.parent.tag === sig.parent.tag) structScore++;

      if (storedSignature.parent.id && sig.parent.id) {
        structChecks++;
        if (storedSignature.parent.id === sig.parent.id) structScore++;
      }

      const storedParentClasses = storedSignature.parent.classes || [];
      const elParentClasses = sig.parent.classes || [];
      if (storedParentClasses.length > 0) {
        structChecks++;
        const overlap = storedParentClasses.filter(c => elParentClasses.includes(c));
        structScore += overlap.length / storedParentClasses.length;
      }

      if (storedSignature.siblings && sig.siblings) {
        structChecks++;
        const storedSibTags = storedSignature.siblings.map(s => s.tag).sort();
        const elSibTags = sig.siblings.map(s => s.tag).sort();
        const sibSim = textSimilarity(storedSibTags.join(','), elSibTags.join(','));
        structScore += sibSim;
      }

      if (structChecks > 0) {
        const conf = structScore / structChecks;
        if (conf > 0.4) {
          const nthChild = el.index != null ? el.index + 1 : 1;
          const parentSel = sig.parent.id
            ? `#${sig.parent.id}`
            : sig.parent.tag;
          candidates.push({
            element: el,
            signature: sig,
            strategy: 'structural_match',
            confidence: conf * 0.80,
            selector: `${parentSel} > ${sig.tag}:nth-child(${nthChild})`,
          });
        }
      }
    }

    // Strategy 5: class_match — overlapping CSS classes
    const storedClasses = storedSignature.classes || [];
    const elClasses = sig.classes || [];
    if (storedClasses.length > 0 && elClasses.length > 0) {
      const overlap = storedClasses.filter(c => elClasses.includes(c));
      if (overlap.length > 0) {
        const conf = overlap.length / Math.max(storedClasses.length, elClasses.length);
        candidates.push({
          element: el,
          signature: sig,
          strategy: 'class_match',
          confidence: conf * 0.75,
          selector: `${sig.tag || '*'}.${overlap.join('.')}`,
        });
      }
    }
  }

  // Strategy 6: community_match — known corrections
  const communityCorrections = stmts.findSharedCorrections.all(siteId, failedSelector);
  for (const corr of communityCorrections) {
    const appliedBoost = Math.min(corr.applied_count * 0.02, 0.15);
    candidates.push({
      element: null,
      signature: null,
      strategy: 'community_match',
      confidence: 0.70 + appliedBoost,
      selector: corr.new_selector,
      correctionId: corr.id,
    });
  }

  // Pick highest confidence above threshold
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates.find(c => c.confidence >= 0.6);

  if (!best) {
    const logId = crypto.randomUUID();
    stmts.insertHealingLog.run(logId, registryId, siteId, failedSelector, null, 'none', 0, 0);
    return { healed: false, newSelector: null, strategy: null, confidence: 0 };
  }

  const logId = crypto.randomUUID();
  stmts.insertHealingLog.run(
    logId, registryId, siteId, failedSelector,
    best.selector, best.strategy, best.confidence, 1
  );

  if (registryId) {
    stmts.updateRegistrySelector.run(best.selector, best.confidence, registryId);
  }

  if (best.correctionId) {
    stmts.incrementCorrectionApplied.run(best.correctionId);
  }

  return {
    healed: true,
    newSelector: best.selector,
    strategy: best.strategy,
    confidence: Math.round(best.confidence * 1000) / 1000,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Submit Correction
// ═══════════════════════════════════════════════════════════════════════

function submitCorrection(siteId, registryId, { oldSelector, newSelector, correctedBy, reason, shared }) {
  const id = crypto.randomUUID();
  stmts.insertCorrection.run(
    id, registryId || null, siteId,
    oldSelector, newSelector,
    correctedBy || 'user',
    reason || null,
    shared ? 1 : 0
  );

  if (registryId) {
    const reg = stmts.findRegistryById.get(registryId);
    if (reg) {
      stmts.updateRegistryFromCorrection.run(newSelector, registryId);
    }
  }

  return { id, siteId, registryId, oldSelector, newSelector };
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Community Suggestions
// ═══════════════════════════════════════════════════════════════════════

function getCommunitySuggestions(siteId, failedSelector) {
  return stmts.findSharedCorrections.all(siteId, failedSelector);
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Verify Selector
// ═══════════════════════════════════════════════════════════════════════

function verifySelector(siteId, actionName, elementData) {
  const registry = stmts.findRegistry.get(siteId, actionName);
  if (!registry) {
    return { valid: false, confidence: 0, drift: null, error: 'Selector not registered' };
  }

  let storedSignature;
  try { storedSignature = JSON.parse(registry.element_signature || '{}'); } catch { storedSignature = {}; }

  const currentSignature = captureElementSignature(elementData);

  let totalChecks = 0;
  let matchScore = 0;
  const driftDetails = {};

  if (storedSignature.tag) {
    totalChecks++;
    if (storedSignature.tag === currentSignature.tag) {
      matchScore++;
    } else {
      driftDetails.tag = { expected: storedSignature.tag, actual: currentSignature.tag };
    }
  }

  if (storedSignature.id) {
    totalChecks++;
    if (storedSignature.id === currentSignature.id) {
      matchScore++;
    } else {
      driftDetails.id = { expected: storedSignature.id, actual: currentSignature.id };
    }
  }

  const storedClasses = storedSignature.classes || [];
  const currentClasses = currentSignature.classes || [];
  if (storedClasses.length > 0) {
    totalChecks++;
    const overlap = storedClasses.filter(c => currentClasses.includes(c));
    const classRatio = overlap.length / storedClasses.length;
    matchScore += classRatio;
    if (classRatio < 1) {
      const removed = storedClasses.filter(c => !currentClasses.includes(c));
      const added = currentClasses.filter(c => !storedClasses.includes(c));
      driftDetails.classes = { removed, added, overlapRatio: classRatio };
    }
  }

  const storedAttrs = storedSignature.attributes || {};
  const currentAttrs = currentSignature.attributes || {};
  const allAttrKeys = [...new Set([...Object.keys(storedAttrs), ...Object.keys(currentAttrs)])];
  if (allAttrKeys.length > 0) {
    totalChecks++;
    let attrMatch = 0;
    const changedAttrs = {};
    for (const key of allAttrKeys) {
      if (storedAttrs[key] === currentAttrs[key]) {
        attrMatch++;
      } else {
        changedAttrs[key] = { expected: storedAttrs[key] || null, actual: currentAttrs[key] || null };
      }
    }
    matchScore += attrMatch / allAttrKeys.length;
    if (Object.keys(changedAttrs).length > 0) {
      driftDetails.attributes = changedAttrs;
    }
  }

  if (storedSignature.text) {
    totalChecks++;
    const sim = textSimilarity(
      storedSignature.text.toLowerCase(),
      (currentSignature.text || '').toLowerCase()
    );
    matchScore += sim;
    if (sim < 0.95) {
      driftDetails.text = {
        expected: storedSignature.text.substring(0, 50),
        actual: (currentSignature.text || '').substring(0, 50),
        similarity: Math.round(sim * 1000) / 1000,
      };
    }
  }

  const confidence = totalChecks > 0 ? matchScore / totalChecks : 0;
  const valid = confidence >= 0.7;
  const hasDrift = Object.keys(driftDetails).length > 0;

  stmts.updateRegistryVerified.run(valid ? 1 : 0, confidence, siteId, actionName);

  return {
    valid,
    confidence: Math.round(confidence * 1000) / 1000,
    drift: hasDrift ? driftDetails : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Selector Health
// ═══════════════════════════════════════════════════════════════════════

function getSelectorHealth(siteId) {
  const all = stmts.getSelectorsBySite.all(siteId);
  const total = all.length;

  if (total === 0) {
    return { total: 0, verified: 0, healed: 0, avgConfidence: 0, broken: [] };
  }

  let verifiedCount = 0;
  let healedCount = 0;
  let confidenceSum = 0;
  const broken = [];

  for (const row of all) {
    confidenceSum += row.confidence;
    if (row.verified) verifiedCount++;
    if (row.heal_count > 0) healedCount++;
    if (!row.verified || row.confidence < 0.6) {
      broken.push({
        id: row.id,
        actionName: row.action_name,
        currentSelector: row.current_selector,
        confidence: row.confidence,
        healCount: row.heal_count,
        lastHealed: row.last_healed,
      });
    }
  }

  return {
    total,
    verified: verifiedCount,
    healed: healedCount,
    avgConfidence: Math.round((confidenceSum / total) * 1000) / 1000,
    broken,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Healing History
// ═══════════════════════════════════════════════════════════════════════

function getHealingHistory(siteId, { limit, actionName } = {}) {
  const lim = limit || 50;
  if (actionName) {
    return stmts.getHealingLogBySiteAction.all(siteId, actionName, lim);
  }
  return stmts.getHealingLogBySite.all(siteId, lim);
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Snapshot Elements
// ═══════════════════════════════════════════════════════════════════════

function snapshotElements(siteId, url, elements) {
  const id = crypto.randomUUID();
  const snapshotData = Array.isArray(elements)
    ? elements.map(el => captureElementSignature(el))
    : [];

  stmts.insertSnapshot.run(
    id, siteId, url, '*',
    JSON.stringify(snapshotData)
  );

  return { id, siteId, url, elementCount: snapshotData.length };
}

// ═══════════════════════════════════════════════════════════════════════
// 11. Detect Drift
// ═══════════════════════════════════════════════════════════════════════

function detectDrift(siteId, url, currentElements) {
  const lastSnapshot = stmts.getLatestSnapshot.get(siteId, url);
  if (!lastSnapshot) {
    return { hasDrift: false, message: 'No previous snapshot found', changed: [], added: [], removed: [] };
  }

  let previousElements;
  try { previousElements = JSON.parse(lastSnapshot.snapshot || '[]'); } catch { previousElements = []; }

  const currentSigs = (Array.isArray(currentElements) ? currentElements : [])
    .map(el => captureElementSignature(el));

  function fingerprint(sig) {
    return `${sig.tag || ''}|${sig.id || ''}|${(sig.classes || []).join(',')}|${sig.text || ''}`;
  }

  const prevFingerprints = new Map();
  for (let i = 0; i < previousElements.length; i++) {
    prevFingerprints.set(fingerprint(previousElements[i]), i);
  }

  const currFingerprints = new Map();
  for (let i = 0; i < currentSigs.length; i++) {
    currFingerprints.set(fingerprint(currentSigs[i]), i);
  }

  const changed = [];
  const added = [];
  const removed = [];

  for (const [fp, idx] of currFingerprints) {
    if (!prevFingerprints.has(fp)) {
      const prevBySamePosTag = previousElements[idx];
      if (prevBySamePosTag && prevBySamePosTag.tag === currentSigs[idx].tag) {
        const sim = textSimilarity(fingerprint(prevBySamePosTag), fp);
        if (sim > 0.3 && sim < 1.0) {
          changed.push({
            index: idx,
            previous: previousElements[idx],
            current: currentSigs[idx],
            similarity: Math.round(sim * 1000) / 1000,
          });
          continue;
        }
      }
      added.push({ index: idx, element: currentSigs[idx] });
    }
  }

  for (const [fp, idx] of prevFingerprints) {
    if (!currFingerprints.has(fp)) {
      const alreadyChanged = changed.some(c => c.index === idx);
      if (!alreadyChanged) {
        removed.push({ index: idx, element: previousElements[idx] });
      }
    }
  }

  return {
    hasDrift: changed.length > 0 || added.length > 0 || removed.length > 0,
    snapshotDate: lastSnapshot.captured_at,
    changed,
    added,
    removed,
    summary: {
      changedCount: changed.length,
      addedCount: added.length,
      removedCount: removed.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 12. Build CSS Path
// ═══════════════════════════════════════════════════════════════════════

function buildCSSPath(elementData) {
  if (!elementData) return '*';

  const tag = (elementData.tag || elementData.tagName || '').toLowerCase();
  const id = elementData.id;

  if (id) return `#${id}`;

  let selector = tag || '*';

  let classes = [];
  if (Array.isArray(elementData.classes)) {
    classes = elementData.classes.filter(Boolean);
  } else if (typeof elementData.className === 'string') {
    classes = elementData.className.split(/\s+/).filter(Boolean);
  }
  if (classes.length > 0) {
    selector += '.' + classes.join('.');
  }

  const attrs = elementData.attributes || elementData.attrs || {};
  for (const key of Object.keys(attrs)) {
    const lower = key.toLowerCase();
    if (lower === 'class' || lower === 'id' || lower === 'style') continue;
    const val = attrs[key];
    if (val != null && val !== '') {
      selector += `[${lower}="${val.replace(/"/g, '\\"')}"]`;
    } else if (val === '' || val == null) {
      selector += `[${lower}]`;
    }
  }

  return selector;
}

// ═══════════════════════════════════════════════════════════════════════
// 13. Build XPath
// ═══════════════════════════════════════════════════════════════════════

function buildXPath(elementData) {
  if (!elementData) return '//*';

  const tag = (elementData.tag || elementData.tagName || '').toLowerCase() || '*';
  const id = elementData.id;

  if (id) return `//${tag}[@id="${id}"]`;

  const predicates = [];

  let classes = [];
  if (Array.isArray(elementData.classes)) {
    classes = elementData.classes.filter(Boolean);
  } else if (typeof elementData.className === 'string') {
    classes = elementData.className.split(/\s+/).filter(Boolean);
  }
  for (const cls of classes) {
    predicates.push(`contains(@class, "${cls}")`);
  }

  const attrs = elementData.attributes || elementData.attrs || {};
  for (const key of Object.keys(attrs)) {
    const lower = key.toLowerCase();
    if (lower === 'class' || lower === 'id' || lower === 'style') continue;
    const val = attrs[key];
    if (val != null && val !== '') {
      predicates.push(`@${lower}="${val}"`);
    } else {
      predicates.push(`@${lower}`);
    }
  }

  const text = (elementData.text || elementData.textContent || elementData.innerText || '').trim();
  if (text && text.length <= 80) {
    if (!text.includes('"')) {
      predicates.push(`normalize-space(text())="${text}"`);
    } else if (!text.includes("'")) {
      predicates.push(`normalize-space(text())='${text}'`);
    }
  }

  if (predicates.length === 0) return `//${tag}`;
  return `//${tag}[${predicates.join(' and ')}]`;
}

// ═══════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  registerSelector,
  captureElementSignature,
  healSelector,
  levenshteinDistance,
  textSimilarity,
  submitCorrection,
  getCommunitySuggestions,
  verifySelector,
  getSelectorHealth,
  getHealingHistory,
  snapshotElements,
  detectDrift,
  buildCSSPath,
  buildXPath,
};
