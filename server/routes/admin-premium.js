const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/adminAuth');
const { db } = require('../models/db');

router.use(authenticateAdmin);

// ═══════════════════════════════════════════════════════════════════════
// Platform Overview
// ═══════════════════════════════════════════════════════════════════════

router.get('/overview/stats', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalSites = db.prepare('SELECT COUNT(*) as c FROM sites').get().c;
    const activeSites = db.prepare('SELECT COUNT(*) as c FROM sites WHERE active = 1').get().c;

    const revenue = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'succeeded'"
    ).get().total;

    const totalMemories = db.prepare('SELECT COUNT(*) as c FROM agent_memories').get().c;
    const totalHealingEvents = db.prepare('SELECT COUNT(*) as c FROM healing_log').get().c;
    const totalVisionAnalyses = db.prepare('SELECT COUNT(*) as c FROM vision_cache').get().c;
    const totalSwarmTasks = db.prepare('SELECT COUNT(*) as c FROM swarm_tasks').get().c;
    const pluginsInstalled = db.prepare('SELECT COUNT(*) as c FROM plugin_installations').get().c;

    const newUsersLast7Days = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-7 days')"
    ).get().c;
    const newSitesLast7Days = db.prepare(
      "SELECT COUNT(*) as c FROM sites WHERE created_at >= datetime('now', '-7 days')"
    ).get().c;

    const pageInfo = db.prepare('PRAGMA page_count').get();
    const pageSizeInfo = db.prepare('PRAGMA page_size').get();
    const dbSizeBytes = (pageInfo.page_count || 0) * (pageSizeInfo.page_size || 0);

    res.json({
      users: { total: totalUsers },
      sites: { total: totalSites, active: activeSites },
      revenue: { total: revenue },
      premiumFeatures: {
        totalMemories,
        totalHealingEvents,
        totalVisionAnalyses,
        totalSwarmTasks,
        pluginsInstalled,
      },
      growth: {
        newUsersLast7Days,
        newSitesLast7Days,
      },
      system: {
        dbSizeBytes,
        dbSizeMB: Math.round((dbSizeBytes / 1048576) * 100) / 100,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Memory Management
// ═══════════════════════════════════════════════════════════════════════

router.get('/memory/global-stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM agent_memories').get().c;
    const active = db.prepare(
      "SELECT COUNT(*) as c FROM agent_memories WHERE expires_at IS NULL OR expires_at > datetime('now')"
    ).get().c;
    const expired = db.prepare(
      "SELECT COUNT(*) as c FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
    ).get().c;

    const byType = db.prepare(
      'SELECT memory_type, COUNT(*) as count FROM agent_memories GROUP BY memory_type'
    ).all();
    const byCategory = db.prepare(
      'SELECT category, COUNT(*) as count FROM agent_memories GROUP BY category'
    ).all();

    const avgImportance = db.prepare(
      'SELECT AVG(importance) as avg FROM agent_memories'
    ).get().avg || 0;

    const storageBytes = db.prepare(
      'SELECT SUM(LENGTH(key) + LENGTH(value) + COALESCE(LENGTH(embedding), 0)) as bytes FROM agent_memories'
    ).get().bytes || 0;

    const totalSessions = db.prepare('SELECT COUNT(*) as c FROM memory_sessions').get().c;
    const totalAssociations = db.prepare('SELECT COUNT(*) as c FROM memory_associations').get().c;

    res.json({
      total,
      active,
      expired,
      byType,
      byCategory,
      avgImportance: Math.round(avgImportance * 1000) / 1000,
      storageBytes,
      totalSessions,
      totalAssociations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/memory/top-users', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT am.site_id, s.name as site_name, s.domain, u.email as user_email,
             COUNT(*) as memory_count,
             SUM(LENGTH(am.key) + LENGTH(am.value)) as storage_bytes,
             AVG(am.importance) as avg_importance
      FROM agent_memories am
      LEFT JOIN sites s ON am.site_id = s.id
      LEFT JOIN users u ON s.user_id = u.id
      GROUP BY am.site_id
      ORDER BY memory_count DESC
      LIMIT 20
    `).all();

    res.json({ topUsers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/memory/cleanup', (req, res) => {
  try {
    const result = db.prepare(
      "DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
    ).run();

    res.json({ purged: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Healing Management
// ═══════════════════════════════════════════════════════════════════════

router.get('/healing/global-stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM healing_log').get().c;
    const successes = db.prepare('SELECT COUNT(*) as c FROM healing_log WHERE success = 1').get().c;
    const successRate = total > 0 ? Math.round((successes / total) * 10000) / 100 : 0;

    const topStrategies = db.prepare(`
      SELECT strategy, COUNT(*) as count,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
             AVG(confidence) as avg_confidence
      FROM healing_log
      GROUP BY strategy
      ORDER BY count DESC
    `).all();

    const totalRegistered = db.prepare('SELECT COUNT(*) as c FROM selector_registry').get().c;
    const totalCorrections = db.prepare('SELECT COUNT(*) as c FROM selector_corrections').get().c;

    res.json({
      total,
      successes,
      successRate,
      topStrategies,
      totalRegistered,
      totalCorrections,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/healing/community-corrections', (req, res) => {
  try {
    const corrections = db.prepare(`
      SELECT sc.*, s.name as site_name, s.domain
      FROM selector_corrections sc
      LEFT JOIN sites s ON sc.site_id = s.id
      WHERE sc.shared = 1
      ORDER BY sc.applied_count DESC, sc.created_at DESC
    `).all();

    res.json({ corrections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/healing/broken-selectors', (req, res) => {
  try {
    const broken = db.prepare(`
      SELECT sr.*, s.name as site_name, s.domain
      FROM selector_registry sr
      LEFT JOIN sites s ON sr.site_id = s.id
      WHERE sr.confidence < 0.5
      ORDER BY sr.confidence ASC
    `).all();

    res.json({ broken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Vision Management
// ═══════════════════════════════════════════════════════════════════════

router.get('/vision/global-stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM vision_cache').get().c;
    const activeCached = db.prepare(
      "SELECT COUNT(*) as c FROM vision_cache WHERE expires_at > datetime('now')"
    ).get().c;
    const expiredCached = db.prepare(
      "SELECT COUNT(*) as c FROM vision_cache WHERE expires_at <= datetime('now')"
    ).get().c;
    const cacheHitRate = total > 0
      ? Math.round((activeCached / total) * 10000) / 100
      : 0;

    const providerUsage = db.prepare(`
      SELECT provider, COUNT(*) as count,
             SUM(tokens_used) as total_tokens,
             AVG(latency_ms) as avg_latency
      FROM vision_cache
      GROUP BY provider
      ORDER BY count DESC
    `).all();

    const totalTokens = db.prepare(
      'SELECT COALESCE(SUM(tokens_used), 0) as t FROM vision_cache'
    ).get().t;
    const avgLatency = db.prepare(
      'SELECT COALESCE(AVG(latency_ms), 0) as avg FROM vision_cache'
    ).get().avg;
    const totalElements = db.prepare('SELECT COUNT(*) as c FROM vision_elements').get().c;

    res.json({
      totalAnalyses: total,
      activeCached,
      expiredCached,
      cacheHitRate,
      providerUsage,
      totalTokens,
      avgLatencyMs: Math.round(avgLatency),
      totalElements,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vision/usage-by-site', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT vc.site_id, s.name as site_name, s.domain,
             COUNT(*) as analyses_count,
             SUM(vc.tokens_used) as total_tokens,
             AVG(vc.latency_ms) as avg_latency
      FROM vision_cache vc
      LEFT JOIN sites s ON vc.site_id = s.id
      GROUP BY vc.site_id
      ORDER BY analyses_count DESC
    `).all();

    res.json({ usageBySite: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/vision/purge-cache', (req, res) => {
  try {
    const cacheResult = db.prepare(
      "DELETE FROM vision_cache WHERE expires_at <= datetime('now')"
    ).run();
    const elemResult = db.prepare(
      'DELETE FROM vision_elements WHERE cache_id NOT IN (SELECT id FROM vision_cache)'
    ).run();

    res.json({
      purgedCacheEntries: cacheResult.changes,
      orphanedElementsCleaned: elemResult.changes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Swarm Management
// ═══════════════════════════════════════════════════════════════════════

router.get('/swarm/global-stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM swarm_tasks').get().c;
    const completed = db.prepare(
      "SELECT COUNT(*) as c FROM swarm_tasks WHERE status = 'completed'"
    ).get().c;
    const failed = db.prepare(
      "SELECT COUNT(*) as c FROM swarm_tasks WHERE status = 'failed'"
    ).get().c;
    const running = db.prepare(
      "SELECT COUNT(*) as c FROM swarm_tasks WHERE status = 'running'"
    ).get().c;
    const successRate = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;

    const avgAgentsRow = db.prepare(`
      SELECT AVG(agent_count) as avg_agents FROM (
        SELECT COUNT(*) as agent_count FROM swarm_agents
        GROUP BY task_id
      )
    `).get();
    const avgAgents = avgAgentsRow ? Math.round((avgAgentsRow.avg_agents || 0) * 100) / 100 : 0;

    const taskTypeBreakdown = db.prepare(`
      SELECT task_type, COUNT(*) as count,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM swarm_tasks
      GROUP BY task_type
    `).all();

    res.json({
      total,
      completed,
      failed,
      running,
      successRate,
      avgAgentsPerTask: avgAgents,
      taskTypeBreakdown,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/swarm/active-tasks', (req, res) => {
  try {
    const tasks = db.prepare(`
      SELECT st.*, s.name as site_name, s.domain
      FROM swarm_tasks st
      LEFT JOIN sites s ON st.site_id = s.id
      WHERE st.status IN ('pending', 'running')
      ORDER BY st.created_at DESC
    `).all();

    const enriched = tasks.map(t => {
      const agents = db.prepare(
        'SELECT id, agent_role, agent_type, target, status, score FROM swarm_agents WHERE task_id = ?'
      ).all(t.id);
      return { ...t, agents };
    });

    res.json({ activeTasks: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/swarm/cancel-all', (req, res) => {
  try {
    const now = new Date().toISOString();

    const runningTasks = db.prepare(
      "SELECT id FROM swarm_tasks WHERE status IN ('pending', 'running')"
    ).all();

    const cancelTx = db.transaction(() => {
      for (const task of runningTasks) {
        db.prepare(
          "UPDATE swarm_tasks SET status = 'cancelled', completed_at = ? WHERE id = ?"
        ).run(now, task.id);
        db.prepare(
          "UPDATE swarm_agents SET status = 'cancelled' WHERE task_id = ? AND status IN ('idle', 'running')"
        ).run(task.id);
      }
    });
    cancelTx();

    res.json({ cancelledTasks: runningTasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Plugin Management
// ═══════════════════════════════════════════════════════════════════════

router.get('/plugins/all', (req, res) => {
  try {
    const plugins = db.prepare(`
      SELECT pr.*,
             (SELECT COUNT(*) FROM plugin_installations pi WHERE pi.plugin_id = pr.id) as installation_count
      FROM plugin_registry pr
      ORDER BY pr.created_at DESC
    `).all();

    res.json({ plugins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plugins/:pluginId/toggle', (req, res) => {
  try {
    const { pluginId } = req.params;
    const plugin = db.prepare('SELECT * FROM plugin_registry WHERE id = ?').get(pluginId);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

    const newEnabled = plugin.enabled ? 0 : 1;
    db.prepare(
      "UPDATE plugin_registry SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newEnabled, pluginId);

    res.json({ pluginId, enabled: !!newEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plugins/hook-stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT hook_name,
             COUNT(*) as total_executions,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
             ROUND(CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) as success_rate,
             AVG(duration_ms) as avg_duration_ms
      FROM hook_executions
      GROUP BY hook_name
      ORDER BY total_executions DESC
    `).all();

    res.json({ hookStats: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plugins/:pluginId', (req, res) => {
  try {
    const { pluginId } = req.params;
    const plugin = db.prepare('SELECT * FROM plugin_registry WHERE id = ?').get(pluginId);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

    const removeTx = db.transaction(() => {
      db.prepare('DELETE FROM plugin_installations WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_hooks WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM hook_executions WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(pluginId);
    });
    removeTx();

    res.json({ removed: true, pluginId, name: plugin.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Revenue
// ═══════════════════════════════════════════════════════════════════════

function getTierPrices() {
  const plans = db.prepare('SELECT tier, price FROM plans').all();
  const prices = { free: 0, starter: 900, pro: 2900, enterprise: 9900 };
  for (const p of plans) prices[p.tier] = p.price;
  return prices;
}
const TIER_PRICES = new Proxy({}, { get: function(_, tier) { return getTierPrices()[tier] || 0; } });

router.get('/revenue/summary', (req, res) => {
  try {
    const tierCounts = db.prepare(`
      SELECT tier, COUNT(*) as count
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY tier
    `).all();

    let mrr = 0;
    for (const row of tierCounts) {
      mrr += (TIER_PRICES[row.tier] || 0) * row.count;
    }
    const arr = mrr * 12;

    const totalActive = db.prepare(
      "SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'"
    ).get().c;
    const cancelledLast30 = db.prepare(
      "SELECT COUNT(*) as c FROM subscriptions WHERE status = 'cancelled' AND started_at >= datetime('now', '-30 days')"
    ).get().c;
    const churnRate = totalActive > 0
      ? Math.round((cancelledLast30 / (totalActive + cancelledLast30)) * 10000) / 100
      : 0;

    const arpu = totalActive > 0 ? Math.round(mrr / totalActive) : 0;

    res.json({
      mrr,
      mrrFormatted: `$${(mrr / 100).toFixed(2)}`,
      arr,
      arrFormatted: `$${(arr / 100).toFixed(2)}`,
      churnRate,
      arpu,
      arpuFormatted: `$${(arpu / 100).toFixed(2)}`,
      activeSubscriptions: totalActive,
      cancelledLast30Days: cancelledLast30,
      tierCounts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/revenue/timeline', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month,
             SUM(amount) as total_amount,
             COUNT(*) as payment_count
      FROM payments
      WHERE status = 'succeeded'
        AND created_at >= datetime('now', '-12 months')
      GROUP BY month
      ORDER BY month ASC
    `).all();

    res.json({ timeline: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/revenue/tier-breakdown', (req, res) => {
  try {
    const totalSites = db.prepare('SELECT COUNT(*) as c FROM sites WHERE active = 1').get().c;
    const tiers = db.prepare(`
      SELECT tier, COUNT(*) as count
      FROM sites
      WHERE active = 1
      GROUP BY tier
      ORDER BY CASE tier
        WHEN 'free' THEN 1
        WHEN 'starter' THEN 2
        WHEN 'pro' THEN 3
        WHEN 'enterprise' THEN 4
      END
    `).all();

    const breakdown = tiers.map(t => ({
      tier: t.tier,
      count: t.count,
      percentage: totalSites > 0
        ? Math.round((t.count / totalSites) * 10000) / 100
        : 0,
      pricePerMonth: `$${((TIER_PRICES[t.tier] || 0) / 100).toFixed(2)}`,
    }));

    res.json({ totalActiveSites: totalSites, breakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// System
// ═══════════════════════════════════════════════════════════════════════

router.get('/system/health', (req, res) => {
  try {
    const pageInfo = db.prepare('PRAGMA page_count').get();
    const pageSizeInfo = db.prepare('PRAGMA page_size').get();
    const dbSizeBytes = (pageInfo.page_count || 0) * (pageSizeInfo.page_size || 0);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();

    const tableStats = tables.map(t => {
      const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
      return { table: t.name, rows: count };
    });

    res.json({
      dbSizeBytes,
      dbSizeMB: Math.round((dbSizeBytes / 1048576) * 100) / 100,
      tableCount: tables.length,
      tables: tableStats,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/maintenance', (req, res) => {
  try {
    db.exec('ANALYZE');

    const oldLogs = db.prepare(
      "DELETE FROM analytics WHERE created_at < datetime('now', '-90 days')"
    ).run();
    const oldHookExec = db.prepare(
      "DELETE FROM hook_executions WHERE executed_at < datetime('now', '-90 days')"
    ).run();
    const oldNotifications = db.prepare(
      "DELETE FROM notifications_log WHERE created_at < datetime('now', '-90 days')"
    ).run();

    db.exec('VACUUM');

    res.json({
      success: true,
      vacuumed: true,
      analyzed: true,
      deletedOldAnalytics: oldLogs.changes,
      deletedOldHookExecutions: oldHookExec.changes,
      deletedOldNotifications: oldNotifications.changes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/system/audit-log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const hasAuditLogs = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'"
    ).get();

    if (hasAuditLogs) {
      const logs = db.prepare(`
        SELECT al.*, s.name as site_name, s.domain
        FROM audit_logs al
        LEFT JOIN sites s ON al.site_id = s.id
        ORDER BY al.created_at DESC
        LIMIT ?
      `).all(limit);
      return res.json({ source: 'audit_logs', logs });
    }

    const logs = db.prepare(`
      SELECT a.*, s.name as site_name, s.domain
      FROM analytics a
      LEFT JOIN sites s ON a.site_id = s.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({ source: 'analytics', logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
