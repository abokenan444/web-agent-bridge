/**
 * WAB Neural Engine (07-neural) — FULLY CLOSED
 * Local AI inference engine. All logic is proprietary.
 * Only the API interface is exposed here.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

let neuralEngine;
try { neuralEngine = require('./neural-engine'); } catch { neuralEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/analyze-url', (req, res) => {
    const { url: targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: 'url required' });
    if (!neuralEngine) return res.status(503).json({ error: 'Neural engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = neuralEngine.analyzeUrl(targetUrl);
    res.json(result);
  });

  router.post('/classify', (req, res) => {
    const { content, categories } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    if (!neuralEngine) return res.status(503).json({ error: 'Neural engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = neuralEngine.classify(content, categories);
    res.json(result);
  });

  router.post('/embeddings', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    if (!neuralEngine) return res.status(503).json({ error: 'Neural engine not available', code: 'MODULE_UNAVAILABLE' });
    const result = neuralEngine.embed(text);
    res.json(result);
  });

  router.get('/models', (req, res) => {
    if (!neuralEngine) return res.json({ models: [], message: 'Neural engine not loaded' });
    res.json(neuralEngine.listModels());
  });

  router.get('/stats', (req, res) => {
    if (!neuralEngine) return res.json({ status: 'offline' });
    res.json(neuralEngine.getStats());
  });

  return router;
}

module.exports = { createRouter };
