/**
 * Pulls "who is this study for?" out of a listing's free text.
 *
 * The output is deliberately conservative: a requirement is only recorded when
 * the text states it, because the UI turns these into a "you can/cannot take
 * this" verdict and a false requirement hides a study the user could have done.
 */

const RULES = [
  { key: 'students',  re: /(students?\s+only|only\s+students|must\s+be\s+(?:a\s+)?student|university\s+students?\s+(?:only|needed|wanted|required)|college\s+students?\s+(?:only|needed|wanted)|undergraduates?\s+(?:only|needed)|psychology\s+students?|students?\s+(?:wanted|needed|sought|required)|סטודנטים?\s*(?:\/ות)?\s*בלבד|רק\s+סטודנטים|מיועד\s+לסטודנטים|לסטודנטים\s+בלבד|סטודנטיות\s+בלבד)/i,
    label: 'סטודנטים בלבד' },
  { key: 'partner',   re: /(couples?\s+(?:study|survey|research|only|needed|wanted)|romantic\s+couples?|both\s+partners|with\s+your\s+partner|dyadic\s+study|\bdyads?\b|זוגות|בני\s+זוג|עם\s+בן\/?\s*בת\s+הזוג|מחקר\s+זוגי)/i,
    label: 'זוגות' },
  { key: 'children',  re: /(parents?\s+(?:of|only|needed|wanted|with)|mothers?\s+of|fathers?\s+of|caregivers?\s+of|with\s+(?:young\s+)?children|have\s+(?:a\s+)?child(?:ren)?|toddlers?|הורים\s+ל|אמהות\s+ל|אבות\s+ל|בעלי\s+ילדים|עם\s+ילדים|הורים\s+בלבד)/i,
    label: 'הורים לילדים' },
  { key: 'married',   re: /(married\s+(?:couples?|women|men|people|participants|only)|must\s+be\s+married|נשואים|נשואות|נשוי\/אה|זוגות\s+נשואים)/i,
    label: 'נשואים' },
  { key: 'pregnant',  re: /(pregnan(?:t|cy)|expecting\s+mothers?|postpartum|בהריון|הריון|לאחר\s+לידה)/i,
    label: 'הריון / לאחר לידה' },
  { key: 'patients',  re: /(patients?\s+with|diagnosed\s+with|suffering\s+from|people\s+with\s+(?:a\s+)?(?:diagnosis|disorder|disease|condition)|חולי\s|מאובחנים|מאובחנות|הסובלים\s+מ)/i,
    label: 'אבחנה רפואית' },
  { key: 'smoker',    re: /(smokers?\s+(?:only|needed|wanted)|current\s+smokers?|מעשנים\s+בלבד|מעשנים\s+פעילים)/i,
    label: 'מעשנים' },
  { key: 'driver',    re: /(licensed\s+drivers?|drivers?\s+(?:only|needed)|בעלי\s+רישיון\s+נהיגה|נהגים\s+בלבד)/i,
    label: 'בעלי רישיון נהיגה' },
  { key: 'employed',  re: /(full-?time\s+employees?|currently\s+employed|working\s+adults?\s+only|עובדים\s+במשרה\s+מלאה|שכירים\s+בלבד)/i,
    label: 'מועסקים' },
];

const GENDER_RULES = [
  { value: 'female', re: /(wom[ae]n\s+only|only\s+wom[ae]n|females?\s+only|female\s+participants\s+(?:only|needed|wanted)|נשים\s+בלבד|לנשים\s+בלבד|רק\s+נשים)/i, label: 'נשים בלבד' },
  { value: 'male',   re: /(men\s+only|only\s+men|males?\s+only|male\s+participants\s+(?:only|needed|wanted)|גברים\s+בלבד|לגברים\s+בלבד|רק\s+גברים)/i, label: 'גברים בלבד' },
];

// Only the countries that actually show up as gates on survey posts.
const COUNTRIES = [
  { code: 'IL', re: /(israel(?:i)?\s+(?:residents?|citizens?|participants?|only)|living\s+in\s+israel|based\s+in\s+israel|תושבי\s+ישראל|בישראל\s+בלבד)/i, label: 'תושבי ישראל' },
  { code: 'US', re: /(\b(?:us|usa|u\.s\.a?\.?)\s*[-–]?\s*(?:only|based|residents?|citizens?|participants?)|american\s+(?:residents?|participants?|citizens?)\s*(?:only)?|living\s+in\s+the\s+(?:us|usa|united\s+states)|\[us\]|\(us\s+only\))/i, label: 'ארה״ב בלבד' },
  { code: 'GB', re: /(\buk\s*[-–]?\s*(?:only|based|residents?|participants?)|british\s+residents?|living\s+in\s+the\s+uk|\[uk\]|\(uk\s+only\))/i, label: 'בריטניה בלבד' },
  { code: 'CA', re: /(canad(?:a|ian)\s+(?:only|residents?|participants?)|living\s+in\s+canada)/i, label: 'קנדה בלבד' },
  { code: 'AU', re: /(australian?\s+(?:only|residents?|participants?)|living\s+in\s+australia)/i, label: 'אוסטרליה בלבד' },
  { code: 'DE', re: /(german(?:y|s)?\s+(?:only|residents?|participants?)|living\s+in\s+germany)/i, label: 'גרמניה בלבד' },
  { code: 'IN', re: /(indian?\s+(?:only|residents?|participants?)\b|living\s+in\s+india)/i, label: 'הודו בלבד' },
];

const AGE_PATTERNS = [
  { re: /\bages?\s*:?\s*(\d{1,2})\s*(?:-|–|to|until)\s*(\d{1,2})/i, min: 1, max: 2 },
  { re: /\baged?\s+(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/i, min: 1, max: 2 },
  { re: /\b(\d{1,2})\s*(?:-|–)\s*(\d{1,2})\s*(?:years?\s*old|y\/?o\b|year-olds)/i, min: 1, max: 2 },
  { re: /גילאי\s*(\d{1,2})\s*(?:-|–|עד)\s*(\d{1,2})/, min: 1, max: 2 },
  { re: /בני\s*(\d{1,2})\s*(?:-|–|עד)\s*(\d{1,2})/, min: 1, max: 2 },
  { re: /\b(?:over|above|older\s+than|at\s+least)\s+(\d{1,2})\s*(?:years?\s*old|y\/?o)?\b/i, min: 1 },
  { re: /\b(\d{1,2})\s*(?:\+|and\s+over|and\s+older|or\s+older)\b/i, min: 1 },
  { re: /(?:מגיל|בני)\s*(\d{1,2})\s*(?:ומעלה|ומעלה\.)/, min: 1 },
  { re: /\b(?:under|younger\s+than|up\s+to)\s+(\d{1,2})\s*(?:years?\s*old)?\b/i, max: 1 },
];

/** @returns {{gender:?string, ageMin:?number, ageMax:?number, requires:string[], countryOnly:?string, notes:string[]}} */
export function extractEligibility(text = '') {
  const flat = String(text).replace(/\s+/g, ' ');
  const requires = [];
  const notes = [];

  for (const rule of RULES) {
    if (rule.re.test(flat)) {
      requires.push(rule.key);
      notes.push(rule.label);
    }
  }

  let gender = null;
  for (const rule of GENDER_RULES) {
    if (rule.re.test(flat)) {
      gender = rule.value;
      notes.push(rule.label);
      break;
    }
  }

  let countryOnly = null;
  for (const c of COUNTRIES) {
    if (c.re.test(flat)) {
      countryOnly = c.code;
      notes.push(c.label);
      break;
    }
  }

  const age = extractAge(flat);
  // "mothers of toddlers aged 2-5" is the child's age, not the participant's -
  // no paid study recruits participants under 16, so treat those as noise.
  if (age.ageMax !== null && age.ageMax < 16) {
    age.ageMin = null;
    age.ageMax = null;
  }
  if (age.ageMin || age.ageMax) {
    notes.push(
      age.ageMin && age.ageMax ? `גיל ${age.ageMin}–${age.ageMax}`
        : age.ageMin ? `גיל ${age.ageMin}+`
        : `עד גיל ${age.ageMax}`
    );
  }

  return { gender, ageMin: age.ageMin, ageMax: age.ageMax, requires, countryOnly, notes };
}

function extractAge(flat) {
  for (const p of AGE_PATTERNS) {
    const m = flat.match(p.re);
    if (!m) continue;
    const min = p.min ? toAge(m[p.min]) : null;
    const max = p.max ? toAge(m[p.max]) : null;
    if (min === null && max === null) continue;
    if (min !== null && max !== null && min > max) continue;
    return { ageMin: min, ageMax: max };
  }
  return { ageMin: null, ageMax: null };
}

function toAge(s) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 5 && n <= 99 ? n : null;
}

/** True when the listing gates on a country other than Israel. */
export const excludesIsrael = (eligibility) =>
  !!eligibility.countryOnly && eligibility.countryOnly !== 'IL';
