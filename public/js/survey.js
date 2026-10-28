(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('survey-data').textContent);
  var KEY = 'dishari:draft:' + data.code;
  var MAX = 2000;

  var screens = {
    intro: document.getElementById('scr-intro'),
    questions: document.getElementById('scr-questions'),
    done: document.getElementById('scr-done'),
  };
  var sections = Array.prototype.slice.call(document.querySelectorAll('section[data-q]'));
  var footer = screens.questions.querySelector('.footer-bar');
  var btnBack = footer.querySelector('[data-action="back"]');
  var btnNext = footer.querySelector('[data-action="next"]');
  var btnSubmit = footer.querySelector('[data-action="submit"]');
  var errorBox = document.getElementById('submit-error');
  var tpl = document.getElementById('posted-tpl');

  // ---------- Draft state (localStorage only; nothing hits the server until Submit) ----------

  function emptyState() {
    return { screen: 'intro', index: 0, votes: {}, choices: {}, posted: {}, typed: {}, fields: {} };
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') {
        var base = emptyState();
        for (var k in base) if (!(k in s)) s[k] = base[k];
        s.index = Math.min(Math.max(0, s.index | 0), sections.length - 1);
        return s;
      }
    } catch (e) { /* storage blocked or corrupt */ }
    return emptyState();
  }

  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // ---------- Rendering ----------

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  function current() { return sections[state.index]; }
  function qid(section) { return section.getAttribute('data-qid'); }
  function isYesNo(section) { return section.getAttribute('data-type') === 'yesno'; }
  function isChoice(section) { return section.getAttribute('data-type') === 'choice'; }

  function answered(section) {
    var id = qid(section);
    if (isYesNo(section)) return !!state.votes[id];
    if (isChoice(section)) return typeof state.choices[id] === 'number';
    return true;
  }

  function renderPosted(section) {
    var list = section.querySelector('.posted');
    if (!list) return;
    var items = state.posted[qid(section)] || [];
    list.textContent = '';
    items.forEach(function (text, i) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      row.querySelector('.cmt-body').textContent = text;
      row.querySelector('[data-action="remove"]').addEventListener('click', function () {
        items.splice(i, 1);
        state.posted[qid(section)] = items;
        save();
        renderPosted(section);
      });
      list.appendChild(row);
    });
    list.hidden = items.length === 0;
  }

  function renderVotes(section) {
    var vote = state.votes[qid(section)];
    section.querySelectorAll('[data-vote]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-vote') === vote));
    });
  }

  function renderChoices(section) {
    var picked = state.choices[qid(section)];
    section.querySelectorAll('[data-choice]').forEach(function (b) {
      b.setAttribute('aria-checked', String(Number(b.getAttribute('data-choice')) === picked));
    });
  }

  function renderComposer(section) {
    var boxes = state.fields[qid(section)] || [];
    section.querySelectorAll('.field-box').forEach(function (b) {
      b.value = boxes[Number(b.getAttribute('data-field'))] || '';
    });
    var ta = section.querySelector('.composer');
    if (!ta) return;
    ta.value = state.typed[qid(section)] || '';
    var postBtn = section.querySelector('[data-action="post"]');
    if (postBtn) postBtn.disabled = !ta.value.trim();
  }

  function renderFooter() {
    var section = current();
    var last = state.index === sections.length - 1;
    var blocked = !answered(section);
    btnBack.disabled = state.index === 0;
    btnNext.hidden = last;
    btnSubmit.hidden = !last;
    btnNext.disabled = blocked;
    btnSubmit.disabled = blocked;
  }

  function renderQuestion() {
    sections.forEach(function (s, i) { s.hidden = i !== state.index; });
    var section = current();
    renderVotes(section);
    renderChoices(section);
    renderComposer(section);
    renderPosted(section);
    renderFooter();
    document.getElementById('q-num').textContent = state.index + 1;
    document.getElementById('q-progress').style.width = Math.round(((state.index + 1) / sections.length) * 100) + '%';
    errorBox.hidden = true;
  }

  // ---------- Actions ----------

  // Yes/No comments are "posted" into a list; written answers are a single text box.
  function post(section) {
    if (!section.querySelector('[data-action="post"]')) return;
    var id = qid(section);
    var text = (state.typed[id] || '').trim().slice(0, MAX);
    if (!text) return;
    var items = state.posted[id] || [];
    if (items.length >= 20) return;
    items.push(text);
    state.posted[id] = items;
    state.typed[id] = '';
    save();
    renderComposer(section);
    renderPosted(section);
  }

  function go(index) {
    // Text typed but not posted is posted automatically, so nothing is lost silently.
    post(current());
    state.index = index;
    state.screen = 'questions';
    save();
    renderQuestion();
    window.scrollTo(0, 0);
  }

  function submit() {
    sections.forEach(post);
    var answers = {};
    data.questions.forEach(function (q) {
      if (q.type === 'choice') answers[q.id] = { choice: state.choices[q.id] };
      else if (q.type === 'text' && q.boxes) answers[q.id] = { fields: (state.fields[q.id] || []).slice(0, q.boxes).map(function (t) { return (t || '').trim().slice(0, MAX); }) };
      else if (q.type === 'text') answers[q.id] = { comments: (state.typed[q.id] || '').trim() ? [state.typed[q.id].trim().slice(0, MAX)] : [] };
      else answers[q.id] = { vote: state.votes[q.id] || null, comments: state.posted[q.id] || [] };
    });
    btnSubmit.disabled = true;
    btnBack.disabled = true;
    errorBox.hidden = true;

    fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ answers: answers }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.status === 200 && r.body.ok) {
          clearDraft();
          document.getElementById('display-name').textContent = r.body.displayName;
          show('done');
        } else if (r.status === 409 || r.status === 410 || r.status === 404) {
          // Already submitted, closed or invalid: the server page explains which.
          clearDraft();
          window.location.reload();
        } else if (r.status === 429) {
          fail('Too many attempts. Please wait a few minutes and try again.');
        } else {
          fail('Something went wrong. Please check your answers and try again.');
        }
      })
      .catch(function () {
        fail("Couldn't reach the server. Check your connection and try again — your answers are saved on this device.");
      });
  }

  function fail(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    renderFooter();
  }

  // ---------- Wiring ----------

  document.querySelector('[data-action="begin"]').addEventListener('click', function () {
    state.screen = 'questions';
    save();
    show('questions');
    renderQuestion();
  });

  document.querySelector('[data-action="exit"]').addEventListener('click', function () {
    state.screen = 'intro';
    save();
    show('intro');
  });

  sections.forEach(function (section) {
    var id = qid(section);
    section.querySelectorAll('[data-vote]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.votes[id] = b.getAttribute('data-vote');
        save();
        renderVotes(section);
        renderFooter();
      });
    });
    section.querySelectorAll('[data-choice]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.choices[id] = Number(b.getAttribute('data-choice'));
        save();
        renderChoices(section);
        renderFooter();
      });
    });
    section.querySelectorAll('.field-box').forEach(function (b) {
      b.addEventListener('input', function () {
        var boxes = state.fields[id] || [];
        boxes[Number(b.getAttribute('data-field'))] = b.value;
        state.fields[id] = boxes;
        save();
      });
    });
    var ta = section.querySelector('.composer');
    if (!ta) return;
    var postBtn = section.querySelector('[data-action="post"]');
    ta.addEventListener('input', function () {
      state.typed[id] = ta.value;
      if (postBtn) postBtn.disabled = !ta.value.trim();
      save();
    });
    if (postBtn) postBtn.addEventListener('click', function () { post(section); ta.focus(); });
  });

  btnBack.addEventListener('click', function () { if (state.index > 0) go(state.index - 1); });
  btnNext.addEventListener('click', function () { if (state.index < sections.length - 1) go(state.index + 1); });
  btnSubmit.addEventListener('click', submit);
  document.querySelector('[data-action="done"]').addEventListener('click', function () { window.location.reload(); });

  // Restore where the participant left off.
  if (state.screen === 'questions') {
    show('questions');
    renderQuestion();
  } else {
    show('intro');
  }
})();
