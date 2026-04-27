<?php
/**
 * One-Click Sovereign Identity — admin page that turns any WordPress site
 * into a "sovereign" WAB site by:
 *
 *   1. Showing the exact DNS records to copy into the registrar.
 *   2. Live-verifying each record from the browser via DoH.
 *   3. Confirming /.well-known/wab.json is reachable.
 *
 * No registrar API call is made server-side — we keep the surface minimal
 * and deterministic. The user copies a snippet, pastes once, done.
 *
 * @package WebAgentBridge
 */

defined( 'ABSPATH' ) || exit;

class WAB_Sovereign {

	/** @var self|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 20 );
	}

	public function register_menu() {
		add_submenu_page(
			'options-general.php',
			__( 'WAB Sovereign Identity', 'web-agent-bridge' ),
			__( 'WAB Sovereign Identity', 'web-agent-bridge' ),
			'manage_options',
			'wab-sovereign',
			array( $this, 'render_page' )
		);
	}

	/**
	 * Build the canonical DNS records this site should publish.
	 *
	 * @return array<int,array<string,string>>
	 */
	public static function records_for_site() {
		$home   = home_url( '/' );
		$parts  = wp_parse_url( $home );
		$host   = isset( $parts['host'] ) ? $parts['host'] : '';
		$apex   = self::guess_apex( $host );
		$origin = ( isset( $parts['scheme'] ) ? $parts['scheme'] : 'https' ) . '://' . $host;

		return array(
			array(
				'name'  => '_wab',
				'fqdn'  => '_wab.' . $apex,
				'type'  => 'TXT',
				'value' => 'v=wab1; endpoint=' . $origin . '/.well-known/wab.json',
				'desc'  => __( 'Discovery — points agents at your wab.json contract.', 'web-agent-bridge' ),
			),
			array(
				'name'  => '_wab-trust',
				'fqdn'  => '_wab-trust.' . $apex,
				'type'  => 'TXT',
				'value' => 'trust=' . $origin . '/trust.json; security=' . $origin . '/.well-known/security.txt',
				'desc'  => __( 'Trust contract — declares data scope, rate limits, complaint channel.', 'web-agent-bridge' ),
			),
			array(
				'name'  => '_wab-agent',
				'fqdn'  => '_wab-agent.' . $apex,
				'type'  => 'TXT',
				'value' => 'agent=' . $origin . '/agent-bridge.json; ver=2',
				'desc'  => __( 'Optional — separate agent endpoint for staged rollouts.', 'web-agent-bridge' ),
			),
		);
	}

	/**
	 * Best-effort apex extraction (kept simple — handles foo.example.com → example.com).
	 *
	 * @param string $host Host name.
	 * @return string
	 */
	public static function guess_apex( $host ) {
		$host = preg_replace( '/^www\./i', '', (string) $host );
		$bits = explode( '.', $host );
		if ( count( $bits ) <= 2 ) {
			return $host;
		}
		// Two-label public suffixes like co.uk are not perfectly handled here;
		// the user can edit the displayed records before pasting.
		return implode( '.', array_slice( $bits, -2 ) );
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'web-agent-bridge' ) );
		}

		$records      = self::records_for_site();
		$discovery    = home_url( '/.well-known/wab.json' );
		$nonce        = wp_create_nonce( 'wab-sovereign' );
		$apex         = ! empty( $records ) ? self::guess_apex( wp_parse_url( home_url( '/' ), PHP_URL_HOST ) ) : '';
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'One-Click Sovereign Identity', 'web-agent-bridge' ); ?></h1>
			<p style="max-width:780px;font-size:14px">
				<?php
				echo esc_html__(
					'Turn this WordPress site into a sovereign WAB endpoint. Copy each TXT record into your DNS provider — the table below verifies them live from your browser via DNS over HTTPS.',
					'web-agent-bridge'
				);
				?>
			</p>

			<h2 class="title"><?php esc_html_e( 'Step 1 — DNS records', 'web-agent-bridge' ); ?></h2>
			<p>
				<?php
				/* translators: %s: apex domain */
				printf(
					esc_html__( 'Add these under your domain (apex: %s).', 'web-agent-bridge' ),
					'<code>' . esc_html( $apex ) . '</code>'
				);
				?>
			</p>
			<table class="widefat striped" id="wab-sov-records" style="max-width:980px">
				<thead>
					<tr>
						<th style="width:90px"><?php esc_html_e( 'Live', 'web-agent-bridge' ); ?></th>
						<th><?php esc_html_e( 'Name', 'web-agent-bridge' ); ?></th>
						<th><?php esc_html_e( 'Type', 'web-agent-bridge' ); ?></th>
						<th><?php esc_html_e( 'Value', 'web-agent-bridge' ); ?></th>
						<th style="width:80px"></th>
					</tr>
				</thead>
				<tbody>
				<?php foreach ( $records as $r ) : ?>
					<tr data-fqdn="<?php echo esc_attr( $r['fqdn'] ); ?>" data-rtype="<?php echo esc_attr( $r['type'] ); ?>" data-match="<?php echo esc_attr( substr( $r['value'], 0, 24 ) ); ?>">
						<td class="wab-live">…</td>
						<td><code><?php echo esc_html( $r['name'] ); ?></code><br><small><?php echo esc_html( $r['desc'] ); ?></small></td>
						<td><?php echo esc_html( $r['type'] ); ?></td>
						<td><textarea readonly rows="2" style="width:100%;font-family:monospace;font-size:12px"><?php echo esc_textarea( $r['value'] ); ?></textarea></td>
						<td><button type="button" class="button button-secondary wab-copy" data-copy="<?php echo esc_attr( $r['value'] ); ?>"><?php esc_html_e( 'Copy', 'web-agent-bridge' ); ?></button></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>

			<h2 class="title"><?php esc_html_e( 'Step 2 — Discovery endpoint', 'web-agent-bridge' ); ?></h2>
			<p>
				<?php
				/* translators: %s: discovery URL */
				printf(
					esc_html__( 'WAB Discovery is served by this plugin at: %s', 'web-agent-bridge' ),
					'<a href="' . esc_url( $discovery ) . '" target="_blank"><code>' . esc_html( $discovery ) . '</code></a>'
				);
				?>
				&nbsp;<span id="wab-sov-disc-status" class="description">…</span>
			</p>

			<h2 class="title"><?php esc_html_e( 'Step 3 — Privacy posture', 'web-agent-bridge' ); ?></h2>
			<ul style="max-width:780px;list-style:disc inside">
				<li><?php esc_html_e( 'Lookups use DNS over HTTPS (DoH) — encrypted between agent and resolver. ISPs cannot see them.', 'web-agent-bridge' ); ?></li>
				<li><?php esc_html_e( 'Your chosen DoH resolver still sees lookups. Pick a provider you trust.', 'web-agent-bridge' ); ?></li>
				<li><?php esc_html_e( 'Enable DNSSEC at your registrar to prevent zone-level forgery (DS record).', 'web-agent-bridge' ); ?></li>
			</ul>
		</div>

		<script>
		(function(){
			const RR = { TXT: 16, CAA: 257 };
			async function doh(name, type){
				const u = 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + type + '&do=1';
				const r = await fetch(u, { headers: { 'accept': 'application/dns-json' }});
				const d = await r.json();
				return { answers: (d.Answer||[]).filter(a => a.type === RR[type]).map(a => (a.data||'').replace(/^"|"$/g,'').replace(/"\s*"/g,'')), ad: !!d.AD };
			}
			document.querySelectorAll('#wab-sov-records tr[data-fqdn]').forEach(async (row) => {
				const cell = row.querySelector('.wab-live');
				try {
					const res = await doh(row.dataset.fqdn, row.dataset.rtype);
					const hit = res.answers.some(a => a.toLowerCase().indexOf(row.dataset.match.toLowerCase()) !== -1);
					if (hit) {
						cell.innerHTML = '<span style="color:#16a34a">✓ live' + (res.ad ? ' · DNSSEC' : '') + '</span>';
					} else {
						cell.innerHTML = '<span style="color:#b91c1c">✗ missing</span>';
					}
				} catch {
					cell.innerHTML = '<span style="color:#a16207">… error</span>';
				}
			});
			document.querySelectorAll('.wab-copy').forEach(btn => {
				btn.addEventListener('click', () => {
					const t = btn.getAttribute('data-copy') || '';
					if (navigator.clipboard) navigator.clipboard.writeText(t);
					const old = btn.textContent;
					btn.textContent = '✓';
					setTimeout(() => { btn.textContent = old; }, 1200);
				});
			});
			(async () => {
				const el = document.getElementById('wab-sov-disc-status');
				if (!el) return;
				try {
					const r = await fetch(<?php echo wp_json_encode( $discovery ); ?>, { method: 'GET', credentials: 'omit' });
					if (r.ok) { el.textContent = '✓ reachable'; el.style.color = '#16a34a'; }
					else { el.textContent = '✗ HTTP ' + r.status; el.style.color = '#b91c1c'; }
				} catch (e) {
					el.textContent = '… could not reach'; el.style.color = '#a16207';
				}
			})();
		})();
		</script>
		<?php
	}
}
