<?php
/**
 * Custom actions registrar (PHP hooks → front-end JSON).
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Collects action definitions from themes/plugins.
 */
class WAB_Action_Registrar {

	/**
	 * @var array<int, array<string, mixed>>
	 */
	protected $actions = array();

	/**
	 * Add an action definition. PHP callbacks are not sent to the browser;
	 * use WordPress AJAX hooks or REST routes for server-side work.
	 *
	 * @param array<string, mixed> $def Action definition.
	 * @return void
	 */
	public function add( array $def ) {
		if ( empty( $def['name'] ) || empty( $def['description'] ) ) {
			return;
		}
		$this->actions[] = $def;
	}

	/**
	 * @return array<int, array<string, mixed>>
	 */
	public function get_actions() {
		return $this->actions;
	}
}

/**
 * Build client-safe action payloads (strip callables).
 *
 * @return array<int, array<string, mixed>>
 */
function wab_collect_registered_actions() {
	$registrar = new WAB_Action_Registrar();

	/**
	 * Fires to register custom WAB actions.
	 *
	 * @param WAB_Action_Registrar $action_registrar Registrar instance.
	 */
	do_action( 'wab_register_actions', $registrar );

	$out = array();
	foreach ( $registrar->get_actions() as $def ) {
		$clean = $def;
		// PHP callbacks are not sent to the browser; use REST/AJAX for server work.
		unset( $clean['callback'] );
		$out[] = $clean;
	}

	return $out;
}
