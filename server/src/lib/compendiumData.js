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

// MARKDOWN TABLES ARE THE POINT OF THE NOTE, NOT NOISE IN IT.
//
// 111 of 127 published items carry one, because the drafter is told to use a
// table wherever there is a natural pairing — award to recipient, scheme to
// ministry, Bill to provision — and those pairings are what become list-match
// questions later. The first version of this file dropped every line beginning
// with a pipe, on the reasoning that the template escapes everything except
// **bold** and a leaked table would print as pipes. That is true of a table
// left in prose and false as a way of handling one: it threw the pairing away.
//
// So the note is parsed into blocks. Prose before the first table is the
// "why in news" paragraph; the tables and whatever follows them are
// "key details", which is the order the template's own anatomy asks for.
//
// The template's table takes exactly two columns. A wider one is folded — the
// first column stays the key and the rest are joined into the value with " · ",
// which keeps the pairing readable instead of dropping columns 3 and 4.
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;

function splitRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

function foldTo2(cells) {
  if (cells.length <= 2) return [cells[0] || '', cells[1] || ''];
  return [cells[0], cells.slice(1).filter(Boolean).join(' · ')];
}

/**
 * Splits markdown into paragraphs and tables, in document order.
 * @returns {{type:'p',text:string}|{type:'table',header:string[],rows:string[][]}}[]
 */
function parseBlocks(text) {
  const lines = clean(text).split(/\n/);
  const out = [];
  let para = [];
  const flush = () => {
    const t = para.join(' ').replace(/\s+/g, ' ').trim();
    if (t) out.push({ type: 'p', text: t });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRow = TABLE_ROW.test(line) && !TABLE_RULE.test(line);
    // A table starts on a row whose NEXT line is the |---|---| rule. Without
    // that check a sentence containing a pipe would open a table.
    if (isRow && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const header = foldTo2(splitRow(line));
      const rows = [];
      i += 2;
      for (; i < lines.length; i++) {
        if (!TABLE_ROW.test(lines[i]) || TABLE_RULE.test(lines[i])) break;
        const cells = foldTo2(splitRow(lines[i]));
        if (cells.some(Boolean)) rows.push(cells);
      }
      i -= 1;
      if (rows.length) out.push({ type: 'table', header, rows });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading inside the note is a section marker the template has no place
    // for; keep its words, drop the hashes.
    para.push(line.replace(/^#+\s*/, '').trim());
  }
  flush();
  return out;
}

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
    // A "## Key facts" section is normally a two-column table, and the schema
    // has a table type for exactly this. Parsing it means the attribute/value
    // pairing survives into the static box instead of arriving as pipes.
    const parsed = parseBlocks(body);
    const tbl = parsed.find((x) => x.type === 'table');
    if (tbl) {
      out.push({ title, type: 'table', header: tbl.header, rows: tbl.rows });
      const after = parsed.filter((x) => x.type === 'p').map((x) => x.text);
      if (after.length) out.push({ title, type: 'p', items: after });
      continue;
    }
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
    // Prose before the first table introduces the story; the tables and what
    // follows them are the detail. That is the template's own anatomy — block 4
    // is a context paragraph, block 5 is "table then 1-2 prose paragraphs".
    const noteBlocks = parseBlocks(item.notes_markdown);
    const firstTable = noteBlocks.findIndex((b) => b.type === 'table');
    const lead = firstTable === -1 ? noteBlocks : noteBlocks.slice(0, firstTable);
    const rest = firstTable === -1 ? [] : noteBlocks.slice(firstTable);
    const paras = lead.filter((b) => b.type === 'p').map((b) => b.text);

    // A salvaged item is a fact card: facts and maybe a question, no note. It
    // gets a different shape in the template rather than the full topic
    // anatomy with three quarters of it empty — see factCard() in build.js.
    // Salvaged, or a note with nothing in it at all. NOT merely "no prose":
    // an item whose note is a single table is a topic with a table, and
    // testing on paras alone turned one of those into a fact card and threw
    // its table away.
    const isFact = Number(item.salvaged) === 1 || noteBlocks.length === 0;

    // EVERY QUESTION THE ITEM HAS, not a fixed four.
    //
    // The kit's schema says exactly four per topic and its renderer does not:
    // build.js maps over the array everywhere, for the questions, the answer
    // strip, the quick-check row and the explanations. Items here carry between
    // one and ten, written deliberately during drafting, and a compendium that
    // silently prints four of ten throws away work somebody reviewed.
    //
    // Capping is still possible and is now the ADMIN's choice, made on the
    // Circulate panel, rather than a constant nobody can see.
    const mcqs = byItem.get(item.id) || [];

    const written = clean(item.hook);
    const writtenRecap = clean(item.recap)
      .split(/\n+/)
      .map((r) => r.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter(Boolean);
    const hook = written || hookOf(item, facts);
    const recap = writtenRecap.length === 3 ? writtenRecap : recapOf(item, facts, paras);

    // A fact card is not "thin" — it is complete for what it is. Reporting it
    // as missing four fields every day is how a warning stops being read.
    const missing = [];
    if (!isFact && !hook) missing.push('hook');
    if (!isFact && !recap) missing.push('recap');
    if (!isFact && !paras.length) missing.push('why_in_news');
    if (facts.length < 6) missing.push(`prelims_facts(${facts.length})`);
    if (mcqs.length < 4) missing.push(`questions(${mcqs.length})`);
    if (missing.length) thin.push({ id: item.id, headline: item.headline, missing });

    const units = unitsOf ? unitsOf(item.id) : item.units || [];
    const withUnits = { ...item, units };
    const sec = sectionOf(withUnits);
    const label = (SECTIONS.find((s) => s.key === sec) || SECTIONS[0]).title;

    const topic = {
      n: 0,
      kind: isFact ? 'fact' : 'topic',
      title: clean(item.headline),
      tags: papersFor(withUnits).slice(0, 3).map((p) => String(p).toUpperCase()),
      // A fact card carries none of the retention layer, and the old fallbacks
      // are what made it look broken: `why_in_news` repeated the headline
      // verbatim under the headline, and the recap was three slices of the
      // same short string.
      hook: isFact ? '' : hook || clean(item.headline).slice(0, 120),
      recap: isFact
        ? []
        : recap || [cut40(paras[0] || item.headline), cut40(facts[0] || ''), cut40(item.static_linkage || '')],
      why_in_news: isFact ? [] : paras,
      key_details: isFact ? [] : rest,
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

    const blocks = isFact ? [] : blocksOf(item.static_notes);
    if (!isFact && (item.static_linkage || blocks.length)) {
      topic.static_linkage = { summary: clean(item.static_linkage), blocks };
    }

    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(topic);
  }

  // IN THE SYLLABUS'S ORDER, NOT THE ORDER THE ITEMS HAPPENED TO ARRIVE IN.
  //
  // Keyed by insertion, a day whose first item was a geography story printed
  // "Section I — Geography" and "Section II — Polity". The numerals are how a
  // reader navigates a document they read every day, so they have to mean the
  // same thing on every issue. Empty sections are skipped, and the numbering
  // closes up rather than leaving gaps.
  const sections = SECTIONS.filter((s) => byLabel.has(s.title)).map((s, i) => ({
    label: `Section ${ROMAN[i] || i + 1}`,
    title: s.title,
    topics: byLabel.get(s.title),
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
