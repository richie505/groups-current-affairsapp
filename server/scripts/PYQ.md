# The PYQ layer

What the commission has actually asked, as data — so that generation imitates the
real paper instead of a rotation.

```bash
# Group-II: the hand-tagged bank (format evidence). Use the appsc-group2-prep
# skill's copy — it holds eight papers; the appsc-group2-tutor one holds one.
node server/scripts/seed-pyq-bank.js --file "<appsc-group2-prep skill>/references/pyq-bank.md"

# The blueprint's full keyword-angle vocabulary, from the same skill
node server/scripts/seed-blueprint-keywords.js --file "<appsc-group2-prep skill>/references/blueprint-keywords.md"

# Group-I: recurrence and cross-paper reuse from the Mains blueprint
node server/scripts/seed-g1-blueprint.js --file APPSC-G1-Mains-Blueprint/01-MASTER-STUDY-PLAN.md

# Additional papers, from PDFs (OCR + structuring)
node content-pipeline/pyq/extract.js --list
node content-pipeline/pyq/extract.js --paper g2-2023-screening --pages 5-8
```

## Two halves, two currencies

The layer looks lopsided until you notice that the two exams are scored
differently.

| | Group II | Group I Mains |
|---|---|---|
| Answers are | ticked | written |
| So "format" is | the whole point | meaningless |
| What is counted | **format mix per keyword** | **recurrence and cross-paper reuse** |
| Table | `pyq_questions` + `pyq_question_keywords` | `topic_evidence` |
| Drives | which MCQ formats to generate | study priority, `topics.tier` |

Asking "what format was this asked in" about a descriptive paper is a category
error, which is why the Group-I half counts something else entirely.

## The Group-II half: format mix

`plannedFormats(db, keyword, n, fallback)` returns the formats to generate for a
keyword, distributed as APPSC actually distributed them, falling back to the
rotation when the evidence is thinner than four questions — because a
distribution built on two questions is not a distribution, it is two questions.

`run.js` calls this instead of its fixed cycle. Measured against the hand-tagged
2025 Mains Paper I, the old cycle was wrong in specific, correctable ways:

| format | observed | old cycle | gap |
|---|---|---|---|
| direct_recall | 47.5% | 20.0% | **+27.5** |
| count_based | 0.6% | 10.0% | **−9.4** |
| multi_statement | 10.8% | 20.0% | −9.2 |
| statement_based | 2.5% | 10.0% | −7.5 |
| list_matching | 12.7% | 20.0% | −7.3 |
| chronological | 3.8% | **0.0%** | +3.8 |

It produced less than half the plain recall the paper actually asks, sixteen
times too many count-based questions, and **no chronological questions at all**
for a format that is 4% of the real paper.

What comes out per keyword is specific rather than generic:

```
Author            -> list_matching, negative_statement, direct_recall, statement_based
FIRST             -> direct_recall, direct_recall, direct_recall, direct_recall
Amendments        -> direct_recall, direct_recall, assertion_reason, multi_statement
```

`Author` resolving to list-matching is the style guide's own observation
(Authors↔Works is a natural pairing) arrived at from the data; `FIRST` resolving
to pure recall is obvious in hindsight and was not being done.

## Format classification

`classifyFormat(stem, options)` is deterministic. An exam board writes to a house
style — "Match List I with List II", "Assertion (A) … Reason (R)", "Arrange … in
chronological order" — and those are patterns, not judgements. 14 of 15 test
cases pass; the residual is `direct_recall`, because a four-option question with
no special structure *is* recall, and leaving those `unknown` would discard most
of the corpus.

Two decisions worth knowing when reading any distribution:

- **Negation outranks structure.** "Consider the following statements … which is
  NOT correct" is filed as `negative_statement`, not `multi_statement`. So the
  `multi_statement` count is a count of *positive* multi-statement questions.
  Negation is the rarer and more diagnostic property and it is where marks are
  lost.
- **A bare `not` in the stem is enough.** Enumerating the phrasings missed "was
  not written by Harshavardhana" on a real 2023 question. Matched against the
  stem only, so a distractor containing "not" cannot make a question negative.

## The Group-I half: recurrence

`topic_evidence` holds what the blueprint observed across the 2023 and 2025
papers: 54 Tier-1 topics with their paper, unit and evidence phrase; the 26
reuse clusters with the paper to *study from* and the papers they *also answer*;
and the 11 AP clusters. The parser's counts matched the document's own stated
totals exactly — 54, 26, 11 — which is the cheapest available check that it read
the tables correctly.

`topicRecurrence()` unions both halves. It has to: counting only the Group-II
bank recommended demoting **Finance Commission and fiscal federalism** out of
tier 1, the single most-recurring topic in the Group-I blueprint. A tier derived
from half the evidence is worse than the hand-assigned tier it replaces.

`suggestTiers()` returns suggestions and does not write them. With one tagged
paper and a two-year blueprint, the corpus can rank topics; it cannot overrule a
considered judgement without someone looking.

## Provenance, and what must never be served

Every question records how it was obtained:

- `source = 'bank'` — hand-tagged. `stem_kind = 'gloss'`: the stem is a
  *description* ("Andhra newspaper founders/dates"), not the question as printed.
  **Good evidence, and never a practice question.** Serving a gloss to a student
  as a question is the one way this layer could do harm.
- `source = 'extracted'` — OCR'd and structured from a PDF. `stem_kind =
  'verbatim'`, with `ocr_confidence`, `needs_review` and the `raw` text kept for
  audit.

## Why the PDFs are re-OCR'd rather than read

The PYQ PDFs already carry a text layer, and it is somebody else's bad OCR baked
in. On a 2023 question it produced:

> "Whieh one of the lbllowing books was lvritten by Harshavardhana"

Re-OCR at 300 DPI produced, at 95% confidence:

> "Which one of the following books was **not** written by Harshavardhana ?"

The baked-in layer had **dropped the word "not"**, inverting the question. A bank
storing the opposite of what was asked is worse than no bank, so the text layer
is ignored deliberately.

The pages are bilingual and the OCR interleaves the two languages, so English
lines arrive out of order and split mid-sentence. Confidence separates them
cleanly — English sits at 78-96, Telugu OCR'd without a Telugu model at 33-73 —
and reassembly is the one stage a model does, with a prompt that transcribes
rather than interprets and is forbidden from supplying an answer key from memory.

## Known limitations

- **Eight papers are tagged, 1,127 questions** — 2016/2018/2023 screening, 2018
  Mains Papers I and 3, 2025 Mains Papers I and II, and 2019 GS. 96 keywords
  carry the four questions of evidence `plannedFormats()` needs; the rest still
  fall back to the default cycle. Distributions for a keyword with 4-12
  questions are directional, not precise.

  Note there are TWO `pyq-bank.md` files. The one to seed lives in the
  **`appsc-group2-prep`** skill (125 KB, eight papers); the one in
  `appsc-group2-tutor` holds only 2025 Mains Paper I and is a subset of it.
- **38 rows are `format = 'unknown'`.** Mental Ability question types
  (Coding-Decoding, Blood Relations, Non-verbal Figure Reasoning and the rest)
  are not among the eight formats the generator uses, and ten more are questions
  the official key marked deleted. `formatMix()` excludes `'unknown'`, so
  neither group skews a planned mix — but neither is evidence either.
- **The scans are still barely extracted.** The filter that discarded short
  option lines is fixed (see `content-pipeline/pyq/extract.js`), and kept lines
  went from 52 to 128 of 151 across the pages it was measured on, but only ten
  questions have actually been run through stage 3. Until a full run is made,
  the bank is the format evidence and the scans are not.
- **Group-I evidence is topic-level, not question-level.** The blueprint records
  "Both years", not the questions themselves, so there is no Group-I question
  text in the database at all.
- **`topics.tier` is still hand-assigned.** `suggestTiers()` proposes 68 changes,
  mostly promoting reuse-map topics; none are applied.
- **Duplicate topics from merging two vocabularies.** "AP agriculture and natural
  farming" and "AP agriculture, irrigation, cropping, climate change" are
  separate rows that should probably be one. Needs a human merge pass.
- **No UI.** CLI and library only.
