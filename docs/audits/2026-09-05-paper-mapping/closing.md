# Paper mapping — closing measurement, 5 September 2026

Run it: `python docs/audits/2026-09-05-paper-mapping/final-measurement.py server/data/ca.db`

```
published items      127
tags                 263
blank items          11   (8.7% of published)

POOLED PRECISION           136/146 = 93.2%
  excluding deferred       136/141 = 96.5%

  surviving sample tags    81/91  = 89.0%
  new-alias tags           55/55  = 100.0%
```

Superseding earlier runs at 261 tags / 91.8% and 262 / 92.5%: `road safety` was then made weak,
which removed the one error the batches had introduced (item 213), and `MSME`
was given its missing national units, which added one tag to item 154. The
100.0% on new-alias tags is 55 of 55 rather than a perfect vocabulary — the
error that was in that population has been removed from the corpus, not
re-judged.

The `MSME` tag on item 154 (`G1P-C3`, from "Indian MSME manufacturers") is
correct and is counted in neither population; it postdates both batches.

## Read the 93.2% carefully

It mixes two populations that are not the same kind of thing.

**The 92 surviving sample tags are a random draw** — three samples of 40, taken
from the whole tag population without looking at them first. That number, 89.0%,
is the one that generalises, and it is the honest successor to the 83.9% this
programme was gated on.

**The 55 new-alias tags are not a random draw.** They are the tags produced by
37 aliases that were proposed one at a time, each defended against the sentence
it appears in and the count of articles it would touch, and each approved by
hand. 100% is what a curated vocabulary scores on the corpus it was curated
against. It says the batches did not buy recall with precision — which is what
it was asked to answer — and it says nothing about how those aliases will behave
on next month's paper.

Quoting 93.2% as "the precision of the mapper" would be quoting a blend whose
composition was chosen after the fact. The number to carry forward is 89.0%,
with the new-alias figure as evidence about the batches specifically.

## One correction to the earlier figures

Sample 1's verdicts are now read from the recorded table in
`sample-40-marked.md`, matched by (item, unit). The earlier pooled runs
re-derived them by re-drawing the sample from a seed and mapping verdicts BY
POSITION, which is only correct if the population being drawn from is
byte-for-byte the one the sample was originally taken from. That snapshot no
longer exists. The parse reproduces the recorded 29/40 = 72.5% exactly, so it is
self-checking; the position-based figures may have been slightly mis-keyed.

## The 11 surviving errors

| item | unit | class |
|------|------|-------|
| 63 | `G2-P2-U5` | deferred — advertisement admitted as an article |
| 82 | `G1P-S3`, `G2-P2-U6` | deferred — segmentation bleed, op-ed into news |
| 144 | `G1P-B3` | deferred |
| 154 | `G2-P2-U5` | deferred |
| 228 | `G2-P2-U2` | deferred — advertisement |
| 93 | `G2-P1-U7` | substantive mention, wrong unit |
| 101 | `G1P-A6` | two names inside one quoted sentence |
| 112 | `G2-S2` | substantive mention, wrong unit |
| 193 | `G2-P2-U4` | substantive mention, wrong unit |
| 205 | `G1P-S5` | substantive mention, wrong unit |

Eleven now, not twelve: item 213's `G1P-D4` is gone. `road safety` was made weak
after this table was first written, so `transport` and `road safety` together no
longer satisfy the two-terms clause and the district awareness campaign lost the
tag. That item is now blank, which is the right answer for it.

Six of the eleven are deferred classes: an advertisement that should never have
been ingested, and an op-ed the column segmenter merged into a news story. No
filter clause can fix either; they are ingestion defects.

Four are the same residual class — the article genuinely discusses the thing,
and the unit is the wrong one for it. That is a question about which unit owns a
topic, not about whether the topic is present, and the filter has no access to
it.

## The MSME alias — resolved, and the class it belongs to

`MSME` no longer maps to `G2-P2-U5`. Across 411 articles that pairing earned two
tags and BOTH were national stories — item 154 (a White House report on Indian
pump exports) and item 218 (India's industrial heat) — and it never once caught
an AP MSME story. The unit's label reads "AP agriculture, industry, MSMEs...",
so the alias was defensible on paper and worthless in practice. The bare acronym
now maps to `G1P-C3` and `G2-P2-U3`; the AP unit holds `AP MSME`, `Andhra
Pradesh MSME` and `MSME in Andhra Pradesh` instead.

That unblocked the strict-acronym plural rule, which now recovers two tags on
item 218 and both are right. Shipped.

**The state-qualified phrases fire on nothing.** `AP MSME`, `Andhra Pradesh
MSME` and `MSME in Andhra Pradesh` each match zero articles in this corpus, as
do the equivalents for every other generic alias tested. A newspaper printed in
Andhra Pradesh does not write "AP MSME"; it writes "MSMEs" and lets the story
carry the state. So dropping `MSME` from the AP unit was a pure removal of a
wrong tag, and the phrases added in its place are insurance against a future
article, not recall recovered today.

## The AP-scope class in general

134 aliases sit on the eight AP-scoped objective units; 77 of them do not name
the state. That is the population `MSME` came from. Measured across the corpus,
those 77 produced 21 tags on published items and only five landed on an article
the scorer did not flag as Andhra Pradesh:

| item | unit | alias | verdict |
|------|------|-------|---------|
| 147 | `G2-P2-U5` | `dairy` | WRONG — a Karnataka paneer ban on the AP industry unit |
| 75 | `G2-P2-U4` | `AIIB` | a real AP story (MA&UD) the AP flag missed; a multilateral bank on the AP finance unit is still the wrong route to it |
| 193 | `G1P-C5` | `Reorganisation Act`, `bifurcation` | defensible — Krishna water sharing IS a bifurcation matter |
| 193 | `G2-P1-U5` | `bifurcation` | defensible, same reason |
| 193 | `G2-P2-U4` | `central assistance` | WRONG, already judged so in sample 2 |

So the class is real but small: two clear errors out of 21. It is NOT the case
that generic aliases are flooding the AP units — `MSME` was the worst of them
and it is fixed.

An article-level gate ("only tag an AP unit when the article is flagged AP")
would remove all five, including the two defensible ones and the AP story whose
flag was wrong. That is three good tags to buy two bad ones, so it is not the
answer either.

## What the eleven remaining blanks are

Four are foreign stories with no Indian paper line — 118, 131, 156, 226. Blank
by design; the circulation panel now filters for them so they stop reading as
mapping failures.

One is item 210, where the column segmenter merged a CBI prosecution story into
a bonded-labour raid. Any alias added would tag the wrong half. See
`docs/notes/segmentation-bleed-news-into-news.md`.

Four are thin by editorial judgement and kept published anyway — 114 (the
biosignature; the GSI is only an affiliation), 143 (the junior doctors' strike),
230 (medical-college rankings), and 213 (the road-safety drive, which went blank
when `road safety` was made weak).

The remaining two are ordinary vocabulary gaps that no proposal survived review
for.

## The MCQ unit column

`ca_mcqs.unit_code` may only hold a unit the question's ITEM carries. Enforced at
generation (generateMcqs hands the model that list and nothing else) and now
also at the write, which is the door a future caller would otherwise walk
through.

`backfill-mcq-units.js` brought the existing rows toward that invariant by
matching each question's text against its candidate units' aliases — the same
lookup the article mapping uses, for the same reason: re-runnable, and
correctable by editing one alias row.

```
                 before   after
  valid            533     593
  mismatched       188     128
  blank             76      63
```

**128 questions still hold a unit their item does not carry.** The backfill fills
and re-points; it does not blank. For 84 of them the alias evidence chose
nothing and for 55 two units tied, and in both cases the script leaves the
existing value rather than inventing one — which means the invariant the column
is supposed to have is still false 128 times. Blanking them is the consistent
finish and is a separate decision, because it destroys information: a wrong unit
still records that somebody once thought the question belonged somewhere.

The 60 that were re-pointed were read against their question text first. Six AP
industrial-park questions moved off the Energy units onto AP industry, five
national-highway questions moved off social geography onto economic geography,
four RTE questions moved onto Indian Society. None is worse than what it
replaced.
