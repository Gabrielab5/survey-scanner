const UA = process.env.SCANNER_UA || 'survey-scanner/1.0';
const MIN_HOST_INTERVAL_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One promise chain per host so we never hammer a source in parallel. */
const hostQueues = new Map();

function throttle(host, job) {
  const prev = hostQueues.get(host) || Promise.resolve();
  const next = prev.then(async () => {
    const result = await job();
    await sleep(MIN_HOST_INTERVAL_MS);
    return result;
  });
  // Keep the chain alive even if a job rejects.
  hostQueues.set(host, next.catch(() => {}));
  return next;
}

/**
 * Fetch a URL as text, throttled per host, with backoff on 429/5xx.
 * Returns null instead of throwing so one dead source never fails the run.
 */
export async function fetchText(url, { tries = 4, timeout = 25000, headers = {} } = {}) {
  const host = safeHost(url);
  return throttle(host, async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt) await sleep(4000 * 2 ** (attempt - 1)); // 4s, 8s, 16s
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await fetch(url, {
          signal: ctl.signal,
          redirect: 'follow',
          headers: { 'user-agent': UA, 'accept-language': 'he,en;q=0.8', ...headers },
        });
        if (res.ok) return await res.text();
        lastErr = new Error(`HTTP ${res.status}`);
        // Anything other than rate limiting / server errors will not improve.
        if (res.status !== 429 && res.status < 500) break;
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    console.warn(`  ! fetch failed: ${url} (${lastErr && lastErr.message})`);
    return null;
  });
}

export async function fetchJson(url, opts) {
  const text = await fetchText(url, { headers: { accept: 'application/json' }, ...opts });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`  ! bad JSON from ${url}`);
    return null;
  }
}

const safeHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
