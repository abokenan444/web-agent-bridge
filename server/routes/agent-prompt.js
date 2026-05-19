'use strict';

/**
 * GET /api/agent/system-prompt
 *
 * Serves the canonical WAB agent system prompt as text/plain so that LLM
 * agents can fetch the latest policy at session boot without pinning a
 * local copy. Returns the bundled SDK text plus a version header.
 */

const express = require('express');
const router = express.Router();

const { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } = require('../../sdk/system-prompt');

router.get('/system-prompt', (req, res) => {
  const fmt = String(req.query.format || 'text').toLowerCase();
  res.set('X-WAB-AgentPrompt-Version', SYSTEM_PROMPT_VERSION);
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  if (fmt === 'json') {
    res.json({ ok: true, version: SYSTEM_PROMPT_VERSION, prompt: SYSTEM_PROMPT });
    return;
  }
  res.type('text/plain; charset=utf-8').send(SYSTEM_PROMPT);
});

module.exports = router;
