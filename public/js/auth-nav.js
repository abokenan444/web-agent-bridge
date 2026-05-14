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

// ─── Mobile hamburger menu (CSP-safe, no onclick attributes) ───
(function () {
  function initMobileMenu() {
    var btn = document.querySelector('.mobile-menu-btn');
    var links = document.querySelector('.navbar-links');
    if (!btn || !links) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      links.classList.toggle('active');
      // Toggle icon ☰ ↔ ✕
      btn.textContent = links.classList.contains('active') ? '✕' : '☰';
    });
    // Close menu when clicking outside
    document.addEventListener('click', function (e) {
      if (!e.target.closest('nav') && links.classList.contains('active')) {
        links.classList.remove('active');
        btn.textContent = '☰';
      }
    });
    // Close menu when a leaf nav link is clicked (but not when expanding a dropdown)
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('active');
        // Also collapse any open dropdowns
        links.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        btn.textContent = '☰';
      });
    });

    // ─── Dropdown triggers (works on desktop click + mobile tap) ───
    var triggers = links.querySelectorAll('.nav-trigger');
    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var parent = trigger.closest('.nav-dropdown');
        if (!parent) return;
        var wasOpen = parent.classList.contains('open');
        // Close siblings
        links.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
          if (d !== parent) {
            d.classList.remove('open');
            var t = d.querySelector('.nav-trigger');
            if (t) t.setAttribute('aria-expanded', 'false');
          }
        });
        parent.classList.toggle('open', !wasOpen);
        trigger.setAttribute('aria-expanded', String(!wasOpen));
      });
    });

    // Close dropdowns on outside click (desktop) or Escape
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-dropdown')) {
        links.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        links.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        if (links.classList.contains('active')) {
          links.classList.remove('active');
          btn.textContent = '☰';
        }
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileMenu);
  } else {
    initMobileMenu();
  }
})();
