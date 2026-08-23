#!/usr/bin/env node
'use strict';

// Ships this machine's database to a running instance of the app.
//
//   node server/scripts/push-db.js --to https://your-app.example --email you@x --dry-run
//   node server/scripts/push-db.js --to https://your-app.example --email you@x
//
// WHY THIS EXISTS
//
// The app can be deployed somewhere with a mounted volume and no shell — no
// scp, no rsync, nothing to copy a file with. The content lived on a laptop and
// the server had no route to receive it.
//
// So: a checkpointed copy is POSTed to the admin restore endpoint, which
// validates it, keeps whatever it replaces, and restarts. See the /restore
// route in server/src/routes/admin.js.
//
// THE LOCAL DATABASE IS NEVER MODIFIED. This reads it, checkpoints the WAL into
// a COPY, and sends the copy. Nothing about this command changes what is on
// this machine — which matters, because the laptop is the original and the
// remote is the replica, not the other way round.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib')).loadEnv();

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const args = {
  to: (arg('to') || '').replace(/\/+$/, ''),
  email: arg('email'),
  dryRun: process.argv.includes('--dry-run'),
};

if (!args.to || !args.email) {
  console.error('Usage: node server/scripts/push-db.js --to <https://host> --email <admin email> [--dry-run]');
  process.exit(2);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ca.db');


// Muted by overriding readline's own output hook — the standard idiom, rather
// than the raw-stdin listener this used to use. That version fought readline
// for the same keystrokes, which is fragile everywhere and reliably wrong in
// PowerShell, where two consumers interleave and the answer arrives truncated
// or empty.
//
// PUSH_PASSWORD is honoured for non-interactive use. Not offered as a --flag:
// an argument is visible in shell history and in the process list to every
// other user on the machine.
function askPassword(prompt) {
  if (process.env.PUSH_PASSWORD) return Promise.resolve(process.env.PUSH_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted) rl.output.write(str);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(String(answer || '').trim());
    });
    muted = true;
  });
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}`);
    process.exit(1);
  }

  // A COPY, checkpointed. Reading the live file while a WAL is outstanding
  // gives a torn database that looks fine until the missing pages are asked
  // for. better-sqlite3's backup() is the supported way to get a consistent
  // snapshot of a database that may be in use.
  const Database = require('better-sqlite3');
  const tmp = path.join(os.tmpdir(), `ca-push-${process.pid}.db`);
  const src = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  await src.backup(tmp);
  src.close();

  const probe = new Database(tmp, { readonly: true });
  const n = (sql) => probe.prepare(sql).get().n;
  const summary = {
    users: n('SELECT COUNT(*) AS n FROM users'),
    admins: n(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`),
    days: n(`SELECT COUNT(*) AS n FROM ca_days WHERE status = 'published'`),
    items: n('SELECT COUNT(*) AS n FROM ca_items'),
    questions: n('SELECT COUNT(*) AS n FROM ca_mcqs'),
  };
  probe.close();

  const bytes = fs.statSync(tmp).size;
  console.log(`Local database: ${DB_PATH}`);
  console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB · ${summary.items} items · ` +
    `${summary.questions} questions · ${summary.days} published digests · ` +
    `${summary.users} users (${summary.admins} admin)`);
  console.log(`Target: ${args.to}`);
  console.log('');
  console.log('This REPLACES the database on the target. The target keeps a copy of');
  console.log('what it replaced. Nothing on this machine is modified.');

  if (args.dryRun) {
    fs.unlinkSync(tmp);
    console.log('\nDRY RUN — nothing was sent.');
    return;
  }

  const password = await askPassword(`\nPassword for ${args.email} on ${args.to}: `);

  const login = await fetch(`${args.to}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: args.email, password }),
  });
  if (!login.ok) {
    fs.unlinkSync(tmp);
    console.error(`Login failed (${login.status}). ${(await login.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const { token } = await login.json();

  console.log(`Uploading ${(bytes / 1024 / 1024).toFixed(1)} MB…`);
  const res = await fetch(`${args.to}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
    body: fs.readFileSync(tmp),
  });
  const text = await res.text();
  fs.unlinkSync(tmp);

  if (!res.ok) {
    console.error(`Refused (${res.status}): ${text.slice(0, 300)}`);
    process.exit(1);
  }

  const out = JSON.parse(text);
  console.log(`\nRestored: ${out.restored.items} items, ${out.restored.questions} questions, ` +
    `${out.restored.users} users.`);
  console.log(`The target kept its previous database as ${out.previous_kept_at}.`);
  console.log('It is restarting now; give it a few seconds.');
  console.log('\nYour local database is untouched.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
