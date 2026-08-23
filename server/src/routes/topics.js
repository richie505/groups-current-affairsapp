'use strict';

// The topic layer, over HTTP.
//
// Read-only. The vocabulary is curated in `scripts/topic-data.js` and the
// evidence is seeded from the blueprint, so there is nothing here for a student
// to change — and keeping it read-only means these routes cannot become a second
// way for the graph to drift from its source files.
//
// WHAT THESE FOUR ENDPOINTS ARE FOR
//
//   GET /api/topics             the map: every topic with what is known about it
//   GET /api/topics/reuse-map   study once, answer in three papers
//   GET /api/topics/gaps        Tier-1 topics with no material yet
//   GET /api/topics/:slug       the dossier: news history beside exam history
//
// The last one is the point of the whole layer. Everything else in this app is
// organised by day; this is the one place a student can ask "what do I know
// about Polavaram, and is it worth my time?" and get an answer built from both
// the newspaper and the past papers.

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const T = require('../lib/topics');
const P = require('../lib/pyq');

const router = express.Router();
router.use(requireAuth);

// Only published items are ever counted or shown. A draft is not knowledge yet,
// and a topic page that included drafts would show a student material they
// cannot open.
const VISIBLE = `i.status = 'published' AND d.status = 'published'`;

// ---------------------------------------------------------------------------
// GET /api/topics
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const { ap, tier, kind, q } = req.query;

  const where = [];
  const params = [];
  if (ap === '1') where.push('t.ap = 1');
  if (tier) {
    where.push('t.tier = ?');
    params.push(Number(tier));
  }
  if (kind) {
    where.push('t.kind = ?');
    params.push(String(kind));
  }
  if (q) {
    // Searches aliases as well as the name, because a student looking for
    // "APCRDA" should find the topic whose formal name is spelled out in full.
    where.push(`(t.name LIKE ? OR EXISTS (
                   SELECT 1 FROM topic_aliases a
                    WHERE a.topic_id = t.id AND a.norm LIKE ?))`);
    params.push(`%${q}%`, `%${T.norm(q)}%`);
  }

  const rows = db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.kind, t.ap, t.tier, t.summary,
              (SELECT COUNT(*) FROM topic_items ti
                 JOIN ca_items i ON i.id = ti.item_id
                 JOIN ca_days  d ON d.id = i.day_id
                WHERE ti.topic_id = t.id AND ${VISIBLE})            AS items,
              (SELECT COUNT(*) FROM topic_items ti
                 JOIN ca_items i ON i.id = ti.item_id
                 JOIN ca_days  d ON d.id = i.day_id
                WHERE ti.topic_id = t.id AND ti.in_headline = 1 AND ${VISIBLE}) AS about,
              -- Real past questions, from the objective papers. This was the
              -- Group-I Mains blueprint's own count; it is now a count of
              -- questions that were actually printed.
              (SELECT COUNT(*) FROM pyq_question_topics qt
                WHERE qt.topic_id = t.id)                           AS pyq_questions,
              (SELECT GROUP_CONCAT(DISTINCT u.paper) FROM topic_units tu
                 JOIN ref_units u ON u.unit_code = tu.unit_code
                WHERE tu.topic_id = t.id AND u.paper <> ''
                  AND u.unfeedable = 0 AND u.broad = 0)             AS papers
         FROM topics t
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.ap DESC, t.tier, t.name`
    )
    .all(...params);

  res.json({
    topics: rows.map((r) => ({
      ...r,
      papers: [...new Set(String(r.papers || '').split(',').filter(Boolean))].sort(),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/topics/reuse-map
// ---------------------------------------------------------------------------

// Declared before /:slug so that 'reuse-map' is not read as a slug.
router.get('/reuse-map', (req, res) => {
  const minPapers = Number(req.query.minPapers || 2);

  // Paper reach, measured from the units of the items that name the topic.
  //
  // This was read off the Group-I Mains blueprint, which carried an explicit
  // `is_primary` — the paper a person had decided to study the topic FROM. With
  // the Mains layer gone there is no such judgement on file, so "study from" is
  // derived instead: the paper carrying the most weight, meaning the one the
  // most items point at. That is a weaker claim than the blueprint's, and it is
  // the strongest one the remaining evidence actually supports.
  const rows = db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.ap, t.tier,
              COUNT(DISTINCT u.paper)        AS papers,
              (SELECT COUNT(*) FROM pyq_question_topics qt
                WHERE qt.topic_id = t.id)    AS questions,
              GROUP_CONCAT(DISTINCT u.paper) AS paper_list,
              (SELECT u2.paper FROM topic_units tu2
                 JOIN ref_units u2 ON u2.unit_code = tu2.unit_code
                WHERE tu2.topic_id = t.id AND u2.paper <> ''
                  AND u2.unfeedable = 0 AND u2.broad = 0
                GROUP BY u2.paper
                ORDER BY SUM(tu2.weight) DESC LIMIT 1) AS study_from
         FROM topics t
         JOIN topic_units tu ON tu.topic_id = t.id
         JOIN ref_units  u  ON u.unit_code = tu.unit_code
        WHERE u.paper <> '' AND u.unfeedable = 0 AND u.broad = 0
        GROUP BY t.id
       HAVING papers >= ?
        ORDER BY papers DESC, questions DESC`
    )
    .all(minPapers);

  res.json({
    minPapers,
    topics: rows.map((r) => ({
      ...r,
      paper_list: [...new Set(String(r.paper_list || '').split(',').filter(Boolean))].sort(),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/topics/gaps
// ---------------------------------------------------------------------------

// Tier-1 topics with nothing attached. This is the most useful screen in the
// layer for someone deciding what to do next: a topic the commission asks
// repeatedly and about which this app holds nothing is the highest-cost gap
// available, and it is invisible without the topic table.
router.get('/gaps', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.slug, t.name, t.ap, t.tier, t.kind,
              (SELECT COUNT(*) FROM pyq_question_topics qt
                WHERE qt.topic_id = t.id) AS pyq_questions
         FROM topics t
        WHERE t.tier <= 2
          AND NOT EXISTS (
                SELECT 1 FROM topic_items ti
                  JOIN ca_items i ON i.id = ti.item_id
                  JOIN ca_days  d ON d.id = i.day_id
                 WHERE ti.topic_id = t.id AND ${VISIBLE})
        ORDER BY t.tier, pyq_questions DESC, t.ap DESC, t.name`
    )
    .all();

  res.json({
    gaps: rows,
    // Split out because an AP gap costs more: AP is roughly half of Papers II
    // and IV and no national source covers it.
    ap: rows.filter((r) => r.ap).length,
  });
});

// ---------------------------------------------------------------------------
// GET /api/topics/syllabus
// ---------------------------------------------------------------------------
//
// THE SYLLABUS ITSELF, WITH WHAT HAS FED EACH UNIT.
//
// The three tabs above are all indexed by TOPIC, which is a vocabulary this
// project curated. Useful, and not the thing a candidate actually revises
// against: they revise against the syllabus APPSC published, unit by unit, and
// the question they arrive with is "how much have I got for this unit, and
// which units have I got nothing for".
//
// The topic layer could not answer that for Group-II at all. Its 248
// topic→unit mappings are every one of them Group-I Mains paper units, so a
// Group-II candidate opening Topics saw a map of somebody else's exam.
//
// This is built from `ca_item_units` instead, which is populated from Section
// 2's deterministic match against the syllabus vocabulary — so it covers every
// exam the map knows about, and a unit at zero is a real gap rather than a
// vocabulary that was never curated.
//
// The broad and unfeedable units are included but flagged. The 30-mark
// Current-Affairs paper matches everything and mental ability matches nothing;
// both are excluded from SCORING for opposite reasons, and hiding them here
// would make the syllabus look incomplete to someone reading it as a syllabus.
router.get('/syllabus', (req, res) => {
  const units = db
    .prepare(
      `SELECT r.unit_code, r.label, r.paper, r.exam, r.format, r.marks,
              r.broad, r.unfeedable, r.syllabus_text,
              (SELECT COUNT(DISTINCT i.id)
                 FROM ca_item_units u
                 JOIN ca_items i ON i.id = u.item_id
                 JOIN ca_days  d ON d.id = i.day_id
                WHERE u.unit_code = r.unit_code AND ${VISIBLE}) AS items,
              (SELECT COUNT(*)
                 FROM ca_mcqs m
                 JOIN ca_items i ON i.id = m.item_id
                 JOIN ca_days  d ON d.id = i.day_id
                WHERE m.unit_code = r.unit_code AND m.status = 'published'
                      AND ${VISIBLE}) AS questions
         FROM ref_units r
        ORDER BY r.exam, r.paper, r.unit_code`
    )
    .all();

  // Grouped server-side because the grouping IS the answer — a flat list of 102
  // units sorted by code is the same data and none of the meaning.
  const EXAMS = [
    { id: 'g2', name: 'Group-II', note: 'Screening and Mains — both answered by ticking a box' },
    { id: 'g1p', name: 'Group-I Prelims', note: 'Objective, 120 questions' },
    { id: 'g1', name: 'Group-I Mains', note: 'Written — the only descriptive paper' },
  ];

  const exams = EXAMS.map((e) => {
    const mine = units.filter((u) => (u.exam || 'g1') === e.id);
    return {
      ...e,
      units: mine,
      total: mine.length,
      // "Covered" counts only units that CAN be fed. Counting the broad and
      // unfeedable ones would flatter the number with units that are either
      // matched by everything or by nothing.
      feedable: mine.filter((u) => !u.broad && !u.unfeedable).length,
      covered: mine.filter((u) => !u.broad && !u.unfeedable && u.items > 0).length,
      items: mine.reduce((n, u) => n + u.items, 0),
      questions: mine.reduce((n, u) => n + u.questions, 0),
    };
  }).filter((e) => e.units.length);

  res.json({ exams });
});

// The published items feeding one syllabus unit.
router.get('/syllabus/:code', (req, res) => {
  const unit = db.prepare('SELECT * FROM ref_units WHERE unit_code = ?').get(req.params.code);
  if (!unit) return res.status(404).json({ error: 'No such syllabus unit.' });

  const items = db
    .prepare(
      `SELECT i.id, i.headline, i.bucket, i.importance, i.event_date, d.date AS day_date,
              (SELECT COUNT(*) FROM ca_mcqs m
                WHERE m.item_id = i.id AND m.status = 'published') AS mcq_count
         FROM ca_item_units u
         JOIN ca_items i ON i.id = u.item_id
         JOIN ca_days  d ON d.id = i.day_id
        WHERE u.unit_code = ? AND ${VISIBLE}
        ORDER BY d.date DESC, i.order_index`
    )
    .all(unit.unit_code);

  res.json({ unit, items });
});

// ---------------------------------------------------------------------------
// GET /api/topics/:slug
// ---------------------------------------------------------------------------

router.get('/:slug', (req, res) => {
  const d = T.topicDossier(db, req.params.slug);
  if (!d) return res.status(404).json({ error: 'No such topic.' });

  // topicDossier does not filter by publication status, because the pipeline
  // uses it too. A student must only ever see published items.
  const publishedIds = new Set(
    db
      .prepare(
        `SELECT i.id FROM ca_items i JOIN ca_days d ON d.id = i.day_id WHERE ${VISIBLE}`
      )
      .all()
      .map((r) => r.id)
  );
  d.items = d.items.filter((it) => publishedIds.has(it.id));

  // The observed format mix, for a student wondering how this topic gets asked.
  let formats = [];
  try {
    formats = db
      .prepare(
        `SELECT q.format, COUNT(*) AS n
           FROM pyq_question_topics qt
           JOIN pyq_questions q ON q.id = qt.question_id
          WHERE qt.topic_id = ? AND q.format NOT IN ('descriptive', 'unknown')
          GROUP BY q.format ORDER BY n DESC`
      )
      .all(d.topic.id);
  } catch {
    formats = [];
  }

  res.json({ ...d, formats });
});

module.exports = router;
