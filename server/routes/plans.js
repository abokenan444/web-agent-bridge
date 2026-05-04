/**
 * Public Plans API — feeds the landing-page pricing section.
 * No authentication; returns only public, non-archived plans.
 */
'use strict';

const express = require('express');
const router = express.Router();
const plansService = require('../services/plans');

router.get('/', (req, res) => {
  try {
    const plans = plansService.listPlans({ publicOnly: true });
    const features = plansService.listFeatures();
    res.json({
      plans,
      features,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const plan = plansService.getPlan(req.params.id);
  if (!plan || plan.is_archived || !plan.is_public) {
    return res.status(404).json({ error: 'plan not found' });
  }
  res.json({ plan });
});

module.exports = router;
