#!/usr/bin/env node
'use strict';

// A consistent copy of the database, safe to take while the server is running.
//
//   node server/scripts/backup.js [--dir <path>] [--keep 14] [--verify]
//
// WHY THIS EXISTS
//
// Because there was no way back. On 23 August a backfill script was run twice
// and wrote an empty string over 313 of 314 datelines. It was recoverable only
// because the source PDFs happened still to be on disk and the column happened
// to be derivable from them. Neither is true of the drafted notes, the review
// decisions, the question bank, or a student's attempt history — those exist in
// exactly one place, and a bad UPDATE, a bad merge or a bad disk ends them.
//
// The corpus is also not cheap. Every item in it was paid for by the word.
//
// WHY NOT `cp ca.db backup.db`
//
// Because SQLite is in WAL mode, so recent commits live in a sidecar file until
// a checkpoint. A plain copy taken at the wrong moment produces a database
// missing its most recent writes, and — this is the dangerous part — it opens
// cleanly and reports no error. You find out when you restore it.
//
// better-sqlite3's `backup()` uses SQLite's own online backup API: it copies
// page by page, restarting if a write lands mid-copy, and the result is a
// single self-contained file consistent as of one instant. It does not block
// the server while it runs.

const fs = require('fs');
const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'backups');
const dir = path.resolve(arg('dir', DEFAULT_DIR));
const keep = Number(arg('keep', 14));
const verify = process.argv.includes('--verify');

fs.mkdirSync(dir, { recursive: true });

// Second-resolution, sortable, and legal as a filename on Windows — which
// rules out the colons in an ISO timestamp.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(dir, `ca-${stamp}.db`);

db.backup(target)
  .then(() => {
    const bytes = fs.statSync(target).size;

    // A backup nobody has opened is a hope, not a backup. `--verify` opens the
    // copy and runs SQLite's own integrity check plus one real query, so a
    // corrupt or truncated file is found now rather than during a restore.
    if (verify) {
      const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
      const copy = new Database(target, { readonly: true });
      const integrity = copy.pragma('integrity_check', { simple: true });
      const items = copy.prepare('SELECT COUNT(*) AS n FROM ca_items').get().n;
      const mcqs = copy.prepare('SELECT COUNT(*) AS n FROM ca_mcqs').get().n;
      copy.close();
      // Opening the copy created its own -wal and -shm sidecars. Leaving them
      // beside the backup defeats the point of taking a self-contained file:
      // whoever restores it would have to know to copy three files, and would
      // silently get a stale database if they copied one.
      for (const side of ['-wal', '-shm']) {
        try {
          if (fs.existsSync(target + side)) fs.unlinkSync(target + side);
        } catch {
          // An empty sidecar left behind is untidy, not a failed backup.
        }
      }
      if (integrity !== 'ok') {
        console.error(`FAILED integrity_check on ${target}: ${integrity}`);
        process.exit(1);
      }
      console.log(`verified: integrity ok, ${items} item(s), ${mcqs} question(s)`);
    }

    console.log(`${target}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);

    // Retention. Oldest first, delete past `keep`.
    //
    // Deliberately count-based rather than age-based: an age rule deletes every
    // backup you have if the job stops running for a fortnight and then runs
    // once, which is precisely the situation in which they are needed.
    if (Number.isFinite(keep) && keep > 0) {
      const mine = fs
        .readdirSync(dir)
        .filter((f) => /^ca-.*\.db$/.test(f))
        .sort();
      const old = mine.slice(0, Math.max(0, mine.length - keep));
      for (const f of old) fs.unlinkSync(path.join(dir, f));
      if (old.length) console.log(`removed ${old.length} older backup(s), keeping ${keep}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(`Backup failed: ${e.message}`);
    process.exit(1);
  });
