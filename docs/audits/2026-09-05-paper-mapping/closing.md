# Paper mapping — closing measurement, 5 September 2026

Run it: `python docs/audits/2026-09-05-paper-mapping/final-measurement.py server/data/ca.db`

```
published items      127
tags                 262
blank items          11   (8.7% of published)

POOLED PRECISION           136/147 = 92.5%
  excluding deferred       136/141 = 96.5%

  surviving sample tags    81/92  = 88.0%
  new-alias tags           55/55  = 100.0%
```

Superseding an earlier run at 261 tags / 91.8%: `road safety` was then made weak,
which removed the one error the batches had introduced (item 213), and `MSME`
was given its missing national units, which added one tag to item 154. The
100.0% on new-alias tags is 55 of 55 rather than a perfect vocabulary — the
error that was in that population has been removed from the corpus, not
re-judged.

The `MSME` tag on item 154 (`G1P-C3`, from "Indian MSME manufacturers") is
correct and is counted in neither population; it postdates both batches.

## Read the 92.5% carefully

It mixes two populations that are not the same kind of thing.

**The 92 surviving sample tags are a random draw** — three samples of 40, taken
from the whole tag population without looking at them first. That number, 88.0%,
is the one that generalises, and it is the honest successor to the 83.9% this
programme was gated on.

**The 55 new-alias tags are not a random draw.** They are the tags produced by
37 aliases that were proposed one at a time, each defended against the sentence
it appears in and the count of articles it would touch, and each approved by
hand. 100% is what a curated vocabulary scores on the corpus it was curated
against. It says the batches did not buy recall with precision — which is what
it was asked to answer — and it says nothing about how those aliases will behave
on next month's paper.

Quoting 92.5% as "the precision of the mapper" would be quoting a blend whose
composition was chosen after the fact. The number to carry forward is 88.0%,
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

## The MSME alias, and what it blocks

`MSME` now maps to `G1P-C3` and `G2-P2-U3` as well as `G2-P2-U5`. It should
probably not map to `G2-P2-U5` at all: across 411 articles that pairing earns
exactly two tags and BOTH are wrong — item 154 (a White House report on Indian
pump exports) and item 218 (India's industrial heat electrification), neither
of them about Andhra Pradesh. The unit's own label reads "AP agriculture,
industry, MSMEs...", so the alias is defensible on paper and has never once
paid off in practice.

That one row is what keeps the strict-acronym plural rule out. With it present,
`MSMEs` in item 218 recovers three tags — two right, one wrong — which is worse
than the corpus average. Drop it and the recovery is two for two and the rule
ships. Left for the reviewer: dropping an alias is the same class of decision as
adding one and gets the same approval.

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
