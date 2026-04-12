/**
 * WAB Agent Workspace — Server-side Route & API
 * ════════════════════════════════════════════════════════════════════════
 * Premium workspace endpoints for the 4-panel agent workspace.
 * Handles subscriptions, workspace sessions, agent execution, and admin stats.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','starter','pro','enterprise')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','expired','suspended')),
    tasks_today INTEGER DEFAULT 0,
    tasks_total INTEGER DEFAULT 0,
    deals_completed INTEGER DEFAULT 0,
    total_savings REAL DEFAULT 0,
    last_task_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_token TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    panels_state TEXT DEFAULT '{}',
    last_activity TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_deals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_id TEXT,
    offer_source TEXT,
    offer_title TEXT,
    original_price REAL,
    final_price REAL,
    savings REAL DEFAULT 0,
    status TEXT DEFAULT 'presented' CHECK(status IN ('presented','clicked','agent_executing','login_required','completed','failed')),
    deal_url TEXT,
    requires_login INTEGER DEFAULT 0,
    login_method TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_analytics (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ws_subs_user ON workspace_subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ws_sessions_user ON workspace_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ws_deals_user ON workspace_deals(user_id);
  CREATE INDEX IF NOT EXISTS idx_ws_analytics_type ON workspace_analytics(event_type);
  CREATE INDEX IF NOT EXISTS idx_ws_analytics_date ON workspace_analytics(created_at);
`);

// ─── Plan Limits ─────────────────────────────────────────────────────

const PLAN_LIMITS = {
  free:       { dailyTasks: 5,   maxResults: 3,  negotiation: false, agentExecute: false },
  starter:    { dailyTasks: 30,  maxResults: 10, negotiation: true,  agentExecute: false },
  pro:        { dailyTasks: -1,  maxResults: 20, negotiation: true,  agentExecute: true  },
  enterprise: { dailyTasks: -1,  maxResults: 50, negotiation: true,  agentExecute: true  },
};

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  getSub: db.prepare('SELECT * FROM workspace_subscriptions WHERE user_id = ? AND status = ?'),
  insertSub: db.prepare(`INSERT INTO workspace_subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, 'active')`),
  updateSubPlan: db.prepare('UPDATE workspace_subscriptions SET plan = ?, status = ? WHERE user_id = ? AND status = ?'),
  incrementTasks: db.prepare(`UPDATE workspace_subscriptions SET tasks_today = tasks_today + 1, tasks_total = tasks_total + 1, last_task_date = date('now') WHERE user_id = ? AND status = 'active'`),
  resetDailyTasks: db.prepare(`UPDATE workspace_subscriptions SET tasks_today = 0 WHERE last_task_date < date('now')`),
  addDealSavings: db.prepare(`UPDATE workspace_subscriptions SET deals_completed = deals_completed + 1, total_savings = total_savings + ? WHERE user_id = ? AND status = 'active'`),

  insertSession: db.prepare('INSERT INTO workspace_sessions (id, user_id, session_token) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM workspace_sessions WHERE session_token = ? AND active = 1'),
  endSession: db.prepare("UPDATE workspace_sessions SET active = 0 WHERE session_token = ?"),

  insertDeal: db.prepare('INSERT INTO workspace_deals (id, user_id, task_id, offer_source, offer_title, original_price, final_price, savings, deal_url, requires_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateDealStatus: db.prepare('UPDATE workspace_deals SET status = ?, completed_at = datetime(\'now\') WHERE id = ?'),
  getUserDeals: db.prepare('SELECT * FROM workspace_deals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),

  logEvent: db.prepare('INSERT INTO workspace_analytics (id, user_id, event_type, event_data) VALUES (?, ?, ?, ?)'),
};

// Reset daily task counts
try { stmts.resetDailyTasks.run(); } catch (_) {}

// ─── User Routes ─────────────────────────────────────────────────────

/**
 * GET /api/workspace/subscription — Get user's workspace subscription
 */
router.get('/subscription', authenticateToken, (req, res) => {
  let sub = stmts.getSub.get(req.user.id, 'active');

  if (!sub) {
    // Auto-create free subscription
    const id = crypto.randomUUID();
    stmts.insertSub.run(id, req.user.id, 'free');
    sub = stmts.getSub.get(req.user.id, 'active');
  }

  const limits = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free;
  const remaining = limits.dailyTasks < 0 ? -1 : Math.max(0, limits.dailyTasks - (sub.tasks_today || 0));

  res.json({
    plan: sub.plan,
    status: sub.status,
    tasksToday: sub.tasks_today,
    tasksTotal: sub.tasks_total,
    dealsCompleted: sub.deals_completed,
    totalSavings: sub.total_savings,
    limits,
    remainingTasks: remaining,
    createdAt: sub.created_at,
  });
});

/**
 * POST /api/workspace/subscription — Upgrade/change plan
 */
router.post('/subscription', authenticateToken, (req, res) => {
  const { plan } = req.body;
  if (!PLAN_LIMITS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  let sub = stmts.getSub.get(req.user.id, 'active');
  if (sub) {
    stmts.updateSubPlan.run(plan, 'active', req.user.id, 'active');
  } else {
    const id = crypto.randomUUID();
    stmts.insertSub.run(id, req.user.id, plan);
  }

  logEvent(req.user.id, 'plan_changed', { plan });
  res.json({ success: true, plan });
});

/**
 * POST /api/workspace/check-limits — Check if user can execute a task
 */
router.post('/check-limits', authenticateToken, (req, res) => {
  const sub = stmts.getSub.get(req.user.id, 'active');
  if (!sub) return res.json({ allowed: true, plan: 'free' }); // New user

  const limits = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free;
  if (limits.dailyTasks >= 0 && sub.tasks_today >= limits.dailyTasks) {
    return res.json({
      allowed: false,
      reason: 'daily_limit',
      plan: sub.plan,
      limit: limits.dailyTasks,
      used: sub.tasks_today,
    });
  }

  stmts.incrementTasks.run(req.user.id);
  res.json({ allowed: true, plan: sub.plan, remaining: limits.dailyTasks < 0 ? -1 : limits.dailyTasks - sub.tasks_today - 1 });
});

/**
 * POST /api/workspace/deal — Record a deal action
 */
router.post('/deal', authenticateToken, (req, res) => {
  const { taskId, source, title, originalPrice, finalPrice, url, requiresLogin } = req.body;
  const savings = originalPrice && finalPrice ? originalPrice - finalPrice : 0;
  const id = crypto.randomUUID();

  stmts.insertDeal.run(id, req.user.id, taskId || null, source || '', title || '', originalPrice || 0, finalPrice || 0, savings, url || '', requiresLogin ? 1 : 0);
  logEvent(req.user.id, 'deal_created', { dealId: id, source, savings });

  res.json({ dealId: id, savings });
});

/**
 * POST /api/workspace/deal/:id/status — Update deal status
 */
router.post('/deal/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  const valid = ['clicked', 'agent_executing', 'login_required', 'completed', 'failed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  stmts.updateDealStatus.run(status, req.params.id);

  if (status === 'completed') {
    // Update savings in subscription
    const deal = db.prepare('SELECT savings FROM workspace_deals WHERE id = ?').get(req.params.id);
    if (deal) {
      stmts.addDealSavings.run(deal.savings || 0, req.user.id);
    }
  }

  logEvent(req.user.id, 'deal_status', { dealId: req.params.id, status });
  res.json({ success: true });
});

/**
 * GET /api/workspace/deals — Get user's deal history
 */
router.get('/deals', authenticateToken, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const deals = stmts.getUserDeals.all(req.user.id, limit);
  res.json({ deals });
});

/**
 * POST /api/workspace/event — Log workspace analytics event
 */
router.post('/event', authenticateToken, (req, res) => {
  const { type, data } = req.body;
  if (!type) return res.status(400).json({ error: 'Event type required' });
  logEvent(req.user.id, type, data || {});
  res.json({ ok: true });
});

// ─── Admin Routes ────────────────────────────────────────────────────

/**
 * GET /api/workspace/admin/stats — Global workspace stats
 */
router.get('/admin/stats', authenticateAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM workspace_subscriptions').get()?.c || 0;
  const activeToday = db.prepare("SELECT COUNT(*) as c FROM workspace_subscriptions WHERE last_task_date = date('now')").get()?.c || 0;
  const totalTasks = db.prepare('SELECT SUM(tasks_total) as c FROM workspace_subscriptions').get()?.c || 0;
  const totalDeals = db.prepare('SELECT SUM(deals_completed) as c FROM workspace_subscriptions').get()?.c || 0;
  const totalSavings = db.prepare('SELECT SUM(total_savings) as c FROM workspace_subscriptions').get()?.c || 0;

  const planBreakdown = db.prepare(`
    SELECT plan, COUNT(*) as count, SUM(tasks_total) as tasks, SUM(total_savings) as savings
    FROM workspace_subscriptions WHERE status = 'active' GROUP BY plan
  `).all();

  const recentEvents = db.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM workspace_analytics
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY event_type ORDER BY count DESC LIMIT 10
  `).all();

  const dailyTasks = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM workspace_analytics
    WHERE event_type IN ('task_started','deal_created') AND created_at > datetime('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();

  res.json({
    totalUsers,
    activeToday,
    totalTasks,
    totalDeals,
    totalSavings,
    planBreakdown,
    recentEvents,
    dailyTasks,
  });
});

/**
 * GET /api/workspace/admin/subscriptions — List all subscriptions
 */
router.get('/admin/subscriptions', authenticateAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  const subs = db.prepare(`
    SELECT ws.*, u.email, u.name
    FROM workspace_subscriptions ws
    LEFT JOIN users u ON ws.user_id = u.id
    ORDER BY ws.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM workspace_subscriptions').get()?.c || 0;

  res.json({ subscriptions: subs, total, page, pages: Math.ceil(total / limit) });
});

/**
 * PUT /api/workspace/admin/subscription/:userId — Admin update subscription
 */
router.put('/admin/subscription/:userId', authenticateAdmin, (req, res) => {
  const { plan, status } = req.body;
  if (plan && !PLAN_LIMITS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  if (plan) {
    stmts.updateSubPlan.run(plan, status || 'active', req.params.userId, 'active');
  }
  if (status && !plan) {
    db.prepare('UPDATE workspace_subscriptions SET status = ? WHERE user_id = ? AND status = ?')
      .run(status, req.params.userId, 'active');
  }

  res.json({ success: true });
});

/**
 * GET /api/workspace/admin/deals — List all deals
 */
router.get('/admin/deals', authenticateAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  const deals = db.prepare(`
    SELECT wd.*, u.email, u.name as user_name
    FROM workspace_deals wd
    LEFT JOIN users u ON wd.user_id = u.id
    ORDER BY wd.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM workspace_deals').get()?.c || 0;
  const totalSavings = db.prepare('SELECT SUM(savings) as s FROM workspace_deals WHERE status = ?').get('completed')?.s || 0;

  res.json({ deals, total, totalSavings, page, pages: Math.ceil(total / limit) });
});

/**
 * GET /api/workspace/admin/analytics — Workspace analytics dashboard
 */
router.get('/admin/analytics', authenticateAdmin, (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);

  const eventsByType = db.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM workspace_analytics
    WHERE created_at > datetime('now', '-${days} days')
    GROUP BY event_type ORDER BY count DESC
  `).all();

  const dailyActivity = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as events,
      COUNT(DISTINCT user_id) as unique_users
    FROM workspace_analytics
    WHERE created_at > datetime('now', '-${days} days')
    GROUP BY day ORDER BY day
  `).all();

  const topUsers = db.prepare(`
    SELECT ws.user_id, u.email, u.name, ws.plan, ws.tasks_total, ws.deals_completed, ws.total_savings
    FROM workspace_subscriptions ws
    LEFT JOIN users u ON ws.user_id = u.id
    ORDER BY ws.tasks_total DESC LIMIT 20
  `).all();

  res.json({ eventsByType, dailyActivity, topUsers });
});

// ─── Helpers ─────────────────────────────────────────────────────────

function logEvent(userId, type, data) {
  try {
    stmts.logEvent.run(crypto.randomUUID(), userId || null, type, JSON.stringify(data));
  } catch (_) {}
}

module.exports = router;
