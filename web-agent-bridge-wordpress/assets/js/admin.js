(function ($) {
	'use strict';

	$('#wab-verify-license').on('click', function () {
		var $btn = $(this);
		var $status = $('#wab-license-status');
		$btn.prop('disabled', true);
		$status.text(wabAdmin.i18n.verifying);

		$.post(
			wabAdmin.ajaxUrl,
			{
				action: 'wab_verify_license',
				nonce: wabAdmin.nonce,
				license_key: $('#wab_license_key').val() || '',
				api_base_url: $('#wab_api_base').val() || ''
			}
		)
			.done(function (res) {
				if (res.success && res.data) {
					var d = res.data;
					$status.text(
						wabAdmin.i18n.ok +
							' tier=' +
							(d.tier || '?') +
							' valid=' +
							(d.valid ? 'yes' : 'no')
					);
				} else {
					$status.text(wabAdmin.i18n.fail);
				}
			})
			.fail(function () {
				$status.text(wabAdmin.i18n.fail);
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});
})(jQuery);
