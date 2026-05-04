/**
 * Admin Plans API — full CRUD over the plans/feature-catalog tables.
 * Mounted under /api/admin/plans (auth handled in server/index.js wiring).
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/adminAuth');
const { auditLog } = require('../services/security');
const plans = require('../services/plans');

router.use(authenticateAdmin);

router.get('/', (req, res) => {
  res.json({
    plans: plans.listPlans({ includeArchived: true }),
    features: plans.listFeatures(),
  });
});

router.get('/:id', (req, res) => {
  const p = plans.getPlan(req.params.id);
  if (!p) return res.status(404).json({ error: 'plan not found' });
  res.json({ plan: p });
});

router.post('/', (req, res) => {
  try {
    const created = plans.createPlan(req.body || {});
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'plan_create',
      details: { id: created.id }, ip: req.ip });
    res.status(201).json({ plan: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const updated = plans.updatePlan(req.params.id, req.body || {});
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'plan_update',
      details: { id: req.params.id, fields: Object.keys(req.body || {}) }, ip: req.ip });
    res.json({ plan: updated });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.put('/:id/features/:feature', (req, res) => {
  try {
    const included = req.body && req.body.included !== undefined ? !!req.body.included : true;
    const updated = plans.setPlanFeature(req.params.id, req.params.feature, included);
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'plan_feature_toggle',
      details: { id: req.params.id, feature: req.params.feature, included }, ip: req.ip });
    res.json({ plan: updated });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const archived = plans.deletePlan(req.params.id);
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'plan_archive',
      details: { id: req.params.id }, ip: req.ip, severity: 'warning' });
    res.json({ plan: archived });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
