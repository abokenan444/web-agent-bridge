/**
 * Vercel Edge Middleware example for WAB.
 *
 * 1. Copy this file to your repo as `middleware.ts` (or `middleware.js`) at the project root.
 * 2. `npm install @wab/edge`  (or vendor packages/edge into your repo)
 * 3. Set env vars WAB_SITE_NAME, WAB_SITE_URL.
 *
 * Docs: https://vercel.com/docs/functions/edge-middleware
 */
import { handleRequest } from '@wab/edge';

export const config = {
  matcher: ['/.well-known/wab.json', '/.well-known/wab-discovery']
};

export default function middleware(request) {
  return handleRequest(request, {
    siteName: process.env.WAB_SITE_NAME || 'My Site',
    siteUrl: process.env.WAB_SITE_URL || 'https://example.com',
    actions: safeParseJson(process.env.WAB_ACTIONS_JSON) || []
  });
}

function safeParseJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
