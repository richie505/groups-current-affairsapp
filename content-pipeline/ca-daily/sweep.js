#!/usr/bin/env node
'use strict';

// Discovery: finds what was published, across every registered source, without
// a language model.
//
// This is the half of the sweep that should never involve an LLM. Asking a model
// "what happened on 19 August" invites invented URLs and half-remembered
// figures; asking PIB and a dozen newsroom feeds for their own indexes returns
// the actual list. The model is used only later, for the thing it is genuinely
// good at — judging which of these is examinable, and turning the survivors into
// exam material.
//
//   node content-pipeline/ca-daily/sweep.js --date 2026-08-21
//   node content-pipeline/ca-daily/sweep.js --date 2026-08-21 --ap
//   node content-pipeline/ca-daily/sweep.js --from 2026-08-19 --to 2026-08-21 --json
//   node content-pipeline/ca-daily/sweep.js --date 2026-08-21 --raw     (skip filters)
//
// Output is an *index* — headline, date, source, URL, and the feed's own
// summary where it has one. No article bodies: fetching several hundred pages in
// order to discard most of them is waste, so the shortlist runs on headlines and
// only survivors get fetched. See daily.js.

const { SOURCES, isNoise } = require('./sources');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20000;

// Terms that make an item Andhra Pradesh-relevant. Applied to headlines from
// non-AP feeds — items from AP-dedicated feeds are flagged by source instead.
const AP_TERMS = [
  'andhra', 'amaravati', 'visakhapatnam', 'vizag', 'vijayawada', 'guntur',
  'tirupati', 'kurnool', 'nellore', 'kakinada', 'rajahmundry', 'rajamahendravaram',
  'anantapur', 'kadapa', 'srikakulam', 'vizianagaram', 'eluru', 'ongole',
  'machilipatnam', 'chittoor', 'annamayya', 'nandyal', 'palnadu', 'bapatla',
  'parvathipuram', 'alluri', 'anakapalli', 'konaseema', 'tirumala',
  'polavaram', 'sriharikota', 'krishnapatnam', 'bhogapuram', 'gangavaram',
  'sri city', 'rayalaseema', 'godavari', 'apcnf', 'apspdcl', 'appsc',
  'chandrababu', 'pawan kalyan', 'tdp', 'ysrcp', 'jana sena',
];

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// RFC-822 ('Fri, 21 Aug 2026 13:21:44 +0530') and PIB's 'Posted on: 19 Aug 2026'
// both reduce to the same three fields, so one parser covers both.
//
// The date is taken as printed rather than converted to UTC. An IST-published
// story dated 21 August belongs in the 21 August digest even if it was 20:30 UTC
// on the 20th — the digest is a calendar day in India, not a UTC instant.
function toIso(raw) {
  const s = decode(raw);
  let m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
  }
  // ISO-ish fallback, for feeds using <dc:date> or atom <updated>.
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// parsers
// ---------------------------------------------------------------------------

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const headline = tag(block, 'title');
    const link = tag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const date = toIso(tag(block, 'pubDate') || tag(block, 'dc:date') || tag(block, 'updated'));
    if (!headline || !link || !date) continue;
    out.push({
      headline,
      date,
      url: link,
      // The feed's own summary. Worth keeping: when an article body turns out to
      // be paywalled, this is the only text there is.
      summary: tag(block, 'description').slice(0, 600),
      category: tag(block, 'category'),
    });
  }
  return out;
}

// PIB's listing groups releases under <h3>Ministry</h3> headings, then lists
// each as an anchor carrying the headline in its title attribute, the release id
// in the href and the date in a following span. Walked in document order so each
// release keeps the ministry heading it sat under — the ministry is a strong
// signal for both the shortlist and the eventual paper-unit routing.
function parsePibIndex(html) {
  const out = [];
  let ministry = '';
  const token =
    /<h3>([\s\S]*?)<\/h3>|<a\s+title='([^']*)'\s+href='\/PressRele[a-zA-Z]*\.aspx\?PRID=(\d+)'[\s\S]{0,400}?publishdatesmall'>\s*Posted on:\s*([^<]*)/g;
  let m;
  while ((m = token.exec(html)) !== null) {
    if (m[1] !== undefined) {
      ministry = decode(m[1]);
      continue;
    }
    const headline = decode(m[2]);
    const date = toIso(m[4]);
    if (!headline || !date) continue;
    out.push({
      headline,
      date,
      url: `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${m[3]}&reg=3&lang=1`,
      summary: '',
      category: ministry,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// dedupe
// ---------------------------------------------------------------------------

// The same story appears in four papers on the same day, and a Cabinet decision
// appears under both the CCEA and the implementing ministry. Without this the
// shortlist prompt is a third duplicates, and the model burns judgement on
// deciding the same item repeatedly.
//
// Matched on a signature of the significant words rather than the whole
// headline, because papers rewrite headlines freely while keeping the nouns and
// the numbers. Primary sources win a tie, so the surviving copy is the one whose
// body is worth fetching.
const STOP = new Set(
  ('a an the and or but of in on at to for from with by as is are was were be been being this that these those ' +
    'it its his her their our your new says said will would may can could s t after over amid ahead')
    .split(' ')
);

function signature(headline) {
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9₹%\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  // Numbers are the most reliable identifier a rewritten headline keeps, so they
  // are always retained; the rest is the first few content words, sorted so word
  // order cannot split a pair.
  const nums = words.filter((w) => /\d/.test(w));
  const rest = words.filter((w) => !/\d/.test(w)).slice(0, 6).sort();
  return [...nums.sort(), ...rest].join('|');
}

// Which of two copies of the same story to keep. Higher wins.
//
// The AP-dedicated feed beats the national one for the same article, so the
// surviving copy is attributed to the desk that actually covers Andhra Pradesh —
// otherwise an AP story reads as "The Hindu — National" purely because that feed
// happened to be parsed first, which is misleading about where the coverage
// lives.
function copyRank(it) {
  let r = 0;
  if (it.is_primary) r += 100;
  if (it.ap_source) r += 20;
  if (it.ap) r += 10;
  if (it.opinion) r -= 5;
  return r;
}

function dedupe(items) {
  const seen = new Map();
  for (const it of items) {
    const key = `${it.date}::${signature(it.headline)}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...it, also_in: [] });
      continue;
    }
    if (copyRank(it) > copyRank(prev)) {
      // Promote this copy, and keep the record of everywhere else it ran —
      // corroboration across several papers is itself worth seeing.
      const also = [...prev.also_in, prev.source].filter((s) => s !== it.source);
      seen.set(key, { ...it, also_in: [...new Set(also)] });
    } else if (!prev.also_in.includes(it.source) && prev.source !== it.source) {
      prev.also_in.push(it.source);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// sweep
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { from: null, to: null, json: false, ap: false, raw: false, limit: Infinity, only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--date') args.from = args.to = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--ap') args.ap = true;
    else if (a === '--raw') args.raw = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--only') args.only = argv[++i].split(',');
  }
  if (args.from && !args.to) args.to = args.from;
  if (args.to && !args.from) args.from = args.to;
  return args;
}

async function sweep({ from, to, ap = false, raw = false, limit = Infinity, only = null } = {}) {
  const active = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;

  // All sources in parallel. One slow or dead feed must not hold up the run, and
  // a failure is reported rather than thrown — losing one paper is not a reason
  // to lose the day.
  const results = await Promise.all(
    active.map(async (src) => {
      try {
        const body = await fetchText(src.url);
        const rows = src.kind === 'pib-index' ? parsePibIndex(body) : parseRss(body);
        return { src, rows, error: null };
      } catch (e) {
        return { src, rows: [], error: e.name === 'AbortError' ? 'timed out' : e.message };
      }
    })
  );

  const perSource = [];
  let all = [];
  for (const { src, rows, error } of results) {
    perSource.push({ id: src.id, name: src.name, found: rows.length, error });
    for (const r of rows) {
      all.push({
        ...r,
        source: src.name,
        source_id: src.id,
        publisher: src.name.split(' — ')[0],
        is_primary: !!src.primary,
        opinion: !!src.opinion,
        // AP by dedicated feed, or by a place name in the headline.
        ap: !!src.ap || AP_TERMS.some((t) => r.headline.toLowerCase().includes(t)),
        // Whether the *feed* is AP-dedicated, as distinct from an AP place name
        // appearing in a national headline. Used only to attribute a deduped
        // story to the desk that actually covers the state.
        ap_source: !!src.ap,
      });
    }
  }

  const fetched = all.length;

  if (from && to) all = all.filter((i) => i.date >= from && i.date <= to);
  const inWindow = all.length;

  if (!raw) all = all.filter((i) => !isNoise(i.headline));
  const afterNoise = all.length;

  all = dedupe(all);
  const afterDedupe = all.length;

  if (ap) all = all.filter((i) => i.ap);

  // Primary sources first, then AP, then opinion last — opinion is valuable for
  // the quotation bank but should never crowd out a Cabinet decision.
  all.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    if (a.ap !== b.ap) return a.ap ? -1 : 1;
    if (a.opinion !== b.opinion) return a.opinion ? 1 : -1;
    return 0;
  });

  return {
    stats: { fetched, inWindow, afterNoise, afterDedupe, kept: all.length },
    perSource,
    items: all.slice(0, limit),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const { stats, perSource, items } = await sweep(args);

  if (args.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  const failed = perSource.filter((s) => s.error);
  console.error(
    `Sources: ${perSource.length - failed.length}/${perSource.length} ok · ` +
      `${stats.fetched} items fetched → ${stats.inWindow} in window → ` +
      `${stats.afterNoise} after noise filter → ${stats.afterDedupe} after dedupe → ${items.length} shown`
  );
  if (failed.length) {
    for (const f of failed) console.error(`  ! ${f.name}: ${f.error}`);
  }
  console.error('');

  for (const i of items) {
    const flags = [i.is_primary ? 'PRIMARY' : null, i.ap ? 'AP' : null, i.opinion ? 'OPINION' : null]
      .filter(Boolean)
      .join(' ');
    console.error(`${i.date} ${flags ? `[${flags}] ` : ''}${i.source}`);
    console.error(`         ${i.headline}`);
    if (i.also_in?.length) console.error(`         also in: ${i.also_in.join(', ')}`);
    console.error(`         ${i.url}`);
  }

  if (!items.length) {
    console.error(
      'Nothing in that window. News feeds carry only the last few days, and the\n' +
        'PIB listing covers the current month — for anything older, use the browser.'
    );
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { sweep, parseRss, parsePibIndex, dedupe, signature, toIso, AP_TERMS };
