<?php
/**
 * WAB Bridge — Shared Hosting Edition
 * Web Agent Bridge (WAB) endpoint for shared hosting environments.
 *
 * Drop this single file into your web root and it becomes a fully functional
 * WAB endpoint — no Node.js, no server access, no installation required.
 *
 * Works on: Hostinger, cPanel Shared, DreamHost, SiteGround, Bluehost,
 *           GoDaddy Shared, and any host that supports PHP 7.4+
 *
 * License: MIT — https://github.com/abokenan444/web-agent-bridge
 * Version: 1.0.0
 */

// ============================================================
//  CONFIGURATION — Edit this section to match your site
// ============================================================

$WAB_CONFIG = [

    // Your site's public URL (no trailing slash)
    'base_url'    => 'https://yourdomain.com',

    // Your site name (shown to AI agents)
    'site_name'   => 'My Website',

    // Short description of what your site does
    'description' => 'A website powered by Web Agent Bridge',

    // WAB API secret key — change this to a long random string
    // AI agents must send this in the Authorization header: Bearer <key>
    'secret_key'  => 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_KEY',

    // Rate limiting: max requests per minute per IP (0 = disabled)
    'rate_limit'  => 60,

    // Allowed origins for CORS (use ['*'] to allow all)
    'cors_origins' => ['*'],

    // Enable or disable specific action groups
    'enable_read_actions'   => true,   // GET page content, metadata
    'enable_search_actions' => true,   // Search site content
    'enable_form_actions'   => false,  // Submit forms (disabled by default)
    'enable_contact_action' => false,  // Send contact messages (disabled by default)

    // Contact form settings (only used if enable_contact_action = true)
    'contact_email' => 'contact@yourdomain.com',

    // Path to a custom wab.json file (optional — auto-generated if not set)
    'custom_wab_json' => '',
];

// ============================================================
//  CORE ENGINE — Do not edit below this line
// ============================================================

define('WAB_VERSION', '1.0.0');
define('WAB_PROTOCOL', 'wab/1.0');

// --- Bootstrap ---
header('X-WAB-Version: ' . WAB_VERSION);
header('X-WAB-Protocol: ' . WAB_PROTOCOL);
header('X-Powered-By: Web Agent Bridge');

// Handle CORS
wab_handle_cors($WAB_CONFIG);

// Parse request
$method  = $_SERVER['REQUEST_METHOD'];
$path    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$base    = rtrim($_SERVER['SCRIPT_NAME'], '/');

// Support both Apache/Nginx (PATH_INFO) and PHP CLI server (REQUEST_URI)
$path_info = $_SERVER['PATH_INFO'] ?? '';
if (empty($path_info)) {
    // Extract action from REQUEST_URI by removing the script path
    $path_info = substr($path, strlen($base));
}
$action = ltrim($path_info, '/');

// Rate limiting
if ($WAB_CONFIG['rate_limit'] > 0) {
    wab_rate_limit($WAB_CONFIG['rate_limit']);
}

// Route requests
switch (true) {

    // OPTIONS preflight
    case $method === 'OPTIONS':
        http_response_code(204);
        exit;

    // WAB capabilities discovery document
    case $action === '' || $action === 'wab.json' || $action === '.well-known/wab.json':
        wab_serve_discovery($WAB_CONFIG);
        break;

    // Ping / health check
    case $action === 'ping':
        wab_json_response(['status' => 'ok', 'wab' => WAB_VERSION, 'timestamp' => time()]);
        break;

    // Execute a WAB action
    case $action === 'action' && $method === 'POST':
        wab_require_auth($WAB_CONFIG);
        wab_handle_action($WAB_CONFIG);
        break;

    // Unknown route
    default:
        wab_error(404, 'Not found. Available endpoints: /, /ping, /action');
}

// ============================================================
//  DISCOVERY DOCUMENT
// ============================================================

function wab_serve_discovery(array $cfg): void
{
    // If a custom wab.json path is set, serve it directly
    if (!empty($cfg['custom_wab_json']) && file_exists($cfg['custom_wab_json'])) {
        header('Content-Type: application/json; charset=utf-8');
        readfile($cfg['custom_wab_json']);
        exit;
    }

    $bridge_url = $cfg['base_url'] . '/' . basename(__FILE__);
    $actions    = [];

    if ($cfg['enable_read_actions']) {
        $actions[] = [
            'name'        => 'get_page_content',
            'description' => 'Retrieve the text content and metadata of any page on this site.',
            'endpoint'    => $bridge_url . '/action',
            'method'      => 'POST',
            'auth'        => true,
            'params'      => [
                'url' => ['type' => 'string', 'required' => true, 'description' => 'Full URL of the page to read']
            ]
        ];
        $actions[] = [
            'name'        => 'get_site_metadata',
            'description' => 'Get the site name, description, language, and navigation links.',
            'endpoint'    => $bridge_url . '/action',
            'method'      => 'POST',
            'auth'        => true,
            'params'      => []
        ];
    }

    if ($cfg['enable_search_actions']) {
        $actions[] = [
            'name'        => 'search_site',
            'description' => 'Search this site\'s content using a keyword query.',
            'endpoint'    => $bridge_url . '/action',
            'method'      => 'POST',
            'auth'        => true,
            'params'      => [
                'query' => ['type' => 'string', 'required' => true, 'description' => 'Search query'],
                'limit' => ['type' => 'integer', 'required' => false, 'description' => 'Max results (default: 10)']
            ]
        ];
    }

    if ($cfg['enable_form_actions']) {
        $actions[] = [
            'name'        => 'submit_form',
            'description' => 'Submit a form on this site.',
            'endpoint'    => $bridge_url . '/action',
            'method'      => 'POST',
            'auth'        => true,
            'params'      => [
                'form_url' => ['type' => 'string', 'required' => true, 'description' => 'URL of the page containing the form'],
                'fields'   => ['type' => 'object', 'required' => true, 'description' => 'Key-value pairs of form field names and values']
            ]
        ];
    }

    if ($cfg['enable_contact_action']) {
        $actions[] = [
            'name'        => 'send_message',
            'description' => 'Send a message to the site owner via the contact form.',
            'endpoint'    => $bridge_url . '/action',
            'method'      => 'POST',
            'auth'        => true,
            'params'      => [
                'name'    => ['type' => 'string', 'required' => true,  'description' => 'Sender name'],
                'email'   => ['type' => 'string', 'required' => true,  'description' => 'Sender email'],
                'subject' => ['type' => 'string', 'required' => false, 'description' => 'Message subject'],
                'message' => ['type' => 'string', 'required' => true,  'description' => 'Message body']
            ]
        ];
    }

    $doc = [
        'wab'         => '1.0',
        'name'        => $cfg['site_name'],
        'description' => $cfg['description'],
        'baseUrl'     => $cfg['base_url'],
        'bridge'      => $bridge_url,
        'auth'        => [
            'type'        => 'bearer',
            'description' => 'Include your WAB secret key as: Authorization: Bearer <key>'
        ],
        'actions'     => $actions,
        'generated'   => date('c'),
        'generator'   => 'WAB Bridge PHP/' . WAB_VERSION
    ];

    wab_json_response($doc);
}

// ============================================================
//  ACTION HANDLER
// ============================================================

function wab_handle_action(array $cfg): void
{
    $body = wab_parse_body();

    if (empty($body['action'])) {
        wab_error(400, 'Missing required field: action');
    }

    switch ($body['action']) {

        case 'get_page_content':
            if (!$cfg['enable_read_actions']) wab_error(403, 'Read actions are disabled.');
            wab_action_get_page_content($body, $cfg);
            break;

        case 'get_site_metadata':
            if (!$cfg['enable_read_actions']) wab_error(403, 'Read actions are disabled.');
            wab_action_get_site_metadata($cfg);
            break;

        case 'search_site':
            if (!$cfg['enable_search_actions']) wab_error(403, 'Search actions are disabled.');
            wab_action_search_site($body, $cfg);
            break;

        case 'submit_form':
            if (!$cfg['enable_form_actions']) wab_error(403, 'Form actions are disabled.');
            wab_action_submit_form($body, $cfg);
            break;

        case 'send_message':
            if (!$cfg['enable_contact_action']) wab_error(403, 'Contact action is disabled.');
            wab_action_send_message($body, $cfg);
            break;

        default:
            wab_error(400, 'Unknown action: ' . htmlspecialchars($body['action']));
    }
}

// ============================================================
//  ACTIONS IMPLEMENTATION
// ============================================================

function wab_action_get_page_content(array $body, array $cfg): void
{
    if (empty($body['url'])) wab_error(400, 'Missing required param: url');

    $url = filter_var($body['url'], FILTER_VALIDATE_URL);
    if (!$url) wab_error(400, 'Invalid URL format');

    // Only allow URLs from the same domain
    $allowed_host = parse_url($cfg['base_url'], PHP_URL_HOST);
    $request_host = parse_url($url, PHP_URL_HOST);
    if ($request_host !== $allowed_host) {
        wab_error(403, 'Cross-domain requests are not allowed. Only URLs from ' . $allowed_host . ' are permitted.');
    }

    $html = wab_fetch_url($url);
    if ($html === false) wab_error(502, 'Failed to fetch the requested URL.');

    // Extract useful content
    $title       = wab_extract_tag($html, 'title');
    $description = wab_extract_meta($html, 'description');
    $text        = wab_extract_text($html);
    $links       = wab_extract_links($html, $cfg['base_url']);
    $headings    = wab_extract_headings($html);

    wab_json_response([
        'action'      => 'get_page_content',
        'url'         => $url,
        'title'       => $title,
        'description' => $description,
        'text'        => mb_substr($text, 0, 8000), // Limit to 8KB
        'headings'    => $headings,
        'links'       => array_slice($links, 0, 50),
        'word_count'  => str_word_count($text),
        'fetched_at'  => date('c')
    ]);
}

function wab_action_get_site_metadata(array $cfg): void
{
    $html = wab_fetch_url($cfg['base_url']);
    if ($html === false) wab_error(502, 'Failed to fetch site homepage.');

    $title       = wab_extract_tag($html, 'title');
    $description = wab_extract_meta($html, 'description');
    $lang        = wab_extract_attr($html, 'html', 'lang') ?: 'en';
    $nav_links   = wab_extract_nav_links($html, $cfg['base_url']);

    wab_json_response([
        'action'      => 'get_site_metadata',
        'site_name'   => $cfg['site_name'],
        'base_url'    => $cfg['base_url'],
        'title'       => $title,
        'description' => $description,
        'language'    => $lang,
        'navigation'  => $nav_links,
        'wab_version' => WAB_VERSION,
        'fetched_at'  => date('c')
    ]);
}

function wab_action_search_site(array $body, array $cfg): void
{
    if (empty($body['query'])) wab_error(400, 'Missing required param: query');

    $query = trim($body['query']);
    $limit = min((int)($body['limit'] ?? 10), 20);

    // Try WordPress search first, then fall back to generic search
    $search_url = $cfg['base_url'] . '/?s=' . urlencode($query);
    $html       = wab_fetch_url($search_url);

    if ($html === false) wab_error(502, 'Failed to perform search.');

    $results = wab_extract_search_results($html, $cfg['base_url'], $limit);

    wab_json_response([
        'action'     => 'search_site',
        'query'      => $query,
        'results'    => $results,
        'count'      => count($results),
        'search_url' => $search_url
    ]);
}

function wab_action_submit_form(array $body, array $cfg): void
{
    if (empty($body['form_url'])) wab_error(400, 'Missing required param: form_url');
    if (empty($body['fields']) || !is_array($body['fields'])) wab_error(400, 'Missing required param: fields (object)');

    $url    = filter_var($body['form_url'], FILTER_VALIDATE_URL);
    if (!$url) wab_error(400, 'Invalid form_url format');

    $allowed_host = parse_url($cfg['base_url'], PHP_URL_HOST);
    $request_host = parse_url($url, PHP_URL_HOST);
    if ($request_host !== $allowed_host) {
        wab_error(403, 'Cross-domain form submissions are not allowed.');
    }

    // Fetch the page to get the form action URL and hidden fields
    $html = wab_fetch_url($url);
    if ($html === false) wab_error(502, 'Failed to fetch form page.');

    // Extract form action
    preg_match('/<form[^>]+action=["\']([^"\']+)["\'][^>]*>/i', $html, $form_match);
    $form_action = $form_match[1] ?? $url;
    if (!filter_var($form_action, FILTER_VALIDATE_URL)) {
        $form_action = $cfg['base_url'] . '/' . ltrim($form_action, '/');
    }

    // Extract hidden fields (nonce, tokens, etc.)
    preg_match_all('/<input[^>]+type=["\']hidden["\'][^>]*>/i', $html, $hidden_matches);
    $hidden_fields = [];
    foreach ($hidden_matches[0] as $input) {
        $name  = wab_extract_attr($input, 'input', 'name');
        $value = wab_extract_attr($input, 'input', 'value');
        if ($name) $hidden_fields[$name] = $value ?? '';
    }

    // Merge hidden fields with user-provided fields
    $post_data = array_merge($hidden_fields, $body['fields']);

    // Submit the form
    $response = wab_post_url($form_action, $post_data);

    wab_json_response([
        'action'      => 'submit_form',
        'form_url'    => $url,
        'form_action' => $form_action,
        'fields_sent' => array_keys($body['fields']),
        'success'     => $response !== false,
        'response_length' => $response ? strlen($response) : 0
    ]);
}

function wab_action_send_message(array $body, array $cfg): void
{
    $required = ['name', 'email', 'message'];
    foreach ($required as $field) {
        if (empty($body[$field])) wab_error(400, "Missing required param: $field");
    }

    if (!filter_var($body['email'], FILTER_VALIDATE_EMAIL)) {
        wab_error(400, 'Invalid email address format.');
    }

    $to      = $cfg['contact_email'];
    $subject = $body['subject'] ?? 'Message from AI Agent via WAB';
    $message = "Name: {$body['name']}\nEmail: {$body['email']}\n\n{$body['message']}";
    $headers = "From: WAB Bridge <noreply@{$_SERVER['HTTP_HOST']}>\r\nReply-To: {$body['email']}\r\nX-Mailer: WAB-Bridge/" . WAB_VERSION;

    $sent = mail($to, $subject, $message, $headers);

    wab_json_response([
        'action'  => 'send_message',
        'success' => $sent,
        'message' => $sent ? 'Message delivered successfully.' : 'Failed to send message. Please check your server mail configuration.'
    ]);
}

// ============================================================
//  HTML PARSING HELPERS
// ============================================================

function wab_extract_tag(string $html, string $tag): string
{
    preg_match('/<' . $tag . '[^>]*>(.*?)<\/' . $tag . '>/si', $html, $m);
    return isset($m[1]) ? trim(strip_tags($m[1])) : '';
}

function wab_extract_meta(string $html, string $name): string
{
    preg_match('/<meta[^>]+name=["\']' . $name . '["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $m);
    if (!isset($m[1])) {
        preg_match('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']' . $name . '["\'][^>]*>/i', $html, $m);
    }
    return isset($m[1]) ? trim($m[1]) : '';
}

function wab_extract_attr(string $html, string $tag, string $attr): string
{
    preg_match('/<' . $tag . '[^>]+' . $attr . '=["\']([^"\']*)["\'][^>]*>/i', $html, $m);
    return $m[1] ?? '';
}

function wab_extract_text(string $html): string
{
    // Remove scripts, styles, and comments
    $html = preg_replace('/<script[^>]*>.*?<\/script>/si', '', $html);
    $html = preg_replace('/<style[^>]*>.*?<\/style>/si', '', $html);
    $html = preg_replace('/<!--.*?-->/s', '', $html);
    // Convert block elements to newlines
    $html = preg_replace('/<(p|div|h[1-6]|li|br|tr)[^>]*>/i', "\n", $html);
    // Strip remaining tags
    $text = strip_tags($html);
    // Clean whitespace
    $text = preg_replace('/\n{3,}/', "\n\n", $text);
    $text = preg_replace('/[ \t]+/', ' ', $text);
    return trim($text);
}

function wab_extract_headings(string $html): array
{
    preg_match_all('/<h([1-6])[^>]*>(.*?)<\/h\1>/si', $html, $m);
    $headings = [];
    foreach ($m[0] as $i => $match) {
        $headings[] = [
            'level' => (int)$m[1][$i],
            'text'  => trim(strip_tags($m[2][$i]))
        ];
    }
    return $headings;
}

function wab_extract_links(string $html, string $base_url): array
{
    preg_match_all('/<a[^>]+href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)<\/a>/si', $html, $m);
    $links = [];
    $host  = parse_url($base_url, PHP_URL_HOST);
    foreach ($m[0] as $i => $match) {
        $href = $m[1][$i];
        $text = trim(strip_tags($m[2][$i]));
        if (empty($text)) continue;
        if (!filter_var($href, FILTER_VALIDATE_URL)) {
            $href = rtrim($base_url, '/') . '/' . ltrim($href, '/');
        }
        if (parse_url($href, PHP_URL_HOST) === $host) {
            $links[] = ['text' => $text, 'url' => $href];
        }
    }
    return array_values(array_unique($links, SORT_REGULAR));
}

function wab_extract_nav_links(string $html, string $base_url): array
{
    // Try to extract nav element first
    preg_match('/<nav[^>]*>(.*?)<\/nav>/si', $html, $nav_match);
    $nav_html = $nav_match[1] ?? $html;
    return wab_extract_links($nav_html, $base_url);
}

function wab_extract_search_results(string $html, string $base_url, int $limit): array
{
    // Works with WordPress search results and most CMS platforms
    $results = [];

    // Try article/post elements
    preg_match_all('/<(article|div)[^>]+class=["\'][^"\']*(?:post|result|entry|item)[^"\']*["\'][^>]*>(.*?)<\/\1>/si', $html, $m);

    foreach (array_slice($m[0], 0, $limit) as $block) {
        preg_match('/<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/si', $block, $link_m);
        $url   = $link_m[1] ?? '';
        $title = trim(strip_tags($link_m[2] ?? ''));

        // Extract excerpt
        preg_match('/<p[^>]*>(.*?)<\/p>/si', $block, $excerpt_m);
        $excerpt = trim(strip_tags($excerpt_m[1] ?? ''));

        if ($url && $title) {
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                $url = rtrim($base_url, '/') . '/' . ltrim($url, '/');
            }
            $results[] = [
                'title'   => $title,
                'url'     => $url,
                'excerpt' => mb_substr($excerpt, 0, 200)
            ];
        }
    }

    return $results;
}

// ============================================================
//  HTTP HELPERS
// ============================================================

function wab_fetch_url(string $url): string|false
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_USERAGENT      => 'WAB-Bridge/' . WAB_VERSION . ' (Web Agent Bridge; +https://webagentbridge.com)',
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $result = curl_exec($ch);
        curl_close($ch);
        return $result;
    }
    // Fallback to file_get_contents
    $ctx = stream_context_create(['http' => [
        'timeout'    => 10,
        'user_agent' => 'WAB-Bridge/' . WAB_VERSION,
    ]]);
    return @file_get_contents($url, false, $ctx);
}

function wab_post_url(string $url, array $data): string|false
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($data),
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_USERAGENT      => 'WAB-Bridge/' . WAB_VERSION,
        ]);
        $result = curl_exec($ch);
        curl_close($ch);
        return $result;
    }
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'content' => http_build_query($data),
        'timeout' => 15,
    ]]);
    return @file_get_contents($url, false, $ctx);
}

// ============================================================
//  AUTH & SECURITY
// ============================================================

function wab_require_auth(array $cfg): void
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s+(.+)/i', $header, $m)) {
        $token = trim($m[1]);
    } else {
        $token = $_SERVER['HTTP_X_WAB_KEY'] ?? '';
    }

    if (empty($token) || !hash_equals($cfg['secret_key'], $token)) {
        header('WWW-Authenticate: Bearer realm="WAB Bridge"');
        wab_error(401, 'Unauthorized. Provide a valid Bearer token in the Authorization header.');
    }
}

function wab_handle_cors(array $cfg): void
{
    $origins = $cfg['cors_origins'];
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '*';

    if (in_array('*', $origins, true)) {
        header('Access-Control-Allow-Origin: *');
    } elseif (in_array($origin, $origins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WAB-Key');
    header('Access-Control-Max-Age: 86400');
}

function wab_rate_limit(int $max_per_minute): void
{
    $ip      = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $key     = sys_get_temp_dir() . '/wab_rl_' . md5($ip);
    $now     = time();
    $window  = 60;

    $data = file_exists($key) ? json_decode(file_get_contents($key), true) : ['count' => 0, 'start' => $now];

    if ($now - $data['start'] > $window) {
        $data = ['count' => 1, 'start' => $now];
    } else {
        $data['count']++;
    }

    file_put_contents($key, json_encode($data), LOCK_EX);

    if ($data['count'] > $max_per_minute) {
        header('Retry-After: ' . ($window - ($now - $data['start'])));
        wab_error(429, 'Rate limit exceeded. Max ' . $max_per_minute . ' requests per minute.');
    }
}

// ============================================================
//  RESPONSE HELPERS
// ============================================================

function wab_parse_body(): array
{
    $raw = file_get_contents('php://input');
    if (!empty($raw)) {
        $data = json_decode($raw, true);
        if (json_last_error() === JSON_ERROR_NONE) return $data;
    }
    return $_POST ?: [];
}

function wab_json_response(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

function wab_error(int $code, string $message): void
{
    wab_json_response([
        'error'   => true,
        'code'    => $code,
        'message' => $message,
        'wab'     => WAB_VERSION
    ], $code);
}
