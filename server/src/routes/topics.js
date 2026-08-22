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
              (SELECT COALESCE(SUM(questions), 0) FROM topic_evidence e
                WHERE e.topic_id = t.id)                            AS pyq_questions,
              (SELECT GROUP_CONCAT(DISTINCT e.paper) FROM topic_evidence e
                WHERE e.topic_id = t.id AND e.paper <> '')          AS papers
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

  // Paper reach from the blueprint's own observations, which is where a
  // multi-paper claim can actually be justified. `is_primary` carries the
  // "study it from here" instruction that makes the map actionable rather than
  // merely interesting.
  const rows = db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.ap, t.tier,
              COUNT(DISTINCT e.paper) AS papers,
              SUM(e.questions)        AS questions,
              GROUP_CONCAT(DISTINCT e.paper) AS paper_list,
              (SELECT e2.paper FROM topic_evidence e2
                WHERE e2.topic_id = t.id AND e2.is_primary = 1
                ORDER BY e2.questions DESC LIMIT 1) AS study_from
         FROM topics t
         JOIN topic_evidence e ON e.topic_id = t.id
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
              (SELECT COALESCE(SUM(questions), 0) FROM topic_evidence e
                WHERE e.topic_id = t.id) AS pyq_questions
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
