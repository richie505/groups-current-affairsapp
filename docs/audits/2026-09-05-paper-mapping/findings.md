# Paper-mapping audit — findings

**5 September 2026.** Measured before changing anything, to decide whether the
evidence filter needed fixing before the alias vocabulary was grown.

- `sample.py` — draws the sample (seeded, re-pullable)
- `sample-40-marked.md` — the 40 tags with a verdict and a reason on each
- `blanks.py` — sizes the blank items and splits them by cause

## What the paper line is, and where it comes from

Nothing writes "this article is Group-II Paper II". The line under each topic in
the circulated PDF is derived, in five steps, and only one of them is a
judgement:

1. **Alias match** — `lib/relevance.js` matches the article's headline,
   standfirst and body against `ref_unit_aliases` (934 aliases over 106 units),
   recording for each unit: which terms matched, how many times, and whether it
   was in the headline.
2. **The evidence filter** — a hit survives only if it is in the headline, OR
   reached by two distinct terms, OR reached by one term *containing a space*.
   Only survivors are written to `np_article_units`.
3. **Article units → item units** — `lib/draft.js` copies them across, minus
   `broad` and `unfeedable` units. The model is not asked and its answer is not
   used.
4. **Unit → paper** — a column lookup on `ref_units.paper`.
5. **Papers → the printed line** — `lib/sections.js`, `papersFor()`.

Step 2 is the whole quality gate.

## Precision: 29/40 = 72.5%

Well under the 95% that would have justified skipping straight to the blanks,
and under the 80% that was set as the "fix the filter first" threshold.

The eleven wrong tags, by cause:

| Cause | Count |
|---|---|
| Third clause — one *spaced* but generic phrase, in the body | **7** |
| Single-word hit in headline/standfirst with no corroboration | 2 |
| Two names inside a single quoted sentence | 1 |
| Segmentation bleed — two stories merged into one article | 1 |

The seven are `renewable energy`, `human rights`, `good governance`,
`artificial intelligence`, `Legislative Assembly`, `stock exchange`,
`population density`.

## The space heuristic fails in both directions

"Contains a space" was a proxy for "specific enough to stand alone". Measured
against the actual vocabulary:

```
aliases WITH a space (auto-qualify as specific):   519
aliases WITHOUT a space (can never stand alone):   415
    including UPSC, SEBI, IRDAI, TRAI, NHRC, POCSO, ASEAN,
              BRICS, QUAD, SAARC, UNSC, AMRUT, MGNREGA, PMAY, CRDA
```

So it costs recall as well as precision, and the two failures are the same
failure. **Item 104** is the proof: a report on the BRICS Youth Ministers'
Meeting, where `BRICS` is already an alias of `G1P-B6`, appears once in the
body, and was dropped for being one word. That item is one of the thirty
blanks.

Across the 29 blank items that have a linked article:

| | Count |
|---|---|
| Would gain a unit from an explicit `standalone` flag, **no new aliases** | 4 |
| Match only a weak generic word today (`soil`, `regulator`, `port`) — real vocabulary gaps | 9 |
| Match no alias at all — real gaps mixed with ~6 items that should never have been drafted | 16 |

The four are items 75 (`AMRUT`, `AIIB`), 104 (`BRICS`), 125 and 130 (`CPI`).

## Three faults found on the way, outside the paper-mapping chain

1. **`in_headline` is not the headline.** It is `headline + standfirst`, and on
   this paper the standfirst is frequently a whole paragraph. That is why
   `stock exchange` is recorded as a headline hit on an article headed *"Trade
   scam or supply chain play? Profit in transit"* — the phrase is in a
   200-character standfirst. The strongest clause in the filter is weaker than
   its name suggests.
2. **An advertisement is in the corpus as an article** — item 228, headline
   *"22 Product Categories\* Retail Touchpoints 22 States & 5 UTs\*"*, with
   advertising copy as its standfirst. An ingestion filter miss.
3. **A segmentation bleed** merged an ISRO/Gaganyaan op-ed into a story about
   FDA notices over a Vimal Elaichi advertisement, which is what produced a
   space-and-defence tag on item 82. The known multi-column merge problem.

## Method note

The first pass judged tags against `ca_items.headline`, which is written by the
drafting model. The matcher reads `np_articles.headline`. They differ, and on
at least three tags the difference changes the verdict — item 101's article is
headed *"Keralam to approach Centre against Railway bifurcation"* while its item
is headed *"Railway Board to detach the Mangaluru region…"*. The sample was
re-pulled and re-marked against the article text.
