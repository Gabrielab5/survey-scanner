/* survey-scanner UI: renders docs/data/studies.json and wires the auto-fill tools. */
(function () {
  'use strict';

  var PROFILE_KEY = 'survey-scanner.profile';
  var THEME_KEY = 'survey-scanner.theme';
  var state = { items: [], meta: null, filters: new Set(), q: '', sort: 'relevance', profile: {} };

  var $ = function (sel) { return document.querySelector(sel); };

  /* ------------------------------------------------------------------ theme */

  var savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#toggleTheme').addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  });

  /* ------------------------------------------------------------------- data */

  fetch('data/studies.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.items = data.items || [];
      state.meta = data;
      renderMeta(data);
      renderSources(data.sources || []);
      render();
    })
    .catch(function () {
      $('#results').innerHTML =
        '<p class="empty">לא הצלחנו לטעון את הנתונים. נסו לרענן בעוד רגע.</p>';
    });

  /* --------------------------------------------------------------- rendering */

  function renderMeta(data) {
    var age = Date.now() - new Date(data.generatedAt).getTime();
    $('#freshness').textContent = 'עודכן ' + relTime(age) + ' · מתעדכן כל שעה';
    var c = data.counts || {};
    $('#stats').innerHTML = [
      stat(c.total, 'רשומות פעילות'),
      stat(c.paid, 'עם תשלום מצוין'),
      stat(c.evergreen, 'פאנלים קבועים'),
      stat(c.autofillable, 'ניתנים למילוי אוטומטי'),
    ].join('');
  }

  function stat(n, label) {
    return '<div class="stat"><b>' + (n || 0) + '</b><span>' + label + '</span></div>';
  }

  function renderSources(sources) {
    $('#sourceStatus').innerHTML = sources.map(function (s) {
      var title = s.error ? ' title="' + esc(s.error) + '"' : '';
      return '<div class="source"' + title + '><span class="dot dot--' + s.status + '"></span>' +
        '<span>' + esc(s.label || s.id) + '</span>' +
        '<span class="source__count">' + s.count + '</span></div>';
    }).join('');
  }

  function render() {
    var items = state.items.filter(matches).sort(comparator());
    $('#results').innerHTML = items.map(card).join('');
    $('#empty').hidden = items.length > 0;
  }

  function matches(item) {
    var f = state.filters;
    if (f.has('paid') && !item.paymentConfirmed) return false;
    if (f.has('online') && item.mode !== 'online') return false;
    if (f.has('he') && item.language !== 'he') return false;
    if (f.has('autofill') && !item.autofill) return false;
    if (f.has('hidePanels') && item.evergreen) return false;
    if (f.has('hideClinical') && item.kind === 'clinical') return false;
    if (f.has('israel') && item.scope === 'global') return false;
    if (f.has('fits') && verdictFor(item, state.profile).level === 'no') return false;
    if (state.q) {
      var hay = [item.title, item.titleEn, item.summary, item.location, item.sourceLabel]
        .concat(item.tags || []).join(' ').toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function comparator() {
    if (state.sort === 'newest') {
      return function (a, b) { return time(b) - time(a); };
    }
    if (state.sort === 'amount') {
      return function (a, b) { return ils(b) - ils(a); };
    }
    return function (a, b) {
      return weight(b) - weight(a) || time(b) - time(a);
    };
  }

  var time = function (i) { return new Date(i.postedAt || i.lastSeen || 0).getTime(); };

  // Rough ILS conversion, only ever used to order the "highest paying" view.
  var RATES = { ILS: 1, USD: 3.7, EUR: 4, GBP: 4.7 };
  function ils(i) {
    if (!i.reward || !i.reward.amount) return -1;
    return i.reward.amount * (RATES[i.reward.currency] || 1);
  }

  function weight(i) {
    var v = verdictFor(i, state.profile);
    return (v.level === 'no' ? -500 : v.level === 'yes' ? 40 : 0) +
      (i.paymentConfirmed ? 100 : 0) + (i.evergreen ? 60 : 0) +
      (i.autofill ? 10 : 0) - (i.stale ? 200 : 0) - (i.kind === 'clinical' ? 30 : 0);
  }

  var KIND_LABEL = {
    panel: 'פאנל קבוע', lab: 'מעבדה אוניברסיטאית', clinical: 'ניסוי קליני',
    survey: 'סקר', study: 'מחקר',
  };

  function card(item) {
    var v = verdictFor(item, state.profile);
    var cls = 'card' + (item.evergreen ? ' card--evergreen' : '') + (item.stale ? ' card--stale' : '') +
      (v.level === 'no' ? ' card--blocked' : '');
    var tags = (item.tags || []).slice(0, 3).map(function (t) {
      return '<span class="tag">' + esc(t) + '</span>';
    }).join('');

    return '<article class="' + cls + '">' +
      '<div class="card__top">' +
        '<h3 class="card__title" dir="auto"><a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(item.title) + '</a>' + (item.titleEn && item.titleEn !== item.title ?
            '<span class="card__alt" dir="ltr">' + esc(item.titleEn) + '</span>' : '') + '</h3>' +
        rewardBadge(item) +
      '</div>' +
      (item.summary ? '<p class="card__summary" dir="auto">' + esc(item.summary) + '</p>' : '') +
      '<div class="card__tags">' +
        '<span class="tag tag--kind">' + (KIND_LABEL[item.kind] || item.kind) + '</span>' +
        (item.mode === 'online' ? '<span class="tag">מקוון</span>' : '') +
        (item.location ? '<span class="tag">' + esc(item.location) + '</span>' : '') +
        (item.stale ? '<span class="tag tag--warn">ייתכן שנסגר</span>' : '') +
        (item.scope === 'global' ? '<span class="tag">פתוח בכל העולם</span>' : '') +
        requirementTags(item) +
        tags +
      '</div>' +
      (v.level === 'none' ? '' : '<div class="card__verdict">' + verdictPill(v) + '</div>') +
      '<div class="card__foot">' +
        '<span class="card__meta">' + esc(item.sourceLabel || item.source) +
          (item.postedAt ? ' · ' + relTime(Date.now() - time(item)) : '') + '</span>' +
        '<span class="card__actions">' +
          (item.autofill ? '<button class="btn btn--ghost" data-fill="' + esc(item.url) + '">מילוי אוטומטי</button>' : '') +
          '<a class="btn btn--primary" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">פתיחה</a>' +
        '</span>' +
      '</div>' +
    '</article>';
  }

  function requirementTags(item) {
    var notes = (item.eligibility && item.eligibility.notes) || [];
    return notes.slice(0, 4).map(function (n) {
      return '<span class="tag tag--req">' + esc(n) + '</span>';
    }).join('');
  }

  function rewardBadge(item) {
    if (item.rewardNote) return '<span class="reward">' + esc(item.rewardNote) + '</span>';
    var r = item.reward;
    if (!r) return '<span class="reward reward--none">תשלום לא צוין</span>';
    if (r.amount) {
      var sign = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' }[r.currency] || '';
      var text = sign + r.amount + (r.amountMax ? '–' + sign + r.amountMax : '');
      return '<span class="reward">' + esc(text) + '</span>';
    }
    var soft = r.type === 'raffle' || r.type === 'unspecified';
    return '<span class="reward ' + (soft ? 'reward--soft' : '') + '">' + esc(r.raw) + '</span>';
  }


  /* ------------------------------------------------------- eligibility check */

  var REQUIREMENT_LABEL = {
    students: 'סטודנטים בלבד',
    partner: 'זוגות / עם בן-בת זוג',
    children: 'הורים לילדים',
    married: 'נשואים',
    pregnant: 'הריון או לאחר לידה',
    patients: 'אבחנה רפואית',
    smoker: 'מעשנים',
    driver: 'בעלי רישיון נהיגה',
    employed: 'מועסקים',
  };

  // Maps a requirement to the profile answer that settles it. Anything not here
  // (a medical diagnosis, say) can never be settled from the profile alone.
  var REQUIREMENT_ANSWER = {
    students: function (p) { return p.isStudent; },
    partner: function (p) { return p.hasPartner; },
    children: function (p) { return p.hasChildren; },
    married: function (p) { return p.maritalStatus ? (p.maritalStatus === 'married' ? 'yes' : 'no') : ''; },
  };

  /**
   * Decides whether the stored profile satisfies a listing's stated conditions.
   * Returns 'yes' only when conditions existed and all of them were met, so a
   * listing that states nothing stays unlabelled rather than falsely reassuring.
   */
  function verdictFor(item, p) {
    var e = item.eligibility || {};
    var blockers = [];
    var unknowns = [];
    var checked = 0;

    if (e.gender) {
      checked++;
      if (!p.gender) unknowns.push(e.gender === 'female' ? 'נשים בלבד' : 'גברים בלבד');
      else if (p.gender !== e.gender) blockers.push(e.gender === 'female' ? 'נשים בלבד' : 'גברים בלבד');
    }

    if (e.ageMin || e.ageMax) {
      checked++;
      var age = parseInt(p.age, 10);
      var range = e.ageMin && e.ageMax ? 'גיל ' + e.ageMin + '–' + e.ageMax
        : e.ageMin ? 'גיל ' + e.ageMin + '+' : 'עד גיל ' + e.ageMax;
      if (!age) unknowns.push(range);
      else if ((e.ageMin && age < e.ageMin) || (e.ageMax && age > e.ageMax)) blockers.push(range);
    }

    (e.requires || []).forEach(function (key) {
      checked++;
      var label = REQUIREMENT_LABEL[key] || key;
      var answer = REQUIREMENT_ANSWER[key] ? REQUIREMENT_ANSWER[key](p) : '';
      // Someone who cannot be pregnant is ruled out; otherwise it is unknowable.
      if (key === 'pregnant' && p.gender === 'male') { blockers.push(label); return; }
      if (!answer) unknowns.push(label);
      else if (answer === 'no') blockers.push(label);
    });

    if (e.countryOnly && e.countryOnly !== 'IL') {
      checked++;
      blockers.push('פתוח רק ל-' + e.countryOnly);
    }

    if (blockers.length) return { level: 'no', reasons: blockers };
    if (unknowns.length) return { level: 'maybe', reasons: unknowns };
    return { level: checked ? 'yes' : 'none', reasons: [] };
  }

  var VERDICT_TEXT = { yes: 'מתאים לך', no: 'לא מתאים', maybe: 'לבדוק' };

  function verdictPill(v) {
    if (v.level === 'none') return '';
    var title = v.reasons.length ? ' title="' + esc(v.reasons.join(' · ')) + '"' : '';
    return '<span class="verdict verdict--' + v.level + '"' + title + '>' +
      VERDICT_TEXT[v.level] + (v.reasons.length ? ': ' + esc(v.reasons.join(', ')) : '') + '</span>';
  }

  /* ---------------------------------------------------------------- controls */

  $('#q').addEventListener('input', function (e) {
    state.q = e.target.value.trim().toLowerCase();
    render();
  });

  $('#sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    render();
  });

  $('#chips').addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    var key = btn.dataset.filter;
    if (state.filters.has(key)) state.filters.delete(key);
    else state.filters.add(key);
    btn.setAttribute('aria-pressed', state.filters.has(key));
    render();
  });

  $('#results').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fill]');
    if (!btn) return;
    window.open(btn.dataset.fill, '_blank', 'noopener');
    toast('השאלון נפתח בלשונית חדשה — לחצו שם על הסימנייה ״מלא טופס אוטומטית״.');
  });

  /* ----------------------------------------------------------------- profile */

  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveProfile(p) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    state.profile = p;
    buildTools(p);
    render();
  }

  state.profile = loadProfile();

  var dialog = $('#profileDialog');
  var form = $('#profileForm');

  function openProfile() {
    var p = loadProfile();
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name && p[el.name] !== undefined) el.value = p[el.name];
    });
    dialog.showModal();
  }

  $('#openProfile').addEventListener('click', openProfile);
  $('#editProfile').addEventListener('click', openProfile);

  dialog.addEventListener('close', function () {
    if (dialog.returnValue !== 'save') return;
    var p = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name && el.value.trim()) p[el.name] = el.value.trim();
    });
    saveProfile(p);
    toast('הפרופיל נשמר בדפדפן שלכם.');
  });

  /* ------------------------------------------------- bookmarklet & userscript */

  var engineSource = null;

  fetch('autofill-core.js', { cache: 'no-cache' })
    .then(function (r) { return r.text(); })
    .then(function (src) {
      engineSource = src;
      buildTools(loadProfile());
    });

  function buildTools(profile) {
    if (!engineSource) return;
    var payload = JSON.stringify(profile);
    var code = '(function(){' + engineSource + ';ssAutofill(' + payload + ');})();';
    $('#bookmarklet').href = 'javascript:' + encodeURIComponent(code);

    $('#copyUserscript').onclick = function () {
      var script = [
        '// ==UserScript==',
        '// @name         סורק הסקרים – מילוי אוטומטי',
        '// @namespace    survey-scanner',
        '// @version      1.0',
        '// @description  ממלא אוטומטית שדות דמוגרפיים נפוצים בשאלונים מקוונים',
        '// @match        https://docs.google.com/forms/*',
        '// @match        https://*.qualtrics.com/*',
        '// @match        https://*.surveymonkey.com/*',
        '// @match        https://*.jotform.com/*',
        '// @match        https://forms.office.com/*',
        '// @match        https://*.limequery.com/*',
        '// @match        https://*.soscisurvey.de/*',
        '// @grant        none',
        '// ==/UserScript==',
        '',
        '(function () {',
        '  var PROFILE = ' + payload + ';',
        engineSource.replace(/^/gm, '  '),
        '  // Forms render lazily; wait for the questions before filling.',
        '  setTimeout(function () { ssAutofill(PROFILE); }, 1500);',
        '})();',
      ].join('\n');
      download('survey-scanner-autofill.user.js', script);
      toast('הקובץ הורד. גררו אותו לחלון Tampermonkey כדי להתקין.');
    };
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  $('#bookmarklet').addEventListener('click', function (e) {
    e.preventDefault();
    toast('גררו את הכפתור לשורת הסימניות — לחיצה כאן לא תפעיל אותו.');
  });

  /* -------------------------------------------------------------------- util */

  function relTime(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 1) return 'עכשיו';
    if (mins < 60) return 'לפני ' + mins + ' דק׳';
    var hours = Math.round(mins / 60);
    if (hours < 24) return 'לפני ' + hours + ' שע׳';
    var days = Math.round(hours / 24);
    return 'לפני ' + days + ' ימים';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(message) {
    var box = $('#toast');
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 5000);
  }
})();
