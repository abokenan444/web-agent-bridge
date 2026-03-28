<?php
/**
 * WAB Discovery Protocol — serves agent-bridge.json and /.well-known/wab.json.
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Discovery {

	/** @var self|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'template_redirect', array( $this, 'serve_well_known' ) );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'init', array( $this, 'add_rewrite_rules' ) );
	}

	public function add_query_vars( $vars ) {
		$vars[] = 'wab_discovery';
		return $vars;
	}

	public function add_rewrite_rules() {
		add_rewrite_rule( '^\.well-known/wab\.json$', 'index.php?wab_discovery=1', 'top' );
		add_rewrite_rule( '^agent-bridge\.json$', 'index.php?wab_discovery=1', 'top' );
	}

	public function serve_well_known() {
		if ( ! get_query_var( 'wab_discovery' ) ) {
			return;
		}
		$this->send_discovery_json();
		exit;
	}

	public function register_routes() {
		register_rest_route( 'wab/v1', '/discover', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'rest_discover' ),
			'permission_callback' => '__return_true',
		) );

		register_rest_route( 'wab/v1', '/actions', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'rest_actions' ),
			'permission_callback' => '__return_true',
		) );

		register_rest_route( 'wab/v1', '/page-info', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'rest_page_info' ),
			'permission_callback' => '__return_true',
		) );

		register_rest_route( 'wab/v1', '/ping', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'rest_ping' ),
			'permission_callback' => '__return_true',
		) );
	}

	public function rest_discover() {
		return new WP_REST_Response( $this->build_discovery(), 200 );
	}

	public function rest_actions() {
		$actions = wab_collect_registered_actions();
		$opts    = WAB_Settings::get_options();
		$perms   = $opts['permissions'];

		$builtin = array();
		if ( ! empty( $perms['readContent'] ) ) {
			$builtin[] = array( 'name' => 'readContent', 'description' => 'Read page content', 'category' => 'content' );
		}
		if ( ! empty( $perms['click'] ) ) {
			$builtin[] = array( 'name' => 'click', 'description' => 'Click an element', 'category' => 'interaction' );
		}
		if ( ! empty( $perms['fillForms'] ) ) {
			$builtin[] = array( 'name' => 'fillForm', 'description' => 'Fill form fields', 'category' => 'interaction' );
		}
		if ( ! empty( $perms['scroll'] ) ) {
			$builtin[] = array( 'name' => 'scroll', 'description' => 'Scroll the page', 'category' => 'navigation' );
		}
		if ( ! empty( $perms['navigate'] ) ) {
			$builtin[] = array( 'name' => 'navigate', 'description' => 'Navigate to URL', 'category' => 'navigation' );
		}

		return new WP_REST_Response( array(
			'actions' => array_merge( $builtin, $actions ),
			'total'   => count( $builtin ) + count( $actions ),
		), 200 );
	}

	public function rest_page_info() {
		return new WP_REST_Response( array(
			'title'       => get_bloginfo( 'name' ),
			'description' => get_bloginfo( 'description' ),
			'url'         => home_url(),
			'type'        => 'wordpress',
			'version'     => get_bloginfo( 'version' ),
			'wab_version' => WAB_VERSION,
			'language'    => get_locale(),
		), 200 );
	}

	public function rest_ping() {
		return new WP_REST_Response( array(
			'pong'        => true,
			'version'     => WAB_VERSION,
			'protocol'    => '1.0',
			'timestamp'   => time() * 1000,
			'status'      => 'healthy',
			'platform'    => 'wordpress',
		), 200 );
	}

	private function send_discovery_json() {
		$doc = $this->build_discovery();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'X-WAB-Version: ' . WAB_VERSION );
		header( 'Access-Control-Allow-Origin: *' );
		echo wp_json_encode( $doc );
	}

	/**
	 * Build the WAB Discovery Protocol document.
	 */
	public function build_discovery() {
		$opts   = WAB_Settings::get_options();
		$cache  = get_option( 'wab_license_cache', array() );
		$tier   = isset( $cache['tier'] ) ? sanitize_key( $cache['tier'] ) : 'free';
		$perms  = $opts['permissions'];
		$domain = WAB_API::get_site_domain();

		$actions = wab_collect_registered_actions();
		$action_list = array_map( function ( $a ) {
			return array(
				'name'        => $a['name'],
				'description' => $a['description'],
				'category'    => isset( $a['category'] ) ? $a['category'] : 'custom',
			);
		}, $actions );

		$builtin_actions = array();
		if ( ! empty( $perms['readContent'] ) ) {
			$builtin_actions[] = array( 'name' => 'readContent', 'description' => 'Read page content', 'category' => 'content' );
		}
		if ( ! empty( $perms['click'] ) ) {
			$builtin_actions[] = array( 'name' => 'click', 'description' => 'Click interactive elements', 'category' => 'interaction' );
		}
		if ( ! empty( $perms['fillForms'] ) ) {
			$builtin_actions[] = array( 'name' => 'fillForm', 'description' => 'Fill form fields', 'category' => 'interaction' );
		}
		if ( ! empty( $perms['navigate'] ) ) {
			$builtin_actions[] = array( 'name' => 'navigate', 'description' => 'Navigate to pages', 'category' => 'navigation' );
		}

		return array(
			'wab_version'    => WAB_VERSION,
			'protocol'       => '1.0',
			'site'           => array(
				'name'        => get_bloginfo( 'name' ),
				'domain'      => $domain,
				'description' => get_bloginfo( 'description' ),
				'platform'    => 'wordpress',
				'wp_version'  => get_bloginfo( 'version' ),
				'language'    => get_locale(),
			),
			'tier'           => $tier,
			'agent_access'   => array(
				'discovery'   => home_url( '/wp-json/wab/v1/discover' ),
				'actions'     => home_url( '/wp-json/wab/v1/actions' ),
				'page_info'   => home_url( '/wp-json/wab/v1/page-info' ),
				'ping'        => home_url( '/wp-json/wab/v1/ping' ),
				'bridge_script' => $this->get_script_url( $opts ),
			),
			'permissions'    => $perms,
			'actions'        => array_merge( $builtin_actions, $action_list ),
			'restrictions'   => array(
				'rate_limit'        => (int) $opts['rate_limit'],
				'blocked_selectors' => array_filter( array_map( 'trim', explode( "\n", (string) $opts['blocked_selectors'] ) ) ),
			),
			'lifecycle'      => array( 'discover', 'authenticate', 'plan', 'execute', 'confirm' ),
			'transport'      => array( 'http', 'javascript' ),
			'generated_at'   => gmdate( 'c' ),
		);
	}

	private function get_script_url( $opts ) {
		if ( ! empty( $opts['script_url'] ) ) {
			return $opts['script_url'];
		}
		$base = untrailingslashit( $opts['api_base_url'] );
		return $base . '/script/ai-agent-bridge.js';
	}
}
