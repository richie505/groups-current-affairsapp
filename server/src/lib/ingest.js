'use strict';

// Section 1 — Source Intelligence, as a library.
//
// ONE CODE PATH, TWO CALLERS
//
// The CLI (`content-pipeline/np-daily/paper.js`) and the admin upload screen
// must do the same thing to a PDF, or the app and the terminal will disagree
// about what is in an edition. So the whole of stage 1-3 lives here and both
// callers use it: extract, segment, merge, persist.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// No relevance judgement, no drafting, no model call of any kind. This layer's
// only job is "what is printed in this newspaper, and which pieces of it are the
// same event". Deciding what is worth keeping is Section 2's job and needs
// different evidence; mixing the two is what makes a pipeline impossible to
// audit, because a missing article could then be a segmentation failure or a
// relevance judgement and there is no way to tell which.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pythonBin, parseJsonStdout } = require(require('path').join(__dirname, '..', '..', '..', 'content-pipeline', 'python-bin'));

const db = require('../db');

const ROOT = path.join(__dirname, '..', '..', '..');
const NP_DIR = path.join(ROOT, 'content-pipeline', 'np-daily');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

const { segment } = require(path.join(NP_DIR, 'segment'));
const { PROFILES } = require(path.join(NP_DIR, 'profiles'));
const M = require(path.join(NP_DIR, 'merge'));

// The district and place list is maintained once, in the PIB sweep, and reused
// rather than copied so the two cannot drift.
let AP_TERMS = [];
try {
  ({ AP_TERMS } = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'sweep')));
} catch {
  AP_TERMS = ['andhra', 'amaravati', 'visakhapatnam', 'vijayawada', 'tirupati'];
}

// Resolved, not assumed. See content-pipeline/python-bin.js.
const PYTHON = pythonBin();
const LAYOUT = path.join(NP_DIR, 'layout.py');

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Stores an uploaded PDF and registers the edition.
 *
 * Idempotent on (publication, date, file hash): re-uploading the same file
 * returns the existing edition rather than creating a second one. That matters
 * because processing is the expensive part and a double-click on an upload
 * button should not cost two OCR passes.
 */
function registerUpload({ buffer, filename, publication, edition, date, language, userId }) {
  if (!buffer || !buffer.length) throw new Error('Empty upload.');
  // %PDF at byte 0 is the format's own magic number. Checking it means a
  // mis-typed upload fails here with a clear message rather than deep inside
  // PyMuPDF with a stack trace.
  if (buffer.slice(0, 4).toString('latin1') !== '%PDF') {
    throw new Error('That file is not a PDF (no %PDF header).');
  }

  const hash = sha256(buffer);
  const existing = db
    .prepare('SELECT * FROM np_editions WHERE publication = ? AND date = ? AND file_hash = ?')
    .get(publication, date, hash);
  if (existing) return { edition: existing, duplicate: true };

  ensureUploadDir();
  const safe = String(filename || 'edition.pdf').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  const stored = path.join(UPLOAD_DIR, `${date}-${hash.slice(0, 12)}-${safe}`);
  fs.writeFileSync(stored, buffer);

  const info = db
    .prepare(
      `INSERT INTO np_editions
         (publication, edition, date, language, source_file, stored_path, file_hash,
          bytes, status, uploaded_by)
       VALUES (@publication, @edition, @date, @language, @source_file, @stored_path,
               @file_hash, @bytes, 'uploaded', @uploaded_by)`
    )
    .run({
      publication,
      edition: edition || '',
      date,
      language: language || 'en',
      source_file: String(filename || ''),
      stored_path: stored,
      file_hash: hash,
      bytes: buffer.length,
      uploaded_by: userId || null,
    });

  return {
    edition: db.prepare('SELECT * FROM np_editions WHERE id = ?').get(info.lastInsertRowid),
    duplicate: false,
  };
}

/**
 * Deletes the uploaded PDF once the edition's per-edition pipeline (draft,
 * then salvage) has actually finished with it — not right after extraction,
 * because a botched OCR pass is easiest to notice by re-running extraction on
 * the original file, and that window needs to stay open through drafting.
 *
 * By the time draft+salvage are done, everything the PDF could still be worth
 * is already in np_articles / np_units in the database; the file itself is
 * just bytes on disk that a year of daily uploads would otherwise pile into
 * gigabytes. The DB row survives untouched — citations, `file_present`, and
 * the admin edition screen all already treat a missing file as normal.
 *
 * Set KEEP_UPLOADED_PDFS=1 to opt out and keep every original on disk.
 */
function cleanupUploadedFile(editionId, { onLog } = {}) {
  const log = onLog || (() => {});
  if (process.env.KEEP_UPLOADED_PDFS === '1') return;
  const ed = db.prepare('SELECT stored_path FROM np_editions WHERE id = ?').get(editionId);
  if (!ed || !ed.stored_path) return;
  try {
    if (fs.existsSync(ed.stored_path)) {
      const bytes = fs.statSync(ed.stored_path).size;
      fs.unlinkSync(ed.stored_path);
      log(`Uploaded PDF removed (${Math.round(bytes / 1024 / 1024)} MB freed) — already extracted into the database.`);
    }
  } catch (e) {
    // Untidy, not incorrect: the edition and everything it produced are unaffected.
    log(`Could not remove the uploaded PDF: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// extract + segment + merge + persist
// ---------------------------------------------------------------------------

function extractLayout(pdf, { dpi = 300, lang = 'eng', pages = null } = {}) {
  const argv = [LAYOUT, pdf, '--dpi', String(dpi), '--lang', lang];
  if (pages) argv.push('--pages', pages);
  const res = spawnSync(PYTHON, argv, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    // Without this a rupee sign in the text layer kills the process on a
    // Windows console whose default codepage is cp1252.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`layout.py failed (${res.status}): ${(res.stderr || '').slice(0, 1500)}`);
  }
  return parseJsonStdout(res.stdout, { label: 'layout.py' });
}

function isAp(article) {
  const hay = `${article.headline} ${article.dateline} ${article.body}`.toLowerCase();
  return AP_TERMS.some((t) => hay.includes(t));
}

/**
 * Processes a registered edition: OCR/extract, segment, detect same-event
 * duplicates, and write every article found.
 *
 * Synchronous and slow — around 30 seconds for a 28-page edition, most of it
 * OCR. Callers that must stay responsive should run it off the request thread;
 * the admin route does exactly that.
 */
function processEdition(editionId, { dpi = 300, onLog } = {}) {
  const ed = db.prepare('SELECT * FROM np_editions WHERE id = ?').get(editionId);
  if (!ed) throw new Error(`No edition ${editionId}`);
  if (!fs.existsSync(ed.stored_path)) throw new Error(`Uploaded file is missing: ${ed.stored_path}`);

  const lines = [];
  const log = (m) => {
    lines.push(m);
    onLog?.(m);
  };

  db.prepare("UPDATE np_editions SET status = 'processing', error = '' WHERE id = ?").run(ed.id);

  try {
    const profileHint =
      ed.language === 'te' ? 'eenadu' : /hindu/i.test(ed.publication) ? 'the-hindu' : null;
    const ocrLang = (PROFILES[profileHint] || PROFILES.generic).ocrLang;

    log(`Extracting ${path.basename(ed.stored_path)} at ${dpi} DPI (OCR language ${ocrLang})`);
    const ir = extractLayout(ed.stored_path, { dpi, lang: ocrLang });
    for (const w of ir.warnings || []) log(`! ${w}`);

    const seg = segment(ir, { profile: profileHint || undefined });
    const pagesOcr = ir.pages.filter((p) => p.source === 'ocr').length;

    log(
      `${ir.page_count} pages, ${pagesOcr} needed OCR, ${seg.skipped.length} skipped, ` +
      `profile ${seg.profile}`
    );
    for (const s of seg.skipped) log(`  skip p${s.page}: ${s.reason}`);

    // Same-event detection across the edition. Cross-script pairs are only ever
    // proposed, never merged, so a Telugu/English pair is left as two articles
    // until something can actually judge it.
    const all = seg.articles.map((a) => ({
      ...a,
      publication: ed.publication,
      edition: ed.edition,
      date: ed.date,
      language: seg.language,
    }));
    const { events, merged, proposals } = M.group(all);
    if (merged.length) log(`${merged.length} same-event pair(s) merged`);
    if (proposals.length) log(`${proposals.length} cross-language pair(s) proposed, not merged`);

    // The lead of each event is the article that carries it; the rest point at
    // the lead rather than being discarded, so the merge stays inspectable.
    const leadOf = new Map();
    for (const group of events) {
      const sorted = [...group].sort((a, b) => all[b].chars - all[a].chars);
      for (const idx of sorted) leadOf.set(idx, sorted[0]);
    }

    const insert = db.prepare(
      `INSERT INTO np_articles
         (edition_id, page, headline, standfirst, byline, bylines, credits, dateline,
          body, chars, language, extraction, ocr_confidence, prominence, ap, status,
          discard_reason, continues_on, section, genre, genre_why)
       VALUES (@edition_id, @page, @headline, @standfirst, @byline, @bylines, @credits,
               @dateline, @body, @chars, @language, @extraction, @ocr_confidence,
               @prominence, @ap, @status, @discard_reason, @continues_on,
               @section, @genre, @genre_why)`
    );

    // Provenance has to survive a re-process.
    //
    // The insert below replaces every article for this edition, which is right —
    // two generations side by side would be worse. But `item_id` is the link
    // from a newspaper article to the knowledge item it produced, and deleting
    // the row silently breaks it: the items live on with no way back to the page
    // they came from, and re-running the drafter would produce a second copy of
    // every one of them.
    //
    // So the links are lifted before the delete and put back after, matched on
    // page plus a normalised headline. Headlines are stable across a re-process
    // unless segmentation changed that specific story — which is exactly the
    // case where the old link SHOULD be dropped, because the article is no
    // longer the same article. Whatever cannot be matched is reported rather
    // than quietly lost.
    const keyOf = (page, headline) =>
      `${page}:${String(headline || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)}`;
    const priorLinks = new Map();
    for (const row of db
      .prepare(
        `SELECT page, headline, item_id, status FROM np_articles
          WHERE edition_id = ? AND item_id IS NOT NULL`
      )
      .all(ed.id)) {
      priorLinks.set(keyOf(row.page, row.headline), row);
    }
    const relink = db.prepare(
      "UPDATE np_articles SET item_id = ?, status = 'drafted' WHERE id = ?"
    );
    const setMerged = db.prepare('UPDATE np_articles SET merged_into = ? WHERE id = ?');

    const ids = new Array(all.length).fill(null);

    db.transaction(() => {
      // Replacing rather than appending, so re-processing an edition cannot
      // leave two generations of its articles side by side.
      db.prepare('DELETE FROM np_articles WHERE edition_id = ?').run(ed.id);

      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        const isLead = leadOf.get(i) === i;
        ids[i] = insert.run({
          edition_id: ed.id,
          page: a.page,
          headline: a.headline,
          standfirst: a.standfirst || '',
          byline: a.byline || '',
          // Every byline, and the credit lines under them. On an opinion piece
          // the credit is provenance rather than decoration — an argument about
          // fiscal policy from a former RBI Governor is a different object from
          // the same argument unattributed.
          bylines: (a.bylines || []).join(' | '),
          credits: (a.credits || []).join(' | '),
          dateline: a.dateline || '',
          body: a.body,
          chars: a.chars,
          language: a.language || 'en',
          extraction: a.source === 'ocr' ? 'ocr' : 'text',
          ocr_confidence: a.ocr_confidence ?? null,
          prominence: a.prominence ?? null,
          ap: isAp(a) ? 1 : 0,
          status: isLead ? 'new' : 'duplicate',
          discard_reason: isLead ? '' : 'same event as another article in this edition',
          continues_on: a.continues_on ?? null,
          // What page of the paper this is, and therefore what KIND of writing it
          // is. See content-pipeline/np-daily/genre.js: an op-ed's claims are the
          // author's, not the record's, and everything downstream needs to know
          // that before it turns them into exam facts.
          section: a.section || '',
          genre: a.genre || 'report',
          genre_why: a.genre_why || '',
        }).lastInsertRowid;
      }

      // Put the provenance back.
      let relinked = 0;
      const matched = new Set();
      for (let i = 0; i < all.length; i++) {
        const prior = priorLinks.get(keyOf(all[i].page, all[i].headline));
        if (!prior || matched.has(prior.item_id)) continue;
        matched.add(prior.item_id);
        relink.run(prior.item_id, ids[i]);
        relinked += 1;
      }
      if (priorLinks.size) {
        log(
          `Re-linked ${relinked} of ${priorLinks.size} article(s) to the items they produced` +
            (relinked < priorLinks.size
              ? ` — ${priorLinks.size - relinked} could not be matched and their items are now orphaned`
              : '')
        );
      }
      for (let i = 0; i < all.length; i++) {
        const lead = leadOf.get(i);
        if (lead !== i && ids[lead]) setMerged.run(ids[lead], ids[i]);
      }

      // Fold a jump's continuation into its origin.
      //
      // This catches what same-event detection cannot. The two halves of a jumped
      // story are written as separate pieces with separate headlines — "1978
      // 'industry' definition void under new code: SC" on the origin page and "SC
      // says 1978 'industry' definition rendered void" on the jump page — so
      // headline similarity scores them apart, and both were drafted as knowledge
      // items with eight questions between them about one event.
      //
      // The jump line says which page, and the segmenter has already resolved the
      // printed page number to a PDF index and required shared vocabulary before
      // proposing the link. Applied only where the continuation is not already
      // merged, so the same-event pass keeps precedence where both agree.
      let joined = 0;
      for (let i = 0; i < all.length; i++) {
        const link = all[i].continuation_of;
        if (!link || !ids[i]) continue;
        if (leadOf.get(i) !== i) continue;   // already merged by the same-event pass
        const originIdx = all.findIndex(
          (x, j) => j !== i && x.page === link.page && x.headline === link.headline
        );
        if (originIdx === -1 || !ids[originIdx]) continue;
        // The origin must itself be a lead.
        //
        // Where the same-event pass has ALREADY grouped these two — it picks the
        // longer half as the lead, which for a jumped story is often the
        // continuation rather than the origin — folding again points them at each
        // other. Both rows then read 'duplicate' with `merged_into` forming a
        // cycle, neither is a lead, and the event disappears from drafting
        // entirely: an event silently lost, which is worse than a duplicate.
        //
        // Observed on the second edition processed: two pairs, four articles.
        // None scored highly enough to be drafted that day, so nothing was
        // actually lost — but only by luck.
        //
        // The same-event pass has precedence, as the comment above always
        // claimed and the code did not enforce.
        if (leadOf.get(originIdx) !== originIdx) continue;
        setMerged.run(ids[originIdx], ids[i]);
        db.prepare(
          `UPDATE np_articles SET status = 'duplicate',
             discard_reason = 'continuation of the story that jumped from page ' || ?
            WHERE id = ?`
        ).run(String(link.page), ids[i]);
        joined += 1;

        // A continuation that already produced a knowledge item leaves that item
        // in the review queue as a second write-up of one event. Superseded, with
        // the reason on the row — and only while it is still a draft, because a
        // published item is knowledge in its own right and is not withdrawn by a
        // re-run, the same rule the redraft and the edition delete both follow.
        const prior = db.prepare('SELECT item_id FROM np_articles WHERE id = ?').get(ids[i]);
        if (prior && prior.item_id) {
          const n = db
            .prepare(
              `UPDATE ca_items SET status = 'discarded', updated_at = datetime('now'),
                 discard_reason = 'Duplicate: this is the jump continuation of the story drafted from page ' || ?
                WHERE id = ? AND status = 'draft'`
            )
            .run(String(link.page), prior.item_id).changes;
          if (n) log(`  superseded draft item #${prior.item_id} — same story as the origin`);
        }
      }
      if (joined) log(`${joined} jump continuation(s) folded into the story they continue`);

      db.prepare(
        `UPDATE np_editions
            SET status = 'processed', pages = @pages, profile = @profile,
                pages_ocr = @pages_ocr, pages_skipped = @pages_skipped,
                articles_found = @articles_found, events = @events, merged = @merged,
                log = @log, error = '', processed_at = datetime('now')
          WHERE id = @id`
      ).run({
        id: ed.id,
        pages: ir.page_count,
        profile: seg.profile,
        pages_ocr: pagesOcr,
        pages_skipped: seg.skipped.length,
        articles_found: all.length,
        events: events.length,
        merged: merged.length,
        log: lines.join('\n').slice(0, 20000),
      });
    })();

    // Section 2 runs immediately after Section 1, in the same pass. Scoring is
    // deterministic and free, so there is no reason to make it a separate step
    // an admin could forget: an edition arrives already triaged.
    const scored = scoreEdition(ed.id, { log });

    log(`${all.length} articles stored as ${events.length} distinct events`);
    return {
      ok: true,
      scored: scored.scored,
      critical: scored.bands.critical || 0,
      high: scored.bands.high || 0,
      articles: all.length,
      events: events.length,
      merged: merged.length,
      proposals: proposals.length,
      pagesOcr,
      skipped: seg.skipped.length,
      profile: seg.profile,
    };
  } catch (e) {
    db.prepare(
      "UPDATE np_editions SET status = 'failed', error = ?, log = ? WHERE id = ?"
    ).run(String(e.message || e).slice(0, 2000), lines.join('\n').slice(0, 20000), ed.id);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Section 2 — score, and record what the score was made of
// ---------------------------------------------------------------------------

/**
 * Scores every article of an edition, and writes the entities, keyword angles
 * and topic links that the score was derived from.
 *
 * Separate from processEdition so it can be re-run alone: the vocabularies grow
 * — new topics, new blueprint angles, a bigger PYQ corpus — and re-scoring an
 * old edition must not mean re-OCRing it. The derived rows are replaced rather
 * than merged, for the reason every derived table in this app is: a stale link
 * that survives a rebuild is indistinguishable from a current one.
 */
function scoreEdition(editionId, { log } = {}) {
  const R = require('./relevance');
  const T = require('./topics');
  const ctx = R.loadContext(db);

  const articles = db
    .prepare('SELECT * FROM np_articles WHERE edition_id = ?')
    .all(editionId);

  // A contributor credit is how a signed opinion piece ends. Finding one in
  // the middle of a body is the cheapest reliable sign that two stories were
  // merged by the column segmenter — see np_articles.bleed_suspect.
  const BLEED = /\((?:[A-Z][\w.\- ]+ )?is an? (?:expert|professor|former|senior|independent|researcher)|views expressed are personal|The writer is|is a professor at|is an expert in/i;

  const upd = db.prepare(
    `UPDATE np_articles
        SET score = @score, band = @band, bucket = @bucket, subjects = @subjects,
            breakdown = @breakdown, scored_at = datetime('now'),
            bleed_suspect = @bleed,
            discard_reason = CASE WHEN @vetoed <> '' THEN @vetoed ELSE discard_reason END,
            status = CASE
                       WHEN status IN ('drafted', 'duplicate') THEN status
                       WHEN @vetoed <> '' THEN 'discarded'
                       WHEN @band IN ('critical', 'high', 'medium') THEN 'relevant'
                       ELSE 'new'
                     END
      WHERE id = @id`
  );
  const insEnt = db.prepare(
    `INSERT OR REPLACE INTO np_article_entities (article_id, kind, name, mentions)
     VALUES (?, ?, ?, ?)`
  );
  const insKw = db.prepare(
    `INSERT OR REPLACE INTO np_article_keywords
       (article_id, keyword, subject, in_headline, pyq_count) VALUES (?, ?, ?, ?, ?)`
  );
  const insTop = db.prepare(
    `INSERT OR REPLACE INTO np_article_topics
       (article_id, topic_id, hits, in_headline, matched) VALUES (?, ?, ?, ?, ?)`
  );
  // Which Group-II syllabus units the article touches. Recorded whatever it
  // scored, because the question the admin asks of a list is "what does this
  // feed?" and a blank answer is the useful one.
  const insUnit = db.prepare(
    `INSERT OR REPLACE INTO np_article_units
       (article_id, unit_code, hits, in_headline, in_standfirst, matched)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const bands = {};
  let scored = 0;

  db.transaction(() => {
    const ids = articles.map((a) => a.id);
    if (ids.length) {
      const holes = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM np_article_entities WHERE article_id IN (${holes})`).run(...ids);
      db.prepare(`DELETE FROM np_article_keywords WHERE article_id IN (${holes})`).run(...ids);
      db.prepare(`DELETE FROM np_article_topics WHERE article_id IN (${holes})`).run(...ids);
      db.prepare(`DELETE FROM np_article_units WHERE article_id IN (${holes})`).run(...ids);
    }

    for (const a of articles) {
      const r = R.score(a, ctx);
      upd.run({
        id: a.id,
        score: r.score,
        band: r.band,
        bucket: r.bucket,
        subjects: (r.subjects || []).join(', '),
        breakdown: JSON.stringify({ ...r.breakdown, why: r.why }),
        vetoed: r.vetoed || '',
        // The signal is the MISMATCH, not the credit's position.
        //
        // A first attempt looked for a credit away from the end of the body,
        // on the theory that a signed piece ends with one. It flagged nothing:
        // in all four real cases the credit is at the end, because the merged
        // op-ed's own ending is what landed there.
        //
        // What is actually anomalous is a contributor credit inside a piece the
        // genre classifier called a REPORT. All four carry one; all 9 genuine
        // op-eds are classified `oped` and are not flagged. It catches two
        // things at once and both are worth an admin's eye: a true segmentation
        // bleed, and an op-ed the classifier read as a report.
        bleed:
          !['oped', 'editorial', 'interview'].includes(String(a.genre || 'report')) &&
          BLEED.test(String(a.body || ''))
            ? 1
            : 0,
      });
      bands[r.band] = (bands[r.band] || 0) + 1;
      scored++;

      // A vetoed article gets no derived rows. Recording the entities of a
      // robbery report would put its people and places into the graph, where
      // they would be indistinguishable from examinable ones.
      if (r.vetoed) continue;

      for (const e of R.extractEntities(a)) insEnt.run(a.id, e.kind, e.name, e.mentions);
      for (const k of r.keywords) insKw.run(a.id, k.term, k.subject || '', k.in_headline || 0, k.pyq || 0);
      for (const t of r.topics) insTop.run(a.id, t.topic_id, t.hits, t.in_headline || 0, t.matched || '');
      for (const u of r.g2_units || []) {
        insUnit.run(
          a.id, u.unit_code, u.hits,
          u.in_headline || 0, u.in_standfirst || 0,
          (u.matched || []).join(', ')
        );
      }
    }
  })();

  log?.(
    `scored ${scored}: ${bands.critical || 0} critical, ${bands.high || 0} high, ` +
    `${bands.medium || 0} medium, ${bands.low || 0} low`
  );
  return { scored, bands };
}

module.exports = {
  UPLOAD_DIR,
  registerUpload,
  cleanupUploadedFile,
  processEdition,
  scoreEdition,
  extractLayout,
  isAp,
  sha256,
};
