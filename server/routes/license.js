const express = require('express');
const router = express.Router();
const { verifyLicense, recordAnalytic } = require('../models/db');

router.post('/verify', (req, res) => {
  const { domain, licenseKey } = req.body;

  if (!domain || !licenseKey) {
    return res.status(400).json({ valid: false, error: 'Domain and licenseKey are required', tier: 'free' });
  }

  const result = verifyLicense(domain, licenseKey);
  res.json(result);
});

router.post('/track', (req, res) => {
  const { licenseKey, actionName, agentId, triggerType, success, metadata } = req.body;

  if (!licenseKey || !actionName) {
    return res.status(400).json({ error: 'licenseKey and actionName are required' });
  }

  try {
    const { findSiteByLicense } = require('../models/db');
    const site = findSiteByLicense.get(licenseKey);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    recordAnalytic({
      siteId: site.id,
      actionName,
      agentId,
      triggerType,
      success: success !== false,
      metadata
    });

    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record analytics' });
  }
});

module.exports = router;
