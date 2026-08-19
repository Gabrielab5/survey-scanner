/**
 * survey-scanner auto-fill engine.
 *
 * Single top-level function on purpose: app.js fetches this file's source text
 * and wraps it into a bookmarklet / userscript, so there is exactly one copy of
 * the logic. It fills fields it recognises and never submits anything.
 */
function ssAutofill(profile) {
  var P = profile || {};
  var filled = 0;

  /* ------------------------------------------------------------ field rules */

  // Order matters: the first rule that matches a field's label wins, so the
  // specific ones (first name) must come before the generic ones (name).
  var RULES = [
    { key: 'email',        re: /e-?mail|מייל|אימייל|דוא"?ל|דואר אלקטרוני/i,                     value: P.email },
    { key: 'firstName',    re: /first ?name|given ?name|forename|שם פרטי/i,                      value: P.firstName },
    { key: 'lastName',     re: /last ?name|sur ?name|family ?name|שם משפחה/i,                    value: P.lastName },
    { key: 'fullName',     re: /full ?name|your name|^name$|nickname|שם מלא|^שם$|שמך/i,          value: fullName() },
    { key: 'phone',        re: /phone|mobile|cell|טלפון|נייד|סלולר/i,                            value: P.phone },
    { key: 'birthYear',    re: /year of birth|birth ?year|שנת לידה/i,                            value: P.birthYear },
    { key: 'age',          re: /\bage\b|how old|גיל|בן כמה|בת כמה/i,                             value: P.age },
    { key: 'gender',       re: /gender|\bsex\b|מגדר|^מין$|מין:/i,                                value: P.gender,        options: 'gender' },
    { key: 'city',         re: /\bcity\b|town|place of residence|עיר|יישוב|ישוב|מקום מגורים/i,   value: P.city },
    { key: 'country',      re: /country|nationality|מדינה|ארץ מגורים/i,                          value: P.country },
    { key: 'nativeLanguage', re: /native language|mother tongue|first language|שפת אם|שפה/i,     value: P.nativeLanguage },
    { key: 'education',    re: /education|degree|academic level|השכלה|תואר|רמת השכלה/i,          value: P.education,     options: 'education' },
    { key: 'occupation',   re: /occupation|profession|\bjob\b|employment|עיסוק|מקצוע|תעסוקה/i,   value: P.occupation },
    { key: 'maritalStatus',re: /marital|relationship status|מצב משפחתי/i,                        value: P.maritalStatus, options: 'marital' },
    { key: 'prolificId',   re: /prolific|participant ?id|worker ?id|מספר משתתף|קוד משתתף/i,      value: P.prolificId },
  ];

  // Synonyms used to pick a radio button / dropdown option for a coded answer.
  var OPTIONS = {
    gender: {
      female: /female|woman|girl|נקבה|אישה|נשי/i,
      male: /(^|[^fe])male|\bman\b|boy|זכר|גבר|גברי/i,
      other: /other|non-?binary|אחר|לא בינארי/i,
      'prefer-not': /prefer not|rather not|מעדיף לא|לא מעוניין|מעדיפה לא/i,
    },
    education: {
      'high-school': /high ?school|secondary|תיכון/i,
      bachelor: /bachelor|\bba\b|\bbsc\b|undergrad|תואר ראשון/i,
      master: /master|\bma\b|\bmsc\b|תואר שני/i,
      phd: /ph\.?d|doctora|דוקטור|תואר שלישי/i,
    },
    marital: {
      single: /single|unmarried|רווק/i,
      married: /married|partnered|נשוי|נשואה/i,
      divorced: /divorced|separated|גרוש/i,
    },
  };

  function fullName() {
    return [P.firstName, P.lastName].filter(Boolean).join(' ') || '';
  }

  /* ------------------------------------------------------------- label text */

  function labelFor(el) {
    var parts = [];
    if (el.id) {
      var lab = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (lab) parts.push(lab.textContent);
    }
    var wrapper = el.closest('label');
    if (wrapper) parts.push(wrapper.textContent);
    ['aria-label', 'placeholder', 'name', 'title', 'data-label'].forEach(function (a) {
      var v = el.getAttribute(a);
      if (v) parts.push(v);
    });
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      by.split(/\s+/).forEach(function (id) {
        var n = document.getElementById(id);
        if (n) parts.push(n.textContent);
      });
    }
    // Google Forms / Qualtrics: the question text lives in an ancestor block.
    var block = el.closest('[role="listitem"], .freebirdFormviewerViewItemsItemItem, .QuestionOuter, .question, fieldset, .form-group');
    if (block) {
      var heading = block.querySelector('[role="heading"], legend, .QuestionText, .freebirdFormviewerComponentsQuestionBaseTitle');
      parts.push(heading ? heading.textContent : block.textContent.slice(0, 200));
    }
    return parts.join(' ｜ ').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  function ruleFor(text) {
    if (!text) return null;
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.value !== undefined && r.value !== null && r.value !== '' && r.re.test(text)) return r;
    }
    return null;
  }

  /* ----------------------------------------------------------- value setting */

  // React/Angular ignore a plain `el.value = x`; go through the native setter.
  function setValue(el, value) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, String(value));
    else el.value = String(value);
    ['input', 'change', 'blur'].forEach(function (type) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
    mark(el);
  }

  function mark(el) {
    var target = el.nodeType === 1 ? el : el.parentElement;
    if (!target) return;
    target.style.outline = '2px solid #1d63d1';
    target.style.outlineOffset = '1px';
    filled++;
  }

  function optionMatcher(rule) {
    var table = OPTIONS[rule.options];
    var re = table && table[rule.value];
    if (re) return function (text) { return re.test(text); };
    var needle = String(rule.value).toLowerCase();
    return function (text) { return text.toLowerCase().indexOf(needle) !== -1; };
  }

  /* ------------------------------------------------------------- field kinds */

  var SKIP_TYPES = /^(hidden|submit|button|reset|file|image|password)$/i;

  function fillTextLike() {
    var nodes = document.querySelectorAll('input, textarea');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var type = (el.type || 'text').toLowerCase();
      if (SKIP_TYPES.test(type) || el.disabled || el.readOnly) continue;
      if (type === 'radio' || type === 'checkbox') continue;
      if (el.value && el.value.trim()) continue;
      if (!isVisible(el)) continue;

      var rule = ruleFor(labelFor(el));
      if (!rule) continue;
      if (type === 'number' && isNaN(Number(rule.value))) continue;
      if (type === 'email' && String(rule.value).indexOf('@') === -1) continue;
      setValue(el, rule.value);
    }
  }

  function fillSelects() {
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      if (sel.disabled || (sel.selectedIndex > 0 && sel.value) || !isVisible(sel)) continue;
      var rule = ruleFor(labelFor(sel));
      if (!rule) continue;
      var matches = optionMatcher(rule);
      for (var j = 0; j < sel.options.length; j++) {
        var opt = sel.options[j];
        if (!opt.value) continue;
        if (matches(opt.textContent + ' ' + opt.value)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          mark(sel);
          break;
        }
      }
    }
  }

  function fillRadios() {
    var groups = {};
    var radios = document.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < radios.length; i++) {
      var el = radios[i];
      if (el.disabled || !isVisible(el)) continue;
      var name = el.name || labelFor(el.closest('fieldset') || el);
      (groups[name] = groups[name] || []).push(el);
    }
    Object.keys(groups).forEach(function (name) {
      var group = groups[name];
      if (group.some(function (r) { return r.checked; })) return;
      var context = group.map(labelFor).join(' ');
      var rule = ruleFor(context);
      if (!rule || !rule.options) return;
      var matches = optionMatcher(rule);
      for (var i = 0; i < group.length; i++) {
        var text = labelOfChoice(group[i]);
        if (matches(text)) {
          group[i].click();
          mark(group[i].closest('label') || group[i]);
          return;
        }
      }
    });
  }

  // Google Forms renders radios as divs; they carry the answer in data-value.
  function fillAriaRadios() {
    var groups = document.querySelectorAll('[role="radiogroup"]');
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      var radios = group.querySelectorAll('[role="radio"]');
      if (!radios.length) continue;
      var already = false;
      for (var k = 0; k < radios.length; k++) {
        if (radios[k].getAttribute('aria-checked') === 'true') already = true;
      }
      if (already) continue;

      var rule = ruleFor(labelFor(group));
      if (!rule || !rule.options) continue;
      var matches = optionMatcher(rule);
      for (var j = 0; j < radios.length; j++) {
        var text = radios[j].getAttribute('data-value') || radios[j].getAttribute('aria-label') || radios[j].textContent;
        if (matches(text || '')) {
          radios[j].click();
          mark(radios[j]);
          break;
        }
      }
    }
  }

  function labelOfChoice(el) {
    var wrapper = el.closest('label');
    return [
      el.value,
      el.getAttribute('aria-label'),
      wrapper ? wrapper.textContent : '',
      el.id ? (document.querySelector('label[for="' + cssEscape(el.id) + '"]') || {}).textContent : '',
    ].filter(Boolean).join(' ');
  }

  function isVisible(el) {
    return !!(el.offsetParent || el.getClientRects().length);
  }

  /* -------------------------------------------------------------------- run */

  try {
    fillTextLike();
    fillSelects();
    fillRadios();
    fillAriaRadios();
  } catch (err) {
    /* keep whatever was filled before the failure */
    console.error('[survey-scanner] autofill error', err);
  }

  ssAutofillToast(filled);
  return filled;
}

function ssAutofillToast(count) {
  var id = 'ss-autofill-toast';
  var old = document.getElementById(id);
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = id;
  box.textContent = count
    ? 'סורק הסקרים: מולאו ' + count + ' שדות. בדקו לפני שליחה.'
    : 'סורק הסקרים: לא זוהו שדות מוכרים בעמוד הזה.';
  box.setAttribute('style', [
    'position:fixed', 'z-index:2147483647', 'bottom:16px', 'left:50%',
    'transform:translateX(-50%)', 'background:#12161c', 'color:#fff',
    'padding:10px 16px', 'border-radius:10px', 'font:14px/1.4 system-ui,sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.35)', 'direction:rtl', 'max-width:90vw',
  ].join(';'));
  document.body.appendChild(box);
  setTimeout(function () { box.remove(); }, 6000);
}
