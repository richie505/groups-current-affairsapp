# APPSC Intelligent Newspaper-to-Exam Preparation System — Product Spec

**Written to disk 22 Aug 2026.** The earlier 7-section spec existed only in chat
and was lost with an account change. This file is now the authoritative record:
anything agreed in conversation gets written here before it is built.

`PLAN.md` is the *architecture* record for what shipped in the first build.
This file is the *product vision* the app is being grown into.

---

## 0. Standing decisions

| Decision | Value | Date |
|---|---|---|
| Repo | Extend `appsc-current-affairs-app`; do **not** start a new one | 21 Aug 2026 |
| `appsc-group2-prep-app` | **Never modified.** Sibling, standalone, separate DB | 21 Aug 2026 |
| Build style | Section by section, top to bottom | 21 Aug 2026 |
| Input | Admin uploads a PDF; everything flows from it | 21 Aug 2026 |
| **Newspaper sources** | **English only — The Hindu. Eenadu / Telugu ingestion is OUT of scope.** | **22 Aug 2026** |

### On the English-only decision

This removes *Eenadu as an input newspaper*. It does **not** remove Telugu as
exam content — AP History, Society and Culture are full of Telugu topics, and
`relevance.js` must keep matching "Telugu literature", Telugu dynasties and the
like. The two are unrelated and must not be cleaned up together.

What it retires: the `eenadu` profile in `np-daily/profiles.js`, the
cross-language merge in `np-daily/merge.js`, the `language === 'te'` branch in
`lib/ingest.js`, and the `tel.traineddata` blocker. Same-event merging *within*
one English edition is still wanted.

---

## 1. The core principle

> **ONE SOURCE → ONE INTELLIGENCE PROCESS → MANY EXAM OUTPUTS**

The newspaper is processed **once**. The same processed knowledge then serves
Group 1, Group 2 and the Paper I essay banks. There are no parallel
"Newspaper → Group 1" and "Newspaper → Group 2" pipelines; that duplicates work.

```
NEWSPAPER
   -> ARTICLE EXTRACTION
   -> FACT + EVENT UNDERSTANDING
   -> MASTER APPSC KNOWLEDGE OBJECT
   -> SYLLABUS / PYQ / KEYWORD MAPPING
   -> MULTIPLE EXAM-SPECIFIC OUTPUTS
```

The competitive advantage is **not** OCR and **not** AI note generation. It is
this chain:

> Current Event → APPSC Relevance → Syllabus Topic → Blueprint Keyword →
> PYQ Pattern → Cross-Paper Connection → AP-Specific Link → Correct Exam Output

---

## 2. The master knowledge object

Every surviving news item becomes one structured object, not text:

```
News Event
├── What happened? · Date · Location · People / Organisations
├── Background · Why important?
├── Dimensions: Political · Economic · Social · Environmental
│                Ethical · Legal · International
├── Andhra Pradesh relevance
├── Group 1 relevance · Group 2 relevance
├── Syllabus mapping · Blueprint keyword mapping · PYQ connections
├── Related static topics · Related previous news
└── Possible outputs: Notes · MCQs · Mains answers · Essay examples
                      Data points · Revision cards
```

Classification shape:

```json
{
  "event": "Example Event",
  "relevance":     { "group1": true, "group2": true },
  "bucket":        "National",
  "subjects":      ["Polity", "Economy"],
  "group1_papers": ["Paper III", "Paper IV", "Paper I Essay"],
  "group2_topics": ["Current Affairs", "Indian Economy"],
  "dimensions":    ["Political", "Economic", "Legal"],
  "ap_specific":   false,
  "priority":      "High"
}
```

---

## 3. The ten layers, with build status

| # | Layer | What it does | Status |
|---|---|---|---|
| 1 | **Newspaper ingestion** | PDF / scanned / ePaper → pages → text or OCR → article detection → segmentation | **BUILT** — `np_editions`, `np_articles`, `lib/ingest.js`, `routes/editions.js`, `AdminEditions.jsx`, `np-daily/` |
| 2 | **Duplicate intelligence** | Same event reported twice becomes one enriched item | **PARTIAL** — same-edition merge works; cross-language merge now **out of scope** (English only) |
| 3 | **APPSC relevance filter** | Relevant? Which exam? Which bucket? Which subject? | **BUILT** — `lib/relevance.js`, 0–100 score (30 syllabus / 20 PYQ angle / 20 AP / 15 importance / 15 reuse), CRITICAL–LOW bands |
| 4 | **Blueprint keyword engine** | Entity + fact extraction → the recurring *exam angle* | **BUILT** — 737 `ref_keywords`, `np_article_keywords`, `np_article_entities` |
| 5 | **PYQ intelligence** | Keyword → what formats APPSC actually asked → plan the MCQ mix | **BUILT** — `pyq_questions` (1,127 across 8 papers), `plannedFormats()` in `lib/pyq.js`; G1 half is `topic_evidence` recurrence |
| 6 | **Group 2 output engine** | Exam-indexed CA notes → keyword → PYQ pattern → MCQs → revision | **BUILT** for the ca-daily lane |
| 7 | **Group 1 output engine** | 54 Tier-1 topics, priority, cross-paper reuse, answer skeletons | **BUILT** — `topic_evidence`, 26 reuse clusters, 11 AP clusters |
| 8 | **AP knowledge graph** | One master topic (e.g. Polavaram) that all subjects hang off | **BUILT** — `topics` / `topic_aliases` / `topic_items` / `topic_links`, with a UI at `/topics` |
| 9 | **Unified note engine** | One MASTER NOTE → G1 detailed / G2 concise / Essay views | **BUILT 22 Aug 2026** — see Section 3 below |
| 10 | **Paper I essay engine** | News auto-fills the Q / D / E / S banks | **BUILT** for the ca-daily lane (`g1_bank`, `Banks.jsx`) |

### Section 3 — the article → note bridge (DONE, 22 Aug 2026)

Before this, `np_articles.item_id` existed in the schema and **nothing ever
wrote it**, so the in-app path dead-ended: admin uploads a PDF → articles →
relevance score → stops. A CRITICAL-scored article produced nothing a student
could read.

What was built:

| Piece | Where |
|---|---|
| Shared drafting library | `server/src/lib/draft.js` |
| Worker (one process, one edition) | `server/scripts/draft-articles.js` |
| API | `POST` / `GET /api/admin/editions/:id/draft` in `routes/editions.js` |
| Admin UI | `DraftPanel` in `pages/admin/AdminEditions.jsx` |

Design points worth not re-litigating:

- **The model is not asked to re-derive what Section 2 measured.** Bucket,
  keyword angles, topics and the units those topics already feed are passed in
  as *findings*. Asking a model a question already settled deterministically
  gets you a second, disagreeing answer.
- **`insertDrafted` is shared with `ca-daily/run.js`, not copied into it.** It
  holds the vocabulary canonicalisation that turns an echoed
  `"P3-U7 — Policy process"` line back into `P3-U7`. A unit code nothing can
  match is not a wrong tag, it is an invisible one — and unit tags are what the
  cross-paper reuse map is built on. Two copies would have drifted silently.
- **Print items carry no invented URL.** The citation is written from the
  edition row (publication, date, page); anything the model returns in
  `sources` is dropped. `is_primary` is 0 — a newspaper is secondary.
- **Every bridged item is `needs_verify = 1`.** One print report is not the
  cross-check the research discipline requires.
- **The angle rule, the corrections guard and `validateItem` all apply**, the
  same three the web lane uses.

- **MCQ generation is included.** `D.generateMcqs()` in `lib/draft.js`, shared
  with the CLI lane, using the PYQ-driven format mix, `validateMcq` and the
  corpus-wide `questionHash` dedupe. `--no-mcqs` / `--mcqs-per N` on the worker.

### The PYQ format engine was inert until 22 Aug 2026

Worth recording, because nothing about it looked wrong. `plannedFormatsFor` sat
at module scope in `run.js` and called `say()`, which is defined inside
`main()`. So whenever the PYQ layer *did* have evidence for a keyword, the log
line threw a `ReferenceError` into its own `catch`, and the catch returned the
rotation. The fallback is a legitimate answer, so every run looked healthy.

Measured on the live database: keyword `Scheme` has **52 questions** of usable
evidence asking for
`[direct_recall, direct_recall, direct_recall, negative_statement]`. Every item
ever generated silently received the rotation
`[direct_recall, multi_statement, list_matching, assertion_reason]` instead.

The shared version takes `db` and `onLog` as parameters, so a missing dependency
is a `TypeError` at the call site rather than a swallowed miss.

---

## 4. The six engines (the same thing, grouped for the dashboard)

1. **Newspaper Intelligence** — import, OCR, article detection, duplicate merge
2. **Current Affairs Intelligence** — relevance, four buckets, priority scoring
3. **APPSC Knowledge Graph** — syllabus → topic → keyword → PYQ → format *(the brain)*
4. **Group 2 Engine** — notes → keywords → PYQ pattern → MCQs → revision
5. **Group 1 Engine** — Tier 1 → priority → cross-paper reuse → AP block → skeletons
6. **Paper I Essay Engine** — data, quotes, examples, case studies, reports, committees, schemes

## 5. Dashboard surface

```
APPSC INTELLIGENCE HUB
  Today's Current Affairs   ·  Newspaper Analysis
  Group 1                   ·  Group 2
  Tier 1 Priority Topics    ·  PYQ Intelligence
  Andhra Pradesh Knowledge Map
  Paper I Essay Bank        ·  MCQ Practice
```

All of these are views over **one** knowledge database.

## 6. Master note format (the base record for Layer 9)

Why in News · Background · Key Facts · Multi-dimensional Analysis · AP Angle ·
Related Schemes · Reports · Judgments · Data · Static Connections ·
PYQ Connections · Essay Bridges · Way Forward

From this single note: **Group 1** (detailed analysis) · **Group 2** (concise
facts) · **Essay Bank** (examples and data). The same knowledge is never
generated twice.

---

## 7. Open backlog not blocked on any decision

- 8 PYQ PDFs still only ~10 questions extracted (filter fixed, no full run yet)
- `topics.tier` hand-assigned; `suggestTiers()` has 68 unapplied proposals
- Duplicate topics from merging news + blueprint vocabularies need a human merge
- `np_articles` scores were computed against the 424-keyword vocabulary and
  would shift if re-scored against 737
- `np-daily/README.md` is stale — it still says `np_editions` does not exist
- `topics.tier` is still hand-assigned. `suggestTiers()` now has **70**
  proposals against real evidence (10 promotions to tier 1), unapplied.
- The topic vocabulary is 43 topics, so only **101 of 252** Group-I question
  slots matched anything. That is a vocabulary gap, not a matcher fault — the
  un-matched slots are the shortest route to knowing which master topics are
  missing.

### Group-I Mains PYQs — SEEDED 22 Aug 2026

`content-pipeline/pyq/g1-mains-pyq-2017-2025.md` → `server/scripts/seed-g1-pyq.js`
→ 20 papers, 252 question slots, 101 topic links. Re-runnable (it owns the
`g1-mains-*` slugs and replaces them).

- **One row per question NUMBER, not per alternative.** `1 (a) … OR (b) …` is
  one slot a candidate answers once; Paper I offers three essays per section.
  Counting alternatives separately would double every Paper II–V topic count and
  inflate recurrence. It also sidesteps `UNIQUE (paper_id, q_no)`, which would
  otherwise have silently collapsed each Paper I section to one row.
- **`format = 'descriptive'` on every row**, which `formatMix()` already
  excludes — so 252 Mains questions cannot shrink any real MCQ format's observed
  share. Verified: `Scheme` still reports 52 questions of evidence, not 52 + n.
- **Keyword tagging is opt-in** (`--tag-keywords`, default off). It would raise
  `pyq_count`, which feeds the Section 2 relevance score, so it changes what
  every future article scores. Defensible, but a decision rather than a default.
- **`topicRecurrence()` was fixed to filter by exam.** It previously counted
  every row in `pyq_questions` as Group-II — harmless while the table held only
  Group-II questions, wrong the moment these landed. Blueprint `topic_evidence`
  is now used only where no real paper covers the topic, since the blueprint is
  a reading *of* the 2023 and 2025 papers.

The payoff, measured rather than asserted: **Finance Commission and fiscal
federalism — 8 Group-I questions across 3 papers in all 4 years** (21 questions
/ 6 papers counting both exams). `suggestTiers()` previously wanted to *demote*
it, because the Group-II bank alone was half the evidence.
