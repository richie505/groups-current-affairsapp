const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { createResetToken } = require('../lib/passwordReset');
const { checkCorrections } = require('../lib/corrections');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const BUCKETS = ['international', 'national', 'ap', 'dynamic'];
const BANKS = ['Q', 'D', 'E', 'S'];
// Section 3 of the Group-I note template. A closed set: the point of the
// multi-dimensional tag is coverage, and an open list cannot be checked for gaps.
const DIMENSIONS = [
  'economic', 'social', 'political', 'ethical', 'environmental', 'legal', 'international',
];
const FORMATS = [
  'direct_recall',
  'negative_statement',
  'assertion_reason',
  'statement_based',
  'multi_statement',
  'chronological',
  'list_matching',
  'count_based',
];

// ---- Validation ---------------------------------------------------------

// Kept here and exported so the content pipeline can validate against exactly
// the same rules before it ever offers a row to the database. A generator that
// validates loosely and a server that validates strictly produces a pipeline
// that appears to work and silently drops a fraction of its output.
function validateMcq(body) {
  const errors = [];
  const q = String(body.question || '').trim();
  if (q.length < 10) errors.push('Question is too short.');
  const opts = ['option_a', 'option_b', 'option_c', 'option_d'].map((k) => String(body[k] || '').trim());
  if (opts.some((o) => !o)) errors.push('All four options are required.');
  const lower = opts.map((o) => o.toLowerCase());
  if (new Set(lower).size !== 4) errors.push('Options must be distinct.');
  if (!['a', 'b', 'c', 'd'].includes(body.correct_option)) errors.push('correct_option must be a, b, c or d.');
  if (body.format && !FORMATS.includes(body.format)) errors.push('Unknown MCQ format.');
  // A current-affairs explanation without a date is a trap: the reader cannot
  // tell whether the key is still true, which is the one thing that goes wrong
  // with this material.
  if (!String(body.explanation || '').trim()) errors.push('Explanation is required.');
  return errors;
}

function validateItem(body, { forPublish = false } = {}) {
  const errors = [];
  if (!String(body.headline || '').trim()) errors.push('Headline is required.');
  if (body.bucket && !BUCKETS.includes(body.bucket)) errors.push('Unknown bucket.');
  if (body.g1_bank && !BANKS.includes(body.g1_bank)) errors.push('Bank must be Q, D, E or S.');
  if (body.importance && ![1, 2, 3].includes(Number(body.importance))) {
    errors.push('Importance must be 1, 2 or 3.');
  }
  if (forPublish) {
    if (!String(body.notes_markdown || '').trim()) errors.push('Notes are required to publish.');
    // The same rule the database trigger enforces, checked here so the admin
    // gets a sentence explaining it rather than a raw constraint failure.
    if (Number(body.relevance_g1) === 1) {
      if (!String(body.g1_fact || '').trim()) errors.push('Group-I lane needs THE FACT.');
      if (!String(body.g1_angle || '').trim()) {
        errors.push('Group-I lane needs THE ANGLE — an item with no argument will never reach an answer.');
      }
    }
    if (Number(body.relevance_g2) === 1 && !String(body.prelims_facts || '').trim()) {
      errors.push('Group-II lane needs a prelims-facts block.');
    }
    // The template's two load-bearing sections. "Why in news" is the trigger a
    // Mains answer opens with, and the AP angle is the half of the marks no
    // national source will hand you — so an item published to the G1 lane
    // without them is an item that will read as generic in the exam.
    if (Number(body.relevance_g1) === 1) {
      if (!String(body.g1_why_news || '').trim()) {
        errors.push('Group-I lane needs "Why in News" — the one-line trigger.');
      }
      if (!String(body.g1_ap_angle || '').trim()) {
        errors.push(
          'Group-I lane needs an AP-specific angle. If the topic genuinely has none, say so explicitly in that field rather than leaving it blank.'
        );
      }
    }
  }
  return errors;
}

// ---- Overview -----------------------------------------------------------

router.get('/overview', (req, res) => {
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM ca_days WHERE status = 'draft')                AS draft_days,
         (SELECT COUNT(*) FROM ca_days WHERE status = 'published')            AS published_days,
         (SELECT COUNT(*) FROM ca_items WHERE status = 'draft')               AS draft_items,
         (SELECT COUNT(*) FROM ca_items WHERE status = 'published')           AS published_items,
         (SELECT COUNT(*) FROM ca_items WHERE status = 'discarded')           AS discarded_items,
         (SELECT COUNT(*) FROM ca_items WHERE needs_verify = 1
                                          AND status <> 'discarded')          AS needs_verify,
         (SELECT COUNT(*) FROM ca_mcqs)                                      AS mcqs,
         (SELECT COUNT(*) FROM ca_mcqs WHERE status <> 'published')          AS pending_mcqs,
         (SELECT COUNT(DISTINCT m.item_id) FROM ca_mcqs m
            JOIN ca_items i ON i.id = m.item_id
           WHERE m.status <> 'published' AND i.status = 'published')          AS pending_mcq_items,
         (SELECT COUNT(*) FROM ca_mcq_flags WHERE status = 'open')            AS open_flags,
         (SELECT COUNT(*) FROM users WHERE role = 'student')                  AS students`
    )
    .get();

  // Items with no source at all. Publishing one of these is how an
  // unverifiable claim gets into the bank, so it belongs on the front page of
  // the admin rather than buried in a report.
  const unsourced = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_items i
        WHERE i.status <> 'discarded'
          AND NOT EXISTS (SELECT 1 FROM ca_item_sources s WHERE s.item_id = i.id)`
    )
    .get().n;

  // Published items carrying no MCQs — the Group-II lane exists but has
  // nothing to practise against.
  const noMcqs = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_items i
        WHERE i.status = 'published' AND i.relevance_g2 = 1
          AND NOT EXISTS (SELECT 1 FROM ca_mcqs m WHERE m.item_id = i.id)`
    )
    .get().n;

  const runs = db
    .prepare(
      `SELECT id, window_start, window_end, mode, status, candidates, drafted,
              discarded, approved, created_at, finished_at
         FROM ca_runs ORDER BY created_at DESC LIMIT 10`
    )
    .all();

  res.json({ counts: { ...counts, unsourced, no_mcqs: noMcqs }, runs });
});

// ---- Review queue -------------------------------------------------------

// Everything awaiting a decision, grouped by day. Sources come along for the
// ride because the review that matters is "is this true and is it sourced",
// and making the admin click through to check kills the habit.
router.get('/queue', (req, res) => {
  const days = db
    .prepare(
      `SELECT d.id, d.date, d.title, d.status,
              COUNT(i.id) AS draft_items
         FROM ca_days d
         LEFT JOIN ca_items i ON i.day_id = d.id AND i.status = 'draft'
        WHERE d.status = 'draft' OR i.id IS NOT NULL
        GROUP BY d.id
       HAVING draft_items > 0 OR d.status = 'draft'
        ORDER BY d.date DESC`
    )
    .all();

  const items = db
    .prepare(
      `SELECT i.*, d.date AS day_date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE i.status = 'draft'
        ORDER BY d.date DESC, i.importance, i.order_index`
    )
    .all();

  if (items.length) {
    const ids = items.map((i) => i.id);
    const holes = ids.map(() => '?').join(',');
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const it of items) {
      it.keywords = [];
      it.units = [];
      it.themes = [];
      it.sources = [];
      it.mcq_count = 0;
    }
    for (const r of db.prepare(`SELECT item_id, keyword FROM ca_item_keywords WHERE item_id IN (${holes})`).all(...ids))
      byId.get(r.item_id)?.keywords.push(r.keyword);
    for (const r of db
      .prepare(
        `SELECT u.item_id, u.unit_code, r.label, r.paper
           FROM ca_item_units u LEFT JOIN ref_units r ON r.unit_code = u.unit_code
          WHERE u.item_id IN (${holes}) ORDER BY u.unit_code`
      )
      .all(...ids))
      byId.get(r.item_id)?.units.push({
        unit_code: r.unit_code, label: r.label, paper: r.paper, exam: r.exam, format: r.format,
      });
    for (const r of db.prepare(`SELECT item_id, theme FROM ca_item_themes WHERE item_id IN (${holes})`).all(...ids))
      byId.get(r.item_id)?.themes.push(r.theme);
    for (const r of db
      .prepare(`SELECT item_id, url, publisher, is_primary FROM ca_item_sources WHERE item_id IN (${holes})`)
      .all(...ids))
      byId.get(r.item_id)?.sources.push(r);
    for (const r of db
      .prepare(
        `SELECT item_id, COUNT(*) AS n,
                SUM(CASE WHEN status <> 'published' THEN 1 ELSE 0 END) AS pending
           FROM ca_mcqs WHERE item_id IN (${holes}) GROUP BY item_id`
      )
      .all(...ids)) {
      const it = byId.get(r.item_id);
      if (it) {
        it.mcq_count = r.n;
        // Questions written onto an already-published item, waiting for review.
        // Surfaced on the card because otherwise the only way to discover them
        // is to open every item and count.
        it.mcq_pending = r.pending || 0;
      }
    }
    // The correction guard, run at review time as well as at draft time — the
    // corrections table can gain an entry after an item was drafted.
    for (const it of items) it.correction_hits = checkCorrections(db, it);

    // The live item this draft duplicates, where there is one. Resolved to a
    // headline rather than left as a bare id, because "supersedes 59" asks the
    // reviewer to go and look it up and "supersedes a published item: Telangana
    // Deputy Chief Minister seeks…" does not.
    const superIds = items.map((i) => i.supersedes).filter(Boolean);
    if (superIds.length) {
      const holes2 = superIds.map(() => '?').join(',');
      const live = new Map(
        db
          .prepare(`SELECT id, headline, status, day_id FROM ca_items WHERE id IN (${holes2})`)
          .all(...superIds)
          .map((r) => [r.id, r])
      );
      for (const it of items) {
        const prior = it.supersedes ? live.get(it.supersedes) : null;
        // Only worth showing while the old item is still published. Once it has
        // been discarded the duplication is resolved and the banner would be
        // noise on every future review of this item.
        it.supersedes_item = prior && prior.status === 'published' ? prior : null;
      }
    }
  }

  // A SECOND QUEUE: published items whose QUESTIONS are waiting on review.
  //
  // The queue above asks "which items are unreviewed", and that was the whole
  // question while questions only ever arrived with the item carrying them.
  // Re-tagging the bank to syllabus units rewrites the questions on items that
  // are already live, so an item can be fully reviewed and still hold questions
  // no one has read. Those are invisible to a queue filtered on i.status, which
  // is exactly how unreviewed content reaches a student by accident.
  const questionReview = db
    .prepare(
      `SELECT i.id, i.headline, i.bucket, i.importance, i.day_id, d.date AS day_date,
              COUNT(*) AS pending,
              (SELECT COUNT(*) FROM ca_mcqs p
                WHERE p.item_id = i.id AND p.status = 'published') AS live
         FROM ca_mcqs m
         JOIN ca_items i ON i.id = m.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE m.status <> 'published' AND i.status = 'published'
        GROUP BY i.id
        ORDER BY d.date DESC, i.order_index`
    )
    .all();
  for (const it of questionReview) {
    it.mcqs = db
      .prepare(
        // With the unit's label, so the reviewer reads the topic rather than
        // decoding a key. Same reason the student sees it.
        `SELECT m.*, u.label AS unit_label, u.exam AS unit_exam
           FROM ca_mcqs m LEFT JOIN ref_units u ON u.unit_code = m.unit_code
          WHERE m.item_id = ? AND m.status <> 'published' ORDER BY m.id`
      )
      .all(it.id);
  }

  res.json({ days, items, question_review: questionReview });
});

// ---- Days ---------------------------------------------------------------

router.get('/days', (req, res) => {
  const days = db
    .prepare(
      `SELECT d.id, d.date, d.title, d.intro_markdown, d.status, d.published_at,
              COUNT(i.id) AS item_count,
              SUM(CASE WHEN i.status = 'published' THEN 1 ELSE 0 END) AS published_count,
              SUM(CASE WHEN i.status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
              SUM(CASE WHEN i.status = 'discarded' THEN 1 ELSE 0 END) AS discarded_count
         FROM ca_days d LEFT JOIN ca_items i ON i.day_id = d.id
        GROUP BY d.id ORDER BY d.date DESC LIMIT 200`
    )
    .all();
  res.json({ days });
});

router.post('/days', (req, res) => {
  const { date, title, intro_markdown } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' });
  }
  const existing = db.prepare('SELECT id FROM ca_days WHERE date = ?').get(date);
  if (existing) return res.status(409).json({ error: 'That date already has a digest.', id: existing.id });
  const info = db
    .prepare('INSERT INTO ca_days (date, title, intro_markdown) VALUES (?, ?, ?)')
    .run(date, String(title || '').trim(), String(intro_markdown || ''));
  res.json({ id: info.lastInsertRowid });
});

router.put('/days/:id', (req, res) => {
  const { title, intro_markdown } = req.body || {};
  db.prepare('UPDATE ca_days SET title = ?, intro_markdown = ? WHERE id = ?').run(
    String(title || '').trim(),
    String(intro_markdown || ''),
    req.params.id
  );
  res.json({ ok: true });
});

router.get('/days/:id/items', (req, res) => {
  const items = db.prepare('SELECT * FROM ca_items WHERE day_id = ? ORDER BY order_index, id').all(req.params.id);
  for (const it of items) {
    it.keywords = db.prepare('SELECT keyword FROM ca_item_keywords WHERE item_id = ?').all(it.id).map((r) => r.keyword);
    it.units = db
      .prepare(
        `SELECT u.unit_code, r.label, r.paper
           FROM ca_item_units u LEFT JOIN ref_units r ON r.unit_code = u.unit_code
          WHERE u.item_id = ? ORDER BY u.unit_code`
      )
      .all(it.id);
    it.themes = db.prepare('SELECT theme FROM ca_item_themes WHERE item_id = ?').all(it.id).map((r) => r.theme);
    it.sources = db
      .prepare('SELECT id, url, publisher, is_primary FROM ca_item_sources WHERE item_id = ? ORDER BY is_primary DESC, id')
      .all(it.id);
    it.dimensions = db
      .prepare('SELECT dimension, note FROM ca_item_dimensions WHERE item_id = ? ORDER BY dimension')
      .all(it.id);
    it.essay_questions = db
      .prepare('SELECT id, question, kind, note FROM ca_essay_questions WHERE item_id = ? ORDER BY id')
      .all(it.id);
    it.mcqs = db.prepare('SELECT * FROM ca_mcqs WHERE item_id = ? ORDER BY id').all(it.id);
    it.skeletons = db.prepare('SELECT * FROM ca_skeletons WHERE item_id = ? ORDER BY id').all(it.id);
  }
  res.json({ items });
});

// Publishing a day publishes its draft items with it, which is what "approve
// this digest" means in practice. Items explicitly discarded stay discarded —
// a bulk approve must never resurrect something already rejected.
router.post('/days/:id/publish', (req, res) => {
  const day = db.prepare('SELECT * FROM ca_days WHERE id = ?').get(req.params.id);
  if (!day) return res.status(404).json({ error: 'Day not found.' });

  const drafts = db.prepare(`SELECT * FROM ca_items WHERE day_id = ? AND status = 'draft'`).all(day.id);

  // Check every draft before publishing any, so a day either goes out whole or
  // reports exactly what is blocking it. Publishing eight of ten and failing
  // silently on two is the outcome most likely to go unnoticed.
  const blocked = [];
  for (const it of drafts) {
    const errors = validateItem(it, { forPublish: true });
    if (errors.length) blocked.push({ id: it.id, headline: it.headline, errors });
  }
  if (blocked.length) {
    return res.status(400).json({
      error: `${blocked.length} item(s) are not ready to publish.`,
      blocked,
    });
  }

  db.transaction(() => {
    db.prepare(`UPDATE ca_items SET status = 'published', updated_at = datetime('now')
                 WHERE day_id = ? AND status = 'draft'`).run(day.id);
    db.prepare(`UPDATE ca_days SET status = 'published', published_at = datetime('now') WHERE id = ?`).run(day.id);
  })();

  res.json({ ok: true, published: drafts.length });
});

router.post('/days/:id/unpublish', (req, res) => {
  db.prepare(`UPDATE ca_days SET status = 'draft', published_at = NULL WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/days/:id', (req, res) => {
  db.prepare('DELETE FROM ca_days WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Items --------------------------------------------------------------

function writeTags(itemId, { keywords, units, themes }) {
  if (Array.isArray(keywords)) {
    db.prepare('DELETE FROM ca_item_keywords WHERE item_id = ?').run(itemId);
    const ins = db.prepare('INSERT OR IGNORE INTO ca_item_keywords (item_id, keyword) VALUES (?, ?)');
    for (const k of keywords) if (String(k).trim()) ins.run(itemId, String(k).trim());
  }
  if (Array.isArray(units)) {
    db.prepare('DELETE FROM ca_item_units WHERE item_id = ?').run(itemId);
    const ins = db.prepare('INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)');
    for (const u of units) if (String(u).trim()) ins.run(itemId, String(u).trim());
  }
  if (Array.isArray(themes)) {
    db.prepare('DELETE FROM ca_item_themes WHERE item_id = ?').run(itemId);
    const ins = db.prepare('INSERT OR IGNORE INTO ca_item_themes (item_id, theme) VALUES (?, ?)');
    for (const t of themes) if (String(t).trim()) ins.run(itemId, String(t).trim().toLowerCase());
  }
}

// Section 3 of the Group-I template. Replaces the whole set, like the other tag
// writers, so removing a dimension in the editor actually removes it.
function writeDimensions(itemId, dimensions) {
  if (!Array.isArray(dimensions)) return;
  db.prepare('DELETE FROM ca_item_dimensions WHERE item_id = ?').run(itemId);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ca_item_dimensions (item_id, dimension, note) VALUES (?, ?, ?)'
  );
  for (const d of dimensions) {
    const dim = String(d.dimension || d).trim().toLowerCase();
    if (!DIMENSIONS.includes(dim)) continue;
    ins.run(itemId, dim, String(d.note || '').trim());
  }
}

// Section 8. Same replace-the-set approach.
function writeEssayQuestions(itemId, questions) {
  if (!Array.isArray(questions)) return;
  db.prepare('DELETE FROM ca_essay_questions WHERE item_id = ?').run(itemId);
  const ins = db.prepare(
    'INSERT INTO ca_essay_questions (item_id, question, kind, note) VALUES (?, ?, ?, ?)'
  );
  for (const q of questions) {
    const text = String(q.question || q).trim();
    if (!text) continue;
    const kind = q.kind === 'indirect' ? 'indirect' : 'direct';
    ins.run(itemId, text, kind, String(q.note || '').trim());
  }
}

function writeSources(itemId, sources) {
  if (!Array.isArray(sources)) return;
  db.prepare('DELETE FROM ca_item_sources WHERE item_id = ?').run(itemId);
  const ins = db.prepare(
    'INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const s of sources) {
    const url = String(s.url || '').trim();
    if (!url) continue;
    ins.run(itemId, url, String(s.publisher || '').trim(), s.is_primary ? 1 : 0, s.fetched_at || null);
  }
}

const ITEM_FIELDS = [
  'headline',
  'event_date',
  'bucket',
  'subject_tag',
  'notes_markdown',
  'static_linkage',
  'static_notes',
  'prelims_facts',
  'g1_bank',
  'g1_fact',
  'g1_angle',
  // The eight-section Group-I note template.
  'g1_theme',
  'g1_sub_theme',
  'g1_why_news',
  'g1_background',
  'g1_ap_angle',
  'g1_linked',
  'g1_bridges',
  'g1_way_forward',
  'importance',
  'relevance_g1',
  'relevance_g2',
  'needs_verify',
  'verify_note',
  'order_index',
];

router.post('/items', (req, res) => {
  const body = req.body || {};
  const errors = validateItem(body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  if (!body.day_id) return res.status(400).json({ error: 'day_id is required.' });

  const values = {
    day_id: body.day_id,
    headline: String(body.headline).trim(),
    event_date: body.event_date || null,
    bucket: body.bucket || 'national',
    subject_tag: String(body.subject_tag || ''),
    notes_markdown: String(body.notes_markdown || ''),
    static_linkage: String(body.static_linkage || ''),
    static_notes: String(body.static_notes || ''),
    prelims_facts: String(body.prelims_facts || ''),
    g1_bank: body.g1_bank || null,
    g1_fact: String(body.g1_fact || ''),
    g1_angle: String(body.g1_angle || ''),
    g1_theme: String(body.g1_theme || ''),
    g1_sub_theme: String(body.g1_sub_theme || ''),
    g1_why_news: String(body.g1_why_news || ''),
    g1_background: String(body.g1_background || ''),
    g1_ap_angle: String(body.g1_ap_angle || ''),
    g1_linked: String(body.g1_linked || ''),
    g1_bridges: String(body.g1_bridges || ''),
    g1_way_forward: String(body.g1_way_forward || ''),
    importance: Number(body.importance) || 2,
    relevance_g1: body.relevance_g1 === 0 ? 0 : 1,
    relevance_g2: body.relevance_g2 === 0 ? 0 : 1,
    needs_verify: body.needs_verify ? 1 : 0,
    verify_note: String(body.verify_note || ''),
    order_index: Number(body.order_index) || 0,
  };

  const info = db
    .prepare(
      `INSERT INTO ca_items (day_id, ${ITEM_FIELDS.join(', ')})
       VALUES (@day_id, ${ITEM_FIELDS.map((f) => '@' + f).join(', ')})`
    )
    .run(values);
  const id = info.lastInsertRowid;
  writeTags(id, body);
  writeSources(id, body.sources);
  writeDimensions(id, body.dimensions);
  writeEssayQuestions(id, body.essay_questions);
  res.json({ id });
});

router.put('/items/:id', (req, res) => {
  const body = req.body || {};
  const existing = db.prepare('SELECT * FROM ca_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const merged = { ...existing, ...body };
  const errors = validateItem(merged, { forPublish: existing.status === 'published' });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const sets = [];
  const values = {};
  for (const f of ITEM_FIELDS) {
    if (body[f] === undefined) continue;
    sets.push(`${f} = @${f}`);
    values[f] = body[f];
  }
  if (sets.length) {
    values.id = req.params.id;
    db.prepare(`UPDATE ca_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(values);
  }
  writeTags(req.params.id, body);
  writeSources(req.params.id, body.sources);
  writeDimensions(req.params.id, body.dimensions);
  writeEssayQuestions(req.params.id, body.essay_questions);
  res.json({ ok: true });
});

router.post('/items/:id/publish', (req, res) => {
  const item = db.prepare('SELECT * FROM ca_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const errors = validateItem(item, { forPublish: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  // Publishing a redraft of a still-live item, and retiring that item in the
  // same action.
  //
  // Only when the caller asks for it. The alternative — retiring automatically
  // whenever `supersedes` is set — would withdraw published knowledge as a side
  // effect of a button labelled "publish", and the reviewer might legitimately
  // want both: a redraft is not always a replacement.
  //
  // Done in one transaction so the two items are never both live, which is the
  // state the whole column exists to prevent.
  const retire = req.body && req.body.retire_superseded;
  let retired = null;
  db.transaction(() => {
    db.prepare(
      `UPDATE ca_items SET status = 'published', updated_at = datetime('now') WHERE id = ?`
    ).run(item.id);
    if (retire && item.supersedes) {
      const n = db
        .prepare(
          `UPDATE ca_items SET status = 'discarded', updated_at = datetime('now'),
             discard_reason = ? WHERE id = ? AND status = 'published'`
        )
        .run(`Replaced by item #${item.id}, a redraft of the same article.`, item.supersedes)
        .changes;
      if (n) retired = item.supersedes;
    }
  })();
  res.json({ ok: true, retired });
});

// Discarding is a decision, not a deletion. The row stays with its reason, so
// the pipeline's judgement can be audited — a run that discards nothing is not
// being ruthless enough, and that is only visible if discards are kept.
router.post('/items/:id/discard', (req, res) => {
  const { reason } = req.body || {};
  if (!String(reason || '').trim()) {
    return res.status(400).json({ error: 'A discard needs a reason — that is the record of why.' });
  }
  db.prepare(
    `UPDATE ca_items SET status = 'discarded', discard_reason = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(String(reason).trim(), req.params.id);
  res.json({ ok: true });
});

router.post('/items/:id/restore', (req, res) => {
  db.prepare(
    `UPDATE ca_items SET status = 'draft', discard_reason = '', updated_at = datetime('now') WHERE id = ?`
  ).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM ca_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Run the correction guard against an item on demand.
router.get('/items/:id/corrections', (req, res) => {
  const item = db.prepare('SELECT * FROM ca_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json({ hits: checkCorrections(db, item) });
});

// ---- MCQs ---------------------------------------------------------------

// Approve every pending question on one item, in one action.
//
// Per-question approval exists too (PUT /mcqs/:id sets status), but the unit of
// review here is the SET: the regeneration replaces an item's whole question
// list at once, and asking the reviewer to tick eight boxes for one item would
// make the honest choice the tedious one.
router.post('/items/:id/mcqs/publish', (req, res) => {
  const item = db.prepare('SELECT id FROM ca_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  // THE SWAP HAPPENS HERE, NOT WHEN THE QUESTIONS WERE WRITTEN.
  //
  // A regenerated set REPLACES the item's old questions, and doing the delete
  // at write time left a published item showing zero questions for as long as
  // the new ones sat in this queue. So the old set stays live until the moment
  // the new one is approved, and both halves happen in one transaction — there
  // is no instant at which the item has neither.
  //
  // A question a student has already answered is never deleted: the attempt and
  // the Leitner box hang off its id, and that is real work, not a stale tag.
  let published = 0;
  let replaced = 0;
  db.transaction(() => {
    const pending = db
      .prepare(`SELECT COUNT(*) AS n FROM ca_mcqs WHERE item_id = ? AND status <> 'published'`)
      .get(item.id).n;
    if (pending) {
      replaced = db
        .prepare(
          `DELETE FROM ca_mcqs
            WHERE item_id = ? AND status = 'published'
              AND NOT EXISTS (SELECT 1 FROM ca_attempts a WHERE a.mcq_id = ca_mcqs.id)
              AND NOT EXISTS (SELECT 1 FROM ca_mcq_flags f WHERE f.mcq_id = ca_mcqs.id)`
        )
        .run(item.id).changes;
    }
    published = db
      .prepare(`UPDATE ca_mcqs SET status = 'published' WHERE item_id = ? AND status <> 'published'`)
      .run(item.id).changes;
  })();
  res.json({ ok: true, published, replaced });
});

// Approve every pending question in the queue at once.
//
// A bulk approve is normally the wrong shape for a review screen — it is a
// button that says "I did not read these". It earns its place here because the
// regeneration is one mechanical change applied uniformly: the same prompt, the
// same syllabus map, over thirty items at once. A reviewer who has read five of
// them and is satisfied should not have to click thirty times to act on that,
// and making them click thirty times is how the fifth one stops being read too.
//
// Per-item approval is still the default path and is listed above this button.
router.post('/mcqs/publish-all', (req, res) => {
  let published = 0;
  let replaced = 0;
  db.transaction(() => {
    const ids = db
      .prepare(
        `SELECT DISTINCT m.item_id AS id FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id
          WHERE m.status <> 'published'`
      )
      .all()
      .map((r) => r.id);
    for (const id of ids) {
      replaced += db
        .prepare(
          `DELETE FROM ca_mcqs
            WHERE item_id = ? AND status = 'published'
              AND NOT EXISTS (SELECT 1 FROM ca_attempts a WHERE a.mcq_id = ca_mcqs.id)
              AND NOT EXISTS (SELECT 1 FROM ca_mcq_flags f WHERE f.mcq_id = ca_mcqs.id)`
        )
        .run(id).changes;
      published += db
        .prepare(`UPDATE ca_mcqs SET status = 'published' WHERE item_id = ? AND status <> 'published'`)
        .run(id).changes;
    }
  })();
  res.json({ ok: true, published, replaced });
});

// Reject them, which means delete: an unreviewed question that was rejected has
// no later use, and keeping it would leave the pending count permanently above
// zero with nothing the reviewer can do about it.
router.post('/items/:id/mcqs/discard', (req, res) => {
  const item = db.prepare('SELECT id FROM ca_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const info = db
    .prepare(`DELETE FROM ca_mcqs WHERE item_id = ? AND status <> 'published'`)
    .run(item.id);
  res.json({ ok: true, discarded: info.changes });
});

router.post('/mcqs', (req, res) => {
  const body = req.body || {};
  const errors = validateMcq(body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  if (!body.item_id) return res.status(400).json({ error: 'item_id is required.' });

  const info = db
    .prepare(
      `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
                            correct_option, explanation, format, keyword, difficulty, fact_as_of)
       VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
               @correct_option, @explanation, @format, @keyword, @difficulty, @fact_as_of)`
    )
    .run({
      item_id: body.item_id,
      question: String(body.question).trim(),
      option_a: String(body.option_a).trim(),
      option_b: String(body.option_b).trim(),
      option_c: String(body.option_c).trim(),
      option_d: String(body.option_d).trim(),
      correct_option: body.correct_option,
      explanation: String(body.explanation || '').trim(),
      format: body.format || 'direct_recall',
      keyword: String(body.keyword || '').trim(),
      difficulty: Number(body.difficulty) || 2,
      fact_as_of: body.fact_as_of || null,
    });
  res.json({ id: info.lastInsertRowid });
});

router.put('/mcqs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM ca_mcqs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Question not found.' });
  const merged = { ...existing, ...(req.body || {}) };
  const errors = validateMcq(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  db.prepare(
    `UPDATE ca_mcqs SET question = @question, option_a = @option_a, option_b = @option_b,
       option_c = @option_c, option_d = @option_d, correct_option = @correct_option,
       explanation = @explanation, format = @format, keyword = @keyword,
       difficulty = @difficulty, fact_as_of = @fact_as_of
     WHERE id = @id`
  ).run({
    id: req.params.id,
    question: String(merged.question).trim(),
    option_a: String(merged.option_a).trim(),
    option_b: String(merged.option_b).trim(),
    option_c: String(merged.option_c).trim(),
    option_d: String(merged.option_d).trim(),
    correct_option: merged.correct_option,
    explanation: String(merged.explanation || '').trim(),
    format: merged.format || 'direct_recall',
    keyword: String(merged.keyword || '').trim(),
    difficulty: Number(merged.difficulty) || 2,
    fact_as_of: merged.fact_as_of || null,
  });
  res.json({ ok: true });
});

router.delete('/mcqs/:id', (req, res) => {
  db.prepare('DELETE FROM ca_mcqs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Skeletons ----------------------------------------------------------

router.post('/skeletons', (req, res) => {
  const { item_id, paper, question_text, skeleton_markdown } = req.body || {};
  if (!item_id || !String(question_text || '').trim()) {
    return res.status(400).json({ error: 'item_id and a question are required.' });
  }
  const info = db
    .prepare(
      `INSERT INTO ca_skeletons (item_id, paper, question_text, skeleton_markdown)
       VALUES (?, ?, ?, ?)`
    )
    .run(item_id, String(paper || ''), String(question_text).trim(), String(skeleton_markdown || ''));
  res.json({ id: info.lastInsertRowid });
});

router.put('/skeletons/:id', (req, res) => {
  const { paper, question_text, skeleton_markdown } = req.body || {};
  db.prepare(
    'UPDATE ca_skeletons SET paper = ?, question_text = ?, skeleton_markdown = ? WHERE id = ?'
  ).run(String(paper || ''), String(question_text || ''), String(skeleton_markdown || ''), req.params.id);
  res.json({ ok: true });
});

router.delete('/skeletons/:id', (req, res) => {
  db.prepare('DELETE FROM ca_skeletons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Students -----------------------------------------------------------

router.get('/students', (req, res) => {
  const students = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.exam_track, u.created_at,
              (SELECT COUNT(*) FROM ca_progress p WHERE p.user_id = u.id AND p.marked_read = 1) AS items_read,
              (SELECT COUNT(*) FROM ca_attempts a WHERE a.user_id = u.id) AS attempts,
              (SELECT SUM(a.is_correct) FROM ca_attempts a WHERE a.user_id = u.id) AS correct,
              (SELECT COUNT(*) FROM ca_user_cards c WHERE c.user_id = u.id) AS cards
         FROM users u WHERE u.role = 'student' ORDER BY u.created_at DESC`
    )
    .all();
  res.json({ students });
});

// There is no mail service on this box, so the reset flow is deliberately
// manual: the admin generates a link and sends it over whatever they already
// use to talk to that student. What it buys over the admin simply typing a new
// password is that the student ends up with one the admin never saw.
router.post('/students/:id/reset-link', (req, res) => {
  const student = db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'student'`).get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const { token, expires_at } = createResetToken(db, { userId: student.id, createdBy: req.user.id });
  res.json({ token, expires_at, name: student.name });
});

module.exports = router;
module.exports.validateMcq = validateMcq;
module.exports.validateItem = validateItem;
module.exports.FORMATS = FORMATS;
module.exports.DIMENSIONS = DIMENSIONS;
