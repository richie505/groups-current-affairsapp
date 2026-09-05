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

/**
 * Whether an alias should also match its own plural.
 *
 * "Core sector growth slows as fertilizer output falls" lost its industry unit
 * because the headline says `fertilizer` and the body says "the fertilizers
 * sector", and `\bfertilizer\b` does not match `fertilizers`. Every single-word
 * alias had that hole; the headline-needs-the-body rule made it bite, because
 * a word that appears in both places in different numbers now counts as
 * appearing in neither.
 *
 * Phrases are included. The objection was that a phrase pluralises on an inner
 * word as often as the last one — `industrial park` is fine, but `member of
 * Parliament` becomes `members of Parliament`, which suffixing the tail cannot
 * reach. That is true and it does not matter: suffixing the tail never produces
 * a WRONG match, only a missed one, and measured over this corpus all thirteen
 * phrase matches it recovered pluralised on the last word — municipal
 * corporations, constitutional amendments, local body elections, irrigation
 * projects, scheduled castes. Twelve of the thirteen were right.
 *
 * Never a strict alias, and never an acronym: those are strict precisely
 * because a loose match fires on prose, and `SCs` is a different thing from
 * `SC`. Never an alias already stored plural, because +s on a plural is noise.
 * Never non-ASCII - Telugu does not form plurals by suffix.
 */
function stemmable(alias, strict) {
  if (strict) return false;
  const a = String(alias || '');
  if (a.length < 4) return false;
  if (/[^\x00-\x7F]/.test(a)) return false;
  if (a === a.toUpperCase()) return false; // MGNREGA, and any acronym stored loose
  if (/s$/i.test(a)) return false; // census, exports, BrahMos
  return true;
}

// The suffix group appended to a stemmable alias. `(?:e?s)?` covers the regular
// -s and the -es that follows a sibilant (tax/taxes); the consonant-y branch is
// handled by rewriting the stem, which is why it is a rule here rather than the
// irregular table it started as - policy, industry, party and ten others in the
// current vocabulary all take it, and none of them is irregular.
function pluralise(body) {
  if (/[^aeiou]y$/i.test(body)) return `${body.slice(0, -1)}(?:y|ies)`;
  return `${body}(?:e?s)?`;
}

// A strict alias is matched exactly as printed, case-sensitively, on word
// boundaries. These are the short acronyms - HAM, TTD, CAA, SC - where a loose
// match would fire inside unrelated words or on ordinary prose.
//
// A non-strict alias is matched case-insensitively, still on word boundaries.
// Word boundaries matter even here: without them 'mayor' matches nothing useful
// in isolation but 'FTA' would match inside 'aftantecedent'.
//
// `plural` opts the alias into matching its own plural — off by default so a
// caller that has not thought about it keeps the old behaviour.
function aliasMatcher(alias, strict, plural) {
  const raw = escapeRe(strict ? alias : norm(alias));
  const body = plural && stemmable(alias, strict) ? pluralise(raw) : raw;
  // \b does not work against a non-ASCII script, so Telugu aliases fall back to
  // a plain containment test. Telugu has no case, so nothing is lost.
  const nonAscii = /[^\x00-\x7F]/.test(alias);
  if (nonAscii) {
    const needle = norm(alias);
    return {
      test: (haystackRaw, haystackNorm) => haystackNorm.includes(needle),
      count: (haystackRaw, haystackNorm) => haystackNorm.split(needle).length - 1,
      // The same shape the ASCII branch returns, so a caller never has to ask
      // which kind of alias it is holding. Omitting it here is how the
      // proper-name guard crashed on the first Telugu alias it reached.
      matches: (haystackRaw, haystackNorm) => {
        const spans = [];
        let i = haystackNorm.indexOf(needle);
        while (i !== -1) {
          spans.push({ start: i, end: i + needle.length });
          i = haystackNorm.indexOf(needle, i + needle.length);
        }
        return { target: haystackNorm, spans };
      },
    };
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
    /**
     * Where the alias matched, and in which string.
     *
     * `test` and `count` answer "is it there" and "how often", which is all
     * the scorer needed until it had to ask what sits NEXT TO a match — an
     * alias inside "Alluri Sitarama Raju Academy" or "Directorate of Public
     * Health" is part of a name rather than a mention of the topic. That
     * question needs offsets, and it needs to know which haystack they index
     * into, because a strict alias matches the raw text and a loose one the
     * normalised text. Returning both together is what keeps a caller from
     * pairing an offset with the wrong string.
     */
    matches: (haystackRaw, haystackNorm) => {
      const target = strict ? haystackRaw : haystackNorm;
      re.lastIndex = 0;
      const out = [];
      let m;
      while ((m = re.exec(target)) !== null) {
        out.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex += 1; // cannot happen here, but a zero-width match would spin
      }
      return { target, spans: out };
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
  // The topic layer stays singular-only for now: its aliases are almost all
  // proper nouns, and its precision has not been measured the way the unit
  // filter's has.
  return rows.map((r) => ({ ...r, matcher: aliasMatcher(r.alias, !!r.strict, false) }));
}

// The text of an item, split into the part that decides what it is ABOUT and
// the part that merely mentions things.
function itemText(item) {
  const head = item.headline || '';
  // The eight-section Group-I Mains note used to be read here too, and it was
  // most of the body text — removing it took topic matches from 152 to 109.
  // That is the correct number rather than a regression: a topic is now matched
  // on what the objective lanes actually publish.
  const body = [item.notes_markdown, item.prelims_facts, item.static_linkage]
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
         -- Only real, feedable syllabus units. This map is what factor E is
         -- measured from, so a code with no unit behind it would inflate the
         -- paper count with a paper that does not exist.
         JOIN ref_units ru ON ru.unit_code = iu.unit_code
                          AND ru.unfeedable = 0 AND ru.broad = 0
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
      `SELECT i.id, i.headline, i.bucket, i.importance, i.status,
              d.date, ti.in_headline, ti.hits, ti.matched
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

  // Paper reach, from the units of the news items that mention the topic.
  //
  // This used to be merged with the Group-I Mains blueprint's own observations.
  // That source is gone, and with it the case for merging: every paper named
  // here is now one this app actually serves.
  const papers = [...new Set(units.map((u) => u.paper).filter(Boolean))].sort();

  // What the commission has actually asked. This is the join that makes a topic
  // page worth opening: the news history and the exam history side by side, so
  // "is this worth my time" stops being a guess.
  // `evidence` was the Group-I Mains blueprint's per-topic observations. It is
  // kept as an always-empty array rather than removed from the shape, because
  // the field is read by the topic page and an absent key and an empty list
  // render differently.
  const evidence = [];
  let pyq = [];
  try {
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
  stemmable,
  loadAliases,
  matchItem,
  rebuild,
  topicDossier,
  reuseMap,
  coldTopics,
};
