'use strict';

// Same-event detection, within one edition and across editions.
//
// TWO PROBLEMS THAT LOOK LIKE ONE
//
// 1. WITHIN an edition, a story is often reported twice - once on the national
//    page and again on the state page with a local angle. Both are English,
//    both are extracted text, so ordinary token overlap settles it.
//
// 2. ACROSS editions, The Hindu and Eenadu report the same event in different
//    languages and different scripts. Token overlap is useless: the two texts
//    share almost no characters. What they do share is the language-independent
//    residue - the numbers, the years, the amounts, the acronyms and the Latin
//    proper nouns that a Telugu paper still prints in Latin script.
//
// So there are two comparators, chosen by whether the pair shares a script. The
// cross-script one is deliberately a *pre-filter*: it proposes pairs cheaply and
// hands the actual judgement to a model, because "both mention 2,400 crore and
// Polavaram" is suggestive but not proof, and a wrong merge destroys an item.
//
// WHY MERGING AT ALL
//
// Because the alternative is two notes on one event, which is the failure the
// whole one-item-routed-twice design exists to avoid. A merged event is also
// strictly better material: Eenadu carries district detail that The Hindu drops,
// and The Hindu carries the national framing that Eenadu compresses.

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'has',
  'have', 'had', 'will', 'would', 'said', 'says', 'that', 'this', 'it', 'its',
  'he', 'she', 'they', 'their', 'his', 'her', 'we', 'you', 'not', 'no', 'also',
  'after', 'over', 'into', 'about', 'more', 'than', 'who', 'which', 'when',
]);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9ఀ-౿\s]/g, ' ')   // keep Latin, digits, Telugu
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

// The part of an article that survives translation: figures, years, amounts,
// acronyms and Latin-script proper nouns. This is the only overlap an English
// and a Telugu report of one event reliably share.
function invariants(text) {
  const s = String(text || '');
  const out = new Set();

  // Numbers with magnitude words, which is how Indian money is written.
  for (const m of s.matchAll(/([\d,.]+)\s*(crore|lakh|billion|million|percent|per cent|%)/gi)) {
    out.add(`${m[1].replace(/[,.]/g, '')}${m[2].toLowerCase().replace(/\s/g, '')}`);
  }
  // Bare numbers of two digits or more. Two rather than three because the
  // counts that actually identify an Indian news event are usually small - "23
  // farmers", "41 plots", "26 residential sites" - and requiring three digits
  // discarded every one of them on the first synthetic pair tested. False
  // overlap on a stray "20" is affordable here: this score only ever *proposes*
  // a pair, and a model settles it.
  for (const m of s.matchAll(/\b(\d{2,})\b/g)) out.add(m[1]);
  // Acronyms: APPSC, TTD, RBI, ISRO, GO, MoU.
  for (const m of s.matchAll(/\b([A-Z]{2,6})\b/g)) {
    if (!/^(THE|AND|FOR|WITH|THAT|THIS|FROM|WILL|SAID)$/.test(m[1])) out.add(m[1]);
  }
  // Latin-script capitalised words, which a Telugu paper still uses for many
  // names, places and institutions.
  for (const m of s.matchAll(/\b([A-Z][a-z]{3,})\b/g)) out.add(m[1].toLowerCase());

  return out;
}

function hasTelugu(text) {
  return /[ఀ-౿]/.test(String(text || ''));
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

// Weighted towards the headline, because two reports of one event agree on the
// event even when their bodies diverge in length and detail.
function sameScriptScore(a, b) {
  const hl = jaccard(new Set(tokens(a.headline)), new Set(tokens(b.headline)));
  const body = jaccard(
    new Set(tokens((a.body || '').slice(0, 1200))),
    new Set(tokens((b.body || '').slice(0, 1200)))
  );
  return 0.6 * hl + 0.4 * body;
}

function crossScriptScore(a, b) {
  const ia = invariants(`${a.headline} ${a.body}`);
  const ib = invariants(`${b.headline} ${b.body}`);
  if (ia.size < 3 || ib.size < 3) return 0;
  let shared = 0;
  for (const t of ia) if (ib.has(t)) shared++;
  // Containment rather than Jaccard: a long article legitimately carries many
  // invariants the short one does not, and Jaccard would punish that.
  return shared / Math.min(ia.size, ib.size);
}

// Same-script pairs above this are merged without asking a model. Set from the
// observation that two write-ups of one event share most of their headline
// nouns, while two different stories on one page share almost none.
const SAME_SCRIPT_MERGE = 0.42;

// Cross-script pairs above this are *proposed*, never merged outright. Lower,
// because it is a pre-filter whose recall matters more than its precision.
const CROSS_SCRIPT_PROPOSE = 0.34;

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

// Union-find, so that A~B and B~C put all three in one event without needing a
// second pass.
function grouper(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  return {
    join(i, j) {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    },
    groups() {
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!map.has(root)) map.set(root, []);
        map.get(root).push(i);
      }
      return [...map.values()];
    },
  };
}

/**
 * Groups articles into events.
 *
 * Returns { events, proposals }:
 *   events    - arrays of article indices judged to be one event
 *   proposals - cross-script pairs that need a model's verdict before merging,
 *               each { a, b, score }. They are NOT merged here.
 */
function group(articles) {
  const g = grouper(articles.length);
  const proposals = [];
  const scored = [];

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const a = articles[i];
      const b = articles[j];
      const crossScript =
        hasTelugu(`${a.headline}${a.body}`) !== hasTelugu(`${b.headline}${b.body}`);

      if (crossScript) {
        const score = crossScriptScore(a, b);
        if (score >= CROSS_SCRIPT_PROPOSE) proposals.push({ a: i, b: j, score: round(score) });
        continue;
      }

      const score = sameScriptScore(a, b);
      if (score >= SAME_SCRIPT_MERGE) {
        g.join(i, j);
        scored.push({ a: i, b: j, score: round(score) });
      }
    }
  }

  return { events: g.groups(), proposals, merged: scored };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Collapses one event's articles into a single candidate.
 *
 * The longest article leads, because length here means detail rather than
 * verbosity - a follow-up carrying the district breakdown is what makes the
 * merge worth doing. The others are appended under their own attribution rather
 * than interleaved, so that a later reader can still see which paper said what.
 * Silently blending two accounts would make a discrepancy between them
 * impossible to notice, and discrepancies are exactly what a second source is
 * for.
 */
function collapse(articles, indices) {
  const parts = indices.map((i) => articles[i]).sort((p, q) => q.chars - p.chars);
  const lead = parts[0];
  const extra = parts.slice(1);

  let text = lead.body;
  for (const e of extra) {
    text += `\n\n[Also reported in ${e.publication || 'another edition'}` +
      `${e.page ? `, p${e.page}` : ''}]\n${e.body}`;
  }

  return {
    headline: lead.headline,
    standfirst: lead.standfirst || '',
    body: text,
    chars: text.length,
    dateline: lead.dateline || extra.map((e) => e.dateline).find(Boolean) || '',
    prominence: Math.max(...parts.map((p) => p.prominence || 0)),
    pages: [...new Set(parts.map((p) => p.page))].sort((a, b) => a - b),
    publications: [...new Set(parts.map((p) => p.publication).filter(Boolean))],
    parts: parts.length,
    sources: parts.map((p) => ({
      publication: p.publication,
      page: p.page,
      edition: p.edition,
      date: p.date,
      language: p.language,
      ocr: p.source === 'ocr',
      ocr_confidence: p.ocr_confidence ?? null,
    })),
  };
}

module.exports = {
  group,
  collapse,
  tokens,
  invariants,
  jaccard,
  sameScriptScore,
  crossScriptScore,
  hasTelugu,
  SAME_SCRIPT_MERGE,
  CROSS_SCRIPT_PROPOSE,
};
