/**
 * Safe redirect target after login/register (?next=/path)
 */
(function () {
  window.wabGetPostAuthRedirect = function () {
    try {
      var p = new URLSearchParams(window.location.search).get('next');
      if (p && p.charAt(0) === '/' && p.indexOf('//') !== 0) return p;
    } catch (e) {}
    return '/dashboard';
  };
})();
