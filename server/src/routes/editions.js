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
const { requireAuth, requireAdmin } = require('../auth');
const ingest = require('../lib/ingest');

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

const runningDraft = (editionId) =>
  db
    .prepare(`SELECT * FROM ca_runs WHERE mode = ? AND status = 'running'
               ORDER BY id DESC LIMIT 1`)
    .get(`edition-${editionId}`);

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

  const waiting = db
    .prepare(
      `SELECT COUNT(*) AS n FROM np_articles
        WHERE edition_id = ? AND status NOT IN ('duplicate', 'discarded')
          AND score IS NOT NULL AND score >= ?
          ${redraft ? '' : 'AND item_id IS NULL'}`
    )
    .get(id, Number.isFinite(minScore) ? minScore : 55).n;
  if (!waiting) {
    return res.status(409).json({
      error: 'No articles are waiting to be drafted at that score. Lower the threshold, or ' +
        'use redraft to include ones already drafted.',
    });
  }

  const argv = [DRAFTER, String(id)];
  if (Number.isFinite(minScore)) argv.push('--min-score', String(minScore));
  // Only passed when the caller explicitly asked for a cap. Left off, the worker
  // drafts every eligible article, so one press of the button finishes the
  // edition rather than leaving a remainder to notice.
  if (Number.isFinite(limit) && limit > 0) argv.push('--limit', String(limit));
  if (req.query.model) argv.push('--model', String(req.query.model));
  if (redraft) argv.push('--redraft');

  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..', '..'),
  });
  child.on('error', (e) => {
    // The worker opens its own run row, so a failure to start it leaves nothing
    // behind to mark failed — which is why this is only logged. The client sees
    // no run appear and can try again.
    console.error(`Could not start the drafter for edition ${id}: ${e.message}`);
  });
  child.unref();

  res.status(202).json({ started: true, id, waiting });
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
      `SELECT id, page, headline, standfirst, byline, dateline, chars, language,
              extraction, ocr_confidence, prominence, ap, status, discard_reason,
              merged_into, item_id, score, band, bucket, subjects, breakdown,
              substr(body, 1, 400) AS excerpt
         FROM np_articles
        WHERE edition_id = ?
        -- Highest relevance first, which is the order the reviewer wants:
        -- the point of scoring is that the list no longer has to be read whole.
        ORDER BY (status = 'duplicate'), score DESC, ap DESC, page`
    )
    .all(ed.id);

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
