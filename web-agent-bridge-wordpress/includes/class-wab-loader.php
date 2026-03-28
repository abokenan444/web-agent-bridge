<?php
/**
 * Front-end script injection.
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Loader {

	/**
	 * Shortcode requested bridge on this request.
	 *
	 * @var bool
	 */
	private static $shortcode_requested = false;

	/**
	 * @var self|null
	 */
	private static $instance = null;

	/**
	 * @return self
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_shortcode( 'wab_bridge', array( __CLASS__, 'shortcode' ) );
		add_action( 'wp_head', array( $this, 'inject_discovery_link' ), 5 );
		add_action( 'wp_head', array( $this, 'maybe_inject_head' ), 99 );
		add_action( 'wp_footer', array( $this, 'maybe_inject_footer' ), 5 );
		add_action( 'wp_footer', array( $this, 'maybe_inject_shortcode_footer' ), 6 );
	}

	/**
	 * Shortcode: marks page for bridge when inject method is shortcode-only.
	 *
	 * @return string
	 */
	public static function shortcode() {
		self::$shortcode_requested = true;
		return '';
	}

	/**
	 * Inject WAB Discovery Protocol <link> for all front-end pages.
	 */
	public function inject_discovery_link() {
		if ( is_admin() || is_feed() || wp_is_json_request() ) {
			return;
		}
		echo '<link rel="alternate" type="application/json" href="' . esc_url( home_url( '/agent-bridge.json' ) ) . '" title="WAB Discovery" />' . "\n";
		echo '<meta name="wab:version" content="' . esc_attr( WAB_VERSION ) . '" />' . "\n";
	}

	/**
	 * @return void
	 */
	public function maybe_inject_head() {
		$opts = WAB_Settings::get_options();
		if ( 'auto_head' !== $opts['inject_method'] ) {
			return;
		}
		if ( ! $this->should_load( $opts ) ) {
			return;
		}
		$this->enqueue_bridge( $opts, false );
	}

	/**
	 * @return void
	 */
	public function maybe_inject_footer() {
		$opts = WAB_Settings::get_options();
		if ( 'auto_footer' !== $opts['inject_method'] ) {
			return;
		}
		if ( ! $this->should_load( $opts ) ) {
			return;
		}
		$this->enqueue_bridge( $opts, true );
	}

	/**
	 * Shortcode-only: inject in footer when shortcode present.
	 *
	 * @return void
	 */
	public function maybe_inject_shortcode_footer() {
		$opts = WAB_Settings::get_options();
		if ( 'shortcode_only' !== $opts['inject_method'] ) {
			return;
		}
		if ( ! self::$shortcode_requested ) {
			return;
		}
		if ( ! $this->should_load( $opts ) ) {
			return;
		}
		$this->enqueue_bridge( $opts, true );
	}

	/**
	 * @param array<string, mixed> $opts Options.
	 * @return bool
	 */
	private function should_load( array $opts ) {
		if ( is_admin() || is_feed() || is_embed() || wp_is_json_request() ) {
			return false;
		}

		if ( ! empty( $opts['exclude_post_types'] ) && is_singular() ) {
			$pt = get_post_type();
			if ( $pt && in_array( $pt, (array) $opts['exclude_post_types'], true ) ) {
				return false;
			}
		}

		if ( is_singular() ) {
			$post_id = get_queried_object_id();
			if ( $post_id && WAB_Metabox::is_disabled_for_post( $post_id ) ) {
				return false;
			}
		}

		if ( is_singular() && ! empty( $opts['exclude_term_ids'] ) ) {
			$ids = array_filter( array_map( 'absint', explode( ',', str_replace( ' ', '', $opts['exclude_term_ids'] ) ) ) );
			$post_id = get_queried_object_id();
			if ( ! empty( $ids ) && $post_id ) {
				foreach ( $ids as $term_id ) {
					foreach ( get_object_taxonomies( get_post_type( $post_id ), 'names' ) as $tax ) {
						if ( has_term( $term_id, $tax, $post_id ) ) {
							return false;
						}
					}
				}
			}
		}

		/**
		 * Filter whether to load WAB on this request.
		 *
		 * @param bool  $load Load bridge.
		 * @param array $opts Plugin options.
		 */
		return (bool) apply_filters( 'wab_should_load', true, $opts );
	}

	/**
	 * @param array<string, mixed> $opts      Options.
	 * @param bool                 $in_footer Print in footer.
	 */
	private function enqueue_bridge( array $opts, $in_footer ) {
		$stealth = ! empty( $opts['stealth_mode'] );
		if ( $stealth && empty( $opts['stealth_ethics_ack'] ) ) {
			return;
		}

		if ( ! $stealth ) {
			echo "\n<!-- Web Agent Bridge -->\n";
		}

		$config = $this->build_config( $opts );
		$custom = wab_collect_registered_actions();

		$config_json = wp_json_encode( $config );
		$protocol_info = wp_json_encode( array(
			'version'         => WAB_VERSION,
			'protocol'        => '1.0',
			'discovery'       => home_url( '/agent-bridge.json' ),
			'api_base'        => home_url( '/wp-json/wab/v1' ),
			'platform'        => 'wordpress',
		) );
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON.
		echo '<script>window.AIBridgeConfig = Object.assign(' . $config_json . ', window.AIBridgeConfig || {});';
		echo 'window._wabLicenseKey = ' . wp_json_encode( $opts['license_key'] ) . ';';
		echo 'window.__wab_protocol = ' . $protocol_info . ';';
		echo '</script>' . "\n";

		if ( ! empty( $custom ) ) {
			$actions_json = wp_json_encode( $custom );
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<script>window.WAB_PRELOAD_ACTIONS = ' . $actions_json . ';</script>' . "\n";
		}

		$url = $this->get_script_url( $opts );
		$handle = 'wab-bridge';

		wp_register_script( $handle, $url, array(), WAB_VERSION, $in_footer );
		wp_enqueue_script( $handle );

		$inline = "document.addEventListener('DOMContentLoaded',function(){var a=window.WAB_PRELOAD_ACTIONS;if(!a||!window.AICommands)return;a.forEach(function(d){try{window.AICommands.registerAction(d);}catch(e){console.warn('[WAB]',e);}});});";
		wp_add_inline_script( $handle, $inline, 'after' );

		$api_base = esc_url( untrailingslashit( $opts['api_base_url'] ) );
		$noscript_endpoint = home_url( '/wp-json/wab/v1/page-info' );
		echo '<noscript>';
		echo '<meta http-equiv="X-WAB-Protocol" content="1.0" />';
		echo '<meta name="wab:discovery" content="' . esc_url( home_url( '/agent-bridge.json' ) ) . '" />';
		echo '<meta name="wab:version" content="' . esc_attr( WAB_VERSION ) . '" />';
		echo '<meta name="wab:api" content="' . esc_url( $noscript_endpoint ) . '" />';
		echo '<link rel="alternate" type="application/json" href="' . esc_url( home_url( '/agent-bridge.json' ) ) . '" title="WAB Discovery" />';
		echo '</noscript>' . "\n";
	}

	/**
	 * @param array<string, mixed> $opts Options.
	 * @return array<string, mixed>
	 */
	private function build_config( array $opts ) {
		$cache = get_option( 'wab_license_cache', array() );
		$tier  = isset( $cache['tier'] ) ? sanitize_key( $cache['tier'] ) : 'free';

		$blocked = array_filter( array_map( 'trim', explode( "\n", (string) $opts['blocked_selectors'] ) ) );

		$config = array(
			'licenseKey'         => $opts['license_key'],
			'subscriptionTier'   => $tier,
			'agentPermissions'   => $opts['permissions'],
			'restrictions'       => array(
				'allowedSelectors'       => array(),
				'blockedSelectors'       => $blocked,
				'requireLoginForActions' => array(),
				'rateLimit'              => array(
					'maxCallsPerMinute' => (int) $opts['rate_limit'],
				),
			),
			'logging'            => array(
				'enabled' => false,
				'level'   => 'basic',
			),
		);

		if ( ! empty( $opts['use_config_endpoint'] ) && ! empty( $opts['config_endpoint'] ) ) {
			$remote = WAB_API::fetch_remote_config( $opts['config_endpoint'], $opts['license_key'] );
			if ( ! is_wp_error( $remote ) && is_array( $remote ) ) {
				$config = array_merge( $config, $remote );
			}
		}

		/**
		 * Filter final AIBridgeConfig array before output.
		 *
		 * @param array<string, mixed> $config Config.
		 * @param array<string, mixed> $opts   Options.
		 */
		return apply_filters( 'wab_bridge_config', $config, $opts );
	}

	/**
	 * @param array<string, mixed> $opts Options.
	 * @return string
	 */
	private function get_script_url( $opts ) {
		if ( ! empty( $opts['script_url'] ) ) {
			$url = $opts['script_url'];
		} else {
			$base = untrailingslashit( $opts['api_base_url'] );
			$url  = $base . '/script/ai-agent-bridge.js';
		}
		/**
		 * Filter bridge script URL.
		 *
		 * @param string               $url  Script URL.
		 * @param array<string, mixed> $opts Plugin options.
		 */
		return apply_filters( 'wab_bridge_script_url', $url, $opts );
	}
}
