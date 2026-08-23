#!/usr/bin/env node
'use strict';

// Everything that must be true before this is reachable by a student.
//
//   node server/scripts/preflight.js
//
// Exits non-zero if anything is wrong, so it can gate a deploy.
//
// WHY A SCRIPT AND NOT A CHECKLIST IN THE README
//
// Because every item on it has already been got wrong once, and a checklist is
// only read by someone who suspects there is a problem. The whole class of
// fault here is the kind that leaves the app working perfectly: the .env that
// was never loaded, the JWT secret published in the source, the admin account
// still on its seed password. None of them break a page. All of them are
// total.
//
// Checks are FAIL (refuse to deploy) or WARN (worth knowing, not blocking).

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const results = [];
const fail = (name, detail) => results.push({ level: 'FAIL', name, detail });
const warn = (name, detail) => results.push({ level: 'WARN', name, detail });
const pass = (name, detail) => results.push({ level: 'PASS', name, detail });

// ---- configuration -------------------------------------------------------

const envFile = path.join(ROOT, '.env');
if (!fs.existsSync(envFile)) {
  fail('.env', `No .env at ${envFile}. Copy .env.example and fill it in.`);
} else {
  pass('.env', 'present at the repo root, where the server looks for it');
}

const secret = process.env.JWT_SECRET || '';
if (!secret) {
  fail('JWT_SECRET', 'not set — every token would be signed with the secret in the source.');
} else if (secret === 'dev-only-secret-change-me') {
  fail('JWT_SECRET', 'is the development secret from the source. Anyone can mint an admin token.');
} else if (secret.length < 32) {
  fail('JWT_SECRET', `only ${secret.length} characters. Use at least 32; 48 random bytes is right.`);
} else {
  pass('JWT_SECRET', `set, ${secret.length} characters`);
}

if (process.env.NODE_ENV !== 'production') {
  warn(
    'NODE_ENV',
    `is "${process.env.NODE_ENV || 'unset'}". Set it to "production" — it is what turns the ` +
      'JWT_SECRET warning into a refusal to start, and what Express uses to stop sending ' +
      'stack traces.'
  );
} else {
  pass('NODE_ENV', 'production');
}

// Not a failure either way — it is a product decision, and the point of
// printing it is that it gets made once, deliberately, rather than inherited.
if (process.env.ALLOW_REGISTRATION === '0') {
  pass('registration', 'closed — accounts are created by an admin, who sends a reset link');
} else {
  warn(
    'registration',
    'is OPEN: anyone with the URL can create an account and read every published item. ' +
      'Every one of those items cost money to draft. Set ALLOW_REGISTRATION=0 to require ' +
      'an admin to create accounts.'
  );
}

const origins = (process.env.CORS_ORIGINS || '').trim();
if (origins === '*') {
  fail('CORS_ORIGINS', 'is "*" — any site could read a logged-in student\'s data.');
} else {
  pass('CORS_ORIGINS', origins ? origins : 'empty (same-origin only, which is correct here)');
}

// ---- the build the server actually serves --------------------------------

const dist = path.join(ROOT, 'web', 'dist', 'index.html');
if (!fs.existsSync(dist)) {
  fail('web build', 'web/dist/index.html is missing. Run: npm --prefix web run build');
} else {
  // A dist older than its own sources is the deploy that ships yesterday's
  // frontend against today's API — every symptom looks like a backend bug.
  const built = fs.statSync(dist).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(path.join(ROOT, 'web', 'src'));
  if (newest > built) {
    fail(
      'web build',
      'web/src has changed since web/dist was built. The server would serve the old ' +
        'frontend. Run: npm --prefix web run build'
    );
  } else {
    pass('web build', 'dist is newer than src');
  }
}

// ---- the database --------------------------------------------------------

let db;
try {
  db = require(path.join(__dirname, '..', 'src', 'db'));
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') fail('database', `integrity_check says: ${integrity}`);
  else pass('database', 'opens, integrity ok');
} catch (e) {
  fail('database', `will not open: ${e.message}`);
}

if (db) {
  // The seeded admin password is in seed.js, in the repository.
  const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
  const admins = db.prepare("SELECT id, email, password_hash FROM users WHERE role = 'admin'").all();
  if (!admins.length) {
    fail('admin account', 'there is no admin user. Run: npm --prefix server run seed');
  } else {
    const weak = admins.filter((a) => {
      try {
        return ['admin123', 'password', 'changeme', 'admin'].some((p) =>
          bcrypt.compareSync(p, a.password_hash)
        );
      } catch {
        return false;
      }
    });
    if (weak.length) {
      fail(
        'admin account',
        `${weak.map((a) => a.email).join(', ')} still uses a password from the seed script.`
      );
    } else {
      pass('admin account', `${admins.length} admin(s), none on a seed password`);
    }
  }

  // Content that is live but broken in a way a student would see.
  const noQuestions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_items i
        WHERE i.status = 'published' AND i.relevance_g2 = 1
          AND NOT EXISTS (SELECT 1 FROM ca_mcqs m
                           WHERE m.item_id = i.id AND m.status = 'published')`
    )
    .get().n;
  if (noQuestions) {
    warn(
      'live content',
      `${noQuestions} published item(s) have no visible questions. If questions are waiting ` +
        'in Admin → Review queue, approve them.'
    );
  } else {
    pass('live content', 'every published Group-II item has questions a student can see');
  }

  const unsourced = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_items i
        WHERE i.status = 'published'
          AND NOT EXISTS (SELECT 1 FROM ca_item_sources s WHERE s.item_id = i.id)`
    )
    .get().n;
  if (unsourced) warn('live content', `${unsourced} published item(s) cite no source.`);

  const backups = path.join(__dirname, '..', 'data', 'backups');
  const count = fs.existsSync(backups)
    ? fs.readdirSync(backups).filter((f) => /^ca-.*\.db$/.test(f)).length
    : 0;
  if (!count) {
    warn('backups', 'none taken. Run: node server/scripts/backup.js --verify');
  } else {
    pass('backups', `${count} in server/data/backups`);
  }
}

// ---- report --------------------------------------------------------------

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.level.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
}

const failures = results.filter((r) => r.level === 'FAIL').length;
const warnings = results.filter((r) => r.level === 'WARN').length;
console.log(
  `\n${results.length - failures - warnings} passed, ${warnings} warning(s), ${failures} failure(s).`
);
if (failures) console.log('Not ready. Fix the failures above.');
process.exit(failures ? 1 : 0);
