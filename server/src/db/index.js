const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ca.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// BEFORE THE SCHEMA, NOT AFTER — because the schema now asserts something this
// database might already violate.
//
// `idx_runs_one_running` is a UNIQUE index over the running runs, and creating
// it fails if two rows already break it. schema.sql runs on every boot, so a
// database carrying leftover duplicates would refuse to start — turning a
// harmless bit of stale state into an outage, which is a far worse fault than
// the one the index exists to prevent.
//
// So the duplicates are closed first. They are already dead by definition: a
// second run against the same edition never held the lock, and any run still
// marked running at boot has no process behind it, because the worker is a
// child of a server that has just restarted.
(function closeOrphanedRuns() {
  const hasRuns = db
    .prepare(`SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'ca_runs'`)
    .get();
  if (!hasRuns) return;
  const closed = db
    .prepare(
      `UPDATE ca_runs SET status = 'failed', finished_at = datetime('now'),
         log = log || ?
        WHERE status = 'running'
          AND id NOT IN (SELECT MAX(id) FROM ca_runs WHERE status = 'running' GROUP BY mode)`
    )
    .run(
      '\n\nClosed at startup: a second run was opened against this mode while ' +
        'another was already in flight, so it never held the drafting lock.'
    ).changes;
  if (closed) console.log(`[db] closed ${closed} duplicate running run(s)`);
})();

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Column additions cannot live in schema.sql — it runs on every boot, and
// ALTER TABLE ADD COLUMN throws once the column exists. Guarded here instead by
// reading the table's actual shape first, so it is a no-op after the first run
// and an existing database picks up new fields without being rebuilt.
(function addMissingColumns() {
  const columns = (table) => db.pragma(`table_info(${table})`).map((c) => c.name);

  const wanted = {
    // The syllabus map grew a second exam. `ref_units` held Papers I to V — the
    // Group-I Mains map — and nothing else, so "is this on the syllabus?" was
    // only ever asked of Group I. `exam` separates the two; `syllabus_text` is
    // APPSC's own wording, which the drafter is shown so it writes to the unit
    // rather than to the label. See server/scripts/g2-syllabus.js.
    ref_units: [
      ['exam', "TEXT NOT NULL DEFAULT 'g1'"],
      ['syllabus_text', "TEXT NOT NULL DEFAULT ''"],
      ['marks', 'INTEGER'],
      // A unit nothing in a newspaper can feed (mental ability), or one that
      // matches everything and is therefore evidence of nothing (the 30-mark
      // current-affairs paper). Both are excluded from scoring, for opposite
      // reasons, and both are recorded so their absence is a decision.
      ['unfeedable', 'INTEGER NOT NULL DEFAULT 0'],
      ['broad', 'INTEGER NOT NULL DEFAULT 0'],
      // How this paper is ANSWERED. Three of the four APPSC papers this app
      // serves are objective and one is descriptive, and the same article has
      // to yield different material for each — a recognisable fact for a
      // ticked box, an argument for a written one. Recording it on the unit is
      // what makes that measurable rather than assumed.
      ['format', "TEXT NOT NULL DEFAULT 'descriptive'"],
    ],
    // Paced learning. Off for everyone until they choose otherwise, which is why
    // it is a column with a default rather than a settings table: the feature is
    // a discipline, and a discipline nobody opted into is an obstacle.
    // See server/src/lib/pacing.js.
    users: [
      // WHAT MAKES A SESSION REVOCABLE.
      //
      // A JWT is valid until it expires, and this app's expire in thirty days.
      // So changing a password did nothing to the sessions already out there:
      // the token on a lost phone, or on the machine the password was changed
      // *because of*, kept working for up to a month. There was no jti, no
      // deny-list and no version — nothing in the system could say "not that
      // one".
      //
      // A counter on the row is the smallest thing that can. It rides in the
      // token as `tv` and is compared against this column on every
      // authenticated request; bumping it invalidates every token ever issued
      // for that account at once, which is exactly what "I changed my
      // password" should mean. The device doing the changing is handed a
      // fresh token in the same response, so it stays signed in and every
      // other device does not.
      ['token_version', 'INTEGER NOT NULL DEFAULT 0'],
      ['pacing', "TEXT NOT NULL DEFAULT 'off'"],
      // The student's own reading time, in minutes, used when pacing is set to
      // 'custom'. Stored even while another mode is selected, so switching to
      // 'Your own time' and back does not lose the number they chose.
      ['pacing_minutes', 'INTEGER NOT NULL DEFAULT 4'],
    ],
    // When the reading clock started for this item. On the progress row rather
    // than in a table of its own because it is the same fact as `marked_read`
    // seen earlier: one row per user per item, already indexed, already deleted
    // with the item.
    ca_progress: [['reading_started_at', 'TEXT']],
    // Which syllabus unit a question TESTS.
    //
    // Three of the four APPSC papers are objective, and until now every
    // question was tagged with a keyword angle and a format but with no unit at
    // all — so "how well is Group-I Prelims section B covered" was a question
    // the bank could not answer about itself. Coverage was measurable on
    // articles and invisible on the thing a student actually practises.
    ca_mcqs: [
      ['unit_code', "TEXT NOT NULL DEFAULT ''"],
      // WHAT THE UNIT USED TO SAY, WHEN IT SAID SOMETHING IMPOSSIBLE.
      //
      // `unit_code` may only hold a unit the question's item carries. 128
      // questions written before that rule existed hold one their item does
      // not, and no evidence in the question text chooses a replacement — the
      // alias lookup resolved 60 of them and then stopped, and re-running it
      // after 56 new syllabus mappings resolved none.
      //
      // Blanking is the only way to make the invariant true, and blanking alone
      // would throw away the fact that somebody once filed the question
      // somewhere. So the old value moves here. Nothing is lost, the column
      // means what it claims again, and one UPDATE puts it back.
      ['unit_code_prior', 'TEXT'],
      // Whether this particular QUESTION has been reviewed.
      //
      // Item status used to be the only gate, which was right while questions
      // only ever arrived with the item that carried them. It stopped being
      // right the moment questions could be regenerated on an item that is
      // already published — re-tagging the bank to syllabus units rewrites the
      // questions on 33 live items, and without this column every one of them
      // would reach a student the instant the script finished.
      //
      // Defaults to 'published' so the 270 questions that existed before the
      // column keep working: they were reviewed as part of their item, and a
      // default of 'draft' would have silently emptied every practice screen.
      // Only questions written onto an ALREADY-PUBLISHED item start as 'draft'.
      ['status', "TEXT NOT NULL DEFAULT 'published'"],
    ],
    // The eight-section Group-I note template. Added after the first version
    // shipped with a single angle field, so existing rows keep their fact and
    // angle and simply have the new sections empty until edited or redrafted.
    ca_items: [
      // A FACT SALVAGED FROM AN ARTICLE THAT WAS NOT ITSELF EXAMINABLE.
      //
      // "Adani calls on Karnataka CM" is a routine political statement and the
      // scorer is right to rank it low. But paragraph nine names a twin-tube
      // tunnel road with a length and a cost, and that is a question. The
      // article is not worth an item; the fact is.
      //
      // A flag rather than a fifth value in the bucket CHECK, for two reasons.
      // Changing a CHECK constraint in SQLite means rebuilding the table, which
      // is not something to do to 180 live rows for a display grouping. And the
      // bucket stays TRUE: a salvaged fact about a Karnataka tunnel really is
      // national and a salvaged AP fact really is AP, so filtering by bucket
      // keeps working. The digest groups on this flag; the data does not lose
      // anything.
      ['salvaged', 'INTEGER NOT NULL DEFAULT 0'],
      // What KIND of source this item was drafted from — 'report', 'oped',
      // 'editorial', 'interview'. Copied onto the item rather than read through
      // np_articles because it has to survive the article: an item outlives the
      // edition row it came from, and "is this a fact or a columnist's claim"
      // must stay answerable for as long as a student can read the item.
      // The item this one is a redraft of, when that item is still live.
      //
      // A redraft repoints the article at its new item. When the old item was a
      // DRAFT the drafter discards it as superseded, which is correct. When the
      // old item was PUBLISHED it is deliberately left alone — published
      // knowledge must not be withdrawn because somebody re-ran a script — and
      // the result was a new draft with no link back to the live item it
      // duplicates. Item #133 sat in the review queue for a day as a better
      // version of published item #59, and nothing on either row said so;
      // publishing it would have shown a student the same story twice.
      ['supersedes', 'INTEGER'],
      ['source_genre', "TEXT NOT NULL DEFAULT 'report'"],
      // Who is making the claim, where the source was signed opinion. Rendered
      // beside the item so an argument is never presented as anonymous record.
      ['source_author', "TEXT NOT NULL DEFAULT ''"],
      // The STATIC syllabus content the news sits on top of.
      //
      // `static_linkage` names the topic a news item updates — "this updates the
      // static topics of inter-State river-water disputes, riparian rights,
      // tribunals". That tells a candidate what to go and read, and then leaves
      // them to find it. A news item is unusable in an answer without the
      // standing material underneath it: nobody writes a Mains answer on a
      // Krishna water dispute out of one day's report.
      //
      // So this carries the reading itself, exam-shaped, alongside the news.
      ['static_notes', "TEXT NOT NULL DEFAULT ''"],
    ],
    // Whether `stem` is the question as printed, or only a description of it.
    //
    // The hand-tagged PYQ bank records each question as a short gloss
    // ("Andhra newspaper founders/dates") rather than verbatim text, which is
    // perfectly good evidence of WHICH keyword was tested in WHICH format — the
    // only thing the format engine needs — but is useless as a practice
    // question and must never be served as one. Recording the difference is the
    // only way to keep both uses honest.
    pyq_questions: [
      ['stem_kind', "TEXT NOT NULL DEFAULT 'verbatim'"],
      ['source', "TEXT NOT NULL DEFAULT 'extracted'"],
    ],
    // Section 2 — the relevance verdict, stored on the article it judges.
    //
    // `breakdown` holds the five factor scores as JSON, which is not
    // decoration: a single number nobody can decompose is a number nobody
    // trusts, and the first question an admin asks about "62 / HIGH" is which
    // part of it came from where. Keeping the breakdown also means a change to
    // the weights can be evaluated against past articles instead of guessed at.
    // The evidence flags the syllabus matcher writes — see schema.sql for what
    // each one is and why the old single flag was two claims in a trench coat.
    ref_unit_aliases: [
      ['standalone', 'INTEGER NOT NULL DEFAULT 0'],
      // A HAND DECISION THAT THE BACKFILL MUST NOT ARGUE WITH.
      //
      // `standalone` is derived — a phrase or an acronym earns it, anything
      // else does not — and the derivation is right often enough to be worth
      // keeping. What it cannot see is a single mixed-case word that is a
      // unique proper noun: `Gorkhaland` names exactly one thing in the world
      // and `BHAVYA` is an acronym six characters long, so neither is a phrase
      // and neither is short enough to be read as an acronym. The rule scored
      // both 0 and there is no wording of the rule that would fix that without
      // also admitting every ordinary noun.
      //
      // NULL means "no opinion, derive it". 1 or 0 is a decision the backfill
      // copies through untouched, and seed-g2-syllabus.js carries it across the
      // clear-and-rebuild so a reseed does not silently discard it.
      ['standalone_override', 'INTEGER'],
      // WHERE THIS ROW CAME FROM, AND WHETHER IT HAS EVER DONE ANYTHING.
      //
      // The syllabus audit added 56 mappings, and 51 of the rows it ruled on
      // had never fired: no tag earned, no corpus hit, in four editions of one
      // newspaper. They were approved on the syllabus text, which is the right
      // call — an untested mapping is not a failed one — but it leaves a
      // vocabulary in which nobody can tell a proven row from a hopeful one.
      //
      // `provenance` says who put it here: 'seed' for the original syllabus
      // vocabulary, 'batch-YYYY-MM-DD' for a reviewed alias batch,
      // 'syllabus-audit-YYYY-MM' for a mapping added by an audit pass.
      //
      // `first_hit_at` is stamped by the scorer the first time the alias is
      // part of the evidence for a tag that survives the filter, and never
      // again. NULL means "has never earned anything yet", which is the number
      // the monthly audit exists to keep visible.
      ['provenance', "TEXT NOT NULL DEFAULT 'seed'"],
      ['first_hit_at', 'TEXT'],
      // A COMMON NOUN THAT NAMES A DOMAIN BUT NOT A TOPIC.
      //
      // `monsoon`, `census`, `port`, `transport`, `regulator` each appear in
      // 1-5% of the corpus. One of them is not evidence, and the audits showed
      // that TWO of them are not either: `monsoon, census` filed a story about
      // Adivasi employment under geography, and `lift irrigation, canal` filed
      // a school-bus accident there too. So the two-distinct-terms clause now
      // requires at least one term that is not weak.
      //
      // Weakness is about the term, not the tag: a weak term still counts
      // towards the tag when a strong one sits beside it, and still carries a
      // unit outright when it is in the headline.
      ['weak', 'INTEGER NOT NULL DEFAULT 0'],
    ],
    np_article_units: [['in_standfirst', 'INTEGER NOT NULL DEFAULT 0']],
    np_articles: [
      ['score', 'REAL'],
      ['band', "TEXT NOT NULL DEFAULT ''"],
      ['bucket', "TEXT NOT NULL DEFAULT ''"],
      ['subjects', "TEXT NOT NULL DEFAULT ''"],
      ['breakdown', "TEXT NOT NULL DEFAULT ''"],
      ['scored_at', 'TEXT'],
      // The page a story runs on to, where the page said so ("CONTINUED ON »
      // PAGE 8"). Recorded rather than acted on: the jump is not yet used to
      // join the continuation, but a jump that is stored can be joined later
      // and one that was stripped and forgotten cannot.
      ['continues_on', 'INTEGER'],
      // What KIND of piece this is — see content-pipeline/np-daily/genre.js.
      // `section` is the page as the paper names it in its own running head
      // ("Editorial", "Opinion", "Business"); `genre` is what that makes the
      // piece; `genre_why` records which signal decided it, so a wrong call can
      // be read rather than guessed at.
      ['section', "TEXT NOT NULL DEFAULT ''"],
      ['genre', "TEXT NOT NULL DEFAULT 'report'"],
      ['genre_why', "TEXT NOT NULL DEFAULT ''"],
      // All bylines, not only the first: op-eds are routinely co-authored. And
      // the contributor credit under them, which on an opinion piece is the
      // authority the argument rests on.
      ['bylines', "TEXT NOT NULL DEFAULT ''"],
      ['credits', "TEXT NOT NULL DEFAULT ''"],
      // A CONTRIBUTOR CREDIT FOUND INSIDE A NEWS ARTICLE'S BODY.
      //
      // The symptom of a multi-column segmentation bleed: two stories merged
      // into one block, so an op-ed's "(X is an expert in launch vehicle
      // systems)" ends up buried inside an unrelated report. That is how an
      // ISRO/Gaganyaan passage came to sit inside a story about advertising
      // notices, and how that item acquired a space-and-defence unit tag.
      //
      // A WARNING, never a rejection. Four articles in this corpus carry it and
      // two were drafted; the signal is specific enough to be worth showing an
      // admin and nowhere near reliable enough to throw an article away on.
      ['bleed_suspect', 'INTEGER NOT NULL DEFAULT 0'],
    ],
  };

  for (const [table, cols] of Object.entries(wanted)) {
    const have = new Set(columns(table));
    for (const [name, type] of cols) {
      if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
})();

module.exports = db;
