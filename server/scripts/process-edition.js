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
  process.exit(0);
} catch (e) {
  // processEdition has already recorded 'failed' and the message on the row, so
  // the exit code is for the operator reading a terminal, not for the app.
  console.error(`[edition ${id}] FAILED: ${e.message}`);
  process.exit(1);
}
