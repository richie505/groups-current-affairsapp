# APPSC Current Affairs Portal — Architecture Plan

**Status:** BUILT — approved and implemented 2026-08-21. See [README.md](README.md)
for what actually shipped; this file is kept as the design record.

Deviations from the plan as written, all deliberate:
- `DailyActivity` could not be ported — it fetches a `/progress/daily` endpoint
  this app does not have. Replaced with `ActivityStrip`, fed from the `daily`
  array `/progress` already returns, so the strip and the streak figure beside it
  cannot disagree.
- The pipeline does **not** fetch the news itself. The sweep needs live web access
  with judgement applied; `run.js` takes a candidates file and owns everything
  downstream and deterministic. Reasoning in `content-pipeline/ca-daily/README.md`.
- Seeded 6 digests rather than 7 — one per day of genuinely researched material
  over 5–21 Aug 2026 rather than a padded week.
**Location:** `appsc-current-affairs-app/` (standalone, sibling to `appsc-group2-prep-app/`)
**Serves:** APPSC Group-I (Mains, descriptive) **and** Group-II (Screening + Mains, objective)

---

## 1. The core design idea — dual routing

Group-I and Group-II need *the same news* in **two completely different shapes**, and the two
bundled skills prove it:

| | Group-II (`appsc-group2-current-affairs`) | Group-I (`appsc-current-affairs`) |
|---|---|---|
| Atomic output | An MCQ in one of **8 official formats** | A **capture card** with an argument |
| Tagging | **Blueprint keyword angles** (`Appointed`, `GI tag`, `Index`, `Summit`…) | **Paper-unit codes** (`[P4-U4]`, `[P3-U2]`…) |
| Grouping | 4 buckets: International / National / **AP** / dynamic cross-subject | 4 banks: **Q**uote / **D**ata / **E**xample / **S**cheme |
| What matters | The *fact*, recalled precisely | **THE ANGLE** — the argument the fact supports |
| Discipline | Distractors must be real-but-wrong | **Discard aggressively** — most news is discarded |

So the app's atomic object is **one CA Item, routed both ways at once**. A student reads a day's
items through a **track lens** (G1 / G2 / both) and gets exactly the shape their exam rewards.
This is the whole value proposition: *one day's reading, two exams served* — instead of two
separate current-affairs habits nobody sustains for nine months.

### What every item carries

```
┌─ SHARED ────────────────────────────────────────────────────────┐
│ headline · event date · bucket · importance tier (1–3)          │
│ notes_markdown      exam-oriented notes, facts bolded, tables   │
│ static_linkage      ties the news to the static syllabus        │
│ sources[]           ≥1, primary preferred, is_primary flag      │
├─ GROUP-II LANE ─────────────────────────────────────────────────┤
│ prelims_facts       the memorise-this block                     │
│ keywords[]          blueprint keyword angles                    │
│ mcqs[]              8-format mix, each tagged format + keyword  │
├─ GROUP-I LANE ──────────────────────────────────────────────────┤
│ g1_bank             Q | D | E | S                               │
│ g1_fact             THE FACT — exam-ready sentence              │
│ g1_angle            THE ANGLE — the argument (mandatory)        │
│ units[]             every paper unit it feeds                   │
│ skeleton            optional full answer skeleton               │
└─────────────────────────────────────────────────────────────────┘
```

**Enforced rules from the skills:**
- No `g1_angle` → the item cannot be published to the G1 lane (skill: *"If you cannot produce
  an angle, the card should be discarded"*).
- No keyword match and no bank → **DISCARD**, logged with a reason. The pipeline is *supposed*
  to throw most news away.
- Every MCQ explanation states `fact_as_of_date` and carries a time-sensitivity note.

---

## 2. Stack

Identical to the existing prep app, so patterns and components port directly:

- **Server:** Node 20, Express 4, `better-sqlite3`, `jsonwebtoken`, `bcryptjs`
- **Web:** React 18, Vite 5, Tailwind 3, `react-markdown` + `remark-gfm`/`remark-breaks`
- **DB:** its own file, `server/data/ca.db` — no coupling to `app.db`
- **Pipeline:** plain Node scripts + Python where PDF parsing is involved

**Ported unchanged from `appsc-group2-prep-app` (proven, don't rebuild):**
`web/src/lib/mcqFormat.js` (the 8-format renderer, with its Safari-lookbehind and
roman-numeral caveats), `QuizRunner.jsx`, `QuizResults.jsx`, `McqCard.jsx`, `Markdown.jsx`,
`ThemeToggle`, `TextHighlighter`, `server/src/lib/revision.js` (Leitner),
`rateLimit.js`, `passwordReset.js`, the PWA `sw.js`, and the logo set.

---

## 3. Schema — `server/src/db/schema.sql`

```sql
users              id, name, email, password_hash, role('admin'|'student'),
                   exam_track('g1'|'g2'|'both') DEFAULT 'both', created_at

-- One row per calendar day = the Daily Digest
ca_days            id, date UNIQUE, title, intro_markdown,
                   status('draft'|'published'), published_at, created_at

ca_items           id, day_id, headline, event_date,
                   bucket('international'|'national'|'ap'|'dynamic'),
                   subject_tag,          -- Economy/Polity/Geography/... for dynamic items
                   notes_markdown, prelims_facts, static_linkage,
                   g1_bank('Q'|'D'|'E'|'S'|NULL), g1_fact, g1_angle,
                   importance INTEGER CHECK(importance BETWEEN 1 AND 3),
                   relevance_g1, relevance_g2,        -- 0/1
                   status('draft'|'published'|'discarded'), discard_reason,
                   needs_verify, order_index, created_at, updated_at

ca_item_keywords   item_id, keyword           -- G2 routing (blueprint angles)
ca_item_units      item_id, unit_code         -- G1 routing ('P4-U4')
ca_item_themes     item_id, theme             -- G1 bank-review themes (7 + AP)
ca_item_sources    id, item_id, url, publisher, is_primary, fetched_at

ca_mcqs            id, item_id, question, option_a..d, correct_option,
                   explanation, format,       -- one of the 8 official formats
                   keyword, difficulty, fact_as_of_date, created_at

ca_skeletons       id, item_id, paper, question_text, skeleton_markdown, created_at

-- Student state
ca_progress        user_id, item_id, marked_read, marked_at
ca_attempts        id, user_id, mcq_id, selected_option, is_correct,
                   session_id, attempted_at
ca_sessions        id, user_id, scope, scope_ref, label, total, answered,
                   correct, timed, duration_seconds, created_at
ca_revision        user_id, item_type('item'|'mcq'), item_id, box, due_date, …
ca_bookmarks       user_id, item_id, created_at
ca_user_cards      user_id, item_id, bank, own_note, created_at   -- personal G1 bank
ca_mcq_flags       id, user_id, mcq_id, reason, note, status, created_at

-- Pipeline audit
ca_runs            id, window_start, window_end, mode, model, status,
                   candidates, drafted, discarded, approved, log, created_at
```

Reference data seeded, not hardcoded in app logic:
- `ref_keywords` — the Current Affairs keyword list **plus** the 8 other subject lists from
  `blueprint-keywords.md` (dynamic cross-subject items borrow those angles).
- `ref_units` — every `P1`–`P5` unit code with its label, from `routing.md`.
- `ref_corrections` — the four **known corrections** (Labour Codes in force 21 Nov 2025 ·
  Amaravati sole statutory capital, Act assent 7 Apr 2026 · 16th FC award 2026-31, RDG
  discontinued · Census 2027 notified with caste enumeration). The pipeline checks drafts
  against this table so it can never re-file a superseded position.

---

## 4. Screens

### Student
| Screen | What it does |
|---|---|
| **Today** | Today's digest. Items grouped by bucket, importance-ranked, **G1/G2 lens toggle** in the header switches what each card shows. Streak + "read in 12 min" estimate. |
| **Archive / Calendar** | Month grid, density-shaded by item count; jump to any date; filter by bucket, keyword, unit, importance. |
| **Item page** | Notes → prelims facts → static linkage → sources. Then the track panel: **G2** shows keyword angles and MCQs (unlocked on *Mark as read*, matching the prep app's proven flow); **G1** shows BANK/UNITS/THE FACT/THE ANGLE with **Save to my bank**. |
| **Practice** | Quiz by window (today / this week / this month / custom range), bucket, keyword, or subject. Timed mode. Format mix weighted per the style guide. |
| **Monthly Revision** | Auto-compiled month compendium + a 50-MCQ monthly test + "what changed since you last read this". |
| **My Banks** (G1) | The **bank review** from the skill: Q/D/E/S counts vs targets (40/60/50/50), thinnest bank, coverage across the 7 themes **+ AP** (flagging any theme with <3 AP examples), stale cards, duplicates to merge, and a *hunt this week* list. |
| **Revision** | Leitner due-queue over items and MCQs. |
| **Mistakes** | Every MCQ last answered wrong, grouped by keyword — shows which *angle* is weak, not just which question. |
| **Progress** | Streak, items read, accuracy trend, bucket/keyword coverage heatmap, AP coverage share. |

### Admin
| Screen | What it does |
|---|---|
| **Review Queue** | The safety gate. Every AI-drafted item lands here as `draft`: side-by-side source links, inline edit, per-lane approve, bulk publish a day. Nothing reaches students unreviewed. |
| **Run Pipeline** | Pick a date/window and mode, trigger a run, watch the streaming log, see candidates→drafted→discarded counts with discard reasons. |
| **Item editor** | Full manual authoring — the same form the pipeline fills, so hand-written AP items and corrections are first-class. MCQ editor with format picker and live `mcqFormat` preview. |
| **Flags** | Student-reported bad questions queue. |

---

## 5. AI research pipeline — `content-pipeline/ca-daily/`

Follows the skills' Research Step verbatim: always search, never rely on memory; anchor to the
real current date; prefer primary sources; cross-check names/figures/appointments across ≥2
sources; paraphrase into original wording.

```
research.js   window → candidate items. Sweeps PIB · PRS · RBI · ISRO/DRDO · MoSPI ·
              MoEFCC · AP department portals · psc.ap.gov.in, then The Hindu / Indian
              Express / Down To Earth / Eenadu / Sakshi as leads. Coaching sites are
              treated as leads only, never sources. Records every URL.

triage.js     Applies DISCARD. An item survives only if it yields a G2 keyword match
              or a G1 bank slot. Discards are written with a reason, not dropped
              silently — so a thin day is visibly thin rather than padded.

draft.js      Per surviving item, generates the dual-routed record: G2 notes +
              prelims facts + static linkage + keyword tags; G1 fact + angle + bank +
              unit tags (tagging *every* paper it feeds, per routing.md's high-reuse
              clusters) + theme. Checked against ref_corrections. Anything
              unconfirmable is marked needs_verify with what to check.

mcqs.js       Format mix weighted to Direct Recall / Multi-Statement / List-Matching,
              with Assertion–Reason and Negative-Statement cycled in. Distractors must
              be real-but-different (last year's host, the previous scheme name, the
              adjacent minister). Every explanation carries fact_as_of_date. Validated
              against the server's own rules and deduped on a normalised question hash
              against the whole corpus — reusing the approach already proven in
              `appsc-group2-prep-app/content-pipeline/generate-mcqs.js`.

insert.js     Writes as status='draft' into the review queue. Resumable via a JSONL
              state file — a rate-limit at item #40 resumes rather than restarting.
              --dry-run writes JSON to disk and touches nothing.
```

Scheduling: a daily run is a single command, so it can be wired to a scheduled task later.
**Publishing stays manual** — the pipeline drafts, you approve.

---

## 6. Build order

1. Scaffold + schema + seed (admin, `ref_keywords`, `ref_units`, `ref_corrections`)
2. Server: auth, `content.js` (student), `admin.js` (CRUD + review queue)
3. Web shell: routing, auth, theme, nav, **track lens** context
4. Today · Item page · Archive
5. Practice + QuizRunner + Leitner revision + Mistakes
6. My Banks (G1 bank review) + Progress
7. Admin review queue + item/MCQ editors + flags
8. Pipeline scripts, then a real dry run on a recent window
9. Seed ~7 days of genuine researched content so the app opens with something real
10. README + ops notes

---

## 7. Deliberate non-goals (v1)

- **No shared login with the prep app.** Standalone means standalone; SSO can come later.
- **No auto-publish.** A wrong current-affairs fact is uncheckable against a textbook — the
  skill is explicit that an acknowledged gap beats a guess.
- **No PDF import yet.** The existing `ca-monthly` parser already covers monthly compendiums
  and can be pointed at this DB later for backfill.
- **No paid deployment work.** Runs locally; Railway config mirrored from the prep app if wanted.
