<?php
/**
 * Remote WAB API (license verify, optional stats).
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_API {

	/**
	 * Verify license with WAB server.
	 *
	 * @param string $license_key License key.
	 * @param string $api_base    Base URL without trailing slash.
	 * @return array|\WP_Error { valid, tier, domain, allowedPermissions?, error? }
	 */
	public static function verify_license( $license_key, $api_base ) {
		$license_key = sanitize_text_field( $license_key );
		$api_base      = esc_url_raw( untrailingslashit( $api_base ) );

		if ( '' === $license_key ) {
			return array(
				'valid' => false,
				'tier'  => 'free',
				'error' => 'empty_key',
			);
		}

		$url = $api_base . '/api/license/verify';

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 15,
				'headers' => array(
					'Content-Type' => 'application/json',
				),
				'body'    => wp_json_encode(
					array(
						'domain'      => self::get_site_domain(),
						'licenseKey'  => $license_key,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( $code >= 400 || ! is_array( $data ) ) {
			return new WP_Error(
				'wab_verify_failed',
				__( 'License verification returned an invalid response.', 'web-agent-bridge' ),
				array( 'status' => $code, 'body' => $body )
			);
		}

		return $data;
	}

	/**
	 * Fetch remote JSON config (optional merge with local settings).
	 *
	 * @param string $endpoint Full URL.
	 * @param string $license_key License key sent as header X-WAB-License.
	 * @return array|\WP_Error
	 */
	public static function fetch_remote_config( $endpoint, $license_key ) {
		$endpoint = esc_url_raw( $endpoint );
		if ( '' === $endpoint ) {
			return new WP_Error( 'wab_no_endpoint', __( 'No config endpoint configured.', 'web-agent-bridge' ) );
		}

		$response = wp_remote_get(
			$endpoint,
			array(
				'timeout' => 15,
				'headers' => array(
					'Accept'          => 'application/json',
					'X-WAB-License'   => $license_key,
					'X-WAB-Site'      => self::get_site_domain(),
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( ! is_array( $data ) ) {
			return new WP_Error( 'wab_bad_config', __( 'Remote config is not valid JSON.', 'web-agent-bridge' ) );
		}

		return $data;
	}

	/**
	 * Site hostname for license binding.
	 *
	 * @return string
	 */
	public static function get_site_domain() {
		$host = wp_parse_url( home_url(), PHP_URL_HOST );
		return is_string( $host ) ? $host : '';
	}

	/**
	 * Tier order for capability checks.
	 *
	 * @param string $tier Tier name.
	 * @return int
	 */
	public static function tier_rank( $tier ) {
		$map = array(
			'free'       => 0,
			'starter'    => 1,
			'pro'        => 2,
			'enterprise' => 3,
		);
		return isset( $map[ $tier ] ) ? $map[ $tier ] : 0;
	}

	/**
	 * Whether current cached tier allows a feature (min tier).
	 *
	 * @param string $feature One of api_access, automated_login, extract_data, analytics.
	 * @return bool
	 */
	public static function tier_allows( $feature ) {
		$status = get_option( 'wab_license_cache', array() );
		$tier   = isset( $status['tier'] ) ? $status['tier'] : 'free';

		$needs = array(
			'api_access'      => 'pro',
			'automated_login' => 'starter',
			'extract_data'    => 'pro',
			'analytics'       => 'starter',
		);

		if ( ! isset( $needs[ $feature ] ) ) {
			return true;
		}

		return self::tier_rank( $tier ) >= self::tier_rank( $needs[ $feature ] );
	}
}
