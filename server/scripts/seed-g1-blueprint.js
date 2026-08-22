#!/usr/bin/env node
'use strict';

// Seeds Group-I recurrence evidence from the Mains blueprint's master study plan.
//
//   node server/scripts/seed-g1-blueprint.js --file <01-MASTER-STUDY-PLAN.md>
//   node server/scripts/seed-g1-blueprint.js --file ... --dry-run
//
// WHAT IT READS
//
//   Part 2  Tier 1 — 54 topics, each with its paper, unit and the recurrence
//           evidence observed across the 2023 and 2025 papers.
//   Part 3  The Master Reuse Map — triple-payers and double-payers, each with
//           the paper to STUDY it from and the papers it also answers.
//   Part 4  The Andhra Pradesh block — 11 clusters and the papers they serve.
//
// WHY THIS IS THE GROUP-I HALF OF THE PYQ LAYER
//
// Group-I Mains is written, not ticked, so counting question formats is
// meaningless for it. What matters is recurrence and cross-paper reuse, and this
// blueprint already measures both from the real papers. Loading it turns a
// document into queries: "which topics recur", "which pay across three papers",
// "what is the AP block", "which Tier-1 topics have no current-affairs item yet".
//
// Topics are matched to existing rows where the alias vocabulary already knows
// them, and created where it does not. Matching first matters: Polavaram and
// Amaravati are already topics carrying news items, and a second row for either
// would split the very history this layer exists to accumulate.

const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const dryRun = args.includes('--dry-run');
const file = fileFlag !== -1 ? args[fileFlag + 1] : null;

if (!file) {
  console.error('Usage: node server/scripts/seed-g1-blueprint.js --file <01-MASTER-STUDY-PLAN.md> [--dry-run]');
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const clean = (s) =>
  String(s || '')
    .replace(/\*\*/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ROMAN = { I: 'P1', II: 'P2', III: 'P3', IV: 'P4', V: 'P5' };

// "Paper III 10.4" -> P3 unit 10 ; "Paper V Unit 2" -> P5 unit 2 ;
// "II, IV, I" -> [P2, P4, P1]
function papersIn(s) {
  const out = [];
  const str = String(s || '');
  for (const m of str.matchAll(/\bPaper\s+(I|II|III|IV|V)\b/gi)) {
    out.push(ROMAN[m[1].toUpperCase()]);
  }
  if (!out.length) {
    // A bare roman list, as the AP block and the Tier-1 additions use.
    for (const m of str.matchAll(/\b(I|II|III|IV|V)\b/g)) out.push(ROMAN[m[1]]);
  }
  return [...new Set(out)];
}

// How many questions an evidence phrase represents. Written out because the
// number is what makes recurrence rankable and the phrasing is what makes it
// checkable — so both are stored.
function questionsFrom(evidence) {
  const e = String(evidence || '').toLowerCase();
  const digit = /(\d+)\s+(?:distinct\s+)?questions?/.exec(e);
  if (digit) return Number(digit[1]);
  if (/\bthree\b/.test(e)) return 3;
  if (/\bfour\b/.test(e)) return 4;
  if (/\bfive\b/.test(e)) return 5;
  if (/\btwice\b/.test(e)) return 2;
  if (/both years|both 2025 options|both\b/.test(e)) return 2;
  return 1;
}

function yearsFrom(evidence) {
  const ys = [...String(evidence || '').matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]);
  if (ys.length) return [...new Set(ys)].join(',');
  return /both years/i.test(evidence || '') ? '2023,2025' : '';
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

function sectionBetween(startRe, endRe) {
  const s = text.search(startRe);
  if (s === -1) return '';
  const rest = text.slice(s);
  const e = endRe ? rest.slice(1).search(endRe) : -1;
  return e === -1 ? rest : rest.slice(0, e + 1);
}

// Part 2: | # | Topic | Unit | Evidence |, grouped under "## Paper II — ..."
function parseTier1() {
  const part = sectionBetween(/^# PART 2 /m, /^# PART 3 /m);
  const out = [];
  let paper = '';
  for (const line of part.split('\n')) {
    const h2 = /^##\s+Paper\s+(I|II|III|IV|V)\b/i.exec(line);
    if (h2) {
      paper = ROMAN[h2[1].toUpperCase()];
      continue;
    }
    if (/^###/.test(line)) {
      paper = '';   // the additions table that follows has its own shape
      continue;
    }
    const m = /^\|\s*\**(\d+)\**\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/.exec(line);
    if (!m) continue;
    const [, n, topic, third, fourth] = m;

    if (paper) {
      out.push({
        n: Number(n), topic: clean(topic), paper,
        units: clean(third).split(',').map((u) => u.trim()).filter(Boolean),
        evidence: clean(fourth), kind: 'tier1',
      });
    } else {
      // The three post-2025 additions: third column is a paper list, not a unit.
      const papers = papersIn(clean(third));
      for (const p of papers) {
        out.push({
          n: Number(n), topic: clean(topic), paper: p, units: [],
          evidence: clean(fourth), kind: 'tier1',
          isAddition: true,
        });
      }
    }
  }
  return out;
}

// Part 3: | Topic | Study it from | Also answers |
function parseReuse() {
  const part = sectionBetween(/^# PART 3 /m, /^# PART 4 /m);
  const out = [];
  for (const line of part.split('\n')) {
    const m = /^\|\s*\**([^|]+?)\**\s*\|([^|]+?)\|([^|]+?)\|\s*$/.exec(line);
    if (!m) continue;
    const topic = clean(m[1]);
    if (!topic || /^topic$/i.test(topic) || /^-+$/.test(topic)) continue;
    const primary = papersIn(m[2]);
    const also = papersIn(m[3]);
    if (!primary.length && !also.length) continue;
    out.push({
      topic,
      primary: primary[0] || '',
      papers: [...new Set([...primary, ...also])],
      evidence: clean(m[3]),
      kind: 'reuse',
    });
  }
  return out;
}

// Part 4: | Cluster | Content | Papers served |
function parseApBlock() {
  const part = sectionBetween(/^# PART 4 /m, /^# PART 5 /m);
  const out = [];
  for (const line of part.split('\n')) {
    const m = /^\|\s*\**\s*(\d+)\.\s*([^|]+?)\**\s*\|([^|]+?)\|([^|]+?)\|\s*$/.exec(line);
    if (!m) continue;
    out.push({
      n: Number(m[1]),
      topic: clean(m[2]),
      content: clean(m[3]),
      papers: papersIn(m[4]),
      kind: 'ap-block',
    });
  }
  return out;
}

const tier1 = parseTier1();
const reuse = parseReuse();
const apBlock = parseApBlock();

console.log(`Parsed from ${path.basename(file)}:`);
console.log(`   Tier 1 rows      ${tier1.length}  (${new Set(tier1.map((t) => t.n)).size} distinct topics)`);
console.log(`   Reuse map rows   ${reuse.length}`);
console.log(`   AP block rows    ${apBlock.length}`);

// ---------------------------------------------------------------------------
// resolve each blueprint topic to a topics row
// ---------------------------------------------------------------------------

const aliases = T.loadAliases(db);

// Matching against the existing alias vocabulary FIRST. Creating a second
// 'Polavaram' or 'Amaravati' row would split the accumulated news history from
// the recurrence evidence, which is the one outcome this layer must avoid.
function resolve(label) {
  const matches = T.matchItem({ headline: label, notes_markdown: '' }, aliases)
    .sort((a, b) => b.hits - a.hits);
  return matches[0] || null;
}

// Creating a topic for a label the vocabulary does not know yet.
//
// Most of these will be new, and that is the point: the topic table was seeded
// from newspaper items, so it knows Polavaram and APCRDA but not "Indus Valley
// Civilization" or "Quasi-judicial authorities". The blueprint is the
// syllabus-level vocabulary, and loading it is what lets a future news item
// about, say, administrative tribunals find a home that already exists.
const AP_MARKERS = /\b(?:AP|A\.P\.|Andhra|Rayalaseema|Amaravati|Polavaram|APCNF|APPCB|APSDMA|Telugu|Vijayawada|Visakhapatnam|Tirupati)\b/i;

function slugify(label) {
  return clean(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// Aliases from the label's own parts. A blueprint label is often a cluster of
// several things ("Drought in Rayalaseema + drought types"), and the parts match
// real prose better than the whole label ever would.
//
// MULTI-WORD PARTS ONLY, and this is not a nicety. The first version accepted
// any part of five characters or more, which split "Christian missionaries —
// India and Andhra" into `India` and `Andhra` — and those two aliases promptly
// tagged fifteen unrelated news items as being about Christian missionaries.
// A one-word fragment of a cluster label is almost never a good alias: the
// genuinely useful single words (Polavaram, APCRDA, TTD) are in the curated
// vocabulary already, where they were chosen deliberately.
function aliasesFor(label) {
  const whole = clean(label);
  const parts = whole
    .split(/\s*(?:\+|;|—|–|,| and | vs\.? | & )\s*/i)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p.length >= 8 &&
        p.split(/\s+/).filter(Boolean).length >= 2 &&
        /[a-z]{4}/i.test(p)
    );
  return [...new Set([whole, ...parts])].slice(0, 6);
}

const upsertTopic = db.prepare(
  `INSERT INTO topics (slug, name, kind, ap, tier, summary)
   VALUES (@slug, @name, 'concept', @ap, @tier, @summary)
   ON CONFLICT(slug) DO UPDATE SET
     tier = MIN(topics.tier, excluded.tier), updated_at = datetime('now')`
);
const insAlias = db.prepare(
  `INSERT OR IGNORE INTO topic_aliases (topic_id, alias, norm, lang, strict)
   VALUES (?, ?, ?, 'en', 0)`
);

const created = new Map();
function createTopic(label, tier) {
  const slug = slugify(label);
  if (created.has(slug)) return created.get(slug);
  if (!dryRun) {
    upsertTopic.run({
      slug, name: clean(label), ap: AP_MARKERS.test(label) ? 1 : 0,
      tier: tier || 2,
      summary: 'Seeded from the Group-I Mains blueprint.',
    });
  }
  const row = db.prepare('SELECT id FROM topics WHERE slug = ?').get(slug);
  const id = row ? row.id : null;
  if (id && !dryRun) {
    for (const a of aliasesFor(label)) insAlias.run(id, a, T.norm(a));
  }
  created.set(slug, id);
  return id;
}

const resolved = [];
const unresolved = [];
for (const row of [...tier1, ...reuse, ...apBlock]) {
  const hit = resolve(row.topic);
  if (hit) resolved.push({ ...row, topic_id: hit.topic_id, matched: hit.slug });
  else unresolved.push(row);
}

console.log(`\nMatched to existing topics: ${resolved.length}`);
console.log(`Unmatched (would need a new topic row): ${unresolved.length}`);
if (unresolved.length) {
  const names = [...new Set(unresolved.map((u) => u.topic))];
  console.log('   first 18 unmatched labels:');
  for (const n of names.slice(0, 18)) console.log(`      ${n.slice(0, 74)}`);
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// Create the missing topics, then treat them exactly like the matched ones.
for (const row of unresolved) {
  const id = createTopic(row.topic, row.kind === 'tier1' ? 1 : 2);
  if (id) resolved.push({ ...row, topic_id: id, matched: '(created)' });
}
console.log(`Created ${created.size} new topic(s) from the blueprint.`);

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

const insEv = db.prepare(
  `INSERT OR REPLACE INTO topic_evidence
     (topic_id, exam, paper, unit, questions, years, evidence, is_primary, kind, source)
   VALUES (@topic_id, 'group1', @paper, @unit, @questions, @years, @evidence, @is_primary, @kind, 'g1-blueprint')`
);
// NOTE: paper-level reach is NOT written to topic_units.
//
// The first version inserted 'P2', 'P3', 'P4' into topic_units.unit_code, and
// only 'P1' happens to be a real code in ref_units — so those rows joined to
// nothing and a topic whose evidence spanned four papers reported serving one.
// The same fault as unit codes echoed from a vocabulary line: a code nothing can
// match is not a tag. Paper reach lives in topic_evidence.paper, which is what
// the dossier now reads.
const bumpTier = db.prepare(
  `UPDATE topics SET tier = MIN(tier, ?), updated_at = datetime('now') WHERE id = ?`
);

let ev = 0;
let units = 0;
let tiered = 0;

db.transaction(() => {
  for (const r of resolved) {
    if (r.kind === 'tier1') {
      const q = questionsFrom(r.evidence);
      insEv.run({
        topic_id: r.topic_id, paper: r.paper,
        unit: (r.units || []).join(','),
        questions: q, years: yearsFrom(r.evidence),
        evidence: r.evidence, is_primary: 1, kind: 'tier1',
      });
      ev++;
      // A Tier-1 topic in the blueprint is Tier 1 here. MIN() so that a topic
      // already judged Tier 1 is never demoted by a later row.
      tiered += bumpTier.run(1, r.topic_id).changes;
    } else if (r.kind === 'reuse') {
      for (const p of r.papers) {
        insEv.run({
          topic_id: r.topic_id, paper: p, unit: '',
          questions: questionsFrom(r.evidence), years: '',
          evidence: r.evidence, is_primary: p === r.primary ? 1 : 0, kind: 'reuse',
        });
        ev++;
      }
    } else {
      for (const p of r.papers) {
        insEv.run({
          topic_id: r.topic_id, paper: p, unit: '',
          questions: 1, years: '', evidence: r.content || '',
          is_primary: 0, kind: 'ap-block',
        });
        ev++;
      }
    }
  }
})();

console.log(`\nStored ${ev} evidence row(s), ${units} manual topic-unit pairing(s), promoted ${tiered} topic(s) to tier 1.`);

// ---- the payoff ----

const recur = db
  .prepare(
    `SELECT t.name, t.ap, SUM(e.questions) AS q,
            COUNT(DISTINCT e.paper) AS papers,
            GROUP_CONCAT(DISTINCT e.paper) AS paper_list
       FROM topic_evidence e JOIN topics t ON t.id = e.topic_id
      WHERE e.exam = 'group1'
      GROUP BY t.id
      ORDER BY papers DESC, q DESC
      LIMIT 14`
  )
  .all();

console.log('\n=== GROUP-I RECURRENCE, most cross-paper first ===');
console.log('   AP  PAPERS               Qs  TOPIC');
for (const r of recur) {
  const papers = [...new Set(String(r.paper_list || '').split(','))].sort().join(',');
  console.log(
    `   ${r.ap ? 'AP' : '  '}  ${papers.padEnd(20)} ${String(r.q).padStart(3)}  ${r.name}`
  );
}
