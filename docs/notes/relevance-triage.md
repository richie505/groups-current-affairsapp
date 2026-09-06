# Relevance-gated extraction

*Written 6 September 2026, from the first classified edition.*

Every article in an edition is now read once by a model, cheaply, before
anything is spent on it, and filed as **high**, **partial** or **drop** with a
0–100 score and a one-sentence reason.

| | |
|---|---|
| Prompt | `content-pipeline/ca-daily/prompt-triage.txt` |
| Library | `server/src/lib/triage.js` |
| Worker | `server/scripts/triage-edition.js` (lock: `ca_runs.mode = triage-<id>`) |
| Runs | automatically, chained from `process-edition.js` |
| Columns | `np_articles.triage_class`, `_class_model`, `_score`, `_reason`, `_areas`, `_model`, `triaged_at` |

## The routes

- **high** — the existing full pipeline: notes, static background, hook and
  recap, prelims facts, questions.
- **partial** — the existing salvage lane: the examinable facts only, as a
  Miscellaneous card. No prose, because there was no theme.
- **drop** — nothing is written. The row keeps its class, score and reason, and
  the edition screen lists it.

## Why it exists

An article already arrived carrying a composite score from `relevance.js` and a
syllabus unit list from the alias matcher. Both are deterministic and free, and
what they measure is how much of the text collides with a vocabulary the app
already holds — which is not the same question as "is this examinable".

On the 6 September edition the alias map covered **26 of 93 articles**. The
other 67 were scored by nothing that had read them, never drafted, never
salvaged, and no row said why.

What the model buys, on that edition: eleven articles the composite rated
*medium or high* were correctly dropped.

| composite | triage | headline |
|---|---|---|
| 78 | 18 | Jagan demands CBI probe into DSC recruitment 'scam' |
| 66 | 17 | APUTF ends hunger strike after CM's assurance |
| 64 | 16 | Ex-Mayor seeks FIR against police over residence search |
| 62 | 18 | Centre obstructing caste census to prevent true representation |
| 60 | 24 | Young Leaders for Social Change programme launched |
| 60 | 18 | Cong. revamps organisation ahead of crucial State polls |

That is exactly the class the composite has always over-rated and cannot
separate, because it scores AP place names, officialdom and money.

## Two rules that changed, both on measurement

### The no-syllabus-unit veto is gone

An article matching no unit was never drafted in full. The rule was right when
there was nothing better to appeal to: a composite cannot separate "Rs 7,470 cr.
cleared for infra works in ULBs" from "Cultural diversity highlight of gala
dinner in Vizag".

It fired on **6 of the model's 9 `high` verdicts** on the first real edition, and
every one was core material — the 12th Pay Revision Commission, the Census 2027
schedule, a CM order on the SC/ST Atrocities Act, the SIR voter-roll revision,
the Javelin acquisition. It was not filtering junk; it was capping the digest at
what the vocabulary already knew.

The class it existed to stop is now stopped by the model instead (the table
above). So it is a **flag, not a veto**: such articles are drafted and listed on
the edition screen as vocabulary gaps, which is the actionable form — add the
alias and they arrive matched next time.

### The model does not decide how many

Each call sees twelve articles and nothing else, so "a typical edition yields
about twenty high" is not something a batch can act on. Three batches out of
seven returned zero, and the edition came out with three `high`. Three is not a
digest.

The **ranking** those calls produced was good — the top sixteen by score were
all defensible and the tail fell away where it should. So the model is asked for
the thing it is good at, a judgement about one article, and `select.js` keeps
the thing that is not a property of any article: the adaptive 12–35 band.

Both answers are stored. `triage_class_model` is the verdict as given,
`triage_class` is the route after the band, so the override is countable rather
than assumed. Moving the dial on the drafting screen re-draws the line with no
model call — the verdicts are already paid for.

## Cost

Seven calls for a 96-article edition, batched twelve at a time, on the shortlist
model. The 15 articles `relevance.js` had already vetoed before scoring are
dropped by rule with no call at all.

It is also a saving. Salvage previously ran on every leftover with a syllabus
unit, one call apiece; it now runs on the `partial` class only.

## 6 September 2026

```
18 pages · 96 articles · 94 events · 2 merged
93 articles → 12 high, 14 partial, 67 dropped · 5 vocabulary gaps
```

## What to watch

- **The drop pile, sorted by composite.** The top of that list is where triage
  and the deterministic scorer disagree, and it is the only place a wrong line
  will show up. Read it on any edition that feels thin.
- **The vocabulary gaps.** Five on the first edition. If the same concept
  appears there twice, add the alias — that is the loop closing.
- **`triage_class <> triage_class_model`.** Counts how often the band overruled
  the model. Consistently large means the band is wrong for this paper, not that
  the model is.
