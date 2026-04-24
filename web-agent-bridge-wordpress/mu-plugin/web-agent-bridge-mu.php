<?php
/**
 * Web Agent Bridge — Must-Use Plugin Loader
 *
 * Install this file in: wp-content/mu-plugins/web-agent-bridge-mu.php
 *
 * Must-Use plugins are automatically loaded by WordPress on every request
 * and CANNOT be deactivated from the admin panel. This ensures WAB is
 * always active, even if the main plugin is deactivated.
 *
 * LICENSE: GPL-2.0-or-later (Open Source)
 *
 * Automatic install (WP-CLI):
 *   wp eval "copy(WAB_MU_PLUGIN_SOURCE, WPMU_PLUGIN_DIR . '/web-agent-bridge-mu.php');"
 *
 * Or via bash:
 *   cp web-agent-bridge-mu.php /path/to/wp-content/mu-plugins/
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

// ── Configuration (override via wp-config.php) ────────────────────────────────
if ( ! defined( 'WAB_MU_API_BASE' ) ) {
	define( 'WAB_MU_API_BASE', 'https://webagentbridge.com' );
}
if ( ! defined( 'WAB_MU_SCRIPT_URL' ) ) {
	define( 'WAB_MU_SCRIPT_URL', WAB_MU_API_BASE . '/script/ai-agent-bridge.js' );
}
if ( ! defined( 'WAB_MU_DISCOVERY_CACHE_TTL' ) ) {
	define( 'WAB_MU_DISCOVERY_CACHE_TTL', 300 ); // 5 minutes
}

// ── Load main plugin if installed, otherwise use minimal fallback ─────────────
add_action( 'plugins_loaded', 'wab_mu_bootstrap', 1 );

function wab_mu_bootstrap() {
	$main_plugin = WP_PLUGIN_DIR . '/web-agent-bridge/web-agent-bridge.php';

	if ( file_exists( $main_plugin ) && ! is_plugin_active( 'web-agent-bridge/web-agent-bridge.php' ) ) {
		// Main plugin installed but deactivated — force-load it
		require_once $main_plugin;
		return;
	}

	if ( defined( 'WAB_VERSION' ) ) {
		// Main plugin already loaded and active
		return;
	}

	// Minimal fallback: inject discovery headers and script without full plugin
	wab_mu_minimal_init();
}

function wab_mu_minimal_init() {
	// Add WAB discovery headers to every response
	add_action( 'send_headers', 'wab_mu_send_headers' );

	// Serve /.well-known/wab.json
	add_action( 'init', 'wab_mu_register_discovery_endpoint' );

	// Inject minimal WAB script into <head>
	add_action( 'wp_head', 'wab_mu_inject_script', 1 );

	// Add WAB meta tags
	add_action( 'wp_head', 'wab_mu_meta_tags', 2 );
}

function wab_mu_send_headers() {
	$home = home_url();
	header( 'X-WAB-Enabled: true' );
	header( 'X-WAB-Version: mu-1.0' );
	header( 'X-WAB-Discovery: ' . $home . '/.well-known/wab.json' );
	header( 'X-WAB-Endpoint: ' . WAB_MU_API_BASE . '/api/wab' );
}

function wab_mu_register_discovery_endpoint() {
	add_rewrite_rule( '^\.well-known/wab\.json$', 'index.php?wab_discovery=1', 'top' );
	add_rewrite_tag( '%wab_discovery%', '([0-9]+)' );

	if ( get_query_var( 'wab_discovery' ) ) {
		wab_mu_serve_discovery();
		exit;
	}
}

function wab_mu_serve_discovery() {
	// Try cache first
	$cached = get_transient( 'wab_mu_discovery_doc' );
	if ( $cached ) {
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Access-Control-Allow-Origin: *' );
		header( 'Cache-Control: public, max-age=' . WAB_MU_DISCOVERY_CACHE_TTL );
		header( 'X-WAB-Cache: hit' );
		echo $cached; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		return;
	}

	$doc = wab_mu_build_discovery();
	$json = wp_json_encode( $doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );

	set_transient( 'wab_mu_discovery_doc', $json, WAB_MU_DISCOVERY_CACHE_TTL );

	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'Access-Control-Allow-Origin: *' );
	header( 'Cache-Control: public, max-age=' . WAB_MU_DISCOVERY_CACHE_TTL );
	header( 'X-WAB-Cache: miss' );
	echo $json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

function wab_mu_build_discovery() {
	return array(
		'wab_version'    => 'mu-1.0',
		'protocol'       => '1.0',
		'mode'           => 'must-use-minimal',
		'site'           => array(
			'name'        => get_bloginfo( 'name' ),
			'domain'      => wp_parse_url( home_url(), PHP_URL_HOST ),
			'description' => get_bloginfo( 'description' ),
			'platform'    => 'wordpress',
			'wp_version'  => get_bloginfo( 'version' ),
			'language'    => get_locale(),
			'url'         => home_url(),
		),
		'agent_access'   => array(
			'discovery'     => home_url( '/.well-known/wab.json' ),
			'bridge_script' => WAB_MU_SCRIPT_URL,
			'api_base'      => WAB_MU_API_BASE . '/api/wab',
		),
		'permissions'    => array(
			'readContent' => true,
			'click'       => true,
			'fillForms'   => false,
			'scroll'      => true,
			'navigate'    => false,
		),
		'upgrade'        => array(
			'message' => 'Install the full Web Agent Bridge plugin for advanced features',
			'url'     => 'https://wordpress.org/plugins/web-agent-bridge/',
		),
		'generated_at'   => gmdate( 'c' ),
	);
}

function wab_mu_inject_script() {
	$config = wp_json_encode( array(
		'apiBase'          => WAB_MU_API_BASE,
		'mode'             => 'must-use',
		'agentPermissions' => array(
			'readContent' => true,
			'click'       => true,
			'fillForms'   => false,
			'scroll'      => true,
			'navigate'    => false,
		),
	) );
	echo '<script>window.AIBridgeConfig = ' . $config . ';</script>' . "\n"; // phpcs:ignore
	echo '<script src="' . esc_url( WAB_MU_SCRIPT_URL ) . '" defer></script>' . "\n";
}

function wab_mu_meta_tags() {
	echo '<meta name="wab:version" content="mu-1.0" />' . "\n";
	echo '<meta name="wab:discovery" content="' . esc_url( home_url( '/.well-known/wab.json' ) ) . '" />' . "\n";
	echo '<link rel="alternate" type="application/json" href="' . esc_url( home_url( '/.well-known/wab.json' ) ) . '" title="WAB Discovery" />' . "\n";
}
