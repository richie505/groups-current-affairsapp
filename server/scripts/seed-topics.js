#!/usr/bin/env node
'use strict';

// Seeds the curated topic vocabulary, then rebuilds the derived tables.
//
//   node server/scripts/seed-topics.js            # seed + link + report
//   node server/scripts/seed-topics.js --report   # report only, no writes
//   node server/scripts/seed-topics.js --relink   # rebuild derived tables only
//
// Safe to re-run. Topics are upserted by slug and aliases by (topic, norm), so
// editing topic-data.js and re-running is the intended way to improve the
// vocabulary. The derived tables are rebuilt from scratch every time, which is
// what makes that safe.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));
const { TOPICS, LINKS } = require('./topic-data');

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const relinkOnly = args.includes('--relink');
const topicFlag = args.indexOf('--topic');
const wantTopic = topicFlag !== -1 ? args[topicFlag + 1] : null;

function seed() {
  const upsertTopic = db.prepare(
    `INSERT INTO topics (slug, name, kind, ap, tier, summary)
     VALUES (@slug, @name, @kind, @ap, @tier, @summary)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, ap = excluded.ap,
       tier = excluded.tier, summary = excluded.summary,
       updated_at = datetime('now')`
  );
  const idOf = db.prepare('SELECT id FROM topics WHERE slug = ?');
  const insAlias = db.prepare(
    `INSERT OR REPLACE INTO topic_aliases (topic_id, alias, norm, lang, strict)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insLink = db.prepare(
    'INSERT OR IGNORE INTO topic_links (a_id, b_id, relation) VALUES (?, ?, ?)'
  );

  let topics = 0;
  let aliases = 0;
  let links = 0;
  let pruned = 0;

  db.transaction(() => {
    for (const t of TOPICS) {
      upsertTopic.run({
        slug: t.slug, name: t.name, kind: t.kind,
        ap: t.ap ? 1 : 0, tier: t.tier ?? 3, summary: t.summary || '',
      });
      const id = idOf.get(t.slug).id;
      topics++;

      // The name itself is always an alias. Forgetting this is the obvious way
      // to seed a topic that cannot match the article that named it in full.
      const list = [{ alias: t.name, strict: false }, ...(t.aliases || [])].map((a) =>
        typeof a === 'string' ? { alias: a, strict: false } : a
      );

      const keep = [];
      for (const a of list) {
        const n = T.norm(a.alias);
        if (!n) continue;
        insAlias.run(id, a.alias, n, a.lang || (/[^\x00-\x7F]/.test(a.alias) ? 'te' : 'en'), a.strict ? 1 : 0);
        keep.push(n);
        aliases++;
      }

      // Prune aliases no longer present in topic-data.js, which makes that file
      // authoritative rather than merely additive.
      //
      // This is not tidiness. Upserting alone meant that DELETING a bad alias
      // from the source had no effect on the database: 'Tirupati' was removed
      // from the TTD topic because it names a city rather than the trust, the
      // seed was re-run, and it carried on matching from the stale row. An alias
      // list that cannot shrink is one that cannot be corrected.
      if (keep.length) {
        const holes = keep.map(() => '?').join(',');
        pruned += db
          .prepare(`DELETE FROM topic_aliases WHERE topic_id = ? AND norm NOT IN (${holes})`)
          .run(id, ...keep).changes;
      }
    }

    for (const [a, b, relation] of LINKS) {
      const ra = idOf.get(a);
      const rb = idOf.get(b);
      if (!ra || !rb) {
        console.error(`  ! link skipped, unknown slug: ${a} -> ${b}`);
        continue;
      }
      insLink.run(ra.id, rb.id, relation);
      links++;
    }
  })();

  return { topics, aliases, links, pruned };
}

function report() {
  const map = T.reuseMap(db, { minPapers: 2 });
  const cold = T.coldTopics(db);

  console.log('\n=== CROSS-PAPER REUSE MAP ===');
  console.log('   topics whose items already span two or more papers\n');
  console.log('   AP  TIER  ITEMS  PAPERS                TOPIC');
  for (const r of map) {
    console.log(
      `   %s   T%d    %-5d  %-20s  %s`
        .replace('%s', r.ap ? 'AP' : '  ')
        .replace('%d', r.tier)
        .replace('%-5d', String(r.items).padEnd(5))
        .replace('%-20s', r.paperList.join(',').padEnd(20))
        .replace('%s', r.name)
    );
  }
  if (!map.length) console.log('   (none yet)');

  console.log(`\n=== STANDING GAPS: ${cold.length} seeded topic(s) with no item yet ===`);
  const apCold = cold.filter((c) => c.ap);
  if (apCold.length) {
    console.log('   Andhra Pradesh (these are the expensive ones to be missing):');
    for (const c of apCold) console.log(`      T${c.tier}  ${c.name}`);
  }
  const other = cold.filter((c) => !c.ap);
  if (other.length) {
    console.log('   National / other:');
    for (const c of other) console.log(`      T${c.tier}  ${c.name}`);
  }
}

// The dossier: everything known about one topic, and which papers it serves.
// This is what the whole layer exists to make answerable.
function dossier(slug) {
  const d = T.topicDossier(db, slug);
  if (!d) {
    console.error(`No topic with slug '${slug}'.`);
    const all = db.prepare('SELECT slug FROM topics ORDER BY slug').all().map((r) => r.slug);
    console.error(`\nKnown slugs:\n  ${all.join('\n  ')}`);
    process.exit(1);
  }
  const { topic, items, units, papers, related } = d;
  console.log(`
=== ${topic.name} ===`);
  console.log(`    ${topic.ap ? 'ANDHRA PRADESH · ' : ''}${topic.kind} · tier ${topic.tier}`);
  if (topic.summary) console.log(`
    ${topic.summary}`);

  console.log(`
--- serves ${papers.length} paper(s): ${papers.join(', ') || 'none yet'}`);
  for (const u of units) {
    console.log(`    ${String(u.unit_code).padEnd(8)} x${u.weight}  ${(u.label || '').slice(0, 58)}`);
  }

  console.log(`
--- ${items.length} item(s)`);
  for (const it of items) {
    console.log(`    ${it.in_headline ? 'ABOUT' : 'ment.'}  ${it.date}  [${it.bucket}] ${it.headline.slice(0, 62)}`);
    if (it.in_headline && it.g1_angle) console.log(`           angle: ${it.g1_angle.slice(0, 96)}`);
  }

  if (related.length) {
    console.log(`
--- related topics`);
    for (const r of related) console.log(`    ${r.relation.padEnd(10)} ${r.name}`);
  }
  console.log();
}

function main() {
  if (wantTopic) {
    dossier(wantTopic);
    return;
  }
  if (!reportOnly && !relinkOnly) {
    const s = seed();
    console.log(
      `Seeded ${s.topics} topics, ${s.aliases} aliases, ${s.links} links` +
      `${s.pruned ? `; pruned ${s.pruned} stale alias(es)` : ''}.`
    );
  }

  if (!reportOnly) {
    const r = T.rebuild(db);
    console.log(
      `\nLinked: ${r.matches} item-topic match(es) across ${r.topics} topic(s) ` +
      `from ${r.items} item(s); ${r.units} derived topic-unit pairing(s).`
    );
    if (r.unmatched.length) {
      console.log(`\n${r.unmatched.length} item(s) matched no topic at all:`);
      for (const u of r.unmatched) console.log(`   #${u.id} ${u.headline.slice(0, 76)}`);
      console.log('   (each is either genuinely off-syllabus, or a missing alias in topic-data.js)');
    }
  }

  report();
}

main();
