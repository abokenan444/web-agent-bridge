/**
 * Web Agent Bridge — Netlify Function: WAB Discovery
 * Serves /.well-known/wab.json at the edge
 *
 * LICENSE: MIT (Open Source)
 */

const WAB_VERSION = '3.2.0';

exports.handler = async (event, context) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://your-site.netlify.app';
  const wabServerUrl = process.env.WAB_SERVER_URL || siteUrl;
  const siteId = process.env.WAB_SITE_ID || '';

  const discovery = {
    wab_version: WAB_VERSION,
    protocol_version: '1.0',
    site_id: siteId,
    site_url: siteUrl,
    endpoint: `${wabServerUrl}/api/wab`,
    transport: ['http'],
    commands: {
      authenticate: { method: 'POST', path: '/authenticate', auth_required: false },
      search: { method: 'POST', path: '/execute', auth_required: true },
      navigate: { method: 'POST', path: '/execute', auth_required: true },
      read_page: { method: 'POST', path: '/execute', auth_required: true },
      fill_form: { method: 'POST', path: '/execute', auth_required: true },
      click: { method: 'POST', path: '/execute', auth_required: true },
      extract: { method: 'POST', path: '/execute', auth_required: true }
    },
    agent_permissions: {
      read: true,
      search: true,
      navigate: true,
      fill_form: false,
      checkout: false,
      login: false
    },
    rate_limits: {
      requests_per_minute: 60,
      requests_per_day: 5000
    },
    platform: 'netlify',
    generated_at: new Date().toISOString(),
    powered_by: 'web-agent-bridge'
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
      'X-WAB-Version': WAB_VERSION,
      'X-WAB-Platform': 'netlify'
    },
    body: JSON.stringify(discovery, null, 2)
  };
};
