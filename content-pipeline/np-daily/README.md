# The newspaper lane

Turns an uploaded ePaper PDF into a candidates file for the existing drafting
pipeline. One command:

```bash
node content-pipeline/np-daily/paper.js "inbox/TH- Vijayawada 21-08.pdf" --date 2026-08-21 --dry-run
node content-pipeline/np-daily/paper.js "inbox/TH- Vijayawada 21-08.pdf" --date 2026-08-21
```

Then hand the result to the lane that already exists:

```bash
node content-pipeline/ca-daily/run.js --candidates content-pipeline/np-daily/out/candidates-2026-08-21.json --date 2026-08-21 --dry-run
```

**Nothing here drafts and nothing here publishes.** This lane only answers
"what is in today's paper, and which few pieces of it are worth writing up".

---

## Why it stops at a candidates file

The drafting, the dual-lane routing, the corrections guard, the MCQ generation,
the validation and the dedupe already exist in `ca-daily/run.js`, and they are
the same job regardless of where the event was found. A newspaper is a different
way of **discovering** an event, not a different kind of event.

So this lane is a second discovery front end for a pipeline that already has
one. `run.js` needs no changes to accept it.

## The five stages

| Stage | What it does | Model |
|---|---|---|
| 1. Extract | `layout.py`: text layer where there is one, OCR where there is not | none |
| 2. Segment | `segment.js`: columns → articles; ads and furniture dropped with reasons | none |
| 3. Merge | `merge.js`: the same event reported twice becomes one event | none |
| 4. Gate | judges which few of ~120 articles are examinable — the discard gate | small, or none |
| 5. Emit | a candidates file in the shape `run.js` already consumes | none |

Four of the five stages use no model at all. That is deliberate and it is the
same reasoning the PIB lane uses: asking a model what a page says invites
invention, while asking the PDF returns what is actually printed. The model is
used only where it beats code — judging whether a story is examinable.

## The one idea in the segmenter

A newspaper page is not a document. It is a set of columns with headlines
stamped across them, so the only question for a block of body text is *which
headline owns this column, here?* The answer:

> the nearest headline **above** the block whose horizontal span **covers** the
> block's centre

This reconstructs reading order with no column grid, and not needing one
matters: a real page carries more than one grid at once. Page 8 of the first
edition this was built against sets its upper half on a 119pt column pitch and
its lower strip on a 110pt pitch, so any page-wide grid misassigns the strip.

It works because of how pages are designed rather than by luck — a headline
placed in a column is precisely the mark that the story above it ended there. A
six-column headline owns body text six columns to its right; a one-column
headline owns only its own column. Both fall out of the same rule.

**Where that rule fails.** It assumes a headline is set at least as wide as the
story under it. True on news pages, false on feature pages, where a narrow
display headline sits over a story running six columns wide — the columns
outside the headline's span end up with no owner. So a second pass attaches each
orphan to the nearest article *region*, capped at 140pt (about one column) so
that two unrelated stories are never welded together silently. On the test
edition this pass took orphaned blocks from ~130 down to 7.

## What gets thrown away, and why that is the point

On the test edition: 28 pages → 7 pages skipped whole → 118 articles → 117
events. Of 282,819 characters extracted, 225,595 survive as article bodies; the
rest is advertising, classifieds, plate codes and running heads.

Then the gate discards most of what remains, because **a newspaper is mostly not
examinable**. Local crime, civic complaints, film, sport, festival logistics and
college functions are the bulk of any edition. A discard rate under 70% is
reported as a warning, not a success.

Everything dropped is dropped **with a reason**, at every stage — page skips,
block-level noise, orphans beyond the cap, and gate discards. A segmenter that
quietly loses a column looks identical to one that works, which is why the
counts are printed rather than hidden.

## A newspaper is a lead, not a source

The candidates this lane emits carry `is_primary: false` and a `url` of the form
`newspaper:the-hindu-th-vijayawada-21-08-2026-08-21-p10`. There is no link,
because an ePaper PDF has no public address, and inventing a plausible URL would
be worse than admitting there is none. The `citation` field carries the real
locator: publication, edition, date and page.

Each candidate also carries `origin.needs_lookup`, set by the gate and defaulting
to true for anything with a number in it. It means: *this figure has not yet been
seen in an official document.* The gate prompt is written to prefer stories that
name a findable instrument — a GO, a Cabinet decision, an Act, a report, an
appointment — precisely so that the lookup is possible.

This matters because of a failure already recorded in this repo: an RBI repo
rate came back from search as both 5.25% and 5.5%, and the reason was that the
5.5% results were a year old. A newspaper report of a figure is exactly the kind
of evidence that cannot settle a question like that.

## Andhra Pradesh

AP items are flagged from the district and place-name list the PIB sweep already
maintains (`ca-daily/sweep.js` → `AP_TERMS`), reused rather than copied so the
two lanes cannot drift apart. The **dateline** is checked as well as the body,
because a story filed from AMALAPURAM is an AP story even when its text never
names the State.

AP events sort ahead of everything else regardless of prominence — a minor AP
policy item is worth more to this exam than a major national one — and
`--ap-only` runs just those.

> A note on why the dateline is extracted at all: it is also the cheapest
> correctness check available on the segmenter. If datelines stop appearing,
> bylines have stopped being recognised, which means roles are being
> misclassified, which means body text is being misrouted.

## Two languages

`merge.js` decides whether two articles are one event, and it uses a different
comparator depending on whether the pair shares a script:

- **Same script** (two English reports, one on the national page and one on the
  state page): token overlap on headline and opening body, weighted to the
  headline. Above 0.42 they are merged automatically.
- **Cross script** (The Hindu against Eenadu): token overlap is useless, because
  the two texts share almost no characters. What they *do* share is the
  language-independent residue — figures, amounts with magnitude words, years,
  acronyms and the Latin-script proper nouns a Telugu paper still prints in
  Latin. Above 0.34 containment the pair is **proposed**, and never merged
  automatically.

Cross-script pairs are only proposed because "both mention ₹2,400 crore and
Polavaram" is suggestive, not proof, and a wrong merge destroys an item. The
verdict needs a model, and that step is **not built yet** — see below.

When articles do merge, the longest leads (length here means detail, not
verbosity) and the others are appended under their own attribution rather than
interleaved, so a later reader can still see which paper said what. Silently
blending two accounts would make a discrepancy between them impossible to
notice, and noticing discrepancies is the whole reason for reading two papers.

## Two gates

`--gate auto` (the default) uses the model when `OPENAI_API_KEY` is set and the
deterministic rule gate when it is not, so the lane always runs.

**The model gate** is the better judge, because "would APPSC ask about this" is a
question about an exam's taste. On the test edition it kept 24 of 117 (79%
discarded).

**The rule gate** (`gate-rules.js`) needs no key. It scores on five signals:

1. **Veto** — the categories that are the bulk of any edition and never
   examinable: local crime, civic complaints, film, ceremonial events, festival
   logistics, weather, listings. Applied first and absolute, so no accumulation
   of keyword hits rescues a robbery report.
2. **Andhra Pradesh** — the strongest positive signal this exam has.
3. **Instrument** — does the story name a findable official act? A GO, a Bill, a
   Cabinet decision, a judgment, an appointment, an allocation.
4. **Blueprint angles** — the seeded `ref_keywords` vocabulary, which wires this
   lane into the Group-II keyword engine with no model in the path. Matched
   angles are carried onto the candidate as `origin.keyword_angles`.
5. **Prominence** — the editor's own judgement, in points of headline size.

On the test edition it kept 19 of 117 (84% discarded), and about three of the 19
were marginal. Two lessons from tuning it, both measured rather than guessed:

- **Bare institution words separate nothing.** `Minister`, `President`, `India`,
  `Committee` matched a weather report, a wedding and a strike alike, so they are
  stoplisted. They remain good APPSC *question angles*; they are useless as a
  *filter*. The discriminating form is the word plus context, which is what the
  instrument patterns match (`committee … constituted`, `report … released`).
- **An angle in the headline means the story is about it; the same word in the
  body is usually incidental.** So a headline hit scores 1.5 and a body-only hit
  0.4. Before that split, four incidental words pushed a weather report over the
  bar.

The rule gate's thresholds were tuned against **one** edition. That is honest but
it is one edition: raise `KEEP_AT` if the kept list reads thin, lower it if AP
items are being missed.

## A note on models

`OPENAI_MODEL` and `OPENAI_SHORTLIST_MODEL` must be **API model ids** — lowercase
and hyphenated, e.g. `gpt-5.6-luna`, not `GPT-5.6 Luna`, which returns
`400 invalid model ID`. To see what a key actually has access to:

```bash
curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | grep -o '"id": *"[^"]*"'
```

Some newer models accept only the default temperature and reject any other value
with a 400 rather than clamping it. `ca-daily/lib.js` handles this by dropping
whichever sampling parameter the API names and retrying, rather than keeping a
per-model list that would go stale — so both lanes work on old and new models
without configuration.

## Publication profiles

`profiles.js` holds one entry per paper. The Hindu's typesetter names its fonts
semantically — `PublicoBannerRs-*` is the headline face, `PublicoTextRs-Roman`
is body, `PublicoTextRs-RomanSC` is section furniture — which makes role
detection nearly deterministic on its pages and much stronger than "bigger than
the median".

That signal is worth exactly one publication, so `generic` carries a
size-percentile fallback for everywhere it does not apply, including **every
OCR'd page**, which has no font identity at all. `detect()` chooses from the
fonts actually present rather than from the filename, because filenames lie.

Adding a paper means adding an entry here. Nothing else needs to know a font
name.

Each `headline` guard in a profile exists because of a specific false positive
seen on a real page: a drop cap (one letter at 37pt), a standfirst (Banner face
but small, directly under the headline), a pull-quote (Banner face, small,
mid-column), a page section title, and a continuation line of a multi-line
display headline ("for the festival").

## OCR

Pages with a usable text layer are read directly; pages below
`--ocr-threshold` characters are rasterised and passed to Tesseract, whose TSV
output gives word boxes and per-word confidence. OCR coordinates are scaled back
into PDF points so that every rule in the segmenter means the same thing on both
paths.

On the test edition seven pages needed OCR at about 5 seconds each, and all
seven turned out to be **full-page property advertisements and a *businessline*
supplement wrap** rather than news. Worth knowing: for The Hindu, OCR is mostly
paying for pages you then discard. It earns its place on Eenadu and on the
occasional flattened news page.

Tesseract is found automatically even when it is not on `PATH`, which it is not
under the standard Windows installer.

### Telugu is not yet readable

This machine's Tesseract has `eng` and `osd` only. Eenadu needs
`tel.traineddata` in `C:\Program Files\Tesseract-OCR\tessdata\`, from the
official `tesseract-ocr/tessdata` repository. Until it is present, `layout.py`
reports a warning per page and returns no text for Telugu image pages — it does
not fail silently.

If an Eenadu ePaper turns out to carry a real text layer, the traineddata is not
needed at all. Check first:

```bash
python content-pipeline/np-daily/layout.py eenadu.pdf --pages 1-4 --no-ocr | python -c "import json,sys; d=json.load(sys.stdin); print([(p['page'], p['native_chars']) for p in d['pages']])"
```

## Flags

| Flag | Meaning |
|---|---|
| `--date YYYY-MM-DD` | required; the edition date |
| `--dry-run` | extract, segment and merge, then stop before the model call |
| `--profile the-hindu\|eenadu\|generic` | force a profile instead of detecting one |
| `--pages 1-6,23` | limit extraction to some pages |
| `--dpi 300` | rasterisation resolution for OCR |
| `--lang eng\|tel` | OCR language |
| `--ap-only` | keep only events that mention Andhra Pradesh |
| `--max-items 12` | cap on what the gate may keep |
| `--gate auto\|model\|rules\|none` | which gate to use; `auto` prefers the model and falls back to rules |
| `--no-gate` | alias for `--gate none`: emit every event, unfiltered |
| `--keep-ir` | write the raw layout IR to `out/` for inspection |
| `--out FILE` | where to write the candidates file |

Multiple PDFs can be passed at once, which is how a Hindu and an Eenadu edition
for the same date get merged in one run:

```bash
node content-pipeline/np-daily/paper.js hindu.pdf eenadu.pdf --date 2026-08-21
```

## Known limitations

- **Cross-language merging is proposed, not decided.** The pre-filter finds
  candidate Hindu/Eenadu pairs; the model call that confirms or rejects each
  pair is not written yet. Until it is, a Hindu and an Eenadu report of one
  event will produce two candidates, and the proposals are printed so you can
  see which.
- **Telugu OCR is blocked** on the missing traineddata, above.
- **Entertainment and features pages segment poorly.** Their headlines are set
  as display type across several blocks, so fragments occasionally survive as
  junk headlines ("release Bethlehem Kudumba Unit a"). They are discarded by the
  gate anyway, which is why this is not chased further.
- **Interview and Q&A pages merge into one long article.** Page 13 of the test
  edition came out as a single 11,000-character item rather than a headline plus
  its Q&A turns. Acceptable for drafting; wrong if you wanted the questions
  separately.
- **7 blocks on the test edition still find no owner.** They are reported with
  the distance to the nearest article rather than dropped quietly.
- **The rule gate is a floor, not a substitute.** Roughly three of its nineteen
  keeps on the test edition were marginal (a ministerial speech, an event
  announcement). Use the model gate when a key is available.
- **No provenance in the database yet.** The candidates file records which
  edition and page an item came from, but nothing writes that into
  `ca_item_sources` beyond the citation string, and there is no
  `np_editions`/`np_articles` table. So you cannot yet ask the admin "show me
  everything from the 21 August Vijayawada edition".
- **No admin upload screen.** This is a CLI, matching the rest of the pipeline.
