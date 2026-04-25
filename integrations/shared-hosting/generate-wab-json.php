<?php
/**
 * WAB JSON Generator
 * Automatically generates a wab.json capabilities document for your site.
 *
 * Upload this file to your web root, visit it in your browser once,
 * download the generated wab.json, then delete this generator file.
 *
 * License: MIT — https://github.com/abokenan444/web-agent-bridge
 * Version: 1.0.0
 */

// ============================================================
//  CONFIGURATION
// ============================================================

$SITE_CONFIG = [
    // Auto-detected from server — change only if incorrect
    'base_url'    => (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
                     . '://' . ($_SERVER['HTTP_HOST'] ?? 'yourdomain.com'),

    // Your site name
    'site_name'   => 'My Website',

    // Short description of your site
    'description' => 'A website powered by Web Agent Bridge',

    // Your WAB Bridge URL (if you uploaded wab-bridge.php)
    // Leave empty if you only want a static discovery document
    'bridge_url'  => '', // e.g. 'https://yourdomain.com/wab-bridge.php'

    // Site type — affects which actions are included
    // Options: 'general', 'ecommerce', 'blog', 'portfolio', 'saas'
    'site_type'   => 'general',

    // Language code (ISO 639-1)
    'language'    => 'en',

    // Contact email (used in contact action if bridge is enabled)
    'contact_email' => '',
];

// ============================================================
//  GENERATOR ENGINE
// ============================================================

$is_download = isset($_GET['download']);
$site_type   = $SITE_CONFIG['site_type'];
$base_url    = rtrim($SITE_CONFIG['base_url'], '/');
$bridge_url  = $SITE_CONFIG['bridge_url'];
$has_bridge  = !empty($bridge_url);

// Build actions based on site type and bridge availability
$actions = [];

// Universal read actions (work even without bridge — just document the site structure)
$actions[] = [
    'name'        => 'get_site_metadata',
    'description' => 'Get site name, description, language, and main navigation links.',
    'endpoint'    => $has_bridge ? $bridge_url : $base_url . '/.well-known/wab.json',
    'method'      => $has_bridge ? 'POST' : 'GET',
    'auth'        => $has_bridge,
    'params'      => $has_bridge ? [] : null,
];

if ($has_bridge) {
    $actions[] = [
        'name'        => 'get_page_content',
        'description' => 'Retrieve the text content and metadata of any page on this site.',
        'endpoint'    => $bridge_url,
        'method'      => 'POST',
        'auth'        => true,
        'params'      => [
            'url' => ['type' => 'string', 'required' => true, 'description' => 'Full URL of the page to retrieve']
        ]
    ];

    $actions[] = [
        'name'        => 'search_site',
        'description' => 'Search this site\'s content using a keyword query.',
        'endpoint'    => $bridge_url,
        'method'      => 'POST',
        'auth'        => true,
        'params'      => [
            'query' => ['type' => 'string', 'required' => true,  'description' => 'Search query string'],
            'limit' => ['type' => 'integer', 'required' => false, 'description' => 'Maximum number of results (default: 10, max: 20)']
        ]
    ];
}

// E-commerce specific actions
if ($site_type === 'ecommerce') {
    $actions[] = [
        'name'        => 'list_products',
        'description' => 'Browse available products with prices, descriptions, and availability.',
        'endpoint'    => $has_bridge ? $bridge_url : $base_url . '/shop',
        'method'      => $has_bridge ? 'POST' : 'GET',
        'auth'        => false,
        'params'      => $has_bridge ? [
            'category' => ['type' => 'string', 'required' => false, 'description' => 'Filter by product category'],
            'limit'    => ['type' => 'integer', 'required' => false, 'description' => 'Max products to return']
        ] : null,
        'note'        => 'Returns product listings from the shop page'
    ];
}

// Blog specific actions
if (in_array($site_type, ['blog', 'general'])) {
    $actions[] = [
        'name'        => 'list_posts',
        'description' => 'Get recent blog posts with titles, excerpts, dates, and URLs.',
        'endpoint'    => $base_url . '/feed',
        'method'      => 'GET',
        'auth'        => false,
        'params'      => null,
        'note'        => 'Returns RSS feed — parse as XML'
    ];
}

// Contact action (if email is configured)
if ($has_bridge && !empty($SITE_CONFIG['contact_email'])) {
    $actions[] = [
        'name'        => 'send_message',
        'description' => 'Send a message to the site owner via the contact form.',
        'endpoint'    => $bridge_url,
        'method'      => 'POST',
        'auth'        => true,
        'params'      => [
            'name'    => ['type' => 'string', 'required' => true,  'description' => 'Your name'],
            'email'   => ['type' => 'string', 'required' => true,  'description' => 'Your email address'],
            'subject' => ['type' => 'string', 'required' => false, 'description' => 'Message subject'],
            'message' => ['type' => 'string', 'required' => true,  'description' => 'Message body']
        ]
    ];
}

// Build the final wab.json document
$wab_doc = [
    'wab'         => '1.0',
    'name'        => $SITE_CONFIG['site_name'],
    'description' => $SITE_CONFIG['description'],
    'baseUrl'     => $base_url,
    'language'    => $SITE_CONFIG['language'],
    'siteType'    => $site_type,
];

// Auth section (only if bridge is enabled)
if ($has_bridge) {
    $wab_doc['auth'] = [
        'type'        => 'bearer',
        'endpoint'    => $bridge_url,
        'description' => 'Include your WAB secret key as: Authorization: Bearer <your-secret-key>'
    ];
} else {
    $wab_doc['auth'] = [
        'type'        => 'none',
        'description' => 'This site uses a static WAB document. No authentication required for read access.'
    ];
}

$wab_doc['actions']   = $actions;
$wab_doc['generated'] = date('c');
$wab_doc['generator'] = 'WAB JSON Generator/1.0.0 (https://webagentbridge.com)';

$json_output = json_encode($wab_doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

// ============================================================
//  OUTPUT
// ============================================================

// If ?download is in the URL, serve as file download
if ($is_download) {
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="wab.json"');
    header('Content-Length: ' . strlen($json_output));
    echo $json_output;
    exit;
}

// Otherwise show the generator UI
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WAB JSON Generator</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e8f0; min-height: 100vh; padding: 40px 20px; }
  .container { max-width: 860px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 40px; }
  .header h1 { font-size: 2rem; font-weight: 700; color: #fff; }
  .header p { color: #94a3b8; margin-top: 8px; font-size: 1rem; }
  .badge { display: inline-block; background: #5865f2; color: #fff; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; margin-bottom: 12px; }
  .card { background: #1a1a2e; border: 1px solid #2d2d4e; border-radius: 12px; padding: 28px; margin-bottom: 24px; }
  .card h2 { font-size: 1.1rem; font-weight: 600; color: #a78bfa; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .step { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #5865f2; border-radius: 50%; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; }
  .json-block { background: #0d0d1a; border: 1px solid #2d2d4e; border-radius: 8px; padding: 20px; font-family: 'Courier New', monospace; font-size: 0.8rem; line-height: 1.6; overflow-x: auto; color: #a5f3fc; white-space: pre; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-decoration: none; border: none; transition: all 0.2s; }
  .btn-primary { background: #5865f2; color: #fff; }
  .btn-primary:hover { background: #4752c4; }
  .btn-secondary { background: #2d2d4e; color: #e2e8f0; border: 1px solid #3d3d6e; }
  .btn-secondary:hover { background: #3d3d6e; }
  .btn-group { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
  .warning { background: #2d1f00; border: 1px solid #f59e0b; border-radius: 8px; padding: 14px 18px; color: #fbbf24; font-size: 0.875rem; margin-top: 16px; }
  .warning strong { display: block; margin-bottom: 4px; }
  .steps-list { counter-reset: step; }
  .steps-list li { counter-increment: step; padding: 10px 0 10px 44px; position: relative; border-bottom: 1px solid #2d2d4e; color: #cbd5e1; font-size: 0.9rem; }
  .steps-list li:last-child { border-bottom: none; }
  .steps-list li::before { content: counter(step); position: absolute; left: 0; top: 10px; width: 28px; height: 28px; background: #2d2d4e; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: #a78bfa; }
  code { background: #2d2d4e; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.85em; color: #a5f3fc; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .tag-green { background: #064e3b; color: #6ee7b7; }
  .tag-blue  { background: #1e3a5f; color: #93c5fd; }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <div class="badge">WAB JSON Generator v1.0.0</div>
    <h1>Your wab.json is Ready</h1>
    <p>Download the file and upload it to your site to enable AI agent discovery.</p>
  </div>

  <div class="card">
    <h2><span class="step">1</span> Generated wab.json</h2>
    <div class="json-block"><?= htmlspecialchars($json_output) ?></div>
    <div class="btn-group">
      <a href="?download" class="btn btn-primary">⬇ Download wab.json</a>
      <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(document.querySelector('.json-block').textContent)">📋 Copy to Clipboard</button>
    </div>
  </div>

  <div class="card">
    <h2><span class="step">2</span> Upload to Your Site</h2>
    <ol class="steps-list">
      <li>Open your hosting <strong>File Manager</strong> (Hostinger, cPanel, FTP, etc.)</li>
      <li>Navigate to your <strong>public_html</strong> (or <code>www</code>) folder</li>
      <li>Create a new folder named <code>.well-known</code> (with the dot)</li>
      <li>Upload the downloaded <code>wab.json</code> inside the <code>.well-known</code> folder</li>
      <li>Verify it works: visit <code><?= htmlspecialchars($base_url) ?>/.well-known/wab.json</code></li>
    </ol>
    <div class="warning">
      <strong>⚠ Security Notice</strong>
      After downloading your wab.json, <strong>delete this generator file</strong> (generate-wab-json.php) from your server. It is not needed after generation.
    </div>
  </div>

  <?php if ($has_bridge): ?>
  <div class="card">
    <h2><span class="step">3</span> Bridge Status</h2>
    <p style="color:#94a3b8; font-size:0.9rem;">Your wab.json is linked to the WAB Bridge at: <code><?= htmlspecialchars($bridge_url) ?></code></p>
    <p style="color:#94a3b8; font-size:0.9rem; margin-top:8px;">AI agents can execute actions through the bridge using your secret key.</p>
  </div>
  <?php else: ?>
  <div class="card">
    <h2><span class="step">3</span> Optional: Enable Full Actions</h2>
    <p style="color:#94a3b8; font-size:0.9rem;">Your current wab.json is a <span class="tag tag-blue">Static Discovery Document</span>. AI agents can discover your site but cannot execute actions.</p>
    <p style="color:#94a3b8; font-size:0.9rem; margin-top:10px;">To enable full action execution, upload <code>wab-bridge.php</code> to your web root, set your secret key inside it, then update the <code>bridge_url</code> in this generator and regenerate.</p>
  </div>
  <?php endif; ?>

</div>
</body>
</html>
