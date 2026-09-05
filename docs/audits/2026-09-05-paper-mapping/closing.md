# Paper mapping — closing measurement, 5 September 2026

Run it: `python docs/audits/2026-09-05-paper-mapping/final-measurement.py server/data/ca.db`

```
published items      127
tags                 261
blank items          10   (7.9% of published)

POOLED PRECISION           135/147 = 91.8%
  excluding deferred       135/141 = 95.7%

  surviving sample tags    80/91  = 87.9%
  new-alias tags           55/56  = 98.2%
```

## Read the 91.8% carefully

It mixes two populations that are not the same kind of thing.

**The 91 surviving sample tags are a random draw** — three samples of 40, taken
from the whole tag population without looking at them first. That number, 87.9%,
is the one that generalises, and it is the honest successor to the 83.9% this
programme was gated on.

**The 56 new-alias tags are not a random draw.** They are the tags produced by
37 aliases that were proposed one at a time, each defended against the sentence
it appears in and the count of articles it would touch, and each approved by
hand. 98.2% is what a curated vocabulary scores on the corpus it was curated
against. It says the batches did not buy recall with precision — which is what
it was asked to answer — and it says nothing about how those aliases will behave
on next month's paper.

Quoting 91.8% as "the precision of the mapper" would be quoting a blend whose
composition was chosen after the fact. The number to carry forward is 87.9%,
with 98.2% as evidence about the batches specifically.

## One correction to the earlier figures

Sample 1's verdicts are now read from the recorded table in
`sample-40-marked.md`, matched by (item, unit). The earlier pooled runs
re-derived them by re-drawing the sample from a seed and mapping verdicts BY
POSITION, which is only correct if the population being drawn from is
byte-for-byte the one the sample was originally taken from. That snapshot no
longer exists. The parse reproduces the recorded 29/40 = 72.5% exactly, so it is
self-checking; the position-based figures may have been slightly mis-keyed.

## The 12 surviving errors

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
| 213 | `G1P-D4` | NEW — a road-safety drive is not economic geography |

Six of the twelve are deferred classes: an advertisement that should never have
been ingested, and an op-ed the column segmenter merged into a news story. No
filter clause can fix either; they are ingestion defects.

Four are the same residual class — the article genuinely discusses the thing,
and the unit is the wrong one for it. That is a question about which unit owns a
topic, not about whether the topic is present, and the filter has no access to
it.

The twelfth, item 213, is the only error the batches introduced: `transport`
(weak) and `road safety` (non-standalone) satisfied the two-terms clause on a
district awareness campaign. One tag from 56, and it argues for `road safety`
being weak rather than for another clause.

## What the ten remaining blanks are

Four are foreign stories with no Indian paper line — 118, 131, 156, 226. Blank
by design; the circulation panel now filters for them so they stop reading as
mapping failures.

One is item 210, where the column segmenter merged a CBI prosecution story into
a bonded-labour raid. Any alias added would tag the wrong half. See
`docs/notes/segmentation-bleed-news-into-news.md`.

Three are thin by editorial judgement and kept published anyway — 114 (the
biosignature; the GSI is only an affiliation), 143 (the junior doctors' strike),
230 (medical-college rankings).

The remaining two are ordinary vocabulary gaps that no proposal survived review
for.
