/**
 * Netlify Edge Function example for WAB.
 *
 * 1. Copy this to `netlify/edge-functions/wab.js`
 * 2. Add to netlify.toml:
 *      [[edge_functions]]
 *      function = "wab"
 *      path = "/.well-known/wab.json"
 *      [[edge_functions]]
 *      function = "wab"
 *      path = "/.well-known/wab-discovery"
 * 3. Set env vars WAB_SITE_NAME, WAB_SITE_URL in the Netlify dashboard.
 *
 * Docs: https://docs.netlify.com/edge-functions/overview/
 */
import { handleRequest } from '@wab/edge';

export default async (request, context) => {
  const env = context.env || {};
  return handleRequest(request, {
    siteName: env.WAB_SITE_NAME || 'My Site',
    siteUrl: env.WAB_SITE_URL || 'https://example.com',
    actions: safeParseJson(env.WAB_ACTIONS_JSON) || []
  });
};

function safeParseJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
