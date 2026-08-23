#!/usr/bin/env node
'use strict';

// Creates the database, an admin account, and the reference vocabularies.
//
// Idempotent: safe to re-run after adding keywords or units to
// reference-data.js. Reference rows are upserted, the admin is left alone if
// it already exists (so a changed password isn't reset), and no content is
// touched.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { KEYWORDS, UNITS, CORRECTIONS } = require('./reference-data');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@appscca.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

// THE QUESTION IS "IS THERE AN ADMIN", NOT "IS THERE THIS ADMIN".
//
// This used to look up ADMIN_EMAIL alone, which is the same thing right up
// until the users table is replaced — by a restore, or by shipping a database
// from another machine. Then the seeded address is genuinely absent, and a seed
// that runs on every boot cheerfully recreates it with the default password
// published in this repository.
//
// On a laptop that is harmless. On a public URL it means an admin account whose
// password everyone knows, reappearing after every deploy, no matter how
// carefully the real one was chosen — and reappearing silently, because from
// the outside nothing about the app looks any different.
//
// So: if the database already has an administrator, it does not need this one.
function seedAdmin() {
  const anyAdmin = db.prepare(`SELECT id, email FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (anyAdmin) {
    console.log(`  admin already present (${anyAdmin.email}) — no seed account created`);
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    console.log(`  admin ${ADMIN_EMAIL} already exists — left unchanged`);
    return;
  }
  db.prepare(
    `INSERT INTO users (name, email, password_hash, role, exam_track)
     VALUES (?, ?, ?, 'admin', 'both')`
  ).run('Admin', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  console.log(`  admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

function seedKeywords() {
  const upsert = db.prepare(
    `INSERT INTO ref_keywords (keyword, subject, order_index) VALUES (?, ?, ?)
     ON CONFLICT(keyword) DO UPDATE SET subject = excluded.subject`
  );
  let n = 0;
  db.transaction(() => {
    for (const [subject, list] of Object.entries(KEYWORDS)) {
      list.forEach((kw, i) => {
        upsert.run(kw, subject, i);
        n++;
      });
    }
  })();
  console.log(`  ${n} keyword angles across ${Object.keys(KEYWORDS).length} subjects`);
}

function seedUnits() {
  const upsert = db.prepare(
    `INSERT INTO ref_units (unit_code, paper, label, order_index) VALUES (?, ?, ?, ?)
     ON CONFLICT(unit_code) DO UPDATE SET paper = excluded.paper, label = excluded.label`
  );
  db.transaction(() => {
    UNITS.forEach(([code, paper, label], i) => upsert.run(code, paper, label, i));
  })();
  console.log(`  ${UNITS.length} paper units`);
}

function seedCorrections() {
  // Matched on topic rather than an id, so editing a correction's wording in
  // reference-data.js updates the row instead of adding a second one that
  // contradicts it.
  const find = db.prepare('SELECT id FROM ref_corrections WHERE topic = ?');
  const insert = db.prepare(
    `INSERT INTO ref_corrections (topic, superseded_claim, correct_position, effective_date, match_terms)
     VALUES (@topic, @superseded_claim, @correct_position, @effective_date, @match_terms)`
  );
  const update = db.prepare(
    `UPDATE ref_corrections SET superseded_claim = @superseded_claim,
       correct_position = @correct_position, effective_date = @effective_date,
       match_terms = @match_terms WHERE id = @id`
  );
  db.transaction(() => {
    for (const c of CORRECTIONS) {
      const row = find.get(c.topic);
      if (row) update.run({ ...c, id: row.id });
      else insert.run(c);
    }
  })();
  console.log(`  ${CORRECTIONS.length} known corrections`);
}

console.log('Seeding APPSC Current Affairs database…');
seedAdmin();
seedKeywords();
seedUnits();
seedCorrections();
console.log('Done.');
