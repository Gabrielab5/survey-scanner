import { readFile } from 'node:fs/promises';
import { fetchText, fetchJson } from './http.mjs';
import { excludesIsrael, extractEligibility } from './eligibility.mjs';
import {
  collapse, decodeEntities, detectFormType, extractLinks, hasHebrew, idFor, isIsraelRelevant,
  isPaid, isSurveyish, parseReward, stripTags, truncate, canAutofill,
} from './text.mjs';

const nowIso = () => new Date().toISOString();

function makeItem({ title, summary, url, source, sourceLabel, kind, mode, text, postedAt, location, tags = [], scope = 'israel' }) {
  const blob = `${title}\n${summary || ''}\n${text || ''}`;
  const formType = detectFormType(url);
  const reward = parseReward(blob);
  return {
    id: idFor(source, url, title),
    title: collapse(title).slice(0, 220),
    summary: truncate(collapse(summary || ''), 400),
    url,
    source,
    sourceLabel,
    kind,
    mode: mode || (/(online|remote|מקוון|אונליין|מהבית|zoom)/i.test(blob) ? 'online' : 'unknown'),
    language: hasHebrew(blob) ? 'he' : 'en',
    reward,
    // true only when the listing names actual money/vouchers, not just the word
    // "payment" - the UI uses this to separate confirmed pay from "maybe".
    paymentConfirmed: !!reward && ['cash', 'voucher'].includes(reward.type),
    location: location || null,
    // 'israel' = tied to Israel; 'global' = open worldwide, so takeable from Israel.
    scope,
    eligibility: extractEligibility(blob),
    formType,
    autofill: canAutofill(formType),
    postedAt: postedAt || nowIso(),
    tags,
  };
}

/* ------------------------------------------------------------------- reddit */

/** Reddit's Atom feed is the only endpoint that answers reliably from CI IPs. */
export async function redditAdapter(feed) {
  const xml = await fetchText(feed.url, { headers: { 'accept-language': 'en' } });
  if (!xml) return [];
  const items = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = decodeEntities(tag(entry, 'title') || '');
    const link = (entry.match(/<link[^>]+href="([^"]+)"/) || [])[1];
    const published = tag(entry, 'published') || tag(entry, 'updated');
    const contentHtml = decodeEntities(tag(entry, 'content') || '');
    const body = stripReddit(stripTags(contentHtml));
    if (!title || !link) continue;

    const blob = `${title}\n${body}`;
    if (feed.requirePaid !== false && !isPaid(blob)) continue;
    if (!isSurveyish(blob)) continue;
    if (feed.requireSurvey && !isSurveyish(blob)) continue;
    var scope = 'israel';
    if (feed.requireIsrael && !isIsraelRelevant(blob)) {
      // Not about Israel - keep it only if the feed opts in and nothing gates it
      // to another country, since an open online study pays from anywhere.
      if (!feed.allowGlobal) continue;
      if (excludesIsrael(extractEligibility(blob))) continue;
      scope = 'global';
    }

    // Prefer the actual survey link from the post body over the reddit permalink.
    const external = extractLinks(contentHtml, link).find(
      (l) => !/reddit\.com|redd\.it|redditstatic/i.test(l.href)
    );
    const target = external ? external.href : link;

    items.push(
      makeItem({
        title,
        summary: body,
        url: target,
        source: feed.id,
        sourceLabel: feed.label,
        kind: 'survey',
        text: body,
        postedAt: published || undefined,
        scope,
        tags: [scope === 'global' ? 'פתוח בכל העולם' : null, external ? 'קישור ישיר לשאלון' : 'פוסט ב-Reddit']
          .filter(Boolean),
      })
    );
  }
  return items;
}

/** Drop reddit's "submitted by /u/x [link] [comments]" footer. */
const stripReddit = (s) =>
  collapse(s.replace(/submitted by\s*\/u\/\S+[\s\S]*$/i, '').replace(/\[link\]|\[comments\]/gi, ''));

const tag = (s, name) => {
  const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
};

/* ---------------------------------------------------------- clinicaltrials */

const CT_FIELDS = [
  'NCTId', 'BriefTitle', 'BriefSummary', 'OverallStatus', 'StudyType', 'LocationCity',
  'LocationCountry', 'LocationFacility', 'LastUpdatePostDate', 'HealthyVolunteers', 'Phase',
  'Sex', 'MinimumAge', 'MaximumAge', 'EligibilityCriteria',
].join(',');

export async function clinicalTrialsAdapter(feed) {
  const params = new URLSearchParams({
    'query.locn': 'Israel',
    'filter.overallStatus': 'RECRUITING',
    pageSize: String(feed.pageSize || 50),
    fields: CT_FIELDS,
    sort: 'LastUpdatePostDate:desc',
  });
  if (feed.query) params.set('query.term', feed.query);
  if (feed.healthyOnly) params.set('filter.advanced', 'AREA[HealthyVolunteers]true');

  const data = await fetchJson(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  if (!data || !Array.isArray(data.studies)) return [];

  const items = [];
  for (const study of data.studies) {
    const p = study.protocolSection || {};
    const nctId = p.identificationModule?.nctId;
    const title = p.identificationModule?.briefTitle;
    if (!nctId || !title) continue;

    const locations = (p.contactsLocationsModule?.locations || []).filter(
      (l) => l.country === 'Israel'
    );
    if (!locations.length) continue;

    const summary = p.descriptionModule?.briefSummary || '';
    const cities = [...new Set(locations.map((l) => l.city).filter(Boolean))];
    const facilities = [...new Set(locations.map((l) => l.facility).filter(Boolean))];

    const item = makeItem({
        title,
        summary,
        url: `https://clinicaltrials.gov/study/${nctId}`,
        source: feed.id,
        sourceLabel: feed.label,
        kind: 'clinical',
        mode: 'in-person',
        // Registry records almost never state payment terms, so nothing is
        // claimed here beyond what the trial's own text says.
        text: summary,
        postedAt: isoDate(p.statusModule?.lastUpdatePostDateStruct?.date),
        location: cities.join(', ') || 'ישראל',
        tags: [
          ...(feed.healthyOnly ? ['מתנדבים בריאים'] : []),
          'תשלום/החזר הוצאות – לברר מול המרכז הרפואי',
          ...facilities.slice(0, 2),
          nctId,
        ],
    });
    items.push({ ...item, eligibility: trialEligibility(p, item.eligibility) });
  }
  return items;
}

const isoDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : undefined);

/** ClinicalTrials.gov states sex/age/healthy-volunteer status as real fields. */
function trialEligibility(protocolSection, fromText) {
  const e = protocolSection.eligibilityModule || {};
  const parsed = extractEligibility(e.eligibilityCriteria || '');
  const requires = [...new Set([...fromText.requires, ...parsed.requires])];
  if (e.healthyVolunteers === false && !requires.includes('patients')) requires.push('patients');

  return {
    ...fromText,
    gender: e.sex === 'FEMALE' ? 'female' : e.sex === 'MALE' ? 'male' : fromText.gender,
    ageMin: years(e.minimumAge) ?? fromText.ageMin,
    ageMax: years(e.maximumAge) ?? fromText.ageMax,
    requires,
    notes: [...new Set([
      ...fromText.notes,
      ...(e.sex === 'FEMALE' ? ['נשים בלבד'] : e.sex === 'MALE' ? ['גברים בלבד'] : []),
      ...(requires.includes('patients') ? ['אבחנה רפואית'] : []),
      ...ageNote(years(e.minimumAge), years(e.maximumAge)),
    ])],
  };
}

const years = (s) => {
  const m = /^(\d{1,3})\s*Year/i.exec(String(s || ''));
  return m ? parseInt(m[1], 10) : null;
};

const ageNote = (min, max) =>
  min && max ? [`גיל ${min}–${max}`] : min ? [`גיל ${min}+`] : max ? [`עד גיל ${max}`] : [];

/* --------------------------------------------------------------- html pages */

/**
 * Generic HTML adapter: split a page into blocks, keep the ones that both link
 * somewhere and read like a paid study. Deliberately selector-free so a site
 * redesign degrades to "found nothing" instead of scraping garbage.
 */
export async function htmlAdapter(feed) {
  const html = await fetchText(feed.url);
  if (!html) return [];

  const blocks = html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/(?:li|article|tr|section|div|p)>/i);

  const seen = new Set();
  const items = [];
  for (const block of blocks) {
    const text = stripTags(block);
    if (text.length < 25 || text.length > 1200) continue;
    if (!isSurveyish(text)) continue;
    if (feed.requirePaid !== false && !isPaid(text)) continue;
    if (feed.requireIsrael && !isIsraelRelevant(text)) continue;

    const link = extractLinks(block, feed.url)[0];
    if (!link || seen.has(link.href)) continue;
    seen.add(link.href);

    const title = link.text && link.text.length > 8 ? link.text : text.split('\n')[0];
    items.push(
      makeItem({
        title,
        summary: text,
        url: link.href,
        source: feed.id,
        sourceLabel: feed.label,
        kind: 'survey',
        text,
        tags: ['נסרק מהאתר'],
      })
    );
    if (items.length >= 40) break;
  }
  return items;
}

/* -------------------------------------------------------------------- panels */

export function panelItems(panels) {
  return panels.map((p) =>
    makeItem({
      title: p.title,
      summary: p.summary,
      url: p.url,
      source: 'registry',
      sourceLabel: 'רשימת פאנלים קבועים',
      kind: p.kind || 'panel',
      mode: p.mode,
      text: `${p.summary} ${p.reward || ''}`,
      tags: p.tags || [],
    })
  ).map((item, i) => ({
    ...item,
    id: `panel-${panels[i].id}`,
    evergreen: true,
    titleEn: panels[i].titleEn || null,
    rewardNote: panels[i].reward || null,
    // Panels are landing pages, not a single form — never promise auto-fill.
    autofill: false,
    formType: 'portal',
    scope: panels[i].scope || 'israel',
  }));
}


/* -------------------------------------------------------------------- manual */

/** Hand-curated listings from sources/manual.json - live within the hour. */
export async function manualAdapter(feed) {
  const file = new URL(`../../${feed.file || 'sources/manual.json'}`, import.meta.url);
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  const now = Date.now();
  return (data.items || [])
    .filter((e) => e.url && e.title)
    .filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() >= now)
    .map((e) => {
      const item = makeItem({
        title: e.title,
        summary: e.summary,
        url: e.url,
        source: feed.id,
        sourceLabel: feed.label,
        kind: e.kind || 'study',
        mode: e.mode,
        text: `${e.summary || ''} ${e.reward || ''}`,
        postedAt: e.addedAt ? new Date(e.addedAt).toISOString() : undefined,
        location: e.location,
        tags: e.tags || [],
      });
      return { ...item, rewardNote: e.reward || null, expiresAt: e.expiresAt || null };
    });
}

export const ADAPTERS = {
  reddit: redditAdapter,
  clinicaltrials: clinicalTrialsAdapter,
  html: htmlAdapter,
  manual: manualAdapter,
};
