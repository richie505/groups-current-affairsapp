'use strict';

// Maps THIS database's item columns onto the retention template's schema
// (pdf-template/schema.json). The layout lives in the kit; this file is the
// only place that knows how our columns become its fields, so either can be
// replaced without touching the other.
//
// WHAT MAPS CLEANLY
//
//   ca_items.headline        -> topic.title
//   ca_items.notes_markdown  -> topic.why_in_news      (already **bold**-marked)
//   ca_items.static_linkage  -> static_linkage.summary
//   ca_items.static_notes    -> static_linkage.blocks  (already ## What it is …)
//   ca_items.prelims_facts   -> topic.prelims_facts    (normalised to "Label — Value")
//   ca_mcqs                  -> topic.questions
//   papersFor(item)          -> topic.tags
//
// WHAT DOES NOT EXIST ON OLDER ROWS
//
// `hook` and `recap` are the retention layer. The drafter writes them now; the
// items drafted before it did have them DERIVED here from prelims_facts and the
// notes. A written one always wins, so the derivation retires by itself as the
// archive turns over.

const path = require('path');

const { papersFor, sectionOf, SECTIONS } = require(path.join(__dirname, 'sections'));

const clean = (s) => String(s || '').replace(/\r/g, '').trim();

// prelims_facts are stored one per line or pipe-separated depending on age.
// NORMALISED TO " — ", AND THAT IS NOT COSMETIC.
//
// The template splits a fact into label and value with
// /^(.{3,80}?)\s(?:—|–|:)\s(.+)$/, which wants whitespace on BOTH sides of the
// separator. This generator writes "Veligonda Phase-I inauguration and water
// release: 31 August 2026" — a colon with no space before it — so every fact
// would render as one unsplit blob and the Prelims-facts block would lose the
// two-column scan it exists for.
//
// The kit's own spec says "a ' — ' or ': ' separator", so the intent is clear
// and its regex is stricter than its documentation. Normalising here rather
// than editing the kit keeps the template a drop-in.
const factsOf = (item) =>
  clean(item.prelims_facts)
    .split(/\n+|\s\|\s/)
    .map((f) => f.replace(/^[-•*]\s*/, '').trim())
    .filter((f) => f.length > 3)
    .map((f) => {
      const m = f.match(/^(.{3,80}?)\s*[:—–]\s+(.+)$/);
      return m ? `${m[1].trim()} — ${m[2].trim()}` : f;
    });

// notes_markdown is prose with **bold** already in it. Split to paragraphs and
// drop anything that is a markdown heading or table — the template escapes
// everything except **bold**, so a leaked pipe table would print as pipes.
const parasOf = (text) =>
  clean(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p && !p.startsWith('#') && !p.startsWith('|'));

// static_notes arrives as "## What it is … ## Key facts …". The schema only
// admits five block titles, so anything else is folded into the nearest one it
// allows rather than dropped.
const ALLOWED = ['What it is', 'Key facts', 'The provisions that get asked', 'Easily confused with', 'Andhra Pradesh'];
const TITLE_ALIASES = new Map([
  ['what it is', 'What it is'],
  ['key facts', 'Key facts'],
  ['the provisions that get asked', 'The provisions that get asked'],
  ['provisions that get asked', 'The provisions that get asked'],
  ['provisions', 'The provisions that get asked'],
  ['easily confused with', 'Easily confused with'],
  ['andhra pradesh', 'Andhra Pradesh'],
  ['andhra pradesh angle', 'Andhra Pradesh'],
]);

function blocksOf(text) {
  const raw = clean(text);
  if (!raw) return [];
  const out = [];
  const parts = raw.split(/^##\s+/m).filter((p) => p.trim());
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    const title = TITLE_ALIASES.get(heading.toLowerCase());
    if (!title || !body) continue;
    const bullets = body
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const allBullets = bullets.length > 1 && bullets.every((b) => /^[-•*]\s/.test(b));
    if (allBullets) {
      out.push({ title, type: 'list', items: bullets.map((b) => b.replace(/^[-•*]\s*/, '')) });
    } else {
      const paras = body.split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      out.push({ title, type: 'p', items: paras.length ? paras : [body] });
    }
  }
  // one block per allowed title, in the spec's order
  const seen = new Map();
  for (const b of out) {
    if (!seen.has(b.title)) seen.set(b.title, b);
    else seen.get(b.title).items.push(...b.items);
  }
  return ALLOWED.filter((t) => seen.has(t)).map((t) => seen.get(t));
}

const strip = (s) => String(s || '').replace(/\*\*/g, '').trim();

// THE DERIVED RETENTION LAYER — see the header.
//
// A hook is "the 3-5 most examinable tokens joined by ·". prelims_facts are
// already exactly that: a hand-written list of Label — Value pairs, ordered
// most-examinable first by the generator. So the hook is their values.
function hookOf(item, facts) {
  // Pair the label with the value, because the value alone is often meaningless.
  // Taking values only produced "1982 · 1 April 2017 · 2024 · July 2026" for a
  // tax-treaty story and "$72.85 billion · $64.40 billion · $4.86 billion" for a
  // forex one — four numbers with nothing to attach them to. The kit's own
  // example is "Vizag = network · Amaravati = sports city", which is a pairing.
  //
  // The label is trimmed to its last few words: the generator writes
  // "RBI-reported forex generated under swap facility as at 21 August 2026",
  // where the part that identifies the thing is at the front, and the part that
  // repeats the value is at the back. So the head is kept, not the tail.
  const pairs = [];
  for (const f of facts) {
    const m = f.match(/^(.{3,80}?)\s+—\s+(.+)$/);
    if (!m) continue;
    let k = strip(m[1]).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    const v = strip(m[2]);
    if (!v || v.length > 40) continue;
    const words = k.split(/\s+/);
    if (words.length > 4) k = words.slice(0, 4).join(' ');
    // Trimming to four words leaves danglers — "Veligonda Phase-I inauguration
    // and = 31 August 2026". Drop trailing connectives so the label ends on a noun.
    k = k.replace(/\s+(?:and|or|of|to|for|in|on|at|as|by|over|under|with|from|the|a|an)\s*$/i, '').trim();
    if (!k) continue;
    const piece = k.toLowerCase() === v.toLowerCase() ? v : `${k} = ${v}`;
    if (piece.length > 52) continue;
    if (pairs.some((p) => p.toLowerCase() === piece.toLowerCase())) continue;
    pairs.push(piece);
    if (pairs.join(' · ').length > 92 || pairs.length >= 3) break;
  }
  const hook = pairs.join(' · ');
  return hook.length >= 12 ? hook.slice(0, 128) : '';
}

// Three bullets: what happened, the numbers, the static link.
function recapOf(item, facts, paras) {
  const first = strip(paras[0] || '');
  const sentence = first.split(/(?<=\.)\s+/)[0] || first;
  const numbers = facts
    .slice(0, 3)
    .map((f) => strip(f))
    .join('; ');
  const link = strip(item.static_linkage);
  const cut = (s, n) => {
    const w = String(s).split(/\s+/);
    return w.length <= n ? String(s) : `${w.slice(0, n).join(' ')}…`;
  };
  const three = [cut(sentence, 40), cut(numbers, 40), cut(link, 40)].filter(Boolean);
  return three.length === 3 ? three : null;
}


// Trim to the 40-word ceiling the spec sets for a recap bullet.
const cut40 = (s) => {
  const t = strip(s);
  const w = t.split(/\s+/);
  return w.length <= 40 ? t : w.slice(0, 40).join(' ') + '…';
};

const LETTER = { a: 'A', b: 'B', c: 'C', d: 'D' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * @param {object[]} items    ca_items rows, already ordered and capped
 * @param {Map<number, object[]>} byItem  item id -> ca_mcqs rows
 * @param {object} opts       { day, unitsOf }
 */
function buildCompendiumData(items, byItem, { day, unitsOf }) {
  const byLabel = new Map();
  const thin = [];

  for (const item of items) {
    const facts = factsOf(item);
    const paras = parasOf(item.notes_markdown);
    const mcqs = (byItem.get(item.id) || []).slice(0, 4);

    const written = clean(item.hook);
    const writtenRecap = clean(item.recap)
      .split(/\n+/)
      .map((r) => r.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter(Boolean);
    const hook = written || hookOf(item, facts);
    const recap = writtenRecap.length === 3 ? writtenRecap : recapOf(item, facts, paras);

    const missing = [];
    if (!hook) missing.push('hook');
    if (!recap) missing.push('recap');
    if (!paras.length) missing.push('why_in_news');
    if (facts.length < 6) missing.push(`prelims_facts(${facts.length})`);
    if (mcqs.length < 4) missing.push(`questions(${mcqs.length})`);
    if (missing.length) thin.push({ id: item.id, headline: item.headline, missing });

    const units = unitsOf ? unitsOf(item.id) : item.units || [];
    const withUnits = { ...item, units };
    const sec = sectionOf(withUnits);
    const label = (SECTIONS.find((s) => s.key === sec) || {}).title || 'Current Affairs';

    const topic = {
      n: 0,
      title: clean(item.headline),
      tags: papersFor(withUnits).slice(0, 3).map((p) => String(p).toUpperCase()),
      hook: hook || clean(item.headline).slice(0, 120),
      recap: recap || [cut40(paras[0] || item.headline), cut40(facts[0] || ''), cut40(item.static_linkage || '')],
      why_in_news: paras.length ? paras : [strip(item.headline)],
      key_details: [],
      prelims_facts: facts,
      questions: mcqs.map((m) => ({
        q: 0,
        stem: clean(m.question),
        options: [m.option_a, m.option_b, m.option_c, m.option_d].map((o) => strip(o)),
        answer: LETTER[String(m.correct_option || 'a').toLowerCase()] || 'A',
        explanation: clean(m.explanation),
        as_of: m.fact_as_of || null,
      })),
    };

    const blocks = blocksOf(item.static_notes);
    if (item.static_linkage || blocks.length) {
      topic.static_linkage = { summary: clean(item.static_linkage), blocks };
    }

    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(topic);
  }

  const sections = [...byLabel.entries()].map(([title, topics], i) => ({
    label: `Section ${ROMAN[i] || i + 1}`,
    title,
    topics,
  }));

  let n = 0;
  let qn = 0;
  for (const s of sections) {
    for (const t of s.topics) {
      t.n = ++n;
      for (const q of t.questions) q.q = ++qn;
    }
  }

  const d = new Date(`${day.date}T00:00:00Z`);
  const o = { timeZone: 'UTC' };
  const weekday = d.toLocaleDateString('en-IN', { ...o, weekday: 'long' });
  const pretty = d.toLocaleDateString('en-IN', { ...o, day: 'numeric', month: 'long', year: 'numeric' });
  const words = items.reduce((a, i) => a + String(i.notes_markdown || '').split(/\s+/).length, 0);

  return {
    data: {
      meta: {
        title: 'Andhra Pradesh Current Affairs',
        subtitle: 'Daily Compendium',
        date: pretty,
        weekday,
        exams: ['APPSC Group-I Prelims', 'APPSC Group-II Screening', 'APPSC Group-II Mains'],
        source: 'The Hindu',
        reading_time: `About ${Math.max(5, Math.round(words / 180))} minutes`,
        disclaimer:
          'Prepared from the day’s newspaper for examination practice. Verify any statute, ' +
          'case, date or official figure against the primary source before quoting it.',
        footer: `APPSC Current Affairs · ${weekday}, ${pretty}`,
      },
      sections,
    },
    thin,
    topics: n,
    questions: qn,
  };
}

module.exports = { buildCompendiumData };
