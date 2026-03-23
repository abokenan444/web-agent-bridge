/**
 * Shows / hides UI by auth state using data-wab-auth="signed-in" | "guest"
 * Run on DOMContentLoaded — keep dashboard links only for signed-in users.
 */
(function () {
  function hasToken() {
    try {
      return !!localStorage.getItem('wab_token');
    } catch (e) {
      return false;
    }
  }

  function apply() {
    var signedIn = hasToken();
    document.querySelectorAll('[data-wab-auth]').forEach(function (el) {
      var mode = el.getAttribute('data-wab-auth');
      if (mode === 'signed-in') {
        el.style.display = signedIn ? '' : 'none';
      } else if (mode === 'guest') {
        el.style.display = signedIn ? 'none' : '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
