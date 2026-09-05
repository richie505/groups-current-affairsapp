#!/usr/bin/env node
'use strict';

// Where the alias vocabulary is thin, what the syllabus names that it does not,
// and which rows are broken rather than merely quiet.
//
//   node server/scripts/syllabus-vocabulary-audit.js [--out docs/audits/<file>.md]
//
// Three questions, in the order they are worth asking.
//
//   1. PER-UNIT COVERAGE. How many aliases does each unit have, and how many of
//      them have ever earned a tag? A unit with forty aliases and one hit is a
//      different problem from a unit with three aliases.
//
//   2. WHAT THE SYLLABUS NAMES AND THE MAP DOES NOT. Candidate terms lifted
//      from ref_units.syllabus_text — the commission's own words — that are not
//      aliases, RANKED BY CORPUS HITS. Ranking matters: the syllabus names
//      hundreds of things, most of which no newspaper will print this year, and
//      the ones worth adding are the ones the paper is already using.
//
//   3. BROKEN ROWS. An alias that CANNOT match, as opposed to one that has not
//      had the chance. `disabilit` was in this table for months: `\bdisabilit\b`
//      can never match "disability", because t and y are both word characters
//      and there is no boundary between them to anchor on. The test below finds
//      that class by construction rather than by noticing.
//
// Nothing here is a decision. It prints; a person rules.

const fs = require('fs');
const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const out = argOf('out', null);

const units = db
  .prepare(
    `SELECT unit_code, paper, exam, label, COALESCE(syllabus_text, '') AS syllabus
       FROM ref_units WHERE broad = 0 AND unfeedable = 0 AND format = 'objective'
      ORDER BY exam, unit_code`
  )
  .all();

const aliases = db
  .prepare(
    `SELECT unit_code, alias, strict, COALESCE(standalone,0) solo, provenance, first_hit_at
       FROM ref_unit_aliases`
  )
  .all();

const articles = db
  .prepare(`SELECT headline, standfirst, body FROM np_articles WHERE body IS NOT NULL`)
  .all()
  .map((a) => `${a.headline || ''} ${a.standfirst || ''} ${a.body || ''}`);
const normArticles = articles.map((t) => T.norm(t));

const corpusHits = (term, strict) => {
  const m = T.aliasMatcher(term, !!strict, true);
  let n = 0;
  for (let i = 0; i < articles.length; i++) if (m.test(articles[i], normArticles[i])) n++;
  return n;
};

// ---------------------------------------------------------------------------
// 1. per-unit coverage
// ---------------------------------------------------------------------------
const byUnit = new Map(units.map((u) => [u.unit_code, { ...u, aliases: [], fired: 0 }]));
for (const a of aliases) {
  const u = byUnit.get(a.unit_code);
  if (!u) continue;
  u.aliases.push(a);
  if (a.first_hit_at) u.fired += 1;
}

// ---------------------------------------------------------------------------
// 2. syllabus terms the map does not carry
// ---------------------------------------------------------------------------
// A CANDIDATE HAS TO LOOK LIKE A TOPIC, NOT LIKE PROSE.
//
// The first run of this ranked `government` (119 hits), `against` (98), `since`
// (60) and `based` (45) at the top, because a syllabus is written in sentences
// and every sentence is mostly connective tissue. Ranking by corpus hits then
// ranks by how common the English is, which is exactly backwards: the commonest
// words are the ones that would make the worst aliases.
//
// Tightening the stopword list was not enough. `Party`, `States`, `Family`,
// `Delhi`, `Justice`, `Commission`, `Money`, `Science` all survived it, because
// a syllabus capitalises the first word of every sentence and capitalisation is
// therefore not the proper-noun signal it looks like.
//
// So candidates are PHRASES ONLY, two or three words. The cost is that a
// genuine one-word gap is invisible here — but a single word specific enough to
// be worth adding is almost always already an alias or already inside one of
// these phrases, and a list whose top thirty rows are noise does not get read.
const STOP = new Set(
  ('the a an and or of in on for to with its their this that these those from by as at is are was ' +
    'were be been being it he she they we you i not no nor but if then than so such other others ' +
    'recent important major basic general various different including etc into over under between ' +
    'about across during after before while where when which who whom whose what why how all any ' +
    'each every both few more most some own same very can will just also his her our your one two ' +
    'three four five issues issue role impact features aspects concept concepts nature scope types ' +
    'kind kinds part parts area areas level levels system systems structure growth development ' +
    'india indian state states national government public private central union local social ' +
    'political economic against since based world through within without along among behind ' +
    'special significant related current modern early late main key new old high low large small ' +
    'programmes programme schemes scheme policies policy measures reforms reform problems problem ' +
    'challenges challenge causes consequences significance origin functions function powers power ' +
    'rights right duties duty conditions condition patterns pattern trends trend needs need use ' +
    'used uses making made make given give taken take year years time times case cases ' +
    'andhra pradesh india’s state’s')
    .split(/\s+/)
);

// Words that make a phrase generic however long it is.
const WEAK_HEAD = new Set(['the', 'and', 'of', 'in', 'for', 'to', 'with', 'its', 'a', 'an']);

const knownAlias = new Set(aliases.map((a) => a.alias.toLowerCase()));

const candidates = new Map(); // term -> Set(unit_code)
for (const u of units) {
  const words = u.syllabus
    .replace(/[—–]/g, ' ')
    .split(/[^A-Za-z0-9'’.-]+/)
    .filter(Boolean);
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      if (slice.some((w) => STOP.has(w.toLowerCase()))) continue;
      const term = slice.join(' ').replace(/[.,;]$/, '');
      if (term.length < 5 || term.length > 42) continue;
      if (/^\d+$/.test(term)) continue;
      if (WEAK_HEAD.has(slice[0].toLowerCase())) continue;
      const key = term.toLowerCase();
      if (knownAlias.has(key)) continue;
      if (!candidates.has(key)) candidates.set(key, { term, units: new Set() });
      candidates.get(key).units.add(u.unit_code);
    }
  }
}

const uncovered = [];
for (const { term, units: us } of candidates.values()) {
  const n = corpusHits(term, false);
  if (n > 0) uncovered.push({ term, units: [...us], hits: n });
}
uncovered.sort((a, b) => b.hits - a.hits || a.term.localeCompare(b.term));

// ---------------------------------------------------------------------------
// 3. broken rows
// ---------------------------------------------------------------------------
// The `disabilit` test: the alias matches nothing, but the alias plus a common
// English ending matches something. That is the signature of a stem typed where
// a word belongs — \b anchors at the end of the alias, and there is no word
// boundary in the middle of a word.
const ENDINGS = ['y', 'ies', 'ation', 'ations', 'ing', 'ed', 'es', 'e', 'al', 'ic', 'ity'];
const broken = [];
const silentAlias = [];
const seenAlias = new Set();
for (const a of aliases) {
  if (seenAlias.has(a.alias)) continue;
  seenAlias.add(a.alias);
  const own = corpusHits(a.alias, a.strict);
  if (own > 0) continue;
  const grown = ENDINGS.map((e) => ({ e, n: corpusHits(a.alias + e, a.strict) })).filter((x) => x.n);
  if (grown.length) {
    broken.push({ alias: a.alias, unit: a.unit_code, suggest: `${a.alias}${grown[0].e}`, hits: grown[0].n });
  } else {
    silentAlias.push(a.alias);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const L = [];
const say = (s = '') => L.push(s);
const editions = db.prepare('SELECT COUNT(*) AS n FROM np_editions').get().n;

say('# Syllabus vocabulary audit');
say('');
say(`Generated by \`server/scripts/syllabus-vocabulary-audit.js\` over ${articles.length} articles`);
say(`from ${editions} edition(s). Nothing here is a decision — it is the list to rule on.`);
say('');
say('## 1. Per-unit alias coverage');
say('');
say('`fired` counts aliases that have earned at least one surviving tag. A unit with');
say('many aliases and none fired is untested, not broken — see');
say('`docs/notes/alias-review-principles.md`.');
say('');
say('| unit | paper | aliases | fired | label |');
say('|---|---|---|---|---|');
for (const u of [...byUnit.values()].sort((a, b) => a.aliases.length - b.aliases.length)) {
  say(`| \`${u.unit_code}\` | ${u.paper} | ${u.aliases.length} | ${u.fired} | ${u.label.slice(0, 58)} |`);
}
say('');
say('## 2. Syllabus terms the map does not carry, ranked by corpus hits');
say('');
say('Lifted from `ref_units.syllabus_text` — the commission\'s own words — minus');
say('everything already an alias. Only terms the corpus actually contains are listed;');
say('a term the paper never prints is not a gap worth filling this month.');
say('');
say(`${uncovered.length} candidate term(s) appear in at least one article.`);
say('');
say('| term | corpus hits | named in |');
say('|---|---|---|');
for (const c of uncovered.slice(0, 120)) {
  say(`| ${c.term} | ${c.hits} | ${c.units.map((u) => `\`${u}\``).join(' ')} |`);
}
if (uncovered.length > 120) say(`\n…and ${uncovered.length - 120} more with fewer hits.`);
say('');
say('## 3. Broken rows');
say('');
say('An alias that matches nothing, where the alias PLUS a common ending matches');
say('something. That is a stem typed where a word belongs: `\\b` anchors at the end of');
say('the alias and there is no word boundary inside a word, so the row can never fire.');
say('');
if (!broken.length) {
  say('None. (`disabilit` and `decentralis` were the two known cases and both are fixed.)');
} else {
  say('| alias | on | probably meant | its hits |');
  say('|---|---|---|---|');
  for (const b of broken) say(`| \`${b.alias}\` | \`${b.unit}\` | \`${b.suggest}\` | ${b.hits} |`);
}
say('');
say(`## 4. Aliases with no corpus match at all — ${silentAlias.length}`);
say('');
say('Not a defect list. These name things this corpus does not happen to discuss.');
say('');
say('```');
for (let i = 0; i < silentAlias.length; i += 6) say(silentAlias.slice(i, i + 6).join(' · '));
say('```');

const text = L.join('\n') + '\n';
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text, 'utf8');
  console.log(`Wrote ${out} — ${uncovered.length} uncovered term(s), ${broken.length} broken row(s), ${silentAlias.length} silent.`);
} else {
  console.log(text);
}
