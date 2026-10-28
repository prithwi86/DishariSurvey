(function () {
  'use strict';

  // Time-based greeting in the admin's own time zone.
  var greeting = document.getElementById('greeting');
  if (greeting) {
    var h = new Date().getHours();
    greeting.textContent = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  }

  // Confirm buttons such as "Close survey".
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });
})();
