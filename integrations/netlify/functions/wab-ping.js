/**
 * Web Agent Bridge — Netlify Function: WAB Ping
 * Health check endpoint
 *
 * LICENSE: MIT (Open Source)
 */

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify({
    status: 'ok',
    version: '3.2.0',
    platform: 'netlify',
    timestamp: new Date().toISOString()
  })
});
