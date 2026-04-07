/**
 * WAB Search Engine — Independent search aggregator with caching,
 * ranking, suggestions, and trending queries.
 *
 * All results are served under the WAB brand — no external engine
 * branding is ever exposed to the user.
 */

const crypto = require('crypto');

let db;

function initSearchEngine(database) {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
      query_hash TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results TEXT NOT NULL,
      source TEXT DEFAULT 'multi',
      created_at TEXT DEFAULT (datetime('now')),
      hit_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      ip_hash TEXT,
      results_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_suggestions (
      query TEXT PRIMARY KEY,
      frequency INTEGER DEFAULT 1,
      last_searched TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_search_cache_created ON search_cache(created_at);
    CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_search_suggestions_freq ON search_suggestions(frequency DESC);
  `);
}

// ─── Cache Layer ──────────────────────────────────────────────────────

function queryHash(q) {
  return crypto.createHash('sha256').update(q.toLowerCase().trim()).digest('hex').slice(0, 32);
}

function getCachedResults(query) {
  const hash = queryHash(query);
  const row = db.prepare(
    `SELECT results, created_at FROM search_cache WHERE query_hash = ? AND created_at > datetime('now', '-1 hour')`
  ).get(hash);
  if (row) {
    db.prepare(`UPDATE search_cache SET hit_count = hit_count + 1 WHERE query_hash = ?`).run(hash);
    return JSON.parse(row.results);
  }
  return null;
}

function setCachedResults(query, results, source) {
  const hash = queryHash(query);
  db.prepare(
    `INSERT OR REPLACE INTO search_cache (query_hash, query, results, source, created_at, hit_count)
     VALUES (?, ?, ?, ?, datetime('now'), 1)`
  ).run(hash, query.toLowerCase().trim(), JSON.stringify(results), source || 'multi');
}

// Purge old cache entries (>24h)
function purgeOldCache() {
  db.prepare(`DELETE FROM search_cache WHERE created_at < datetime('now', '-1 day')`).run();
}

// ─── Search History & Suggestions ─────────────────────────────────────

function recordSearch(query, ipHash, resultsCount) {
  db.prepare(
    `INSERT INTO search_history (query, ip_hash, results_count) VALUES (?, ?, ?)`
  ).run(query.trim(), ipHash || null, resultsCount);

  // Update suggestion frequency
  const normalized = query.toLowerCase().trim();
  if (normalized.length >= 2 && normalized.length <= 100) {
    const existing = db.prepare(`SELECT frequency FROM search_suggestions WHERE query = ?`).get(normalized);
    if (existing) {
      db.prepare(`UPDATE search_suggestions SET frequency = frequency + 1, last_searched = datetime('now') WHERE query = ?`).run(normalized);
    } else {
      db.prepare(`INSERT INTO search_suggestions (query, frequency) VALUES (?, 1)`).run(normalized);
    }
  }
}

function getSuggestions(prefix, limit = 8) {
  if (!prefix || prefix.length < 1) return [];
  const normalized = prefix.toLowerCase().trim();
  return db.prepare(
    `SELECT query, frequency FROM search_suggestions
     WHERE query LIKE ? AND frequency > 0
     ORDER BY frequency DESC, last_searched DESC LIMIT ?`
  ).all(normalized + '%', limit).map(r => r.query);
}

function getTrendingSearches(limit = 10) {
  return db.prepare(
    `SELECT query, COUNT(*) as count FROM search_history
     WHERE created_at > datetime('now', '-24 hours')
     GROUP BY LOWER(query) ORDER BY count DESC LIMIT ?`
  ).all(limit).map(r => ({ query: r.query, count: r.count }));
}

function getSearchStats() {
  const total = db.prepare(`SELECT COUNT(*) as c FROM search_history`).get().c;
  const today = db.prepare(`SELECT COUNT(*) as c FROM search_history WHERE created_at > datetime('now', '-24 hours')`).get().c;
  const cached = db.prepare(`SELECT COUNT(*) as c FROM search_cache`).get().c;
  const uniqueQueries = db.prepare(`SELECT COUNT(DISTINCT LOWER(query)) as c FROM search_history`).get().c;
  return { total, today, cached, uniqueQueries };
}

// ─── Multi-Source Search ──────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
};

async function searchDDG(q) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const html = await resp.text();
    const results = [];
    const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const urls = [], titles = [], snippets = [];
    let m;
    while ((m = resultPattern.exec(html)) !== null) {
      urls.push(m[1]);
      titles.push(stripHtml(m[2]));
    }
    while ((m = snippetPattern.exec(html)) !== null) {
      snippets.push(decodeEntities(stripHtml(m[1])));
    }
    for (let i = 0; i < Math.min(urls.length, 15); i++) {
      let u = urls[i];
      const uddg = u.match(/uddg=([^&]+)/);
      if (uddg) u = decodeURIComponent(uddg[1]);
      if (!u.startsWith('http')) continue;
      results.push({ title: titles[i] || u, url: u, snippet: snippets[i] || '', source: 'ddg' });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function searchGoogle(q) {
  try {
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=15&hl=en';
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const html = await resp.text();
    const results = [];
    const linkPattern = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkPattern.exec(html)) !== null && results.length < 15) {
      const u = decodeURIComponent(m[1]);
      if (!u.startsWith('http')) continue;
      try { if (new URL(u).hostname.includes('google.')) continue; } catch { continue; }
      const title = stripHtml(m[2]);
      if (!title) continue;
      results.push({ title, url: u, snippet: '', source: 'google' });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function searchBing(q) {
  try {
    const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&count=15';
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const html = await resp.text();
    const results = [];
    // Bing result links: <a href="URL" h="ID=..."><strong>title</strong></a>
    const linkPattern = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = linkPattern.exec(html)) !== null && results.length < 15) {
      const u = m[1];
      if (!u.startsWith('http')) continue;
      try { if (new URL(u).hostname.includes('bing.')) continue; } catch { continue; }
      const title = stripHtml(m[2]);
      const snippet = decodeEntities(stripHtml(m[3]));
      if (!title) continue;
      results.push({ title, url: u, snippet, source: 'bing' });
    }
    return results;
  } catch (e) {
    return [];
  }
}

// ─── Result Ranking Engine ────────────────────────────────────────────

function rankResults(allResults) {
  // Deduplicate by URL (keep the one with the best snippet)
  const seen = new Map();
  for (const r of allResults) {
    const normalizedUrl = normalizeUrl(r.url);
    const existing = seen.get(normalizedUrl);
    if (!existing) {
      seen.set(normalizedUrl, { ...r, sourceCount: 1 });
    } else {
      existing.sourceCount++;
      // Prefer the version with a snippet
      if (!existing.snippet && r.snippet) {
        existing.snippet = r.snippet;
      }
      // Prefer longer title
      if (r.title.length > existing.title.length) {
        existing.title = r.title;
      }
    }
  }

  const deduplicated = Array.from(seen.values());

  // Score each result
  for (const r of deduplicated) {
    let score = 0;

    // Multi-source bonus: appearing in multiple engines means higher relevance
    score += (r.sourceCount - 1) * 30;

    // Snippet presence
    if (r.snippet && r.snippet.length > 20) score += 15;

    // HTTPS bonus
    if (r.url.startsWith('https://')) score += 5;

    // Domain diversity: boost independent/small sites
    const hostname = safeHostname(r.url);
    const bigTech = ['google.com','youtube.com','facebook.com','amazon.com','apple.com','microsoft.com','twitter.com','x.com','instagram.com','tiktok.com','linkedin.com','reddit.com','pinterest.com'];
    const isBigTech = bigTech.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!isBigTech) score += 8;

    // Trusted TLDs
    const tld = hostname.split('.').pop();
    if (['org','edu','gov','dev'].includes(tld)) score += 5;

    // Penalize very long URLs (likely junk)
    if (r.url.length > 200) score -= 10;

    r.score = score;
  }

  // Sort by score descending, then by original order
  deduplicated.sort((a, b) => b.score - a.score);

  // Return top 15, strip internal fields
  return deduplicated.slice(0, 15).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet || '',
  }));
}

// ─── Main Search Function ─────────────────────────────────────────────

async function search(query, ipHash) {
  if (!query || !query.trim()) return { results: [], cached: false };

  const q = query.trim();

  // Check cache first
  const cached = getCachedResults(q);
  if (cached && cached.length > 0) {
    recordSearch(q, ipHash, cached.length);
    return { results: cached, cached: true };
  }

  // Fetch from all sources in parallel
  const [ddgResults, googleResults, bingResults] = await Promise.allSettled([
    searchDDG(q),
    searchGoogle(q),
    searchBing(q),
  ]);

  const allResults = [
    ...(ddgResults.status === 'fulfilled' ? ddgResults.value : []),
    ...(googleResults.status === 'fulfilled' ? googleResults.value : []),
    ...(bingResults.status === 'fulfilled' ? bingResults.value : []),
  ];

  if (allResults.length === 0) {
    recordSearch(q, ipHash, 0);
    return { results: [], cached: false };
  }

  // Rank and deduplicate
  const ranked = rankResults(allResults);

  // Cache results
  setCachedResults(q, ranked, 'multi');

  // Record search
  recordSearch(q, ipHash, ranked.length);

  return { results: ranked, cached: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search;
  } catch {
    return url;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

module.exports = {
  initSearchEngine,
  search,
  getSuggestions,
  getTrendingSearches,
  getSearchStats,
  purgeOldCache,
};
