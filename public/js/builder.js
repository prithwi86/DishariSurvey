(function () {
  'use strict';

  var KEY = 'dishari:builder-draft';
  var form = document.getElementById('builder');
  var jsonField = document.getElementById('questions-json');
  var nameInput = document.getElementById('s-name');
  var purposeInput = document.getElementById('s-purpose');
  var titleInput = document.getElementById('q-title');
  var contextInput = document.getElementById('q-context');
  var optionsInput = document.getElementById('q-options');
  var optionsField = document.getElementById('options-field');
  var optionsLabel = document.getElementById('options-label');
  var TYPE_LABELS = { choice: 'Multiple choice', yesno: 'Yes / No', text: 'Written' };
  var saveBtn = document.getElementById('save-q');
  var publishBtn = document.getElementById('publish');
  var typeBtns = document.querySelectorAll('.typebtn');
  var list = document.getElementById('drafts');
  var tpl = document.getElementById('draft-tpl');

  var drafts = [];
  var qType = 'choice';
  var editing = null;

  try { drafts = JSON.parse(jsonField.value) || []; } catch (e) { drafts = []; }
  // No server-side draft (fresh page): restore the last unsaved one from this browser.
  if (!drafts.length && !nameInput.value) {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (saved) {
        drafts = saved.questions || [];
        nameInput.value = saved.name || '';
        purposeInput.value = saved.purpose || '';
      }
    } catch (e) { /* ignore */ }
  }

  function persist() {
    jsonField.value = JSON.stringify(drafts);
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: nameInput.value, purpose: purposeInput.value, questions: drafts }));
    } catch (e) { /* ignore */ }
  }

  function setType(t) {
    qType = t;
    typeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-type') === t)); });
    // Choice: answer options. Written: optional labels for several separate text boxes.
    optionsField.hidden = t === 'yesno';
    optionsLabel.textContent = t === 'text' ? 'Separate text boxes (optional, one label per line)' : 'Options (one per line)';
    optionsInput.placeholder = t === 'text' ? 'Leave empty for a single box, or e.g.\nFood\nVenue' : 'Excellent\nGood\nFair\nPoor';
    updateSave();
  }

  function optionList() {
    return optionsInput.value.split('\n').map(function (o) { return o.trim(); }).filter(Boolean);
  }

  // Multiple-choice questions need at least 2 options.
  function canSave() {
    return !!titleInput.value.trim() && (qType !== 'choice' || optionList().length >= 2);
  }

  function updateSave() { saveBtn.disabled = !canSave(); }

  function render() {
    list.textContent = '';
    drafts.forEach(function (d, i) {
      var card = tpl.content.firstElementChild.cloneNode(true);
      card.querySelector('.d-n').textContent = 'Q' + (i + 1);
      card.querySelector('.d-type').textContent = TYPE_LABELS[d.type] || d.type;
      var opts = card.querySelector('.d-options');
      if (d.type === 'choice') opts.textContent = (d.options || []).join(' · ');
      else if (d.type === 'text' && d.fields && d.fields.length) opts.textContent = 'Text boxes: ' + d.fields.join(' · ');
      else opts.remove();
      card.querySelector('.d-title').textContent = d.title;
      var ctx = card.querySelector('.d-context');
      if (d.context) ctx.textContent = d.context; else ctx.remove();
      card.querySelector('[data-action="edit"]').addEventListener('click', function () { edit(i); });
      card.querySelector('[data-action="delete"]').addEventListener('click', function () { remove(i); });
      list.appendChild(card);
    });
    document.getElementById('drafts-wrap').hidden = drafts.length === 0;
    document.getElementById('draft-count').textContent = drafts.length + ' added';
    document.getElementById('form-heading').textContent = editing != null ? 'Edit question ' + (editing + 1) : 'Add a question';
    document.getElementById('save-label').textContent = editing != null ? 'Save changes' : 'Add question';
    updateSave();
    publishBtn.disabled = !(nameInput.value.trim() && drafts.length > 0);
    persist();
  }

  function saveQuestion() {
    if (!canSave()) return;
    var item = { type: qType, title: titleInput.value.trim(), context: contextInput.value.trim() };
    if (qType === 'choice') item.options = optionList();
    if (qType === 'text' && optionList().length) item.fields = optionList();
    if (editing != null) drafts[editing] = item; else drafts.push(item);
    editing = null;
    titleInput.value = '';
    contextInput.value = '';
    optionsInput.value = '';
    render();
    titleInput.focus();
  }

  function edit(i) {
    var d = drafts[i];
    editing = i;
    titleInput.value = d.title;
    contextInput.value = d.context || '';
    optionsInput.value = (d.options || d.fields || []).join('\n');
    setType(d.type);
    render();
    titleInput.focus();
  }

  function remove(i) {
    drafts.splice(i, 1);
    if (editing === i) editing = null;
    else if (editing != null && editing > i) editing--;
    render();
  }

  typeBtns.forEach(function (b) {
    b.addEventListener('click', function () { setType(b.getAttribute('data-type')); });
  });
  titleInput.addEventListener('input', render);
  optionsInput.addEventListener('input', updateSave);
  nameInput.addEventListener('input', render);
  purposeInput.addEventListener('input', persist);
  saveBtn.addEventListener('click', saveQuestion);

  // Enter in a single-line field must not publish the survey by accident.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (e.target === titleInput) saveQuestion();
  });

  form.addEventListener('submit', function (e) {
    persist();
    if (!(nameInput.value.trim() && drafts.length > 0)) { e.preventDefault(); return; }
    if (!window.confirm('Publish "' + nameInput.value.trim() + '" now? It goes live straight away.')) { e.preventDefault(); return; }
    try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
  });

  setType(qType);
  render();
})();
