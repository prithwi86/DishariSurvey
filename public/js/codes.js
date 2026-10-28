(function () {
  'use strict';
  // Keep the button label in step with the number typed.
  var input = document.getElementById('count');
  var label = document.getElementById('gen-n');
  var btn = document.getElementById('gen-btn');
  if (!input) return;
  input.addEventListener('input', function () {
    var n = parseInt(input.value, 10);
    label.textContent = n > 0 ? n : 0;
    btn.disabled = !(n > 0 && n <= 5000);
  });
  input.form.addEventListener('submit', function () {
    setTimeout(function () { btn.disabled = true; }, 0);
  });
})();
