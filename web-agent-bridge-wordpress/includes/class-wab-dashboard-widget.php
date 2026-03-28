<?php
/**
 * WordPress dashboard widget (license summary + link to WAB).
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Dashboard_Widget {

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
		add_action( 'wp_dashboard_setup', array( $this, 'register' ) );
	}

	public function register() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		wp_add_dashboard_widget(
			'wab_summary',
			__( 'Web Agent Bridge', 'web-agent-bridge' ),
			array( $this, 'render' )
		);
	}

	public function render() {
		$opts  = WAB_Settings::get_options();
		$cache = get_option( 'wab_license_cache', array() );
		$tier  = isset( $cache['tier'] ) ? sanitize_key( $cache['tier'] ) : 'free';
		$valid = ! empty( $cache['valid'] );
		$api   = esc_url( untrailingslashit( $opts['api_base_url'] ) );
		$dash  = $api . '/dashboard';

		$discovery_url = home_url( '/agent-bridge.json' );
		$api_url       = home_url( '/wp-json/wab/v1' );

		echo '<ul class="wab-widget-list">';
		echo '<li><strong>' . esc_html__( 'Protocol:', 'web-agent-bridge' ) . '</strong> WAB v' . esc_html( WAB_VERSION ) . '</li>';
		echo '<li><strong>' . esc_html__( 'Plan:', 'web-agent-bridge' ) . '</strong> ' . esc_html( ucfirst( $tier ) ) . '</li>';
		echo '<li><strong>' . esc_html__( 'License:', 'web-agent-bridge' ) . '</strong> ';
		echo $valid
			? '<span style="color:#0a0">' . esc_html__( 'Verified', 'web-agent-bridge' ) . '</span>'
			: '<span style="color:#a00">' . esc_html__( 'Not verified / Free', 'web-agent-bridge' ) . '</span>';
		echo '</li>';
		if ( ! empty( $cache['checked'] ) ) {
			echo '<li><strong>' . esc_html__( 'Last check:', 'web-agent-bridge' ) . '</strong> ';
			echo esc_html( gmdate( 'Y-m-d H:i', (int) $cache['checked'] ) );
			echo ' UTC</li>';
		}
		echo '<li><strong>' . esc_html__( 'Discovery:', 'web-agent-bridge' ) . '</strong> <code style="font-size:11px;">' . esc_html( $discovery_url ) . '</code></li>';
		echo '<li><strong>' . esc_html__( 'WAB API:', 'web-agent-bridge' ) . '</strong> <code style="font-size:11px;">' . esc_html( $api_url ) . '</code></li>';
		echo '</ul>';
		echo '<p>';
		printf(
			'<a class="button button-primary" href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a> ',
			esc_url( $dash ),
			esc_html__( 'Open WAB dashboard', 'web-agent-bridge' )
		);
		printf(
			'<a class="button" href="%1$s">%2$s</a> ',
			esc_url( admin_url( 'options-general.php?page=web-agent-bridge' ) ),
			esc_html__( 'Plugin settings', 'web-agent-bridge' )
		);
		printf(
			'<a class="button" href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
			esc_url( $discovery_url ),
			esc_html__( 'View Discovery', 'web-agent-bridge' )
		);
		echo '</p>';
		echo '<p class="description">' . esc_html__( 'WAB Protocol endpoints are live. AI agents can discover your site via agent-bridge.json.', 'web-agent-bridge' ) . '</p>';
	}
}
