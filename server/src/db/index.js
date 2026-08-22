const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ca.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Column additions cannot live in schema.sql — it runs on every boot, and
// ALTER TABLE ADD COLUMN throws once the column exists. Guarded here instead by
// reading the table's actual shape first, so it is a no-op after the first run
// and an existing database picks up new fields without being rebuilt.
(function addMissingColumns() {
  const columns = (table) => db.pragma(`table_info(${table})`).map((c) => c.name);

  const wanted = {
    // Paced learning. Off for everyone until they choose otherwise, which is why
    // it is a column with a default rather than a settings table: the feature is
    // a discipline, and a discipline nobody opted into is an obstacle.
    // See server/src/lib/pacing.js.
    users: [['pacing', "TEXT NOT NULL DEFAULT 'off'"]],
    // When the reading clock started for this item. On the progress row rather
    // than in a table of its own because it is the same fact as `marked_read`
    // seen earlier: one row per user per item, already indexed, already deleted
    // with the item.
    ca_progress: [['reading_started_at', 'TEXT']],
    // The eight-section Group-I note template. Added after the first version
    // shipped with a single angle field, so existing rows keep their fact and
    // angle and simply have the new sections empty until edited or redrafted.
    ca_items: [
      // What KIND of source this item was drafted from — 'report', 'oped',
      // 'editorial', 'interview'. Copied onto the item rather than read through
      // np_articles because it has to survive the article: an item outlives the
      // edition row it came from, and "is this a fact or a columnist's claim"
      // must stay answerable for as long as a student can read the item.
      ['source_genre', "TEXT NOT NULL DEFAULT 'report'"],
      // Who is making the claim, where the source was signed opinion. Rendered
      // beside the item so an argument is never presented as anonymous record.
      ['source_author', "TEXT NOT NULL DEFAULT ''"],
      ['g1_theme', "TEXT NOT NULL DEFAULT ''"],
      ['g1_sub_theme', "TEXT NOT NULL DEFAULT ''"],
      ['g1_why_news', "TEXT NOT NULL DEFAULT ''"],
      ['g1_background', "TEXT NOT NULL DEFAULT ''"],
      ['g1_ap_angle', "TEXT NOT NULL DEFAULT ''"],
      ['g1_linked', "TEXT NOT NULL DEFAULT ''"],
      ['g1_bridges', "TEXT NOT NULL DEFAULT ''"],
      ['g1_way_forward', "TEXT NOT NULL DEFAULT ''"],
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
