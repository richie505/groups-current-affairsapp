-- APPSC Current Affairs Portal — SQLite schema
--
-- One self-contained DB file (data/ca.db), deliberately separate from the
-- static-notes app's app.db. Run via server/scripts/seed.js.
--
-- The organising idea of this schema is DUAL ROUTING. Group-I and Group-II
-- need the same news item in two different shapes, and the difference is not
-- cosmetic:
--
--   Group-II wants the FACT, tagged to a blueprint keyword angle, and turned
--   into an MCQ in one of eight official formats.
--   Group-I wants the ARGUMENT the fact supports, filed into one of four
--   banks (Quote/Data/Example/Scheme) and routed to every paper unit it feeds.
--
-- Rather than store an item twice, one ca_items row carries both lanes and the
-- UI reads it through a track lens. That is what makes one day's reading serve
-- both exams instead of being two separate habits.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'student')) DEFAULT 'student',
  -- Which lane(s) this student's screens default to. 'both' is the common
  -- case: most people sit Group-II while preparing Group-I, and the whole
  -- point of the app is that they need not read twice.
  exam_track    TEXT NOT NULL CHECK (exam_track IN ('g1', 'g2', 'both')) DEFAULT 'both',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- REFERENCE DATA — seeded, not hardcoded in application logic
-- =========================================================================

-- Blueprint keyword angles. NOT facts — recurring *question angles* APPSC
-- reuses across years ("Appointed", "GI tag", "Index", "Summit"). The Current
-- Affairs list is the primary one, but the other eight subject lists are
-- seeded too: a newly notified tiger reserve is a current-affairs item whose
-- angle lives in the Environment blueprint, and tagging it only as "Current
-- Affairs" loses the thing that makes it findable at revision time.
CREATE TABLE IF NOT EXISTS ref_keywords (
  keyword     TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,   -- 'Current Affairs' | 'Polity' | 'Economy' | ...
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ref_keywords_subject ON ref_keywords(subject);

-- Group-I paper units, e.g. 'P4-U4' → 'Public finance: Union budget, deficits,
-- FRBM'. Seeded from the routing map so the admin editor offers real units
-- instead of a free-text box that drifts.
CREATE TABLE IF NOT EXISTS ref_units (
  unit_code   TEXT PRIMARY KEY,   -- 'P3-U2'
  paper       TEXT NOT NULL,      -- 'P1'..'P5'
  label       TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

-- The words a NEWSPAPER uses for a syllabus unit, as opposed to the words the
-- syllabus uses for itself. The syllabus says "Distribution of Legislative and
-- Executive Powers between the Union and the States"; the paper says
-- "Centre-State", "concurrent list", "Article 246". Matching the syllabus's own
-- phrasing would match almost nothing.
--
-- Same shape as topic_aliases, and matched by the same code — see
-- server/src/lib/topics.js.
CREATE TABLE IF NOT EXISTS ref_unit_aliases (
  unit_code TEXT NOT NULL REFERENCES ref_units(unit_code) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  strict    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (unit_code, alias)
);
CREATE INDEX IF NOT EXISTS idx_ref_unit_aliases_code ON ref_unit_aliases(unit_code);

-- Which syllabus units an ARTICLE touches, decided before any model is asked.
-- Derived and rebuilt on every re-score, like np_article_topics: the vocabulary
-- will improve, and a derived table that cannot be thrown away becomes a
-- liability the moment it disagrees with the code that produced it.
CREATE TABLE IF NOT EXISTS np_article_units (
  article_id  INTEGER NOT NULL REFERENCES np_articles(id) ON DELETE CASCADE,
  unit_code   TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 1,
  in_headline INTEGER NOT NULL DEFAULT 0,
  matched     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (article_id, unit_code)
);
CREATE INDEX IF NOT EXISTS idx_np_article_units_code ON np_article_units(unit_code);

-- Facts already found to have gone stale, with the corrected position.
--
-- This exists because a verification pass over the user's own blueprint found
-- four of nine checked facts had gone stale in fifteen months, three of them
-- on Tier-1 topics. The pipeline checks every draft against this table, so a
-- model working from older training data cannot quietly re-file a superseded
-- position — which is the single most expensive failure mode for this app,
-- since a wrong current-affairs fact cannot be caught against a textbook.
CREATE TABLE IF NOT EXISTS ref_corrections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  topic            TEXT NOT NULL,
  superseded_claim TEXT NOT NULL,
  correct_position TEXT NOT NULL,
  effective_date   TEXT,
  match_terms      TEXT NOT NULL DEFAULT '',  -- comma-separated trigger terms
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- CONTENT
-- =========================================================================

-- One row per calendar day = the Daily Digest a student opens.
--
-- A day exists even when thin. The alternative — creating a day only once it
-- has enough items — hides the fact that a day was thin, and "the pipeline
-- found little on 14 Aug" is information the student should see rather than
-- have papered over with filler.
CREATE TABLE IF NOT EXISTS ca_days (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL UNIQUE,      -- 'YYYY-MM-DD'
  title          TEXT NOT NULL DEFAULT '',
  intro_markdown TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL CHECK (status IN ('draft', 'published')) DEFAULT 'draft',
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_days_date ON ca_days(date DESC);
CREATE INDEX IF NOT EXISTS idx_days_status ON ca_days(status, date DESC);

CREATE TABLE IF NOT EXISTS ca_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id      INTEGER NOT NULL REFERENCES ca_days(id) ON DELETE CASCADE,
  headline    TEXT NOT NULL,
  -- When the event happened, as distinct from which digest it appears in. A
  -- report released on the 3rd can legitimately be filed on the 5th, and MCQ
  -- explanations must cite the event date, not the filing date.
  event_date  TEXT,

  -- The four buckets. 'dynamic' is the fast-changing edge of another subject
  -- (a new Finance Commission recommendation, a fresh GI tag) — current
  -- affairs by recency, but with its home keyword in Economy/Geography/etc.,
  -- which is what subject_tag records.
  bucket      TEXT NOT NULL CHECK (bucket IN ('international', 'national', 'ap', 'dynamic')),
  subject_tag TEXT NOT NULL DEFAULT '',

  -- ---- shared body ----
  notes_markdown TEXT NOT NULL DEFAULT '',
  -- Ties the news to the static syllabus it updates. Borrowed from the
  -- monthly-compendium format ("STATIC LINKAGE"), and it is the field that
  -- stops current affairs being a separate subject: a student meeting the
  -- Finance Commission in their static notes should find these items waiting.
  static_linkage TEXT NOT NULL DEFAULT '',

  -- ---- Group-II lane ----
  prelims_facts  TEXT NOT NULL DEFAULT '',   -- the memorise-this block

  -- ---- Group-I lane ----
  --
  -- Group-I answers are written, not ticked, so the lane follows a fixed
  -- eight-section note template rather than holding a single block of prose.
  -- The sections exist because each one is a different thing a Mains answer
  -- needs and a different thing that is easy to leave out: the trigger, the
  -- background, the dimensions, the AP angle, the linkages, the essay bridge,
  -- the way forward, and the questions it could be asked as.
  --
  -- Storing them as separate fields rather than one markdown blob is what makes
  -- the gaps visible. A note missing its AP angle is a note that will fail in
  -- the papers where AP is half the content, and that is only checkable if the
  -- AP angle has somewhere of its own to be missing from.
  g1_bank  TEXT CHECK (g1_bank IN ('Q', 'D', 'E', 'S')),
  g1_fact  TEXT NOT NULL DEFAULT '',   -- THE FACT: the exact sentence to write
  -- THE ANGLE: the argument the fact supports, not a restatement of it. An
  -- item with no angle is one the student can never argue from, so publishing
  -- to the G1 lane is blocked without it (see the trigger below).
  g1_angle TEXT NOT NULL DEFAULT '',

  -- The template header: "[THEME] → Sub-theme". Kept as two fields so items can
  -- be grouped by theme across months, which is how a Paper I essay bank is
  -- actually browsed.
  g1_theme     TEXT NOT NULL DEFAULT '',
  g1_sub_theme TEXT NOT NULL DEFAULT '',

  g1_why_news    TEXT NOT NULL DEFAULT '',   -- 1. one-line trigger: what happened, when
  g1_background  TEXT NOT NULL DEFAULT '',   -- 2. meaning / background
  -- 4. The AP-specific angle. Its own field, not a paragraph inside the
  -- background, precisely so its absence is countable.
  g1_ap_angle    TEXT NOT NULL DEFAULT '',
  g1_linked      TEXT NOT NULL DEFAULT '',   -- 5. linked schemes / reports / judgments
  g1_bridges     TEXT NOT NULL DEFAULT '',   -- 6. essay link-lines, ready to drop in
  g1_way_forward TEXT NOT NULL DEFAULT '',   -- 7. the forward-looking conclusion line

  importance   INTEGER NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  relevance_g1 INTEGER NOT NULL DEFAULT 1,
  relevance_g2 INTEGER NOT NULL DEFAULT 1,

  -- 'discarded' is a first-class outcome, not a deletion. Most news should be
  -- discarded, and keeping the row with its reason is what lets the admin see
  -- that the pipeline is being appropriately ruthless rather than blind.
  status         TEXT NOT NULL CHECK (status IN ('draft', 'published', 'discarded')) DEFAULT 'draft',
  discard_reason TEXT NOT NULL DEFAULT '',

  -- Set when a figure or name could not be confirmed at a second source. The
  -- item can still be published; it renders with a visible caution, because an
  -- acknowledged gap is worth more than a confident guess.
  needs_verify  INTEGER NOT NULL DEFAULT 0,
  verify_note   TEXT NOT NULL DEFAULT '',

  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_day ON ca_items(day_id, order_index);
CREATE INDEX IF NOT EXISTS idx_items_status ON ca_items(status, importance);
CREATE INDEX IF NOT EXISTS idx_items_bucket ON ca_items(bucket, status);

-- Publishing to a lane requires that lane to be filled in. Enforced in the
-- database rather than only in the route, because the pipeline writes here too
-- and a half-routed item is worse than a missing one — it looks complete.
CREATE TRIGGER IF NOT EXISTS trg_items_require_angle_insert
BEFORE INSERT ON ca_items
WHEN NEW.status = 'published' AND NEW.relevance_g1 = 1
     AND (TRIM(NEW.g1_angle) = '' OR TRIM(NEW.g1_fact) = '')
BEGIN
  SELECT RAISE(ABORT, 'Cannot publish to the Group-I lane without both THE FACT and THE ANGLE.');
END;

CREATE TRIGGER IF NOT EXISTS trg_items_require_angle_update
BEFORE UPDATE ON ca_items
WHEN NEW.status = 'published' AND NEW.relevance_g1 = 1
     AND (TRIM(NEW.g1_angle) = '' OR TRIM(NEW.g1_fact) = '')
BEGIN
  SELECT RAISE(ABORT, 'Cannot publish to the Group-I lane without both THE FACT and THE ANGLE.');
END;

-- G2 routing: which blueprint question angles this item can be tested through.
CREATE TABLE IF NOT EXISTS ca_item_keywords (
  item_id INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  PRIMARY KEY (item_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_item_keywords_kw ON ca_item_keywords(keyword);

-- G1 routing: every paper unit the item feeds. Deliberately many-to-many and
-- deliberately generous — a single event often serves three papers, and the
-- tag is the whole mechanism by which current affairs become updates to
-- skeletons the student already has.
CREATE TABLE IF NOT EXISTS ca_item_units (
  item_id   INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  PRIMARY KEY (item_id, unit_code)
);
CREATE INDEX IF NOT EXISTS idx_item_units_code ON ca_item_units(unit_code);

-- Bank-review themes: governance, ethics, science & tech, environment,
-- economy, society & education, federalism — plus 'andhra pradesh', which
-- cuts across all seven rather than sitting beside them, because AP coverage
-- is the axis that decides marks and has to be measurable on its own.
CREATE TABLE IF NOT EXISTS ca_item_themes (
  item_id INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  theme   TEXT NOT NULL,
  PRIMARY KEY (item_id, theme)
);
CREATE INDEX IF NOT EXISTS idx_item_themes_theme ON ca_item_themes(theme);

-- Provenance. Every item must cite where it came from; primary sources (PIB,
-- PRS, RBI, ISRO, AP department portals) are flagged so the review queue can
-- show at a glance which items rest only on secondary reporting.
CREATE TABLE IF NOT EXISTS ca_item_sources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  publisher  TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_sources_item ON ca_item_sources(item_id);

CREATE TABLE IF NOT EXISTS ca_mcqs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('a', 'b', 'c', 'd')),
  explanation    TEXT NOT NULL DEFAULT '',
  -- One of the eight formats confirmed from the real paper. Stored rather than
  -- inferred so Practice can deliberately mix formats — the real paper leans
  -- hard on assertion-reason, list-matching and negative-statement, and a bank
  -- that is 90% direct recall trains the wrong reflex.
  format         TEXT NOT NULL DEFAULT 'direct_recall' CHECK (format IN (
                   'direct_recall', 'negative_statement', 'assertion_reason',
                   'statement_based', 'multi_statement', 'chronological',
                   'list_matching', 'count_based')),
  keyword        TEXT NOT NULL DEFAULT '',
  difficulty     INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  -- Current-affairs answers get superseded. Every question records the date
  -- its key was true, so a stale question is identifiable rather than just
  -- silently wrong at revision time.
  fact_as_of     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcqs_item ON ca_mcqs(item_id);
CREATE INDEX IF NOT EXISTS idx_mcqs_keyword ON ca_mcqs(keyword);

-- Section 3 of the Group-I template: the multi-dimensional tags.
--
-- Seven fixed dimensions, each with one line saying how it applies. A separate
-- table rather than a text field because the dimension set is closed and the
-- point is coverage: a topic tagged only 'economic' is a topic the student will
-- write a one-dimensional answer about, and that is visible here in a way it
-- would not be inside a paragraph.
CREATE TABLE IF NOT EXISTS ca_item_dimensions (
  item_id   INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
              'economic', 'social', 'political', 'ethical',
              'environmental', 'legal', 'international')),
  note      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (item_id, dimension)
);
CREATE INDEX IF NOT EXISTS idx_item_dimensions_dim ON ca_item_dimensions(dimension);

-- Section 8 of the template: essay questions this topic could feed.
--
-- 'direct' means the topic is the question ("Discuss X"). 'indirect' means the
-- topic is an example inside a wider essay ("Technology and Inequality") — which
-- is how most current affairs actually earns its marks in Paper I, and the use
-- people forget to prepare for.
CREATE TABLE IF NOT EXISTS ca_essay_questions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('direct', 'indirect')) DEFAULT 'direct',
  note     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_essay_questions_item ON ca_essay_questions(item_id);

-- Group-I: a major event turned into a full answer skeleton.
CREATE TABLE IF NOT EXISTS ca_skeletons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  paper             TEXT NOT NULL DEFAULT '',
  question_text     TEXT NOT NULL,
  skeleton_markdown TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skeletons_item ON ca_skeletons(item_id);

-- =========================================================================
-- STUDENT STATE
-- =========================================================================

-- Marking an item read unlocks its MCQs, same as the static-notes app: the
-- questions are worth far more after the notes than before them.
CREATE TABLE IF NOT EXISTS ca_progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  marked_read INTEGER NOT NULL DEFAULT 0,
  marked_at   TEXT,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON ca_progress(user_id, marked_at);

CREATE TABLE IF NOT EXISTS ca_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope            TEXT NOT NULL,          -- 'day' | 'range' | 'month' | 'bucket' | 'keyword' | 'revision'
  scope_ref        TEXT NOT NULL DEFAULT '',
  label            TEXT NOT NULL DEFAULT '',
  total            INTEGER NOT NULL,
  answered         INTEGER NOT NULL,
  correct          INTEGER NOT NULL,
  timed            INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON ca_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS ca_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mcq_id          INTEGER NOT NULL REFERENCES ca_mcqs(id) ON DELETE CASCADE,
  selected_option TEXT NOT NULL CHECK (selected_option IN ('a', 'b', 'c', 'd')),
  is_correct      INTEGER NOT NULL,
  session_id      INTEGER REFERENCES ca_sessions(id) ON DELETE SET NULL,
  attempted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON ca_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_mcq_time ON ca_attempts(user_id, mcq_id, attempted_at);

-- Leitner spaced revision, same five-box model as the static-notes app.
-- item_type is polymorphic, so due-item queries always INNER JOIN back to the
-- real table and a row orphaned by a deleted item stops appearing rather than
-- erroring.
CREATE TABLE IF NOT EXISTS ca_revision (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL CHECK (item_type IN ('item', 'mcq')),
  item_id          INTEGER NOT NULL,
  box              INTEGER NOT NULL DEFAULT 1,
  due_date         TEXT NOT NULL,
  last_outcome     TEXT,
  last_reviewed_at TEXT,
  reviews_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_revision_user_due ON ca_revision(user_id, due_date);

CREATE TABLE IF NOT EXISTS ca_bookmarks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);

-- The student's own Group-I bank. Distinct from the item's g1_bank: this is
-- the deliberate act of filing something into *their* collection, which is
-- what the bank-review targets (Q~40, D~60, E~50, S~50) are measured against.
-- A bank that fills itself automatically is a bank nobody has read.
CREATE TABLE IF NOT EXISTS ca_user_cards (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  bank       TEXT NOT NULL CHECK (bank IN ('Q', 'D', 'E', 'S')),
  own_note   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_user_cards_user ON ca_user_cards(user_id, bank);

-- Most of the bank is generated rather than hand-written, so the people best
-- placed to catch a wrong key are the students hitting it.
CREATE TABLE IF NOT EXISTS ca_mcq_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mcq_id      INTEGER NOT NULL REFERENCES ca_mcqs(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('wrong_answer', 'outdated', 'unclear', 'typo', 'not_in_notes', 'other')),
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_one_open_per_user_mcq
  ON ca_mcq_flags(user_id, mcq_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_flags_status ON ca_mcq_flags(status, created_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- PIPELINE AUDIT
-- =========================================================================

-- One row per research run. Keeping the discard count next to the drafted
-- count is the point: a run that drafts everything it finds is not being
-- ruthless enough, and that is only visible if both numbers are recorded.
CREATE TABLE IF NOT EXISTS ca_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'daily',
  model        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')) DEFAULT 'running',
  candidates   INTEGER NOT NULL DEFAULT 0,
  drafted      INTEGER NOT NULL DEFAULT 0,
  discarded    INTEGER NOT NULL DEFAULT 0,
  approved     INTEGER NOT NULL DEFAULT 0,
  log          TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON ca_runs(created_at DESC);

-- ===========================================================================
-- THE TOPIC LAYER
-- ===========================================================================
--
-- Everything above this line is organised by DAY. An item belongs to a digest,
-- carries its tags, and is then finished with. That is the right shape for
-- reading a day's news and the wrong shape for preparing an exam, because the
-- exam does not ask about a day. It asks about Polavaram.
--
-- So a topic is the entity a news item is ABOUT, and it persists. Ten items
-- across eight months mentioning Polavaram are ten updates to one master topic,
-- not ten unrelated notes -- and until there is a row for the topic itself
-- there is nowhere for the eleventh to attach, no way to ask what is already
-- known, and no way to see that the topic spans Paper II, Paper IV and the
-- Paper I essay at once.
--
-- The four tables below are deliberately thin. `topics` and `topic_aliases`
-- are curated; `topic_items` and `topic_units` are DERIVED and can be rebuilt
-- from scratch at any time, which matters because the matcher will improve and
-- a derived table that cannot be rebuilt becomes a liability.

CREATE TABLE IF NOT EXISTS topics (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT NOT NULL UNIQUE,          -- 'polavaram'
  name    TEXT NOT NULL,                 -- 'Polavaram Irrigation Project'
  kind    TEXT NOT NULL CHECK (kind IN (
            'project', 'scheme', 'institution', 'law', 'place',
            'person', 'report', 'body', 'event', 'concept')),

  -- AP-specific, as distinct from national. Kept as its own column rather than
  -- inferred from the name because it is the axis the whole exam turns on and
  -- has to be countable.
  ap      INTEGER NOT NULL DEFAULT 0,

  -- 1 = asked repeatedly and across papers, 3 = peripheral. Mirrors the tiering
  -- already used in the Group-I blueprint.
  tier    INTEGER NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 3),

  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_topics_ap ON topics(ap, tier);
CREATE INDEX IF NOT EXISTS idx_topics_kind ON topics(kind);

-- How the topic is actually written in print. This table is the whole reason
-- matching works: a paper says "APCRDA", "CRDA", "Capital Region Development
-- Authority" and "ఏపీసీఆర్‌డీఏ" for one body, and a topic that only knows its
-- own formal name will match none of them.
CREATE TABLE IF NOT EXISTS topic_aliases (
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  alias    TEXT NOT NULL,
  norm     TEXT NOT NULL,                 -- lowercased, punctuation-stripped
  lang     TEXT NOT NULL DEFAULT 'en',
  -- An alias short enough to appear inside other words ('TTD', 'CAA') is only
  -- matched on a word boundary; this flag marks the ones that must never be
  -- matched loosely.
  strict   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_id, norm)
);
CREATE INDEX IF NOT EXISTS idx_topic_aliases_norm ON topic_aliases(norm);

-- DERIVED: which items touch which topic. Rebuildable.
CREATE TABLE IF NOT EXISTS topic_items (
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES ca_items(id) ON DELETE CASCADE,
  hits        INTEGER NOT NULL DEFAULT 1,
  -- Whether the topic was named in the headline. A topic in the headline is
  -- what the item is about; a topic in the body may only be mentioned, and the
  -- difference decides whether an item belongs on the topic's page.
  in_headline INTEGER NOT NULL DEFAULT 0,
  matched     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (topic_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_items_item ON topic_items(item_id);

-- DERIVED: the cross-paper reuse map, and the point of the whole layer.
--
-- A topic inherits the paper units of every item that names it, so "which
-- papers does Polavaram serve?" becomes a query rather than a memory. `weight`
-- is how many items support the pairing, which is what separates a real reuse
-- from one item's stray tag.
CREATE TABLE IF NOT EXISTS topic_units (
  topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  weight    INTEGER NOT NULL DEFAULT 1,
  source    TEXT NOT NULL DEFAULT 'derived' CHECK (source IN ('derived', 'manual')),
  PRIMARY KEY (topic_id, unit_code)
);
CREATE INDEX IF NOT EXISTS idx_topic_units_code ON topic_units(unit_code);

-- Curated topic-to-topic relations, for the cases the item overlap cannot
-- express: Polavaram belongs under AP Bifurcation, and is a sibling of
-- inter-State river disputes.
CREATE TABLE IF NOT EXISTS topic_links (
  a_id     INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  b_id     INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('parent', 'related', 'supersedes')),
  PRIMARY KEY (a_id, b_id, relation)
);

-- ===========================================================================
-- THE PYQ LAYER
-- ===========================================================================
--
-- What the commission has actually asked, as data.
--
-- WHY THIS CHANGES MCQ GENERATION
--
-- Without it, generated questions come off a fixed format cycle: a little of
-- each of the eight formats, in rotation, regardless of topic. That is better
-- than all-recall, but it is still a guess. APPSC does not test every topic the
-- same way -- a Committee is asked as direct recall and list-matching, a
-- constitutional Article as assertion-reason, a chronology as sequencing -- and
-- the only way to know which is to count what it has done.
--
-- So `pyq_questions` exists to answer one question well: given this blueprint
-- keyword, which formats has APPSC actually used, and how often? Generation then
-- follows the real distribution instead of a rotation.
--
-- It also fixes the topic layer's weakest point. `topics.tier` is currently a
-- hand-assigned judgement; once questions are linked to topics, recurrence can
-- be measured instead of estimated.

CREATE TABLE IF NOT EXISTS pyq_papers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,        -- 'g2-2023-screening'
  exam        TEXT NOT NULL CHECK (exam IN ('group1', 'group2')),
  stage       TEXT NOT NULL CHECK (stage IN ('prelims', 'mains')),
  paper       TEXT NOT NULL DEFAULT '',    -- 'screening', 'paper-1', ...
  year        INTEGER,
  source_file TEXT NOT NULL DEFAULT '',
  pages       INTEGER,
  -- Extraction is imperfect and says so. A paper whose scan is poor should be
  -- visibly poor rather than quietly under-represented in every count.
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pyq_questions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id  INTEGER NOT NULL REFERENCES pyq_papers(id) ON DELETE CASCADE,
  q_no      INTEGER,
  page      INTEGER,

  stem         TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  -- 1-4 where a key was printed, NULL where it was not. Mains papers are
  -- descriptive and carry no options at all, which is why neither is required.
  answer       INTEGER,

  -- One of the eight formats the generator uses, or 'descriptive' for a Mains
  -- question. Deliberately the SAME vocabulary as ca_mcqs.format, because the
  -- entire purpose is to compare what was asked with what is being generated.
  format    TEXT NOT NULL DEFAULT 'unknown',
  subject   TEXT NOT NULL DEFAULT '',

  -- Provenance for a source that cannot be trusted blindly: these papers are
  -- scans, re-OCR'd, then structured by a model. `raw` keeps the text the
  -- question was built from so a suspicious row can be checked without
  -- re-running anything, and `needs_review` marks the ones the extractor itself
  -- was unsure about.
  ocr_confidence REAL,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  review_note    TEXT NOT NULL DEFAULT '',
  raw            TEXT NOT NULL DEFAULT '',

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (paper_id, q_no)
);
CREATE INDEX IF NOT EXISTS idx_pyq_q_paper ON pyq_questions(paper_id, q_no);
CREATE INDEX IF NOT EXISTS idx_pyq_q_format ON pyq_questions(format);

-- Which blueprint angle each question tests. The join that makes the whole
-- layer useful: 'for keyword X, what formats has APPSC used'.
CREATE TABLE IF NOT EXISTS pyq_question_keywords (
  question_id INTEGER NOT NULL REFERENCES pyq_questions(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  PRIMARY KEY (question_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_pyq_qk_keyword ON pyq_question_keywords(keyword);

-- DERIVED, like topic_items: which master topic each question belongs to,
-- matched through the same alias vocabulary. Rebuildable.
CREATE TABLE IF NOT EXISTS pyq_question_topics (
  question_id INTEGER NOT NULL REFERENCES pyq_questions(id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  hits        INTEGER NOT NULL DEFAULT 1,
  matched     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (question_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_pyq_qt_topic ON pyq_question_topics(topic_id);

-- Group-I recurrence evidence, at topic level rather than question level.
--
-- WHY THIS IS SHAPED DIFFERENTLY FROM pyq_questions
--
-- Because Group-I Mains is written, not ticked. "Which format was this asked
-- in" is a meaningful question about a screening test and a meaningless one
-- about a descriptive paper, so the Group-I half of the PYQ layer counts
-- something else: how often a topic recurs, and which papers it pays across.
--
-- That is exactly what the Group-I blueprint already measures — "Both years",
-- "Twice within 2023", "Three questions across two years" — from the 2023 and
-- 2025 papers. This table holds those observations so that `topics.tier` can be
-- derived from them instead of hand-assigned, and so the Master Reuse Map is a
-- query rather than a document.
CREATE TABLE IF NOT EXISTS topic_evidence (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  exam       TEXT NOT NULL DEFAULT 'group1' CHECK (exam IN ('group1', 'group2')),
  paper      TEXT NOT NULL DEFAULT '',      -- 'P2'
  unit       TEXT NOT NULL DEFAULT '',      -- '15', or a unit code
  -- How many questions the observation represents. "Both years" is 2, "Three
  -- questions across two years" is 3. Kept as a number so recurrence can be
  -- ranked, with the original wording alongside it so the number can be checked.
  questions  INTEGER NOT NULL DEFAULT 1,
  years      TEXT NOT NULL DEFAULT '',
  evidence   TEXT NOT NULL DEFAULT '',
  -- The paper the blueprint says to STUDY the topic from, as opposed to the
  -- papers it also answers. The distinction is the whole point of a reuse map:
  -- study once, tick it off everywhere.
  is_primary INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL DEFAULT 'tier1'
             CHECK (kind IN ('tier1', 'reuse', 'ap-block', 'gap')),
  source     TEXT NOT NULL DEFAULT 'g1-blueprint',
  UNIQUE (topic_id, exam, paper, unit, kind)
);
CREATE INDEX IF NOT EXISTS idx_topic_evidence_topic ON topic_evidence(topic_id, kind);
CREATE INDEX IF NOT EXISTS idx_topic_evidence_paper ON topic_evidence(paper);

-- ===========================================================================
-- SECTION 1 — SOURCE INTELLIGENCE
-- ===========================================================================
--
-- The newspaper as it was actually uploaded, preserved.
--
-- WHY KEEP THE SOURCE AT ALL, IN A TOPIC-CENTRIC SYSTEM
--
-- Because the newspaper is the input and the topic is the structure, and both
-- claims have to survive: a knowledge item must be traceable to the page it came
-- from. Without these two tables the only provenance was a citation string
-- inside ca_item_sources, which cannot answer "show me everything from the 21
-- August Vijayawada edition", cannot show what a run discarded, and cannot let
-- an admin re-run one page.
--
-- These are also what make an upload idempotent. An edition is identified by
-- publication + date + a hash of the file, so uploading the same PDF twice is
-- recognised rather than silently duplicated across two runs.

CREATE TABLE IF NOT EXISTS np_editions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  publication TEXT NOT NULL,                  -- 'The Hindu'
  edition     TEXT NOT NULL DEFAULT '',       -- 'Vijayawada'
  date        TEXT NOT NULL,                  -- the edition date, YYYY-MM-DD
  language    TEXT NOT NULL DEFAULT 'en',

  source_file TEXT NOT NULL DEFAULT '',       -- the uploaded filename
  stored_path TEXT NOT NULL DEFAULT '',       -- where it was kept on disk
  -- SHA-256 of the bytes. The same paper uploaded twice is the same edition,
  -- and saying so is cheaper than reconciling two runs of it afterwards.
  file_hash   TEXT NOT NULL DEFAULT '',
  bytes       INTEGER,
  pages       INTEGER,

  status      TEXT NOT NULL DEFAULT 'uploaded'
              CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
  profile     TEXT NOT NULL DEFAULT '',       -- the layout profile that was used

  -- The counts that make a run auditable. `skipped_pages` and `discarded` are
  -- as important as `kept`: a run that discards nothing has stopped filtering.
  pages_ocr      INTEGER NOT NULL DEFAULT 0,
  pages_skipped  INTEGER NOT NULL DEFAULT 0,
  articles_found INTEGER NOT NULL DEFAULT 0,
  events         INTEGER NOT NULL DEFAULT 0,
  merged         INTEGER NOT NULL DEFAULT 0,

  log         TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,

  UNIQUE (publication, date, file_hash)
);
CREATE INDEX IF NOT EXISTS idx_np_editions_date ON np_editions(date DESC);
CREATE INDEX IF NOT EXISTS idx_np_editions_status ON np_editions(status, date DESC);

-- Every article the segmenter found, kept whether or not it was used.
--
-- Discards are rows, not deletions — the same principle the item queue already
-- follows. A segmenter that quietly loses a column looks identical to one that
-- works, and the only defence is being able to read what it decided.
CREATE TABLE IF NOT EXISTS np_articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id  INTEGER NOT NULL REFERENCES np_editions(id) ON DELETE CASCADE,

  page        INTEGER,
  headline    TEXT NOT NULL DEFAULT '',
  standfirst  TEXT NOT NULL DEFAULT '',
  byline      TEXT NOT NULL DEFAULT '',
  -- Where the story was filed from. The strongest single signal that a story is
  -- an Andhra Pradesh story, even when its text never names the State.
  dateline    TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  chars       INTEGER NOT NULL DEFAULT 0,
  language    TEXT NOT NULL DEFAULT 'en',

  -- 'text' where a real text layer existed, 'ocr' where the page was rasterised.
  extraction  TEXT NOT NULL DEFAULT 'text' CHECK (extraction IN ('text', 'ocr')),
  ocr_confidence REAL,
  -- Headline size as a multiple of body size: the editor's own judgement of
  -- importance, and a signal no model has to be asked for.
  prominence  REAL,
  ap          INTEGER NOT NULL DEFAULT 0,

  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'relevant', 'discarded', 'drafted', 'duplicate')),
  discard_reason TEXT NOT NULL DEFAULT '',

  -- Same-event grouping. A duplicate points at the article it duplicates rather
  -- than being removed, so the merge can be inspected and undone.
  merged_into INTEGER REFERENCES np_articles(id) ON DELETE SET NULL,
  -- Set once this article has become a knowledge item.
  item_id     INTEGER REFERENCES ca_items(id) ON DELETE SET NULL,

  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_np_articles_edition ON np_articles(edition_id, page);
CREATE INDEX IF NOT EXISTS idx_np_articles_status ON np_articles(status);
CREATE INDEX IF NOT EXISTS idx_np_articles_item ON np_articles(item_id);

-- ===========================================================================
-- SECTION 2 — KNOWLEDGE INTELLIGENCE
-- ===========================================================================
--
-- What was extracted FROM an article, as opposed to the article itself.
--
-- These three tables are all DERIVED and are rebuilt whenever an edition is
-- re-scored, for the same reason topic_items is derived: the extractors will
-- improve, and a derived table that cannot be thrown away becomes a liability
-- the moment it disagrees with the code that produced it.

-- People, organisations, places and schemes named in an article. Kept separate
-- from the article row because one article names many, and because "which
-- articles mention APCRDA" is a question worth being able to ask directly.
CREATE TABLE IF NOT EXISTS np_article_entities (
  article_id INTEGER NOT NULL REFERENCES np_articles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('person', 'organisation', 'place', 'scheme')),
  name       TEXT NOT NULL,
  mentions   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (article_id, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_np_entities_name ON np_article_entities(name);
CREATE INDEX IF NOT EXISTS idx_np_entities_kind ON np_article_entities(kind);

-- Blueprint keyword angles matched in an article, BEFORE any drafting happens.
-- This is what lets the relevance score know an article tests a recurring angle
-- without asking a model anything.
CREATE TABLE IF NOT EXISTS np_article_keywords (
  article_id INTEGER NOT NULL REFERENCES np_articles(id) ON DELETE CASCADE,
  keyword    TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  in_headline INTEGER NOT NULL DEFAULT 0,
  -- How many past questions have used this angle. Copied in at scoring time so
  -- the score is reproducible from the row: recomputing it later against a
  -- grown PYQ corpus would silently change what an old score meant.
  pyq_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_np_article_keywords_kw ON np_article_keywords(keyword);

-- Master topics an article touches, matched through the same alias vocabulary
-- the knowledge graph uses. This is the join that makes cross-paper reuse a
-- scoring factor rather than an afterthought.
CREATE TABLE IF NOT EXISTS np_article_topics (
  article_id  INTEGER NOT NULL REFERENCES np_articles(id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  hits        INTEGER NOT NULL DEFAULT 1,
  in_headline INTEGER NOT NULL DEFAULT 0,
  matched     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (article_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_np_article_topics_topic ON np_article_topics(topic_id);
