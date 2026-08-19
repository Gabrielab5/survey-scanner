import crypto from 'node:crypto';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#32': ' ', '#39': "'", '#x27': "'",
};

export function decodeEntities(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function stripTags(html = '') {
  return collapse(
    decodeEntities(
      html
        .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

export const collapse = (s = '') => s.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export const truncate = (s = '', n = 320) =>
  s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';

export const hasHebrew = (s = '') => /[֐-׿]/.test(s);

/* ---------------------------------------------------------------- relevance */

const ISRAEL_RE =
  /(israel|israeli|jerusalem|tel[\s-]?aviv|haifa|be(?:'|e)?r[\s-]?sheva|netanya|rishon|herzliya|ramat[\s-]?gan|hebrew university|technion|weizmann|ben[\s-]?gurion|bar[\s-]?ilan|reichman|idc herzliya|\.co\.il|\.ac\.il|\.org\.il|₪|\bnis\b|\bils\b|shekel|shequel)/i;

const HE_ISRAEL_RE =
  /(ישראל|ירושלים|תל אביב|חיפה|באר שבע|נתניה|ראשון לציון|הרצליה|רמת גן|רעננה|פתח תקווה|אשדוד|באוניברסיטה|העברית|הטכניון|בן גוריון|בר אילן|רייכמן|ויצמן|תל-אביב)/;

export function isIsraelRelevant(text = '') {
  return ISRAEL_RE.test(text) || HE_ISRAEL_RE.test(text) || hasHebrew(text);
}

const SURVEY_RE =
  /(survey|questionnaire|study|studies|experiment|research|participants?|respondents?|focus group|interview|trial|סקר|שאלון|מחקר|ניסוי|משתתפ|נבדק|קבוצת מיקוד|ראיון|מרואיינ)/i;

export const isSurveyish = (text = '') => SURVEY_RE.test(text);

const RAFFLE_RE = /(raffle|lottery|prize draw|sweepstake|chance to win|הגרלה|הגרלת|סיכוי לזכות)/i;

/**
 * Deliberately strict: the text has to name money or a payment. Softer words
 * ("reward", "earn", "bonus") appear in far too many unpaid posts to be trusted,
 * so they are not part of the gate.
 */
const PAID_STRONG_RE =
  /(₪|\bnis\b|\bils\b|shekels?|\$\s?\d|€\s?\d|£\s?\d|\d\s?(?:usd|gbp|eur)\b|\bpaid\b|\bpays?\b|payment|compensat|reimburs|stipend|honorarium|remunerat|gift ?card|gift ?voucher|amazon (?:card|voucher)|cash\b|בתשלום|תשלום|שכר|גמול|תגמול|החזר הוצאות|שובר|שוברים|כרטיס מתנה|מזומן|מלגה|תמורה כספית|ש"?ח(?![א-ת])|שקלים|שקל(?![א-ת])|משלמ|ישולם|נשלם|לשלם|בתמורה)/i;

const UNPAID_RE =
  /(ללא תשלום|לא בתשלום|אין תשלום|unpaid|no payment|not paid|without (?:payment|compensation))/i;

export function isPaid(text = '') {
  if (!PAID_STRONG_RE.test(text)) return false;
  // "unpaid volunteers" trips every payment keyword there is - only a concrete
  // amount overrides an explicit no-payment statement.
  if (UNPAID_RE.test(text) && !/[₪$€£]|\d\s?(?:nis|ils|ש"?ח|שקל)/i.test(text)) return false;
  return true;
}

/* ------------------------------------------------------------------ rewards */

const AMOUNT_PATTERNS = [
  { re: /₪\s?(\d[\d,.]*)(?:\s?[-–]\s?(\d[\d,.]*))?/i, cur: 'ILS' },
  { re: /(\d[\d,.]*)(?:\s?[-–]\s?(\d[\d,.]*))?\s?(?:₪|ש"?ח|שקלים|שקל|\bnis\b|\bils\b)/i, cur: 'ILS' },
  { re: /\$\s?(\d[\d,.]*)(?:\s?[-–]\s?(\d[\d,.]*))?/, cur: 'USD' },
  { re: /£\s?(\d[\d,.]*)(?:\s?[-–]\s?(\d[\d,.]*))?/, cur: 'GBP' },
  { re: /€\s?(\d[\d,.]*)(?:\s?[-–]\s?(\d[\d,.]*))?/, cur: 'EUR' },
];

/** Extract a structured reward from free text. */
export function parseReward(text = '') {
  const flat = text.replace(/\s+/g, ' ');
  for (const { re, cur } of AMOUNT_PATTERNS) {
    const m = flat.match(re);
    if (!m) continue;
    const lo = num(m[1]);
    const hi = m[2] ? num(m[2]) : null;
    if (lo === null || lo === 0 || lo > 100000) continue;
    return {
      type: RAFFLE_RE.test(flat) ? 'raffle' : 'cash',
      currency: cur,
      amount: lo,
      amountMax: hi,
      raw: collapse(m[0]),
    };
  }
  if (/(gift ?card|voucher|amazon card|שובר|שוברים|כרטיס מתנה)/i.test(flat))
    return { type: 'voucher', currency: null, amount: null, amountMax: null, raw: 'שובר / כרטיס מתנה' };
  if (RAFFLE_RE.test(flat))
    return { type: 'raffle', currency: null, amount: null, amountMax: null, raw: 'הגרלה (לא תשלום מובטח)' };
  if (PAID_STRONG_RE.test(flat))
    return { type: 'unspecified', currency: null, amount: null, amountMax: null, raw: 'תשלום (סכום לא צוין)' };
  return null;
}

const num = (s) => {
  const v = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

/* -------------------------------------------------------------- form typing */

const FORM_HOSTS = [
  [/docs\.google\.com\/forms|forms\.gle/i, 'google-forms'],
  [/qualtrics\.com|\.qualtrics\./i, 'qualtrics'],
  [/surveymonkey\./i, 'surveymonkey'],
  [/typeform\.com/i, 'typeform'],
  [/limesurvey|\/limesurvey\//i, 'limesurvey'],
  [/redcap/i, 'redcap'],
  [/soscisurvey\.de/i, 'soscisurvey'],
  [/jotform\./i, 'jotform'],
  [/microsoft\.com\/.*forms|forms\.office\.com/i, 'ms-forms'],
  [/gorilla\.sc/i, 'gorilla'],
  [/pavlovia\.org/i, 'pavlovia'],
  [/surveyjs|\.survey\./i, 'other'],
];

/** Detect the survey platform so the UI can promise auto-fill only where it works. */
export function detectFormType(url = '') {
  for (const [re, type] of FORM_HOSTS) if (re.test(url)) return type;
  return 'other';
}

const AUTOFILLABLE = new Set([
  'google-forms', 'qualtrics', 'surveymonkey', 'limesurvey', 'soscisurvey', 'jotform', 'ms-forms', 'redcap',
]);

export const canAutofill = (formType) => AUTOFILLABLE.has(formType);

/* --------------------------------------------------------------------- misc */

export const idFor = (...parts) =>
  crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

/** Pull absolute http(s) links out of an HTML fragment. */
export function extractLinks(html = '', base = '') {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    try {
      href = new URL(href, base || undefined).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href)) continue;
    out.push({ href, text: stripTags(m[2]) });
  }
  return out;
}
