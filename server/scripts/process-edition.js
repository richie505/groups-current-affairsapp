#!/usr/bin/env node
'use strict';

// Processes one uploaded edition, in its own process.
//
//   node server/scripts/process-edition.js <editionId> [--dpi 300]
//
// WHY A SEPARATE PROCESS AND NOT setImmediate
//
// Because `processEdition` is synchronous from top to bottom — spawnSync for the
// OCR pass, synchronous better-sqlite3 for every write — and Node is
// single-threaded. Deferring it with setImmediate does not make it concurrent;
// it just moves a thirty-second block to the next tick, during which the server
// answers nothing at all.
//
// That was observable rather than theoretical: with the work on the event loop,
// a second process request did not get the intended 409, it simply queued behind
// the first and was answered thirty seconds later once the run had finished. The
// same block would have made the client's poll-for-status impossible, since the
// poll cannot be served while the thing it is polling is running.
//
// So the route spawns this, unref'd, and returns immediately. WAL mode lets this
// process write while the server keeps reading, and the edition's `status`
// column — written here, not inferred by the caller — is the only shared state
// the two need.

const path = require('path');

const id = Number(process.argv[2]);
const dpiFlag = process.argv.indexOf('--dpi');
const dpi = dpiFlag !== -1 ? Number(process.argv[dpiFlag + 1]) : 300;

if (!Number.isInteger(id) || id <= 0) {
  console.error('Usage: node server/scripts/process-edition.js <editionId> [--dpi 300]');
  process.exit(2);
}

const ingest = require(path.join(__dirname, '..', 'src', 'lib', 'ingest'));

try {
  const r = ingest.processEdition(id, {
    dpi,
    onLog: (m) => console.log(`[edition ${id}] ${m}`),
  });
  console.log(
    `[edition ${id}] done: ${r.articles} articles, ${r.events} events, ` +
    `${r.merged} merged, ${r.pagesOcr} pages OCR'd, ${r.skipped} pages skipped`
  );

  // RELEVANCE TRIAGE FOLLOWS, AUTOMATICALLY.
  //
  // Chained here rather than from the route, for the reason drafting chains
  // salvage: a step that only runs when a particular caller remembers to ask is
  // a step that stops running. However an edition was processed — the admin
  // button, this command line, a future cron — it arrives already classified.
  //
  // This is the first model spend in the app that begins without somebody
  // pressing a button for it, and that is a deliberate change of policy rather
  // than an oversight. It is defensible because of the shape of the bill: seven
  // cheap calls read the whole edition, and what they buy is not drafting
  // anything, it is knowing what NOT to draft. The pass it replaces sent every
  // article with a syllabus unit to the salvage lane at a call apiece.
  //
  // Detached and unref'd so this process can exit now. The triage worker owns
  // its own run row and closes it however it dies; the articles are on disk and
  // are unaffected either way.
  if (!process.argv.includes('--no-triage')) {
    try {
      const { spawn } = require('child_process');
      const child = spawn(
        process.execPath,
        [path.join(__dirname, 'triage-edition.js'), String(id)],
        { detached: true, stdio: 'ignore', cwd: path.join(__dirname, '..', '..') }
      );
      child.unref();
      console.log(`[edition ${id}] relevance triage started (--no-triage to skip).`);
    } catch (e) {
      // Worth a line, not worth failing the extraction for. The articles are
      // stored; triage can be started again from the edition screen.
      console.error(`[edition ${id}] could not start triage: ${e.message}`);
    }
  }

  process.exit(0);
} catch (e) {
  // processEdition has already recorded 'failed' and the message on the row, so
  // the exit code is for the operator reading a terminal, not for the app.
  console.error(`[edition ${id}] FAILED: ${e.message}`);
  process.exit(1);
}
