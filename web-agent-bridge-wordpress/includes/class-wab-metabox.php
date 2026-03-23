<?php
/**
 * Per-post disable + save.
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Metabox {

	const META_KEY = '_wab_disable';

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
		add_action( 'add_meta_boxes', array( $this, 'register' ) );
		add_action( 'save_post', array( $this, 'save' ), 10, 2 );
	}

	public function register() {
		$types = get_post_types( array( 'public' => true ), 'names' );
		foreach ( $types as $type ) {
			add_meta_box(
				'wab_disable_box',
				__( 'Web Agent Bridge', 'web-agent-bridge' ),
				array( $this, 'render' ),
				$type,
				'side',
				'default'
			);
		}
	}

	/**
	 * @param WP_Post $post Post.
	 */
	public function render( $post ) {
		wp_nonce_field( 'wab_save_metabox', 'wab_metabox_nonce' );
		$disabled = get_post_meta( $post->ID, self::META_KEY, true );
		?>
		<p>
			<label>
				<input type="checkbox" name="wab_disable_bridge" value="1" <?php checked( $disabled, '1' ); ?> />
				<?php esc_html_e( 'Disable Web Agent Bridge on this page', 'web-agent-bridge' ); ?>
			</label>
		</p>
		<p class="description"><?php esc_html_e( 'Use on checkout, account, or other sensitive pages.', 'web-agent-bridge' ); ?></p>
		<?php
	}

	/**
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post.
	 */
	public function save( $post_id, $post ) {
		if ( ! isset( $_POST['wab_metabox_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['wab_metabox_nonce'] ) ), 'wab_save_metabox' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		if ( ! empty( $_POST['wab_disable_bridge'] ) ) {
			update_post_meta( $post_id, self::META_KEY, '1' );
		} else {
			delete_post_meta( $post_id, self::META_KEY );
		}
	}

	/**
	 * @param int $post_id Post ID.
	 * @return bool
	 */
	public static function is_disabled_for_post( $post_id ) {
		return '1' === get_post_meta( $post_id, self::META_KEY, true );
	}
}
