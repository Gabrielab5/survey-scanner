#!/usr/bin/env node
/**
 * Hourly aggregator: polls every configured source, merges the results with the
 * previously published dataset and rewrites docs/data/studies.json.
 *
 * Design rules:
 *  - A failing source never fails the run; it is reported in `sources[]` instead.
 *  - Items keep `firstSeen` across runs, and survive GRACE_HOURS after they stop
 *    being listed, so a flaky source does not wipe the site.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, panelItems } from './lib/adapters.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_FILE = path.join(ROOT, 'sources', 'sources.json');
const OUT_FILE = path.join(ROOT, 'docs', 'data', 'studies.json');
const GRACE_HOURS = 48;
const MAX_ITEMS = 500;

async function main() {
  const startedAt = new Date();
  const registry = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
  const previous = await readPrevious();
  const prevById = new Map((previous.items || []).map((i) => [i.id, i]));

  const fresh = [];
  const report = [];

  const evergreen = panelItems(registry.panels || []);
  fresh.push(...evergreen);
  report.push({ id: 'registry', label: 'פאנלים קבועים', status: 'ok', count: evergreen.length });

  const results = await Promise.all(
    (registry.feeds || []).filter((f) => f.enabled !== false).map(async (feed) => {
      const adapter = ADAPTERS[feed.type];
      if (!adapter) return { feed, error: `unknown adapter "${feed.type}"`, items: [] };
      const t0 = Date.now();
      try {
        console.log(`> ${feed.id} (${feed.type})`);
        const items = await adapter(feed);
        console.log(`  ${items.length} item(s) in ${Date.now() - t0}ms`);
        return { feed, items, ms: Date.now() - t0 };
      } catch (err) {
        console.warn(`  ! ${feed.id} threw: ${err.message}`);
        return { feed, error: err.message, items: [] };
      }
    })
  );

  for (const { feed, items, error, ms } of results) {
    fresh.push(...items);
    report.push({
      id: feed.id,
      label: feed.label || feed.id,
      type: feed.type,
      status: error ? 'error' : items.length ? 'ok' : 'empty',
      error: error || null,
      count: items.length,
      ms: ms || null,
    });
  }

  const nowIso = startedAt.toISOString();
  const merged = new Map();

  for (const item of fresh) {
    const prev = prevById.get(item.id);
    const existing = merged.get(item.id);
    const record = {
      ...item,
      firstSeen: prev?.firstSeen || existing?.firstSeen || nowIso,
      lastSeen: nowIso,
      stale: false,
    };
    if (!existing || score(record) > score(existing)) merged.set(item.id, record);
  }

  // Keep recently-seen items that vanished this run, flagged as stale.
  const cutoff = Date.now() - GRACE_HOURS * 3600 * 1000;
  for (const [id, prev] of prevById) {
    if (merged.has(id) || prev.evergreen) continue;
    if (new Date(prev.lastSeen || 0).getTime() < cutoff) continue;
    merged.set(id, { ...prev, stale: true });
  }

  const items = [...merged.values()]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, MAX_ITEMS);

  const payload = {
    generatedAt: nowIso,
    nextUpdateHint: new Date(startedAt.getTime() + 3600 * 1000).toISOString(),
    counts: {
      total: items.length,
      paid: items.filter((i) => i.paymentConfirmed).length,
      autofillable: items.filter((i) => i.autofill).length,
      evergreen: items.filter((i) => i.evergreen).length,
      stale: items.filter((i) => i.stale).length,
    },
    sources: report,
    items,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `\nwrote ${path.relative(ROOT, OUT_FILE)}: ${items.length} items ` +
      `(${payload.counts.paid} paid, ${payload.counts.stale} stale)`
  );
}

/** Prefer the richer duplicate when two sources report the same study. */
const score = (i) =>
  (i.reward?.amount ? 3 : 0) + (i.reward ? 2 : 0) + (i.summary ? 1 : 0) + (i.autofill ? 1 : 0);

/** Sort key: evergreen panels first, then freshest. */
const rank = (i) =>
  (i.evergreen ? 4e12 : 0) + (i.stale ? -2e12 : 0) + new Date(i.postedAt || i.lastSeen || 0).getTime();

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    return { items: [] };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
