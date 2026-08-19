# סורק הסקרים · survey-scanner

אתר סטטי שמרכז **סקרים, ניסויים ומחקרים בישראל שמשלמים למשתתפים** — עם קישור ישיר לכל
סקר, עדכון אוטומטי כל שעה, וכלי למילוי אוטומטי של שאלונים.

> A static site aggregating paid studies/surveys in Israel. Refreshes hourly via GitHub
> Actions, links straight to each survey, and ships a browser auto-fill tool for the
> demographic questions every survey starts with.

## מה יש כאן

| רכיב | תיאור |
| --- | --- |
| `docs/` | האתר עצמו (HTML/CSS/JS בלבד, בלי תלויות) — זה מה ש-GitHub Pages מגיש |
| `docs/data/studies.json` | מאגר הנתונים שנוצר אוטומטית בכל שעה |
| `scripts/update.mjs` | האוסף: פונה לכל המקורות, ממזג עם הנתונים הקודמים וכותב את ה-JSON |
| `scripts/lib/` | לקוח HTTP עם throttling, מנתחי טקסט/תשלום, חילוץ תנאי השתתפות, ומתאמים לכל סוג מקור |
| `sources/sources.json` | רשימת המקורות — פאנלים קבועים + פידים שנסרקים |
| `sources/manual.json` | רשומות שמוסיפים ביד; מופיעות באתר תוך שעה |
| `.github/workflows/update.yml` | ה-cron השעתי |

## הפעלה מקומית

```bash
node scripts/update.mjs          # מרענן את docs/data/studies.json
npx http-server docs -p 8080     # מריץ את האתר
```

אין `npm install` ואין תלויות — הכול רץ על Node 22 סטנדרטי.

## הפעלת האתר (GitHub Pages)

1. **Settings → Pages → Source: Deploy from a branch**
2. בוחרים את הענף בתפריט הראשון. **רק אחרי בחירת ענף** מופיע לידו תפריט שני
   (ברירת מחדל `/ (root)`) — שם בוחרים **`/docs`** ולוחצים **Save**.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**
   (כדי שה-workflow יוכל לדחוף את קובץ הנתונים המעודכן).

> ⚠️ GitHub מריץ `schedule` **רק מענף ברירת המחדל**. בריפו הזה ענף ברירת המחדל הוא
> `claude/israeli-studies-aggregator-crztzn`, ולכן העדכון השעתי רץ ממנו כמו שהוא.
> אם משנים ברירת מחדל — לוודא שהקוד נמצא שם. הרצה ידנית תמיד זמינה דרך
> **Actions → Update studies → Run workflow**.

## המקורות

| מקור | סוג | מה מגיע ממנו |
| --- | --- | --- |
| רשימת פאנלים | `registry` | פאנלים ומאגרי נבדקים ישראליים שתמיד פתוחים להרשמה (מדגם, iPanel, Prolific, מאגרי Sona של האוניברסיטאות ועוד) |
| ClinicalTrials.gov | `clinicaltrials` | ניסויים קליניים שמגייסים בישראל — כולל מסלול "מתנדבים בריאים" |
| Reddit (RSS) | `reddit` | פוסטים מ-r/SampleSize, r/Israel, r/TelAviv, r/AcademicPsychology שמזכירים תשלום |
| רשומות ידניות | `manual` | כל מה שמוסיפים ל-`sources/manual.json` |
| עמודי גיוס | `html` | מתאם גנרי לסריקת עמוד גיוס משתתפים (ראו תבנית מושבתת ב-`sources.json`) |

### הוספת מקור

עורכים את `sources/sources.json`. מקור מסוג `html` הוא גנרי — הוא מחפש בעמוד בלוקים
שנראים כמו קריאה להשתתפות בתשלום ומוציא מהם קישור, כותרת וסכום:

```json
{
  "id": "my-lab",
  "type": "html",
  "label": "המעבדה שלי",
  "url": "https://example.ac.il/participants",
  "requireIsrael": true,
  "requirePaid": true
}
```

הסריקה מכוונת בכוונה לפי טקסט ולא לפי selectors, כדי שרענון עיצוב באתר המקור ייתן
"לא נמצא כלום" במקום זבל.

### הוספת מחקר בודד ביד

מוסיפים ל-`items` בקובץ `sources/manual.json`:

```json
{
  "title": "ניסוי קבלת החלטות – מעבדה, תל אביב",
  "url": "https://example.org/signup",
  "summary": "מפגש של 45 דקות. תשלום במזומן בסוף המפגש.",
  "reward": "60 ₪",
  "kind": "study",
  "mode": "in-person",
  "location": "תל אביב",
  "expiresAt": "2026-09-30"
}
```

הרשומה תיעלם מעצמה אחרי `expiresAt`.

## היקף: ישראל מול "פתוח לכולם"

פיד עם `"allowGlobal": true` (כרגע r/SampleSize ו-r/AcademicPsychology) שומר גם מחקרים
בתשלום שאינם ישראליים אבל **פתוחים לכל העולם** — אפשר לענות עליהם מישראל ולקבל תשלום.
הם מקבלים `scope: "global"` ותגית "פתוח בכל העולם", ואפשר להסתיר אותם בצ׳יפ
"בישראל בלבד". מחקר שנעול למדינה אחרת ("US only", "UK residents") נזרק בשלב האיסוף.

## בדיקת התאמה (`scripts/lib/eligibility.mjs`)

מכל רשומה מחולצים תנאי ההשתתפות שפורסמו:

| שדה | דוגמאות שנתפסות |
| --- | --- |
| `requires: students` | "students only", "מיועד לסטודנטים" |
| `requires: partner` | "couples study", "both partners", "זוגות", "בני זוג" |
| `requires: children` | "mothers of", "parents of", "הורים ל…", "בעלי ילדים" |
| `requires: married` | "married couples", "נשואים" |
| `requires: pregnant` | "pregnant", "postpartum", "בהריון", "לאחר לידה" |
| `requires: patients` | "patients with", "diagnosed with", "מאובחנים" |
| `gender` | "women only", "נשים בלבד" |
| `ageMin` / `ageMax` | "aged 18-35", "25+", "גילאי 20–30" |
| `countryOnly` | "US only", "UK residents", "תושבי ישראל" |

ב-ClinicalTrials.gov התנאים נלקחים מהשדות המובנים (`Sex`, `MinimumAge`, `MaximumAge`,
`HealthyVolunteers`) ולא מניחוש טקסטואלי.

הפרופיל בדפדפן (גיל, מגדר, סטודנט/ית, בן/בת זוג, ילדים, מצב משפחתי) מוצלב מול התנאים
האלה, וכל כרטיס מסומן:

* **מתאים לך** — היו תנאים, ואתם עומדים בכולם.
* **לא מתאים** — יש תנאי שאתם לא עומדים בו (מוצג איזה). הצ׳יפ "מתאים לי" מסתיר אותם.
* **לבדוק** — יש תנאי שאין עליו תשובה בפרופיל (למשל אבחנה רפואית).
* בלי סימון — לא פורסמו תנאים.

שתי הסתייגויות חשובות: התנאים נקראים מהטקסט שהחוקר פרסם, ולכן תנאי שלא נכתב לא ייתפס;
וגיל של ילדים ("mothers of toddlers aged 2-5") לא נחשב כגיל המשתתף.

## איך נקבע "יש כאן תשלום"

* זיהוי התשלום דורש אזכור מפורש של כסף (`₪`, `NIS`, `$`, "תשלום", "גמול", "שובר"…).
  מילים רכות כמו *reward* או *earn* לא נחשבות — הן מופיעות ביותר מדי פוסטים לא רלוונטיים.
* "ללא תשלום" מבטל זיהוי, אלא אם מופיע סכום קונקרטי.
* **הגרלה אינה תשלום** ומסומנת בנפרד.
* `paymentConfirmed` נכון רק כשהטקסט נוקב בסכום/שובר. ניסויים קליניים כמעט אף פעם
  לא מפרסמים תנאי תשלום, ולכן הם מסומנים "לברר מול המרכז הרפואי" ולא כתשלום מאושר.

## עמידות

* מקור שנופל לא מפיל את הריצה — הוא מסומן באתר בסטטוס `error`.
* פניות מווסתות פר-דומיין (2.5 שניות בין בקשות) עם backoff על 429/5xx.
* רשומה שנעלמה מהמקור נשמרת עוד 48 שעות ומסומנת "ייתכן שנסגר", כך שתקלה זמנית
  לא מרוקנת את האתר.

## מילוי אוטומטי

`docs/autofill-core.js` הוא מנוע המילוי. האתר מושך את קוד המקור שלו ומרכיב ממנו,
יחד עם הפרופיל השמור, שני כלים:

* **סימנייה (bookmarklet)** — גוררים לשורת הסימניות ולוחצים בתוך כל שאלון.
* **סקריפט ל-Tampermonkey** — מוריד קובץ `.user.js` שרץ אוטומטית ב-Google Forms,
  Qualtrics, SurveyMonkey, Jotform, MS Forms, LimeSurvey ו-SoSci.

המנוע מזהה שדות לפי טקסט התווית (עברית ואנגלית): שם, אימייל, טלפון, גיל, שנת לידה,
מגדר, עיר, מדינה, שפת אם, השכלה, עיסוק, מצב משפחתי ומזהה Prolific. (שדות ההתאמה —
סטודנט/ית, בן/בת זוג, ילדים — משמשים לבדיקת ההתאמה ולא למילוי אוטומטי.) הוא ממלא `input`,
`textarea`, `select`, כפתורי רדיו רגילים, וגם את הרדיו־מבוססי־`role` של Google Forms
(דרך native setter + אירועי `input/change`, כדי שטפסים מבוססי React יקלטו את הערך).

**מה הוא לא עושה:** הוא לא שולח טפסים, לא עונה על שאלות התוכן של המחקר, ולא נוגע
בשדות שכבר מולאו. הפרופיל נשמר ב-`localStorage` בלבד ולא נשלח לשום שרת.

## הסתייגויות

הרשימה נאספת אוטומטית ממקורות פומביים ואינה מאומתת אחת-אחת. תמיד לאמת תנאי תשלום
מול מפרסם המחקר. מחקר לגיטימי לא מבקש פרטי אשראי או תשלום מראש.
