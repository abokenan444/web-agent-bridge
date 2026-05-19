/**
 * Webhook Subscriptions API (v3.16.0 — Phase 4)
 *
 *   POST   /api/webhooks                  — create subscription (returns secret once)
 *   GET    /api/webhooks                  — list user's subscriptions
 *   GET    /api/webhooks/:id              — get one
 *   PATCH  /api/webhooks/:id              — update url/events/active/description
 *   DELETE /api/webhooks/:id              — delete
 *   GET    /api/webhooks/:id/deliveries   — recent delivery log
 *   GET    /api/webhooks/events           — list supported event types
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const webhooks = require('../services/webhooks');

function _handle(res, fn) {
  try {
    const out = fn();
    res.json({ ok: true, data: out });
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({ ok: false, error: e.code || 'internal_error', message: e.message });
  }
}

router.get('/events', (req, res) => {
  res.json({ ok: true, data: { events: Array.from(webhooks.VALID_EVENTS) } });
});

router.post('/', authenticateToken, express.json({ limit: '8kb' }), (req, res) => {
  _handle(res, () => webhooks.createSubscription({
    userId: req.user.id,
    url: req.body.url,
    events: req.body.events,
    description: req.body.description,
  }));
});

router.get('/', authenticateToken, (req, res) => {
  _handle(res, () => webhooks.listSubscriptions(req.user.id));
});

router.get('/:id', authenticateToken, (req, res) => {
  _handle(res, () => webhooks.getSubscription({ id: req.params.id, userId: req.user.id }));
});

router.patch('/:id', authenticateToken, express.json({ limit: '8kb' }), (req, res) => {
  _handle(res, () => webhooks.updateSubscription({
    id: req.params.id,
    userId: req.user.id,
    url: req.body.url,
    events: req.body.events,
    active: req.body.active,
    description: req.body.description,
  }));
});

router.delete('/:id', authenticateToken, (req, res) => {
  _handle(res, () => webhooks.deleteSubscription({ id: req.params.id, userId: req.user.id }));
});

router.get('/:id/deliveries', authenticateToken, (req, res) => {
  _handle(res, () => webhooks.listDeliveries({
    subscriptionId: req.params.id,
    userId: req.user.id,
    limit: parseInt(req.query.limit, 10) || 50,
  }));
});

module.exports = router;
