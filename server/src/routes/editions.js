'use strict';

// Section 1 — Source Intelligence, over HTTP. Admin only.
//
//   POST   /api/admin/editions            upload a PDF (raw body)
//   POST   /api/admin/editions/:id/process  extract, segment, dedupe
//   POST   /api/admin/editions/:id/draft    promote scored articles to items
//   GET    /api/admin/editions/:id/draft    the drafting run, for polling
//   GET    /api/admin/editions            the list
//   GET    /api/admin/editions/:id        one edition and its articles
//   DELETE /api/admin/editions/:id        remove an edition and its articles
//
// WHY THE UPLOAD IS A RAW BODY AND NOT MULTIPART
//
// Because it needs no dependency. A single PDF per request is not a form, and
// `express.raw()` — already in Express — accepts the bytes directly. Adding
// multer to parse a multipart envelope around one file would be a new install
// for a standalone app, for no gain.
//
// WHY PROCESSING IS NOT DONE IN THE REQUEST
//
// A 28-page edition takes about thirty seconds, most of it OCR, which is far
// past what a browser will wait for. So the route starts the work and returns
// immediately; the client polls the edition. `status` on np_editions is the
// state machine — uploaded, processing, processed, failed — and it is written by
// the worker rather than inferred, so a crashed run leaves 'failed' with its
// error rather than a row that looks eternally busy.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db');
const SELECT = require('../lib/select');
const { requireAuth, requireAdmin } = require('../auth');
const ingest = require('../lib/ingest');
// The run-row helpers, shared with the worker rather than reimplemented — the
// route and the worker must agree on what a run row looks like, because the
// route now opens it and the worker closes it.
const L = require(path.join(__dirname, '..', '..', '..', 'content-pipeline', 'ca-daily', 'lib'));

const router = express.Router();
router.use(requireAuth, requireAdmin);

// 120MB: the test edition was 17.8MB, but a full ePaper with heavy artwork can
// be several times that, and an upload that fails at the limit wastes the whole
// transfer.
const MAX_PDF_BYTES = 120 * 1024 * 1024;

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

router.post(
  '/',
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: MAX_PDF_BYTES }),
  (req, res) => {
    const { publication, edition, date, language } = req.query;

    if (!publication) return res.status(400).json({ error: 'publication is required.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD (the edition date).' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'No PDF received. Send the file as the request body.' });
    }

    try {
      const { edition: row, duplicate } = ingest.registerUpload({
        buffer: req.body,
        filename: req.query.filename || 'edition.pdf',
        publication: String(publication),
        edition: String(edition || ''),
        date: String(date),
        language: String(language || 'en'),
        userId: req.user.id,
      });
      // 200 rather than 201 for a duplicate, and the flag is explicit: the
      // client should say "this edition is already here" instead of implying a
      // fresh upload happened.
      //
      // stored_path is stripped here as it is on GET: it is a server filesystem
      // path, of no use to a browser, and disclosing the install layout to a
      // client is a habit worth not having.
      const { stored_path, ...safe } = row;
      res.status(duplicate ? 200 : 201).json({ edition: safe, duplicate });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ---------------------------------------------------------------------------
// process
// ---------------------------------------------------------------------------

const WORKER = path.join(__dirname, '..', '..', 'scripts', 'process-edition.js');

router.post('/:id/process', (req, res) => {
  const id = Number(req.params.id);
  const ed = db.prepare('SELECT id, status FROM np_editions WHERE id = ?').get(id);
  if (!ed) return res.status(404).json({ error: 'No such edition.' });

  // The database row is the lock, not an in-process Set. The work happens in a
  // child process, so a Set here would not see a run started by a previous
  // server process — and `status` is written by the worker itself, which makes
  // it the only claim about the run that is actually true.
  if (ed.status === 'processing') {
    return res.status(409).json({ error: 'That edition is already being processed.' });
  }

  // Claimed before the child starts, so a rapid second request is refused rather
  // than racing: the child would re-enter the same DELETE-then-insert
  // transaction and the two runs would erase each other's articles.
  db.prepare("UPDATE np_editions SET status = 'processing', error = '' WHERE id = ?").run(id);

  const dpi = Number(req.query.dpi) || 300;
  const child = spawn(process.execPath, [WORKER, String(id), '--dpi', String(dpi)], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..', '..'),
  });
  child.on('error', (e) => {
    db.prepare("UPDATE np_editions SET status = 'failed', error = ? WHERE id = ?")
      .run(`Could not start the worker: ${e.message}`, id);
  });
  // Unref'd so the server can exit without waiting for a long OCR pass.
  child.unref();

  res.status(202).json({ started: true, id, dpi });
});

// ---------------------------------------------------------------------------
// draft — Section 3, the article → note bridge
// ---------------------------------------------------------------------------
//
// Turns scored articles into drafted knowledge items. Everything Sections 1 and
// 2 produce is input to this and nothing else consumed it before: `item_id` was
// in the schema from the start and no code ever wrote it, so an article scored
// CRITICAL produced exactly as much student-visible material as one scored LOW.
//
// Out of process for the same reason as /process, but a different bottleneck:
// one model call per article at several seconds each, so twenty articles is
// minutes. The `ca_runs` row is the lock — see the worker for why that rather
// than a new column.

const DRAFTER = path.join(__dirname, '..', '..', 'scripts', 'draft-articles.js');
const SALVAGER = path.join(__dirname, '..', '..', 'scripts', 'salvage-articles.js');
const SALVAGE = require('../lib/salvage');

// A LOCK THAT CAN BE HELD BY A PROCESS THAT NO LONGER EXISTS.
//
// The worker closes its run row on the way out however it dies, but it cannot
// close it if it is killed outright — a machine that sleeps, a terminal that is
// closed, a timeout that sends SIGKILL. The row then sits at 'running' forever
// and every later attempt on that edition is refused with "already in progress"
// and no way to say otherwise from the admin screen. There is a two-day-old
// 'daily' run in this database in exactly that state.
//
// Two hours is far past any real run: the longest observed is 72 articles at
// about 33 seconds each, which is forty minutes. Past that the process is gone
// and the lock is a fossil, so it is stepped over rather than obeyed — and the
// stale row is closed as failed on the way past, so it stops being reported as
// in-flight on the runs screen too.
const STALE_RUN_HOURS = 2;

const runningDraft = (editionId) => {
  const row = db
    .prepare(`SELECT * FROM ca_runs WHERE mode = ? AND status = 'running'
               ORDER BY id DESC LIMIT 1`)
    .get(`edition-${editionId}`);
  if (!row) return null;
  const stale = db
    .prepare(`SELECT (julianday('now') - julianday(?)) * 24 > ? AS stale`)
    .get(row.created_at, STALE_RUN_HOURS).stale;
  if (!stale) return row;
  db.prepare(
    `UPDATE ca_runs SET status = 'failed', finished_at = datetime('now'),
       log = log || ? WHERE id = ? AND status = 'running'`
  ).run(
    `\n\nClosed automatically: still marked running after ${STALE_RUN_HOURS} hours, ` +
      'so the worker process is gone. Anything it drafted before it died was written as it went.',
    row.id
  );
  return null;
};

// ---------------------------------------------------------------------------
// GET /api/admin/editions/:id/plan
// ---------------------------------------------------------------------------

// WHAT THE ADAPTIVE SELECTOR WOULD DRAFT, AND WHY — FOR FREE.
//
// The admin screen used to ask for a minimum score and then show a count of the
// rows above it. That is a question the person on the screen cannot answer well:
// the score is a blend of five factors, so a threshold on it admits articles
// that feed no syllabus unit and rejects articles that feed four. Measured over
// 248 articles, `>= 45` drafted 10 that connect to nothing and skipped 54 that
// connect to something.
//
// So the screen stops asking for a number and starts showing the decision. This
// endpoint runs exactly the selector the worker runs — same module, same
// defaults — and returns the picked list with the reason each one was picked,
// plus the articles it turned down that scored well but match no unit, which is
// the syllabus vocabulary's to-do list.
//
// It costs nothing: no model call, one query per edition. That is the whole
// point of keeping selection deterministic — the admin can look before paying.
router.get('/:id/plan', (req, res) => {
  const id = Number(req.params.id);
  const ed = db.prepare('SELECT id, date, publication FROM np_editions WHERE id = ?').get(id);
  if (!ed) return res.status(404).json({ error: 'No such edition.' });

  const redraft = String(req.query.redraft || '') === '1';
  const opts = {};
  const max = Number(req.query.max);
  const min = Number(req.query.min);
  if (Number.isFinite(max) && max > 0) opts.maxItems = max;
  if (Number.isFinite(min) && min > 0) opts.minItems = min;

  const drafted = new Set(
    db
      .prepare('SELECT id FROM np_articles WHERE edition_id = ? AND item_id IS NOT NULL')
      .all(id)
      .map((r) => r.id)
  );

  const rows = SELECT.candidateRows(db, id).filter((r) => redraft || !drafted.has(r.id));
  const { picked, rejected, config } = SELECT.selectForDrafting(rows, opts);

  // The evidence behind each pick, fetched in two queries rather than two per
  // article. This is what turns "25 articles" into something a person can audit:
  // which units, and which blueprint angles the commission has actually used.
  const ids = picked.map((r) => r.id);
  const unitsBy = new Map();
  const kwBy = new Map();
  if (ids.length) {
    const holes = ids.map(() => '?').join(',');
    for (const r of db
      .prepare(
        `SELECT au.article_id, au.unit_code, au.in_headline, u.label, u.exam
           FROM np_article_units au JOIN ref_units u ON u.unit_code = au.unit_code
          WHERE au.article_id IN (${holes}) AND u.broad = 0 AND u.unfeedable = 0
          ORDER BY au.in_headline DESC, au.hits DESC`
      )
      .all(...ids)) {
      if (!unitsBy.has(r.article_id)) unitsBy.set(r.article_id, []);
      unitsBy.get(r.article_id).push({
        unit_code: r.unit_code, label: r.label, exam: r.exam, in_headline: r.in_headline,
      });
    }
    for (const r of db
      .prepare(
        `SELECT article_id, keyword, pyq_count, in_headline
           FROM np_article_keywords WHERE article_id IN (${holes})
          ORDER BY in_headline DESC, pyq_count DESC, keyword`
      )
      .all(...ids)) {
      if (!kwBy.has(r.article_id)) kwBy.set(r.article_id, []);
      kwBy.get(r.article_id).push({ keyword: r.keyword, pyq_count: r.pyq_count });
    }
  }

  res.json({
    edition: { id: ed.id, date: ed.date, publication: ed.publication },
    config,
    // Everything the selector considered, so the screen can say what was left.
    considered: rows.length,
    alreadyDrafted: drafted.size,
    picked: picked.map((r) => ({
      id: r.id,
      headline: r.headline,
      page: r.page,
      score: r.score,
      band: r.band,
      leverage: r.leverage,
      rank: r.rank,
      units: unitsBy.get(r.id) || [],
      keywords: (kwBy.get(r.id) || []).slice(0, 6),
      // How many of this article's angles the commission has asked before. The
      // blueprint half of "why this one".
      pyqBacked: (kwBy.get(r.id) || []).filter((k) => k.pyq_count > 0).length,
    })),
    // Scored well, connects to nothing. Not an error list — a vocabulary to-do
    // list, and the reason the rule can afford to be strict about the rest.
    unmatched: rejected
      .filter((r) => !r.units && r.score >= 45)
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ id: r.id, headline: r.headline, page: r.page, score: r.score })),
    // Turned down for a reason other than having no unit: too weak overall, or
    // below the rank the band admits.
    belowBar: rejected.filter((r) => r.units).length,
  });
});

router.post('/:id/draft', (req, res) => {
  const id = Number(req.params.id);
  const ed = db.prepare('SELECT id, status, date FROM np_editions WHERE id = ?').get(id);
  if (!ed) return res.status(404).json({ error: 'No such edition.' });
  if (ed.status !== 'processed') {
    return res.status(409).json({
      error: 'Process the edition before drafting from it — there are no scored articles yet.',
    });
  }

  const existing = runningDraft(id);
  if (existing) {
    return res.status(409).json({ error: 'A drafting run is already in progress.', run: existing });
  }

  const minScore = Number(req.query.min_score);
  const limit = Number(req.query.limit);
  const redraft = String(req.query.redraft || '') === '1';
  // The ADAPTIVE band. This is the knob the admin screen now offers instead of a
  // score threshold: how many items a day should yield, with the selector
  // deciding which. Absent, the defaults in lib/select.js apply.
  const maxItems = Number(req.query.max);
  const minItems = Number(req.query.min);
  const bandOpts = {};
  if (Number.isFinite(maxItems) && maxItems > 0) bandOpts.maxItems = maxItems;
  if (Number.isFinite(minItems) && minItems > 0) bandOpts.minItems = minItems;

  // AN EXPLICIT LIST OF ARTICLES, chosen by the admin, instead of a threshold.
  //
  // The score is a good default and a bad master. It cannot know that today's
  // 38 is the Bill the whole State is arguing about, or that today's 62 is a
  // routine review meeting dressed in instrument words. The admin reading the
  // page can. So the threshold stays exactly as it was, and this sits beside it.
  //
  // Validated against THIS edition before anything is spawned: an id from
  // another edition, or one that does not exist, would otherwise reach the
  // worker and be silently skipped, which looks identical to drafting nothing.
  const picked = String(req.query.articles || '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (picked.length) {
    const holes = picked.map(() => '?').join(',');
    const valid = db
      .prepare(
        `SELECT id FROM np_articles
          WHERE edition_id = ? AND id IN (${holes}) AND status NOT IN ('duplicate', 'discarded')`
      )
      .all(id, ...picked)
      .map((r) => r.id);
    const missing = picked.filter((n) => !valid.includes(n));
    if (missing.length) {
      return res.status(400).json({
        error: `${missing.length} of the ${picked.length} selected article(s) are not draftable in this edition.`,
      });
    }
    if (valid.length > 60) {
      return res.status(400).json({ error: 'Select at most 60 articles in one run.' });
    }
  }

  // A hand-picked list has already been validated against this edition, so its
  // own length IS the count. Both branches are a number, so the check below
  // reads the same either way.
  // How many the run will actually take.
  //
  // With no explicit threshold this now asks the ADAPTIVE selector rather than
  // counting rows over a flat score, so the number the admin is shown is the
  // number that will be drafted. Counting one way and drafting another is how
  // "24 waiting" turns into 35 items in the queue.
  const waiting = picked.length
    ? picked.length
    : Number.isFinite(minScore)
      ? db
          .prepare(
            `SELECT COUNT(*) AS n FROM np_articles
              WHERE edition_id = ? AND status NOT IN ('duplicate', 'discarded')
                AND score IS NOT NULL AND score >= ?
                ${redraft ? '' : 'AND item_id IS NULL'}`
          )
          .get(id, minScore).n
      : SELECT.selectForDrafting(
          SELECT.candidateRows(db, id).filter(
            (r) =>
              redraft ||
              !db.prepare('SELECT item_id FROM np_articles WHERE id = ?').get(r.id).item_id
          ),
          bandOpts
        ).picked.length;
  if (!waiting) {
    return res.status(409).json({
      error:
        'Nothing is waiting to be drafted — every article either connects to no syllabus ' +
        'unit or has been drafted already. Pick articles by hand, or use redraft.',
    });
  }

  const argv = [DRAFTER, String(id)];
  // A hand-picked list is an instruction, so it overrides the threshold rather
  // than being filtered by it: choosing an article scored 12 and then having it
  // silently dropped for scoring 12 would be the worst of both.
  if (picked.length) argv.push('--article', picked.join(','), '--min-score', '0');
  else if (Number.isFinite(minScore)) argv.push('--min-score', String(minScore));
  else {
    // The band, passed only when the caller set it. Omitted, the worker uses the
    // same defaults the plan endpoint showed — so what the screen previewed is
    // what the worker drafts.
    if (bandOpts.maxItems) argv.push('--max', String(bandOpts.maxItems));
    if (bandOpts.minItems) argv.push('--min', String(bandOpts.minItems));
  }
  // Only passed when the caller explicitly asked for a cap. Left off, the worker
  // drafts every eligible article, so one press of the button finishes the
  // edition rather than leaving a remainder to notice.
  if (Number.isFinite(limit) && limit > 0) argv.push('--limit', String(limit));
  if (req.query.model) argv.push('--model', String(req.query.model));
  if (redraft) argv.push('--redraft');

  // THE LOCK IS TAKEN HERE, NOT BY THE WORKER.
  //
  // It used to be the worker's job: this route checked for a running row, span
  // the child, and the child inserted the row several seconds later once Node
  // had booted and opened the database. Every request arriving inside that
  // window passed the check, because no row existed yet — so a double-click
  // started two runs against the same edition, and a blank-page fault that made
  // the admin click repeatedly started seven in three minutes.
  //
  // Claiming it before the spawn closes the window, and the unique index on
  // ca_runs(mode) WHERE status='running' closes what is left: if two requests
  // reach this line together, one insert wins and the other gets a constraint
  // error, which is a refusal rather than a second run.
  let runId;
  try {
    runId = L.startRun(db, {
      windowStart: ed.date,
      windowEnd: ed.date,
      mode: `edition-${id}`,
      model: String(req.query.model || process.env.OPENAI_MODEL || ''),
    });
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(e.message)) {
      return res.status(409).json({ error: 'A drafting run is already in progress.' });
    }
    throw e;
  }
  argv.push('--run-id', String(runId));

  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..', '..'),
  });
  child.on('error', (e) => {
    // The row now exists before the child does, so a failure to start it must
    // release the lock. Left running, it would refuse every later attempt on
    // this edition until the two-hour stale sweep — for a worker that never ran.
    db.prepare(
      `UPDATE ca_runs SET status = 'failed', finished_at = datetime('now'), log = ?
        WHERE id = ? AND status = 'running'`
    ).run(`The drafter could not be started: ${e.message}`, runId);
    console.error(`Could not start the drafter for edition ${id}: ${e.message}`);
  });
  child.unref();

  res.status(202).json({ started: true, id, waiting, runId });
});

// ---------------------------------------------------------------------------
// salvage — the facts inside the articles drafting turned down
// ---------------------------------------------------------------------------
//
// A button rather than something drafting does automatically, for the same
// reason drafting is a button: it costs money per article, and the number of
// articles is decided by the paper rather than by anyone here.
router.post('/:id/salvage', (req, res) => {
  const id = Number(req.params.id);
  const ed = db.prepare('SELECT id, status, date FROM np_editions WHERE id = ?').get(id);
  if (!ed) return res.status(404).json({ error: 'No such edition.' });
  if (ed.status !== 'processed') {
    return res.status(409).json({ error: 'Process the edition first — there are no articles to read.' });
  }

  // REFUSES WHILE DRAFTING IS RUNNING, and that is not politeness.
  //
  // Salvage works on the articles drafting did NOT take, which it computes from
  // which articles currently have items. Drafting is changing exactly that while
  // it runs, so the two together are a race: an article could be drafted AND
  // salvaged, and the same fact would reach a student twice — once inside a note
  // and once as a card — with nothing to show it had happened.
  const drafting = runningDraft(id);
  if (drafting) {
    return res.status(409).json({
      error: 'Drafting is still running. Salvage reads what drafting leaves behind, so it has to wait.',
      run: drafting,
    });
  }

  const waiting = SALVAGE.leftoverCount(db, id);
  if (!waiting) {
    return res.status(409).json({
      error: 'Nothing left to salvage — every article in this edition has been drafted or already examined.',
    });
  }

  let runId;
  try {
    runId = L.startRun(db, {
      windowStart: ed.date,
      windowEnd: ed.date,
      mode: `salvage-${id}`,
      model: String(req.query.model || process.env.OPENAI_MODEL || ''),
    });
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(e.message)) {
      return res.status(409).json({ error: 'A salvage run is already in progress.' });
    }
    throw e;
  }

  const argv = [SALVAGER, String(id), '--run-id', String(runId)];
  if (req.query.limit) argv.push('--limit', String(Number(req.query.limit) || 0));
  if (req.query.model) argv.push('--model', String(req.query.model));

  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..', '..'),
  });
  child.on('error', (e) => {
    db.prepare(
      `UPDATE ca_runs SET status = 'failed', finished_at = datetime('now'), log = ?
        WHERE id = ? AND status = 'running'`
    ).run(`The salvage pass could not be started: ${e.message}`, runId);
    console.error(`Could not start salvage for edition ${id}: ${e.message}`);
  });
  child.unref();

  res.status(202).json({ started: true, id, waiting, runId });
});

// How much this edition still has to salvage, and the last run's outcome. Same
// shape as the drafting poll so the client needs one code path.
router.get('/:id/salvage', (req, res) => {
  const id = Number(req.params.id);
  const run = db
    .prepare(`SELECT * FROM ca_runs WHERE mode = ? ORDER BY id DESC LIMIT 1`)
    .get(`salvage-${id}`);
  res.json({
    waiting: SALVAGE.leftoverCount(db, id),
    salvaged: db
      .prepare(
        `SELECT COUNT(*) AS n FROM ca_items i JOIN np_articles a ON a.item_id = i.id
          WHERE a.edition_id = ? AND i.salvaged = 1`
      )
      .get(id).n,
    run: run || null,
  });
});

// Poll target while a run is in flight, and the record of the last one after it
// finishes. Same shape either way so the client does not need two code paths.
router.get('/:id/draft', (req, res) => {
  const id = Number(req.params.id);
  const run = db
    .prepare(`SELECT * FROM ca_runs WHERE mode = ? ORDER BY id DESC LIMIT 1`)
    .get(`edition-${id}`);
  res.json({ run: run || null, running: !!(run && run.status === 'running') });
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.status <> 'duplicate') AS distinct_articles,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.ap = 1 AND a.status <> 'duplicate') AS ap_articles,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.item_id IS NOT NULL) AS drafted,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.band = 'critical') AS critical,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.band = 'high') AS high,
              (SELECT COUNT(*) FROM np_articles a
                WHERE a.edition_id = e.id AND a.status = 'discarded') AS discarded
         FROM np_editions e
        ORDER BY e.date DESC, e.id DESC`
    )
    .all();
  // stored_path is a server filesystem path and is of no use to a browser.
  res.json({ editions: rows.map(({ stored_path, ...rest }) => rest) });
});

router.get('/:id', (req, res) => {
  const ed = db.prepare('SELECT * FROM np_editions WHERE id = ?').get(Number(req.params.id));
  if (!ed) return res.status(404).json({ error: 'No such edition.' });

  const articles = db
    .prepare(
      // bleed_suspect rides along so the admin screen can warn that this
      // article may be two stories merged — see np_articles.bleed_suspect.
      `SELECT id, page, headline, standfirst, byline, dateline, chars, language,
              COALESCE(bleed_suspect, 0) AS bleed_suspect,
              extraction, ocr_confidence, prominence, ap, status, discard_reason,
              merged_into, item_id, score, band, bucket, subjects, breakdown,
              section, genre, genre_why, bylines, credits,
              substr(body, 1, 400) AS excerpt
         FROM np_articles
        WHERE edition_id = ?
        -- Highest relevance first, which is the order the reviewer wants:
        -- the point of scoring is that the list no longer has to be read whole.
        ORDER BY (status = 'duplicate'), score DESC, ap DESC, page`
    )
    .all(ed.id);

  // Which Group-II syllabus units each article feeds. Attached in one query
  // rather than joined, because an article touches several and a join would
  // multiply the rows the client then has to collapse again.
  //
  // This is the column the admin actually reads before choosing what to draft:
  // an article with no unit beside it is filler, whatever it scored.
  if (articles.length) {
    const byId = new Map(articles.map((a) => [a.id, a]));
    for (const a of articles) a.units = [];
    const holes = articles.map(() => '?').join(',');
    for (const r of db
      .prepare(
        `SELECT u.article_id, u.unit_code, u.in_headline, u.matched, r.label, r.paper
           FROM np_article_units u
           LEFT JOIN ref_units r ON r.unit_code = u.unit_code
          WHERE u.article_id IN (${holes})
          ORDER BY u.in_headline DESC, u.unit_code`
      )
      .all(...articles.map((a) => a.id))) {
      byId.get(r.article_id)?.units.push({
        unit_code: r.unit_code, label: r.label, paper: r.paper,
        in_headline: r.in_headline, matched: r.matched,
      });
    }
  }

  const { stored_path, ...safe } = ed;
  res.json({
    edition: safe,
    // The file is still on disk, which matters for re-processing; the path is not
    // exposed but its presence is.
    file_present: fs.existsSync(stored_path),
    articles,
  });
});

router.get('/:id/articles/:articleId', (req, res) => {
  const row = db
    .prepare('SELECT * FROM np_articles WHERE id = ? AND edition_id = ?')
    .get(Number(req.params.articleId), Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No such article.' });
  res.json({ article: row });
});

router.delete('/:id', (req, res) => {
  const ed = db.prepare('SELECT * FROM np_editions WHERE id = ?').get(Number(req.params.id));
  if (!ed) return res.status(404).json({ error: 'No such edition.' });

  // Articles cascade. The knowledge items they produced do NOT: an item that has
  // been reviewed and published is knowledge in its own right and must not
  // disappear because somebody tidied up the newspaper it came from. Their
  // np_articles link is simply lost, which the item's own citation still covers.
  db.prepare('DELETE FROM np_editions WHERE id = ?').run(ed.id);
  try {
    if (ed.stored_path && fs.existsSync(ed.stored_path)) fs.unlinkSync(ed.stored_path);
  } catch {
    // A stored file that cannot be removed is untidy, not incorrect.
  }
  res.json({ ok: true });
});

module.exports = router;
