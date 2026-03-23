<?php
/**
 * Uninstall: remove plugin options.
 *
 * @package WebAgentBridge
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'wab_options' );
delete_option( 'wab_license_cache' );
