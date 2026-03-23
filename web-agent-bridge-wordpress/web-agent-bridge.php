<?php
/**
 * Plugin Name:       Web Agent Bridge
 * Plugin URI:        https://webagentbridge.com
 * Description:       Embeds the Web Agent Bridge script for AI agents: permissions, license verification, custom actions, and per-page controls.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Web Agent Bridge
 * Author URI:        https://webagentbridge.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       web-agent-bridge
 * Domain Path:       /languages
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

define( 'WAB_VERSION', '1.0.0' );
define( 'WAB_PLUGIN_FILE', __FILE__ );
define( 'WAB_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'WAB_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'WAB_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

// Default remote WAB app URL (override in settings).
define( 'WAB_DEFAULT_API_BASE', 'https://webagentbridge.com' );

require_once WAB_PLUGIN_DIR . 'includes/class-wab-api.php';
require_once WAB_PLUGIN_DIR . 'includes/class-wab-actions.php';
require_once WAB_PLUGIN_DIR . 'includes/class-wab-settings.php';
require_once WAB_PLUGIN_DIR . 'includes/class-wab-metabox.php';
require_once WAB_PLUGIN_DIR . 'includes/class-wab-loader.php';
require_once WAB_PLUGIN_DIR . 'includes/class-wab-dashboard-widget.php';

/**
 * Initialize plugin.
 */
function wab_init() {
	load_plugin_textdomain( 'web-agent-bridge', false, dirname( WAB_PLUGIN_BASENAME ) . '/languages' );

	WAB_Settings::instance();
	WAB_Metabox::instance();
	WAB_Loader::instance();
	WAB_Dashboard_Widget::instance();
}
add_action( 'plugins_loaded', 'wab_init' );

/**
 * Plugin activation: schedule license check option defaults.
 */
function wab_activate() {
	if ( ! get_option( 'wab_options' ) ) {
		add_option(
			'wab_options',
			array(
				'license_key'           => '',
				'api_base_url'          => WAB_DEFAULT_API_BASE,
				'script_url'            => '',
				'inject_method'         => 'auto_head',
				'permissions'           => array(
					'readContent'      => true,
					'click'            => true,
					'fillForms'        => false,
					'scroll'            => true,
					'navigate'          => false,
					'apiAccess'         => false,
					'automatedLogin'    => false,
					'extractData'       => false,
				),
				'blocked_selectors'     => ".private\n[data-private]\n[data-no-agent]",
				'rate_limit'            => 60,
				'stealth_mode'          => false,
				'stealth_ethics_ack'    => false,
				'config_endpoint'       => '',
				'use_config_endpoint'   => false,
				'exclude_post_types'    => array(),
				'exclude_term_ids'      => '',
				'subscribe_url'         => 'https://webagentbridge.com/#pricing',
			)
		);
	}
}
register_activation_hook( __FILE__, 'wab_activate' );
