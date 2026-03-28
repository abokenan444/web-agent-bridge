<?php
/**
 * Admin settings page and options.
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Settings {

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
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'wp_ajax_wab_verify_license', array( $this, 'ajax_verify_license' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin' ) );
		add_action( 'admin_init', array( $this, 'maybe_admin_notices' ) );
	}

	/**
	 * @return array<string, mixed>
	 */
	public static function get_options() {
		$defaults = array(
			'license_key'           => '',
			'api_base_url'          => WAB_DEFAULT_API_BASE,
			'script_url'            => '',
			'inject_method'         => 'auto_head',
			'permissions'           => array(
				'readContent'      => true,
				'click'            => true,
				'fillForms'        => false,
				'scroll'           => true,
				'navigate'         => false,
				'apiAccess'        => false,
				'automatedLogin'   => false,
				'extractData'      => false,
			),
			'blocked_selectors'     => '',
			'rate_limit'            => 60,
			'stealth_mode'          => false,
			'stealth_ethics_ack'    => false,
			'config_endpoint'       => '',
			'use_config_endpoint'   => false,
			'exclude_post_types'    => array(),
			'exclude_term_ids'      => '',
			'subscribe_url'         => 'https://webagentbridge.com/#pricing',
		);
		$opts = get_option( 'wab_options', array() );
		$opts = wp_parse_args( is_array( $opts ) ? $opts : array(), $defaults );
		if ( empty( $opts['permissions'] ) || ! is_array( $opts['permissions'] ) ) {
			$opts['permissions'] = $defaults['permissions'];
		} else {
			$opts['permissions'] = wp_parse_args( $opts['permissions'], $defaults['permissions'] );
		}
		return $opts;
	}

	public function register_menu() {
		add_options_page(
			__( 'Web Agent Bridge', 'web-agent-bridge' ),
			__( 'Web Agent Bridge', 'web-agent-bridge' ),
			'manage_options',
			'web-agent-bridge',
			array( $this, 'render_page' )
		);
	}

	public function register_settings() {
		register_setting(
			'wab_settings_group',
			'wab_options',
			array( $this, 'sanitize_options' )
		);
	}

	/**
	 * @param array<string, mixed> $input Raw input.
	 * @return array<string, mixed>
	 */
	public function sanitize_options( $input ) {
		$old   = self::get_options();
		$input = is_array( $input ) ? $input : array();

		$out = array(
			'license_key'           => isset( $input['license_key'] ) ? sanitize_text_field( $input['license_key'] ) : '',
			'api_base_url'          => isset( $input['api_base_url'] ) ? esc_url_raw( untrailingslashit( $input['api_base_url'] ) ) : WAB_DEFAULT_API_BASE,
			'script_url'            => isset( $input['script_url'] ) ? esc_url_raw( $input['script_url'] ) : '',
			'inject_method'         => isset( $input['inject_method'] ) && in_array( $input['inject_method'], array( 'auto_head', 'auto_footer', 'shortcode_only' ), true )
				? $input['inject_method']
				: 'auto_head',
			'permissions'           => array(),
			'blocked_selectors'     => isset( $input['blocked_selectors'] ) ? sanitize_textarea_field( $input['blocked_selectors'] ) : '',
			'rate_limit'            => isset( $input['rate_limit'] ) ? max( 1, min( 10000, absint( $input['rate_limit'] ) ) ) : 60,
			'stealth_mode'          => ! empty( $input['stealth_mode'] ),
			'stealth_ethics_ack'    => ! empty( $input['stealth_ethics_ack'] ),
			'config_endpoint'       => isset( $input['config_endpoint'] ) ? esc_url_raw( $input['config_endpoint'] ) : '',
			'use_config_endpoint'   => ! empty( $input['use_config_endpoint'] ),
			'exclude_post_types'    => isset( $input['exclude_post_types'] ) && is_array( $input['exclude_post_types'] ) ? array_map( 'sanitize_key', $input['exclude_post_types'] ) : array(),
			'exclude_term_ids'      => isset( $input['exclude_term_ids'] ) ? sanitize_text_field( $input['exclude_term_ids'] ) : '',
			'subscribe_url'         => isset( $input['subscribe_url'] ) ? esc_url_raw( $input['subscribe_url'] ) : '',
		);

		$perm_keys = array( 'readContent', 'click', 'fillForms', 'scroll', 'navigate', 'apiAccess', 'automatedLogin', 'extractData' );
		foreach ( $perm_keys as $pk ) {
			$out['permissions'][ $pk ] = ! empty( $input['permissions'][ $pk ] );
		}

		// Re-verify license when key or API base changes.
		if ( $out['license_key'] !== $old['license_key'] || $out['api_base_url'] !== $old['api_base_url'] ) {
			$this->refresh_license_cache( $out['license_key'], $out['api_base_url'] );
		}

		// Enforce tier caps after cache refresh.
		$cache = get_option( 'wab_license_cache', array() );
		$tier  = isset( $cache['tier'] ) ? $cache['tier'] : 'free';
		if ( WAB_API::tier_rank( $tier ) < WAB_API::tier_rank( 'pro' ) ) {
			$out['permissions']['apiAccess']      = false;
			$out['permissions']['extractData']    = false;
		}
		if ( WAB_API::tier_rank( $tier ) < WAB_API::tier_rank( 'starter' ) ) {
			$out['permissions']['automatedLogin'] = false;
		}

		return $out;
	}

	/**
	 * @param string $key Key.
	 * @param string $api_base API base.
	 */
	private function refresh_license_cache( $key, $api_base ) {
		$result = WAB_API::verify_license( $key, $api_base );
		if ( is_wp_error( $result ) ) {
			update_option(
				'wab_license_cache',
				array(
					'valid'   => false,
					'tier'    => 'free',
					'error'   => $result->get_error_message(),
					'checked' => time(),
				),
				false
			);
			return;
		}
		$result['checked'] = time();
		update_option( 'wab_license_cache', $result, false );
	}

	public function ajax_verify_license() {
		check_ajax_referer( 'wab_admin', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'Permission denied.', 'web-agent-bridge' ) ), 403 );
		}
		$key  = isset( $_POST['license_key'] ) ? sanitize_text_field( wp_unslash( $_POST['license_key'] ) ) : '';
		$base = isset( $_POST['api_base_url'] ) ? esc_url_raw( untrailingslashit( wp_unslash( $_POST['api_base_url'] ) ) ) : '';
		$opts = self::get_options();
		if ( '' === $key ) {
			$key = $opts['license_key'];
		}
		if ( '' === $base ) {
			$base = $opts['api_base_url'];
		}
		$res  = WAB_API::verify_license( $key, $base );
		if ( is_wp_error( $res ) ) {
			wp_send_json_error( array( 'message' => $res->get_error_message() ) );
		}
		$res['checked'] = time();
		update_option( 'wab_license_cache', $res, false );
		wp_send_json_success( $res );
	}

	public function enqueue_admin( $hook ) {
		if ( 'settings_page_web-agent-bridge' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'wab-admin', WAB_PLUGIN_URL . 'assets/css/admin.css', array(), WAB_VERSION );
		wp_enqueue_script( 'wab-admin', WAB_PLUGIN_URL . 'assets/js/admin.js', array( 'jquery' ), WAB_VERSION, true );
		wp_localize_script(
			'wab-admin',
			'wabAdmin',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'wab_admin' ),
				'i18n'    => array(
					'verifying' => __( 'Verifying…', 'web-agent-bridge' ),
					'ok'        => __( 'License verified.', 'web-agent-bridge' ),
					'fail'      => __( 'Verification failed.', 'web-agent-bridge' ),
				),
			)
		);
	}

	public function maybe_admin_notices() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && 'settings_page_web-agent-bridge' === $screen->id ) {
			return;
		}
		$cache = get_option( 'wab_license_cache', array() );
		if ( ! empty( $cache['valid'] ) ) {
			return;
		}
		$opts = self::get_options();
		if ( '' === $opts['license_key'] ) {
			return;
		}
		add_action(
			'admin_notices',
			function () {
				$url = admin_url( 'options-general.php?page=web-agent-bridge' );
				echo '<div class="notice notice-warning is-dismissible"><p>';
				echo esc_html__( 'Web Agent Bridge: your license key could not be verified.', 'web-agent-bridge' );
				echo ' <a href="' . esc_url( $url ) . '">' . esc_html__( 'Review settings', 'web-agent-bridge' ) . '</a>';
				echo '</p></div>';
			}
		);
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$opts  = self::get_options();
		$cache = get_option( 'wab_license_cache', array() );
		$tier  = isset( $cache['tier'] ) ? $cache['tier'] : 'free';

		$can_api       = WAB_API::tier_allows( 'api_access' );
		$can_auto_login = WAB_API::tier_allows( 'automated_login' );
		$can_extract   = WAB_API::tier_allows( 'extract_data' );

		settings_errors( 'wab_settings' );
		if ( ! empty( $opts['license_key'] ) && empty( $cache['valid'] ) ) {
			echo '<div class="notice notice-warning"><p>';
			esc_html_e( 'Your license key could not be verified against the WAB API. Check the key, API base URL, and domain binding.', 'web-agent-bridge' );
			echo '</p></div>';
		}
		?>
		<div class="wrap wab-settings">
			<h1><?php echo esc_html( get_admin_page_title() ); ?> <span class="wab-badge">v<?php echo esc_html( WAB_VERSION ); ?></span></h1>
			<p class="description">
				<?php esc_html_e( 'Open protocol for AI agent-website interaction. Connect your WordPress site so agents can discover, plan, and execute structured commands.', 'web-agent-bridge' ); ?>
			</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'wab_settings_group' ); ?>

				<h2 class="title"><?php esc_html_e( 'License & API', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="wab_license_key"><?php esc_html_e( 'License key', 'web-agent-bridge' ); ?></label></th>
						<td>
							<input type="text" class="regular-text" id="wab_license_key" name="wab_options[license_key]" value="<?php echo esc_attr( $opts['license_key'] ); ?>" autocomplete="off" />
							<button type="button" class="button" id="wab-verify-license"><?php esc_html_e( 'Verify now', 'web-agent-bridge' ); ?></button>
							<p class="description" id="wab-license-status">
								<?php
								if ( ! empty( $cache['checked'] ) ) {
									printf(
										/* translators: %s: tier name */
										esc_html__( 'Last check: tier=%s, valid=%s', 'web-agent-bridge' ),
										esc_html( $tier ),
										! empty( $cache['valid'] ) ? esc_html__( 'yes', 'web-agent-bridge' ) : esc_html__( 'no', 'web-agent-bridge' )
									);
								}
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wab_api_base"><?php esc_html_e( 'WAB API base URL', 'web-agent-bridge' ); ?></label></th>
						<td>
							<input type="url" class="regular-text" id="wab_api_base" name="wab_options[api_base_url]" value="<?php echo esc_attr( $opts['api_base_url'] ); ?>" placeholder="https://webagentbridge.com" />
							<p class="description"><?php esc_html_e( 'Use your self-hosted WAB URL or the official host.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wab_script_url"><?php esc_html_e( 'Bridge script URL', 'web-agent-bridge' ); ?></label></th>
						<td>
							<input type="url" class="large-text" id="wab_script_url" name="wab_options[script_url]" value="<?php echo esc_attr( $opts['script_url'] ); ?>" placeholder="<?php echo esc_attr( trailingslashit( $opts['api_base_url'] ) . 'script/ai-agent-bridge.js' ); ?>" />
							<p class="description"><?php esc_html_e( 'Leave empty to default to {API base}/script/ai-agent-bridge.js', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Subscription', 'web-agent-bridge' ); ?></th>
						<td>
							<p>
								<label for="wab_subscribe_url" class="screen-reader-text"><?php esc_html_e( 'Plans URL', 'web-agent-bridge' ); ?></label>
								<input type="url" class="large-text" id="wab_subscribe_url" name="wab_options[subscribe_url]" value="<?php echo esc_attr( $opts['subscribe_url'] ); ?>" />
							</p>
							<a href="<?php echo esc_url( $opts['subscribe_url'] ); ?>" class="button button-secondary" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'View plans & upgrade', 'web-agent-bridge' ); ?></a>
						</td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'Injection', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Include method', 'web-agent-bridge' ); ?></th>
						<td>
							<label><input type="radio" name="wab_options[inject_method]" value="auto_head" <?php checked( $opts['inject_method'], 'auto_head' ); ?> /> <?php esc_html_e( 'Automatic in &lt;head&gt;', 'web-agent-bridge' ); ?></label><br />
							<label><input type="radio" name="wab_options[inject_method]" value="auto_footer" <?php checked( $opts['inject_method'], 'auto_footer' ); ?> /> <?php esc_html_e( 'Automatic in footer', 'web-agent-bridge' ); ?></label><br />
							<label><input type="radio" name="wab_options[inject_method]" value="shortcode_only" <?php checked( $opts['inject_method'], 'shortcode_only' ); ?> /> <?php esc_html_e( 'Shortcode only', 'web-agent-bridge' ); ?> <code>[wab_bridge]</code></label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wab_config_endpoint"><?php esc_html_e( 'Remote config endpoint', 'web-agent-bridge' ); ?></label></th>
						<td>
							<label>
								<input type="checkbox" name="wab_options[use_config_endpoint]" value="1" <?php checked( $opts['use_config_endpoint'] ); ?> />
								<?php esc_html_e( 'Merge JSON from this URL (server-side)', 'web-agent-bridge' ); ?>
							</label>
							<p><input type="url" class="large-text" id="wab_config_endpoint" name="wab_options[config_endpoint]" value="<?php echo esc_attr( $opts['config_endpoint'] ); ?>" /></p>
							<p class="description"><?php esc_html_e( 'Optional. Sends X-WAB-License and X-WAB-Site headers. Merged into AIBridgeConfig.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'Agent permissions', 'web-agent-bridge' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Some options require a paid tier on your WAB account.', 'web-agent-bridge' ); ?></p>
				<table class="form-table" role="presentation">
					<?php
					$perms = $opts['permissions'];
					$list  = array(
						'readContent'   => __( 'Read content', 'web-agent-bridge' ),
						'click'         => __( 'Click', 'web-agent-bridge' ),
						'fillForms'     => __( 'Fill forms', 'web-agent-bridge' ),
						'scroll'        => __( 'Scroll', 'web-agent-bridge' ),
						'navigate'      => __( 'Navigate', 'web-agent-bridge' ),
						'apiAccess'     => __( 'API access (Pro+)', 'web-agent-bridge' ),
						'automatedLogin' => __( 'Automated login (Starter+)', 'web-agent-bridge' ),
						'extractData'   => __( 'Extract data (Pro+)', 'web-agent-bridge' ),
					);
					foreach ( $list as $key => $label ) {
						$disabled = false;
						if ( 'apiAccess' === $key && ! $can_api ) {
							$disabled = true;
						}
						if ( 'automatedLogin' === $key && ! $can_auto_login ) {
							$disabled = true;
						}
						if ( 'extractData' === $key && ! $can_extract ) {
							$disabled = true;
						}
						$checked = ! empty( $perms[ $key ] );
						?>
						<tr>
							<th scope="row"><?php echo esc_html( $label ); ?></th>
							<td>
								<label>
									<input type="checkbox" name="wab_options[permissions][<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( $checked ); ?> <?php disabled( $disabled ); ?> />
									<?php
									if ( $disabled ) {
										echo '<span class="description">' . esc_html__( 'Upgrade your plan to enable this.', 'web-agent-bridge' ) . '</span>';
									}
									?>
								</label>
							</td>
						</tr>
						<?php
					}
					?>
				</table>

				<h2 class="title"><?php esc_html_e( 'Restrictions & limits', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="wab_blocked"><?php esc_html_e( 'Blocked selectors', 'web-agent-bridge' ); ?></label></th>
						<td>
							<textarea class="large-text code" rows="5" id="wab_blocked" name="wab_options[blocked_selectors]"><?php echo esc_textarea( $opts['blocked_selectors'] ); ?></textarea>
							<p class="description"><?php esc_html_e( 'One CSS selector per line.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wab_rate"><?php esc_html_e( 'Rate limit (calls per minute)', 'web-agent-bridge' ); ?></label></th>
						<td><input type="number" min="1" max="10000" id="wab_rate" name="wab_options[rate_limit]" value="<?php echo esc_attr( (string) $opts['rate_limit'] ); ?>" /></td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'Stealth mode', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Stealth', 'web-agent-bridge' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="wab_options[stealth_mode]" value="1" <?php checked( $opts['stealth_mode'] ); ?> />
								<?php esc_html_e( 'Reduce obvious markers in HTML output (still loads the bridge for opted-in agents).', 'web-agent-bridge' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Ethical use', 'web-agent-bridge' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="wab_options[stealth_ethics_ack]" value="1" <?php checked( $opts['stealth_ethics_ack'] ); ?> />
								<?php esc_html_e( 'I confirm that automation on this site complies with applicable laws, terms of service, and user consent.', 'web-agent-bridge' ); ?>
							</label>
							<?php if ( $opts['stealth_mode'] && ! $opts['stealth_ethics_ack'] ) : ?>
								<p class="wab-warning"><?php esc_html_e( 'Stealth mode should only be used with ethical consent acknowledged.', 'web-agent-bridge' ); ?></p>
							<?php endif; ?>
						</td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'Content rules', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Exclude post types', 'web-agent-bridge' ); ?></th>
						<td>
							<?php
							$types = get_post_types( array( 'public' => true ), 'objects' );
							foreach ( $types as $pt ) {
								$checked = in_array( $pt->name, (array) $opts['exclude_post_types'], true );
								?>
								<label style="display:inline-block;margin-right:12px;">
									<input type="checkbox" name="wab_options[exclude_post_types][]" value="<?php echo esc_attr( $pt->name ); ?>" <?php checked( $checked ); ?> />
									<?php echo esc_html( $pt->label ); ?>
								</label>
								<?php
							}
							?>
							<p class="description"><?php esc_html_e( 'Never load the bridge on these types.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wab_exclude_terms"><?php esc_html_e( 'Exclude term IDs', 'web-agent-bridge' ); ?></label></th>
						<td>
							<input type="text" class="large-text" id="wab_exclude_terms" name="wab_options[exclude_term_ids]" value="<?php echo esc_attr( $opts['exclude_term_ids'] ); ?>" placeholder="12, 34, 56" />
							<p class="description"><?php esc_html_e( 'Comma-separated taxonomy term IDs. If the current post has any of these, the bridge will not load.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'WAB Protocol & Discovery', 'web-agent-bridge' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Protocol version', 'web-agent-bridge' ); ?></th>
						<td><code>WAB Protocol 1.0 — Runtime <?php echo esc_html( WAB_VERSION ); ?></code></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Discovery endpoints', 'web-agent-bridge' ); ?></th>
						<td>
							<?php
							$disc_urls = array(
								home_url( '/agent-bridge.json' ),
								home_url( '/.well-known/wab.json' ),
								home_url( '/wp-json/wab/v1/discover' ),
							);
							echo '<ul class="wab-widget-list">';
							foreach ( $disc_urls as $u ) {
								echo '<li><code>' . esc_html( $u ) . '</code> ';
								echo '<a href="' . esc_url( $u ) . '" target="_blank" rel="noopener noreferrer" class="button button-small">' . esc_html__( 'Test', 'web-agent-bridge' ) . '</a>';
								echo '</li>';
							}
							echo '</ul>';
							?>
							<p class="description"><?php esc_html_e( 'All three URLs serve the same discovery document. AI agents fetch this to learn your site capabilities.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'WAB REST API', 'web-agent-bridge' ); ?></th>
						<td>
							<?php
							$api_routes = array(
								'/wp-json/wab/v1/discover' => __( 'Discovery document', 'web-agent-bridge' ),
								'/wp-json/wab/v1/actions'  => __( 'Available actions', 'web-agent-bridge' ),
								'/wp-json/wab/v1/page-info' => __( 'Site info', 'web-agent-bridge' ),
								'/wp-json/wab/v1/ping'     => __( 'Health check', 'web-agent-bridge' ),
							);
							echo '<ul class="wab-widget-list">';
							foreach ( $api_routes as $path => $desc ) {
								$full = home_url( $path );
								echo '<li><code>' . esc_html( $path ) . '</code> — ' . esc_html( $desc ) . ' ';
								echo '<a href="' . esc_url( $full ) . '" target="_blank" rel="noopener noreferrer" class="button button-small">' . esc_html__( 'Test', 'web-agent-bridge' ) . '</a>';
								echo '</li>';
							}
							echo '</ul>';
							?>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'NoScript fallback', 'web-agent-bridge' ); ?></th>
						<td>
							<span style="color:#0a0;font-weight:600;"><?php esc_html_e( 'Active', 'web-agent-bridge' ); ?></span>
							<p class="description"><?php esc_html_e( 'When JavaScript is disabled, meta tags and link elements expose discovery URLs so HTTP-only agents can still find your site.', 'web-agent-bridge' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Lifecycle', 'web-agent-bridge' ); ?></th>
						<td>
							<ol style="margin:0;padding-left:1.5em;">
								<li>Discover</li>
								<li>Authenticate</li>
								<li>Plan</li>
								<li>Execute</li>
								<li>Confirm</li>
							</ol>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
