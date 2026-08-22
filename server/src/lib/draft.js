'use strict';

// SECTION 3 — THE ARTICLE → NOTE BRIDGE
//
// Sections 1 and 2 end with a scored `np_article`: segmented, entity-extracted,
// keyword-matched, topic-matched and given a 0-100 relevance verdict. Nothing
// downstream of that existed. `np_articles.item_id` was in the schema from the
// start and nothing ever wrote it, so an article scored CRITICAL produced
// exactly as much student-visible material as one scored LOW: none.
//
// This module closes that. It turns a scored article into the MASTER KNOWLEDGE
// OBJECT — one `ca_items` row, routed to both exams at once — and links the two
// with `item_id`.
//
// WHY THIS IS A SHARED LIB AND NOT A SECOND PIPELINE
//
// The product principle is ONE SOURCE → ONE INTELLIGENCE PROCESS → MANY EXAM
// OUTPUTS. There was already a working newspaper path (np-daily/paper.js writes
// a candidates file, ca-daily/run.js drafts from it), and the temptation was to
// write a second drafting routine for the in-app path. That would mean two
// implementations of the vocabulary canonicalisation below — the code that stops
// a unit tag being silently invisible — and they would drift.
//
// So `insertDrafted` is extracted here verbatim in behaviour and run.js calls
// it. Same pattern as Section 1, where `lib/ingest.js` is shared by the CLI and
// the API rather than duplicated into both.
//
// WHAT THE MODEL IS AND IS NOT ASKED
//
// It is NOT asked to re-derive the bucket, the keyword angles or the topics.
// Section 2 already computed those deterministically and reproducibly, and a
// model asked the same question would return a second, disagreeing answer to
// one already settled. They are supplied to it as FINDINGS, and its job is to
// write the note that uses them.
//
// It is asked for exactly what a scoring function cannot produce: the note
// prose, THE FACT, and THE ANGLE — the argument the fact supports.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PIPELINE = path.join(ROOT, 'content-pipeline', 'ca-daily');

// The one model-call implementation in the repo. It carries retry logic that
// was expensive to establish — gpt-5.x models answer a non-default temperature
// with a 400 rather than clamping it, so `complete` drops whichever sampling
// parameter the API names and retries. Reimplementing that here would mean
// rediscovering it here.
const L = require(path.join(PIPELINE, 'lib'));

const DIMENSIONS = [
  'economic', 'social', 'political', 'ethical', 'environmental', 'legal', 'international',
];

// ---------------------------------------------------------------------------
// the model input
// ---------------------------------------------------------------------------

// Everything Section 2 established about this article, written as findings the
// drafter should use rather than questions it should answer.
function findingsFor(db, article) {
  const keywords = db
    .prepare(
      `SELECT keyword, subject, in_headline, pyq_count
         FROM np_article_keywords WHERE article_id = ?
        ORDER BY in_headline DESC, pyq_count DESC, keyword`
    )
    .all(article.id);

  const topics = db
    .prepare(
      `SELECT t.name, t.tier, at.hits, at.in_headline, at.matched
         FROM np_article_topics at JOIN topics t ON t.id = at.topic_id
        WHERE at.article_id = ?
        ORDER BY at.in_headline DESC, at.hits DESC`
    )
    .all(article.id);

  // Which paper units the matched topics already feed. This is the cross-paper
  // reuse map doing real work rather than being a view: the drafter is handed
  // the units this event's topics are known to serve, so a Polavaram story
  // arrives already knowing it belongs to Paper II, Paper IV and the essay.
  const units = topics.length
    ? db
        .prepare(
          `SELECT DISTINCT tu.unit_code, u.label
             FROM np_article_topics at
             JOIN topic_units tu ON tu.topic_id = at.topic_id
             LEFT JOIN ref_units u ON u.unit_code = tu.unit_code
            WHERE at.article_id = ?
            ORDER BY tu.unit_code`
        )
        .all(article.id)
    : [];

  const entities = db
    .prepare(
      `SELECT kind, name, mentions FROM np_article_entities WHERE article_id = ?
        ORDER BY mentions DESC, kind, name`
    )
    .all(article.id);

  return { keywords, topics, units, entities };
}

function sourceTextFor(db, article, edition) {
  const f = findingsFor(db, article);
  const lines = [];

  lines.push(`HEADLINE: ${article.headline || ''}`);
  if (article.standfirst) lines.push(`STANDFIRST: ${article.standfirst}`);
  // The dateline is the strongest single signal that a story is an AP story,
  // even when its text never names the State, so it is given its own line
  // rather than being left inside the body.
  if (article.dateline) lines.push(`DATELINE: ${article.dateline}`);
  if (article.byline) lines.push(`BYLINE: ${article.byline}`);
  lines.push(`DATE: ${edition.date}`);
  lines.push(
    `SOURCE: ${edition.publication}${edition.edition ? ` (${edition.edition})` : ''}` +
      `, ${edition.date}, page ${article.page ?? '?'} — print edition`
  );

  lines.push('');
  lines.push('=== WHAT THE SYSTEM HAS ALREADY ESTABLISHED ===');
  lines.push('These are settled findings, not suggestions. Use them; do not re-derive them.');
  lines.push('');
  lines.push(
    `RELEVANCE: ${article.score == null ? 'unscored' : Math.round(article.score)}/100` +
      `${article.band ? ` (${article.band.toUpperCase()})` : ''}`
  );
  lines.push(`BUCKET: ${article.bucket || 'national'}`);
  if (article.subjects) lines.push(`SUBJECTS: ${article.subjects}`);
  lines.push(`ANDHRA PRADESH STORY: ${article.ap ? 'yes' : 'no'}`);

  if (f.keywords.length) {
    lines.push('');
    lines.push('BLUEPRINT KEYWORD ANGLES MATCHED (the angles APPSC tests this through):');
    for (const k of f.keywords.slice(0, 12)) {
      const where = k.in_headline ? 'headline' : 'body';
      const pyq = k.pyq_count ? `, asked ${k.pyq_count}x in past papers` : '';
      lines.push(`  - ${k.keyword}${k.subject ? ` [${k.subject}]` : ''} (${where}${pyq})`);
    }
  }

  if (f.topics.length) {
    lines.push('');
    lines.push('MASTER TOPICS THIS UPDATES (an existing entity, not a new note):');
    for (const t of f.topics.slice(0, 8)) {
      lines.push(`  - ${t.name}${t.tier ? ` (Tier ${t.tier})` : ''} — matched on "${t.matched}"`);
    }
  }

  if (f.units.length) {
    lines.push('');
    lines.push('PAPER UNITS THOSE TOPICS ALREADY FEED (tag at least these):');
    for (const u of f.units.slice(0, 14)) {
      lines.push(`  - ${u.unit_code}${u.label ? ` — ${u.label}` : ''}`);
    }
  }

  if (f.entities.length) {
    lines.push('');
    lines.push('ENTITIES EXTRACTED:');
    const byKind = {};
    for (const e of f.entities) (byKind[e.kind] ||= []).push(e.name);
    for (const [kind, names] of Object.entries(byKind)) {
      lines.push(`  ${kind}: ${names.slice(0, 10).join(', ')}`);
    }
  }

  lines.push('');
  lines.push('SOURCE TEXT:');
  lines.push(article.body || '(no body text extracted)');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// the draft call
// ---------------------------------------------------------------------------

// Appended to the standard drafting prompt. The base prompt was written for a
// web candidate with URLs; a print article differs in two ways that matter, and
// both are honesty constraints rather than formatting ones.
const PRINT_ADDENDUM = `
=== THIS ITEM CAME FROM A PRINT NEWSPAPER ===

Two consequences, both binding:

1. DO NOT INVENT SOURCES. There is no URL. Return "sources": [] and nothing
   else — the citation is written from the edition record, which knows the
   publication, date and page exactly. A fabricated link is worse than no link.

2. ONE SECONDARY SOURCE. A single newspaper report is not the cross-check the
   research discipline requires. Set "needs_verify": true and name in
   "verify_note" the specific figures, names or dates a reader must confirm
   against a primary source (PIB, PRS, RBI, a department portal) before this is
   published. If nothing in the item is checkable in that way — a report of a
   speech, say — say so plainly instead.

Use the established findings above for the bucket, the keyword angles and the
unit tags. You are writing the note, not re-classifying the article.
`;

async function draftArticle(db, { article, edition, model, vocabulary, prompt }) {
  const system = `${prompt}\n\n${PRINT_ADDENDUM}\n\n${vocabulary}`;
  const raw = await L.complete({
    system,
    user: sourceTextFor(db, article, edition),
    model,
  });
  return L.parseJson(raw);
}

// ---------------------------------------------------------------------------
// text-field normalisation
// ---------------------------------------------------------------------------

// A TEXT column cannot bind an array, and better-sqlite3 refuses rather than
// coercing — which rolls back the whole transaction AFTER every draft in it has
// been paid for. Observed on 3 of 28 items: `g1_bridges` and `g1_linked` came
// back as JSON arrays because the prompt describes them as lists of lines.
//
// The prompt can ask for a shape. Only code can guarantee it.
// An array of bullet strings becomes newline-separated bullets, which is how
// every one of these fields is rendered anyway. Anything else object-shaped is
// JSON-stringified rather than silently emptied, so a surprise is visible in
// the review queue instead of vanishing.
function toText(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
      .filter(Boolean)
      .map((line) => (/^[-*•]/.test(line) ? line : `- ${line}`))
      .join('\n');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// `headline`, `event_date`, `bucket`, `subject_tag` and `g1_bank` are in this
// list for the same reason as the prose fields, and the last one matters most:
// `g1_bank` carries a CHECK constraint, so an array arriving there fails the
// insert rather than merely looking odd.
const TEXT_FIELDS = [
  'headline', 'event_date', 'bucket', 'subject_tag', 'notes_markdown',
  'static_linkage', 'prelims_facts', 'g1_bank', 'g1_fact', 'g1_angle',
  'g1_theme', 'g1_sub_theme', 'g1_why_news', 'g1_background', 'g1_ap_angle',
  'g1_linked', 'g1_bridges', 'g1_way_forward', 'verify_note', 'discard_reason',
];

function normaliseTextFields(record) {
  if (!record || typeof record !== 'object') return record;
  for (const f of TEXT_FIELDS) {
    if (f in record) record[f] = toText(record[f]);
  }
  return record;
}

// ---------------------------------------------------------------------------
// the insert
// ---------------------------------------------------------------------------

// Takes the code off the front of an echoed vocabulary line. Splits only on a
// SPACE-DELIMITED dash, so the hyphen inside a real code (P3-U7) is untouched.
const codeOf = (value) => String(value ?? '').trim().split(/\s+[—–-]\s+/)[0].trim();

function canonicaliser(valid) {
  return (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (valid.has(raw)) return raw;
    const head = codeOf(raw);
    return valid.has(head) ? head : null;
  };
}

// Writes drafted records into the review queue as `ca_items`, resolving their
// tags against the seeded vocabularies.
//
// WHY THE VOCABULARY CHECK EXISTS
//
// The drafting prompt supplies units as "P3-U7 — Policy process, implementation"
// lines and the model sometimes echoes the whole line back. Unchecked, that
// string lands in `ca_item_units.unit_code`, where it can never match a query
// for 'P3-U7' — so the tag is not wrong, it is INVISIBLE, which is worse. One
// 28-item run lost 25 of 159 unit tags this way, and unit tags are exactly what
// the cross-paper reuse view is built on.
//
// Units and keywords are treated differently on purpose. A unit code IS a join
// key, so an unresolvable one is dropped and reported. A keyword is a tag, so an
// off-vocabulary one is kept and merely counted — losing "Federalism" because it
// is not in the seeded list would be worse than recording it.
//
// `drafted` records may carry `_articleId`. Where they do, the article is linked
// back to the item it produced and marked 'drafted'. That link is the whole
// point of Section 3, and it is set inside the same transaction as the insert so
// an article can never be marked drafted against an item that was rolled back.
function insertDrafted(db, { date, drafted = [], discarded = [], onLog = () => {} }) {
  const offVocabKeywords = new Set();
  const droppedUnits = [];
  const itemIds = [];

  const run = db.transaction(() => {
    let day = db.prepare('SELECT id FROM ca_days WHERE date = ?').get(date);
    if (!day) {
      const info = db.prepare(`INSERT INTO ca_days (date, status) VALUES (?, 'draft')`).run(date);
      day = { id: info.lastInsertRowid };
    }

    const insItem = db.prepare(
      `INSERT INTO ca_items (day_id, headline, event_date, bucket, subject_tag,
         notes_markdown, static_linkage, prelims_facts, g1_bank, g1_fact, g1_angle,
         g1_theme, g1_sub_theme, g1_why_news, g1_background, g1_ap_angle,
         g1_linked, g1_bridges, g1_way_forward,
         importance, relevance_g1, relevance_g2, needs_verify, verify_note,
         order_index, status)
       VALUES (@day_id, @headline, @event_date, @bucket, @subject_tag,
         @notes_markdown, @static_linkage, @prelims_facts, @g1_bank, @g1_fact, @g1_angle,
         @g1_theme, @g1_sub_theme, @g1_why_news, @g1_background, @g1_ap_angle,
         @g1_linked, @g1_bridges, @g1_way_forward,
         @importance, @relevance_g1, @relevance_g2, @needs_verify, @verify_note,
         @order_index, 'draft')`
    );
    const insKeyword = db.prepare(
      'INSERT OR IGNORE INTO ca_item_keywords (item_id, keyword) VALUES (?, ?)'
    );
    const insUnit = db.prepare(
      'INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)'
    );
    const insTheme = db.prepare(
      'INSERT OR IGNORE INTO ca_item_themes (item_id, theme) VALUES (?, ?)'
    );
    const insSource = db.prepare(
      `INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insDimension = db.prepare(
      'INSERT OR IGNORE INTO ca_item_dimensions (item_id, dimension, note) VALUES (?, ?, ?)'
    );
    const insEssay = db.prepare(
      'INSERT INTO ca_essay_questions (item_id, question, kind, note) VALUES (?, ?, ?, ?)'
    );
    const insMcq = db.prepare(
      `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
         correct_option, explanation, format, keyword, difficulty, fact_as_of)
       VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
         @correct_option, @explanation, @format, @keyword, @difficulty, @fact_as_of)`
    );
    const insDiscarded = db.prepare(
      `INSERT INTO ca_items (day_id, headline, bucket, status, discard_reason,
         relevance_g1, relevance_g2)
       VALUES (?, ?, 'national', 'discarded', ?, 0, 0)`
    );
    const linkArticle = db.prepare(
      `UPDATE np_articles SET item_id = ?, status = 'drafted', discard_reason = ''
        WHERE id = ?`
    );
    const discardArticle = db.prepare(
      `UPDATE np_articles SET status = 'discarded', discard_reason = ? WHERE id = ?`
    );

    const refUnits = new Set(
      db.prepare('SELECT unit_code FROM ref_units').all().map((r) => r.unit_code)
    );
    const refKeywords = new Set(
      db.prepare('SELECT keyword FROM ref_keywords').all().map((r) => r.keyword)
    );
    const unitOf = canonicaliser(refUnits);
    const keywordOf = canonicaliser(refKeywords);

    let order = db
      .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM ca_items WHERE day_id = ?')
      .get(day.id).m;

    for (const r of drafted) {
      normaliseTextFields(r);
      order += 1;
      const info = insItem.run({
        day_id: day.id,
        headline: r.headline,
        event_date: r.event_date || null,
        bucket: r.bucket || 'national',
        subject_tag: r.subject_tag || '',
        notes_markdown: r.notes_markdown || '',
        static_linkage: r.static_linkage || '',
        prelims_facts: r.prelims_facts || '',
        g1_bank: r.g1_bank || null,
        g1_fact: r.g1_fact || '',
        g1_angle: r.g1_angle || '',
        g1_theme: r.g1_theme || '',
        g1_sub_theme: r.g1_sub_theme || '',
        g1_why_news: r.g1_why_news || '',
        g1_background: r.g1_background || '',
        g1_ap_angle: r.g1_ap_angle || '',
        g1_linked: r.g1_linked || '',
        g1_bridges: r.g1_bridges || '',
        g1_way_forward: r.g1_way_forward || '',
        importance: Number(r.importance) || 2,
        relevance_g1: Number(r.relevance_g1) === 0 ? 0 : 1,
        relevance_g2: Number(r.relevance_g2) === 0 ? 0 : 1,
        needs_verify: Number(r.needs_verify) ? 1 : 0,
        verify_note: r.verify_note || '',
        order_index: order,
      });
      const itemId = info.lastInsertRowid;
      itemIds.push(itemId);

      for (const k of r.keywords || []) {
        const kw = keywordOf(k) || codeOf(k);
        if (!kw) continue;
        insKeyword.run(itemId, kw);
        if (!refKeywords.has(kw)) offVocabKeywords.add(kw);
      }
      for (const u of r.units || []) {
        const code = unitOf(u);
        if (code) insUnit.run(itemId, code);
        else if (String(u || '').trim()) droppedUnits.push(String(u).trim().slice(0, 70));
      }
      for (const t of r.themes || []) insTheme.run(itemId, String(t).toLowerCase());
      for (const s of r.sources || []) {
        if (!s || (!s.url && !s.publisher)) continue;
        insSource.run(itemId, s.url || '', s.publisher || '', s.is_primary ? 1 : 0,
          s.fetched_at || null);
      }
      for (const d of r.dimensions || []) {
        if (!DIMENSIONS.includes(String(d.dimension || '').toLowerCase())) continue;
        insDimension.run(itemId, String(d.dimension).toLowerCase(), String(d.note || ''));
      }
      for (const q of r.essay_questions || []) {
        const text = String(q.question || '').trim();
        if (!text) continue;
        insEssay.run(itemId, text, q.kind === 'indirect' ? 'indirect' : 'direct',
          String(q.note || ''));
      }
      for (const m of r.mcqs || []) {
        insMcq.run({
          item_id: itemId,
          question: m.question,
          option_a: m.option_a,
          option_b: m.option_b,
          option_c: m.option_c,
          option_d: m.option_d,
          correct_option: m.correct_option,
          explanation: m.explanation || '',
          format: m.format || 'direct_recall',
          keyword: m.keyword || '',
          difficulty: Number(m.difficulty) || 2,
          fact_as_of: m.fact_as_of || null,
        });
      }

      if (r._articleId) linkArticle.run(itemId, r._articleId);
    }

    // Discards are rows, not deletions. A run that discards nothing has stopped
    // filtering, and that is only visible if the rejections are recorded.
    for (const d of discarded) {
      if (d._articleId) discardArticle.run(d.discard_reason || '', d._articleId);
      // A discarded print article does not need a placeholder ca_item — the
      // np_articles row already carries the rejection and its reason, which is
      // more provenance than the web lane's placeholder ever had.
      else insDiscarded.run(day.id, d.headline || '(untitled candidate)', d.discard_reason || '');
    }
  });

  run();

  if (droppedUnits.length) {
    const counts = new Map();
    for (const u of droppedUnits) counts.set(u, (counts.get(u) || 0) + 1);
    onLog(`${droppedUnits.length} unit tag(s) dropped as unresolvable against ref_units:`);
    for (const [u, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      onLog(`   ${n}x ${u}`);
    }
    onLog('   (a code nothing can match is not a tag; fix the drafting prompt if this recurs)');
  }
  if (offVocabKeywords.size) {
    onLog(`${offVocabKeywords.size} keyword(s) outside ref_keywords, kept as free tags:`);
    onLog(`   ${[...offVocabKeywords].slice(0, 10).join(', ')}`);
  }

  return { itemIds, offVocabKeywords: [...offVocabKeywords], droppedUnits };
}

// ---------------------------------------------------------------------------
// MCQ generation
// ---------------------------------------------------------------------------

// Weighted to the formats that suit current-affairs facts — single events,
// several claims about one event, natural pairings — while cycling in
// assertion-reason and negative-statement, which the real paper leans on
// heavily and which are where marks are actually lost. A bank served as 90%
// plain recall trains the wrong reflex.
//
// This is only the FALLBACK. Where the PYQ layer has evidence for a keyword,
// what APPSC actually asked beats what seems reasonable.
const FORMAT_CYCLE = [
  'direct_recall',
  'multi_statement',
  'list_matching',
  'assertion_reason',
  'direct_recall',
  'negative_statement',
  'multi_statement',
  'statement_based',
  'list_matching',
  'count_based',
];

function formatsFor(index, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(FORMAT_CYCLE[(index * n + i) % FORMAT_CYCLE.length]);
  return out;
}

// PYQ-driven format selection, with the rotation as the fallback.
//
// The keyword chosen is the item's first, which is the drafting prompt's primary
// angle. Blending the distributions of four keywords at once would produce a
// mush that matches none of them; imitating the primary angle is both simpler
// and closer to how a paper-setter works.
//
// WHY `db` AND `onLog` ARE PARAMETERS
//
// Because the previous version reached for both from an enclosing scope it did
// not have. It called a `say()` defined inside run.js's `main()` from module
// scope, so the moment `plan.source === 'pyq'` — that is, exactly when the PYQ
// layer HAD evidence — it threw a ReferenceError straight into the catch below,
// which returned the rotation. Measured on the live database: keyword "Scheme"
// has 52 questions of usable evidence wanting
// [direct_recall, direct_recall, direct_recall, negative_statement], and every
// item silently received the rotation instead.
//
// So the whole PYQ format engine was inert, and inert in the quietest possible
// way: the fallback is a legitimate answer, so nothing ever looked wrong. Both
// dependencies are now passed in, where a missing one is a TypeError at the
// call site rather than a swallowed miss.
function plannedFormatsFor(db, record, index, n, onLog = () => {}) {
  const fallback = formatsFor(index, n);
  const keyword = (record.keywords || [])[0];
  if (!keyword) return fallback;

  let pyq;
  try {
    pyq = require('./pyq');
  } catch {
    // The PYQ tables may not exist in an older database. A missing evidence
    // base is a reason to fall back, not to fail a run.
    return fallback;
  }

  const plan = pyq.plannedFormats(db, keyword, n, fallback);
  // Reported rather than silently applied: "these formats came from 52 real
  // questions" and "these came from a rotation" are very different claims about
  // a practice paper, and the difference belongs in the run log.
  if (plan.source === 'pyq') {
    onLog(`      formats from ${plan.evidence} PYQ(s) on "${keyword}": ${plan.formats.join(', ')}`);
  }
  return plan.formats;
}

// Generates the questions for one drafted item, in the formats the PYQ evidence
// asks for. Returns the accepted MCQs; never throws, because an item without
// questions is still worth filing and a failed generation must not cost the
// drafting that was already paid for.
//
// `seenHashes` is shared across a whole run and mutated here, which is what
// stops the same question being generated twice from two related articles.
async function generateMcqs(
  db,
  { record, index, count = 4, model, mcqPrompt, seenHashes, fallbackDate, onLog = () => {} }
) {
  const { validateMcq } = L.serverValidators();
  const wanted = plannedFormatsFor(db, record, index, count, onLog);

  const brief = [
    `NOTES:\n${record.notes_markdown || ''}`,
    `PRELIMS FACTS:\n${record.prelims_facts || ''}`,
    `KEYWORD ANGLES: ${(record.keywords || []).join(', ')}`,
    `FACTS TRUE AS OF: ${record.event_date || fallbackDate}`,
    '',
    `Write exactly ${wanted.length} questions, in these formats, in this order:`,
    ...wanted.map((f, i) => `${i + 1}. ${f}`),
  ].join('\n');

  const out = [];
  try {
    const raw = await L.complete({ system: mcqPrompt, user: brief, model });
    const list = L.parseJson(raw, { array: true });
    for (const m of list) {
      const errors = validateMcq(m);
      if (errors.length) {
        onLog(`    dropped a question — ${errors.join(' ')}`);
        continue;
      }
      const hash = L.questionHash(m.question);
      if (seenHashes && seenHashes.has(hash)) {
        onLog('    dropped a duplicate question');
        continue;
      }
      if (seenHashes) seenHashes.add(hash);
      out.push({ ...m, fact_as_of: m.fact_as_of || record.event_date || fallbackDate });
    }
  } catch (e) {
    onLog(`    MCQ generation failed (${e.message}) — item kept without questions`);
  }
  return out;
}

module.exports = {
  DIMENSIONS,
  PRINT_ADDENDUM,
  FORMAT_CYCLE,
  findingsFor,
  sourceTextFor,
  draftArticle,
  normaliseTextFields,
  toText,
  insertDrafted,
  formatsFor,
  plannedFormatsFor,
  generateMcqs,
};
