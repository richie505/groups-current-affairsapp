'use strict';

// The topic layer: matching items to master topics, and deriving the
// cross-paper reuse map from what the matches reveal.
//
// WHY MATCHING IS DONE WITH ALIASES AND NOT A MODEL
//
// Because it has to be rebuildable and explainable. `topic_items` and
// `topic_units` are derived tables: the matcher will improve, and when it does
// the right move is to throw both away and rebuild. That is only affordable if
// rebuilding is free, which rules out a model call per item per topic.
//
// It is also the more honest tool for the job. "Does this item mention APCRDA"
// is a lookup, not a judgement, and a lookup that can be traced to the exact
// alias it matched can be corrected by editing one row. A model verdict cannot.
//
// The one thing this cannot do is recognise a topic that is discussed without
// being named. That is a real limit, and the answer is to add the alias rather
// than to reach for a model.

// ---------------------------------------------------------------------------
// normalisation and matching
// ---------------------------------------------------------------------------

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A strict alias is matched exactly as printed, case-sensitively, on word
// boundaries. These are the short acronyms - HAM, TTD, CAA, SC - where a loose
// match would fire inside unrelated words or on ordinary prose.
//
// A non-strict alias is matched case-insensitively, still on word boundaries.
// Word boundaries matter even here: without them 'mayor' matches nothing useful
// in isolation but 'FTA' would match inside 'aftantecedent'.
function aliasMatcher(alias, strict) {
  const body = escapeRe(strict ? alias : norm(alias));
  // \b does not work against a non-ASCII script, so Telugu aliases fall back to
  // a plain containment test. Telugu has no case, so nothing is lost.
  const nonAscii = /[^\x00-\x7F]/.test(alias);
  if (nonAscii) {
    return { test: (haystackRaw, haystackNorm) => haystackNorm.includes(norm(alias)) };
  }
  const re = new RegExp(`\\b${body}\\b`, strict ? 'g' : 'gi');
  return {
    test: (haystackRaw, haystackNorm) => {
      re.lastIndex = 0;
      return re.test(strict ? haystackRaw : haystackNorm);
    },
    count: (haystackRaw, haystackNorm) => {
      const target = strict ? haystackRaw : haystackNorm;
      re.lastIndex = 0;
      let n = 0;
      while (re.exec(target) !== null) n++;
      return n;
    },
  };
}

function loadAliases(db) {
  const rows = db
    .prepare(
      `SELECT a.topic_id, a.alias, a.strict, t.slug, t.name
         FROM topic_aliases a JOIN topics t ON t.id = a.topic_id`
    )
    .all();
  return rows.map((r) => ({ ...r, matcher: aliasMatcher(r.alias, !!r.strict) }));
}

// The text of an item, split into the part that decides what it is ABOUT and
// the part that merely mentions things.
function itemText(item) {
  const head = [item.headline, item.g1_theme, item.g1_sub_theme].filter(Boolean).join(' \n ');
  const body = [
    item.notes_markdown, item.prelims_facts, item.static_linkage,
    item.g1_fact, item.g1_angle, item.g1_why_news, item.g1_background,
    item.g1_ap_angle, item.g1_linked, item.g1_bridges, item.g1_way_forward,
  ]
    .filter(Boolean)
    .join(' \n ');
  return { head, body, headNorm: norm(head), bodyNorm: norm(body) };
}

/**
 * Matches one item against every alias. Returns one entry per topic, not per
 * alias, because an item naming "APCRDA" and "Capital Region Development
 * Authority" has mentioned one topic twice, not two topics once.
 */
function matchItem(item, aliases) {
  const { head, body, headNorm, bodyNorm } = itemText(item);
  const byTopic = new Map();

  for (const a of aliases) {
    const inHead = a.matcher.test(head, headNorm);
    const inBody = a.matcher.test(body, bodyNorm);
    if (!inHead && !inBody) continue;

    const hits =
      (a.matcher.count ? a.matcher.count(head, headNorm) + a.matcher.count(body, bodyNorm) : 1) || 1;

    const prev = byTopic.get(a.topic_id);
    if (prev) {
      prev.hits += hits;
      prev.in_headline = prev.in_headline || inHead ? 1 : 0;
      if (inHead && !prev.matchedInHead) {
        prev.matched = a.alias;
        prev.matchedInHead = true;
      }
    } else {
      byTopic.set(a.topic_id, {
        topic_id: a.topic_id,
        slug: a.slug,
        name: a.name,
        hits,
        in_headline: inHead ? 1 : 0,
        matched: a.alias,
        matchedInHead: inHead,
      });
    }
  }
  return [...byTopic.values()];
}

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuilds `topic_items` and `topic_units` from scratch.
 *
 * Both are derived, so this truncates rather than merges. Merging would let a
 * stale match from an older alias list survive indefinitely with nothing to
 * reveal it, and the point of keeping these tables derived is that they can
 * always be made to agree with the current vocabulary.
 *
 * `onlyStatus` defaults to leaving discarded items out: a discarded item is a
 * record of a decision, not knowledge about a topic.
 */
function rebuild(db, { statuses = ['draft', 'published'], minHits = 1, minBodyHits = 2 } = {}) {
  const aliases = loadAliases(db);
  if (!aliases.length) return { topics: 0, items: 0, matches: 0, units: 0, unmatched: [] };

  const holes = statuses.map(() => '?').join(',');
  const items = db
    .prepare(`SELECT * FROM ca_items WHERE status IN (${holes})`)
    .all(...statuses);

  const insItem = db.prepare(
    `INSERT OR REPLACE INTO topic_items (topic_id, item_id, hits, in_headline, matched)
     VALUES (?, ?, ?, ?, ?)`
  );

  const unmatched = [];
  let matches = 0;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM topic_items').run();
    db.prepare("DELETE FROM topic_units WHERE source = 'derived'").run();

    for (const item of items) {
      // A topic named in the HEADLINE is what the item is about, and one hit is
      // enough. A topic that appears only in the body needs to appear more than
      // once: measured on real items, single-hit body matches were almost all
      // incidental - a generic phrase like 'urban infrastructure' or 'social
      // justice' brushing past in one clause - while genuine body coverage
      // repeats the name.
      const found = matchItem(item, aliases).filter((m) =>
        m.in_headline ? m.hits >= minHits : m.hits >= minBodyHits
      );
      if (!found.length) {
        unmatched.push({ id: item.id, headline: item.headline });
        continue;
      }
      for (const m of found) {
        insItem.run(m.topic_id, item.id, m.hits, m.in_headline, m.matched);
        matches++;
      }
    }

    // The cross-paper reuse map: a topic inherits the paper units of every item
    // that names it, weighted by how many items support the pairing. One item's
    // stray tag and a genuine recurring reuse must not look the same.
    // The NOT EXISTS clause protects manual pairings. Without it, INSERT OR
    // REPLACE collides on (topic_id, unit_code) and quietly rewrites an
    // authoritative row — one a person entered from the Group-I blueprint's
    // reuse map — as a derived one. Measured: a rebuild silently converted three
    // manual pairings on the first run after the blueprint was loaded.
    db.prepare(
      `INSERT OR REPLACE INTO topic_units (topic_id, unit_code, weight, source)
       SELECT ti.topic_id, iu.unit_code, COUNT(DISTINCT ti.item_id), 'derived'
         FROM topic_items ti
         JOIN ca_item_units iu ON iu.item_id = ti.item_id
        WHERE NOT EXISTS (
                SELECT 1 FROM topic_units m
                 WHERE m.topic_id = ti.topic_id
                   AND m.unit_code = iu.unit_code
                   AND m.source = 'manual')
        GROUP BY ti.topic_id, iu.unit_code`
    ).run();
  });
  run();

  return {
    topics: db.prepare('SELECT COUNT(DISTINCT topic_id) AS n FROM topic_items').get().n,
    items: items.length,
    matches,
    units: db.prepare("SELECT COUNT(*) AS n FROM topic_units WHERE source='derived'").get().n,
    unmatched,
  };
}

// ---------------------------------------------------------------------------
// queries: what the layer is for
// ---------------------------------------------------------------------------

/** Everything known about one topic, newest item first. */
function topicDossier(db, slug) {
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(slug);
  if (!topic) return null;

  const items = db
    .prepare(
      `SELECT i.id, i.headline, i.bucket, i.importance, i.status, i.g1_bank,
              i.g1_angle, d.date, ti.in_headline, ti.hits, ti.matched
         FROM topic_items ti
         JOIN ca_items i ON i.id = ti.item_id
         JOIN ca_days  d ON d.id = i.day_id
        WHERE ti.topic_id = ?
        ORDER BY ti.in_headline DESC, d.date DESC`
    )
    .all(topic.id);

  const units = db
    .prepare(
      `SELECT tu.unit_code, tu.weight, u.paper, u.label
         FROM topic_units tu LEFT JOIN ref_units u ON u.unit_code = tu.unit_code
        WHERE tu.topic_id = ?
        ORDER BY tu.weight DESC, tu.unit_code`
    )
    .all(topic.id);

  const related = db
    .prepare(
      `SELECT t.slug, t.name, l.relation FROM topic_links l
         JOIN topics t ON t.id = CASE WHEN l.a_id = ? THEN l.b_id ELSE l.a_id END
        WHERE l.a_id = ? OR l.b_id = ?`
    )
    .all(topic.id, topic.id, topic.id);

  // Paper reach comes from two places, and needs both. `topic_units` gives the
  // papers implied by the units of news items that mention the topic; the
  // Group-I blueprint gives the papers a person observed it being asked in.
  // Reading only the first reported Polavaram as serving one paper when the
  // blueprint had it in four.
  const evidencePapers = (() => {
    try {
      return db
        .prepare('SELECT DISTINCT paper FROM topic_evidence WHERE topic_id = ? AND paper <> \'\'')
        .all(topic.id)
        .map((r) => r.paper);
    } catch {
      return [];
    }
  })();
  const papers = [
    ...new Set([...units.map((u) => u.paper).filter(Boolean), ...evidencePapers]),
  ].sort();

  // What the commission has actually asked. This is the join that makes a topic
  // page worth opening: the news history and the exam history side by side, so
  // "is this worth my time" stops being a guess.
  let evidence = [];
  let pyq = [];
  try {
    evidence = db
      .prepare(
        `SELECT paper, unit, questions, years, evidence, is_primary, kind
           FROM topic_evidence WHERE topic_id = ?
          ORDER BY is_primary DESC, questions DESC, paper`
      )
      .all(topic.id);
    pyq = db
      .prepare(
        `SELECT q.format, COUNT(*) AS n
           FROM pyq_question_topics qt
           JOIN pyq_questions q ON q.id = qt.question_id
          WHERE qt.topic_id = ? AND q.format NOT IN ('descriptive', 'unknown')
          GROUP BY q.format ORDER BY n DESC`
      )
      .all(topic.id);
  } catch {
    // The PYQ tables are optional; a database without them still has a dossier.
  }

  return { topic, items, units, papers, related, evidence, pyq };
}

/**
 * Topics whose items span more than one paper. This is the Master Reuse Map:
 * study once, update continuously, use everywhere.
 */
function reuseMap(db, { minPapers = 2 } = {}) {
  const rows = db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.ap, t.tier,
              COUNT(DISTINCT ti.item_id) AS items,
              GROUP_CONCAT(DISTINCT u.paper)  AS papers,
              COUNT(DISTINCT tu.unit_code)    AS units
         FROM topics t
         JOIN topic_items ti ON ti.topic_id = t.id
         LEFT JOIN topic_units tu ON tu.topic_id = t.id
         LEFT JOIN ref_units u ON u.unit_code = tu.unit_code
        GROUP BY t.id
        ORDER BY t.ap DESC, t.tier, items DESC`
    )
    .all();

  return rows
    .map((r) => ({
      ...r,
      paperList: [...new Set(String(r.papers || '').split(',').filter(Boolean))].sort(),
    }))
    .filter((r) => r.paperList.length >= minPapers);
}

/** Seeded topics that no item has yet touched: the standing gaps. */
function coldTopics(db) {
  return db
    .prepare(
      `SELECT t.slug, t.name, t.ap, t.tier FROM topics t
        WHERE NOT EXISTS (SELECT 1 FROM topic_items ti WHERE ti.topic_id = t.id)
        ORDER BY t.ap DESC, t.tier, t.slug`
    )
    .all();
}

module.exports = {
  norm,
  aliasMatcher,
  loadAliases,
  matchItem,
  rebuild,
  topicDossier,
  reuseMap,
  coldTopics,
};
