# The daily current-affairs pipeline

## One command

```bash
node content-pipeline/ca-daily/daily.js --date 2026-08-21 --dry-run   # look first
node content-pipeline/ca-daily/daily.js --date 2026-08-21             # then insert
```

Omit `--date` and it runs yesterday — PIB posts through the day, so a morning run
for "today" sees a fraction of it.

Nothing this pipeline produces reaches a student. Everything lands as `draft` in
**Admin → Review queue**, and a person approves it.

## The four stages

| Stage | What it does | Model |
|---|---|---|
| **1. Discover** | `sweep.js` parses **PIB's own release index** — ministry, headline, date, URL for every release. About 40 a day, 1,200+ a month. | **none** |
| **2. Shortlist** | One call over *headlines and ministries only*, deciding which few are worth drafting. This is the discard gate. | small (`gpt-4o-mini`) |
| **3. Fetch** | Full body text for the survivors only, via `fetch-source.js`. | **none** |
| **4. Draft** | `run.js` — dual-lane routing, corrections guard, MCQs in the eight formats, validation, dedupe, insert as drafts. | main (`gpt-4o`) |

**Discovery deliberately uses no model.** Asking a model "what happened on
19 August" invites invented URLs and half-remembered figures. Asking PIB for its
own index returns the actual list. The model is used only where it is genuinely
better than code: judging examinability, and turning a release into exam
material.

**The shortlist runs on headlines, not bodies.** That is what makes a daily run
affordable — fetching 40 full releases in order to throw 32 away is pure waste.
One small call sorts them, then only the survivors get fetched and drafted.

### Andhra Pradesh

`sweep.js` flags AP-relevant items by matching a district and place-name list
against the headline, and sorts them ahead of national items on the same date.
The shortlist prompt is then told to keep AP items **at a much lower bar** —
a minor AP item beats a major national one, because AP is roughly half of Papers
II and IV and no national source covers it at the depth this exam demands.

`--ap-only` restricts the whole run to AP items, which is the fifteen minutes a
day with the highest return.

### Flags

| Flag | Effect |
|---|---|
| `--date YYYY-MM-DD` | Which day to run. Defaults to yesterday. |
| `--dry-run` | Discover, shortlist, fetch, draft to JSON — insert nothing. |
| `--ap-only` | Only Andhra Pradesh items. |
| `--max-items N` | Cap items drafted, default 10. Anything cut is **named** in the log, not dropped silently. |
| `--mcqs-per N` | Questions per item, default 4. |
| `--no-mcqs` | Draft items without questions — about a fifth of the cost, good while tuning prompts. |
| `--model` / `--shortlist-model` | Override either model. |
| `--keep-candidates` | Keep the intermediate candidates file for inspection. |

---

## Running the stages by hand

The stages are independently runnable, which is how you debug one without paying
for the others.

```bash
# What was published? No API key needed.
node content-pipeline/ca-daily/sweep.js --date 2026-08-19
node content-pipeline/ca-daily/sweep.js --date 2026-08-19 --ap

# What does one release actually say? No API key needed.
node content-pipeline/ca-daily/fetch-source.js "<url>"
```

`run.js` still takes a hand-built candidates file, which is the route for
anything PIB does not carry — an AP government order, a PRS Bill summary, a
newspaper report. See the candidates shape below.

---

## The manual sweep (for what PIB does not carry)

`daily.js` covers PIB, which is the primary source for virtually every central
scheme and cabinet decision. It does **not** cover AP government orders, PRS Bill
summaries, RBI documents (CAPTCHA-gated) or newspaper reporting — so for those,
run this brief against the live web and hand the result to `run.js` as a
candidates file. It is written to be pasted to an agent as-is.

> Sweep current affairs for **{date}** for the APPSC Group-I and Group-II exams.
>
> **Primary sources first:** PIB, PRS India (Bills, Acts, commission reports),
> RBI, SEBI, ISRO, DRDO, MoSPI, MoEFCC, ministry `gov.in` pages, AP government
> department portals, `psc.ap.gov.in`. **Secondary, for leads only:** The Hindu,
> Indian Express, Down To Earth; Eenadu, Sakshi and The Hindu AP edition for
> state news. **Treat coaching sites as leads, never sources** — they disagree
> with each other and propagate each other's errors.
>
> **Spend the most effort on Andhra Pradesh.** It is roughly half of Papers II
> and IV, a fifth of Paper V, and present in every Paper I essay, and no national
> source covers it at the depth this exam demands. Hunt specifically for: state
> budget and fiscal position · Amaravati and capital-region development ·
> industrial policy, MSMEs, ports, corridors · agriculture, natural farming,
> aquaculture, irrigation, Polavaram · welfare scheme launches and evaluations ·
> governance and digital delivery · disasters and relief · environment, coastal,
> forest, wildlife · **anything with a number attached to Andhra Pradesh**.
>
> Cross-check every appointment, award name and figure against at least two
> sources. Where you cannot confirm something, say so rather than filling it in.
>
> Return a JSON array of candidates in the shape below. Include borderline items
> — the triage stage discards, and it is better placed to than the sweep.

### The candidates file

```json
[
  {
    "headline": "16th Finance Commission report tabled in Parliament",
    "date": "2026-02-01",
    "text": "Full source text or a substantial extract. The drafting step is told to write nothing it cannot support from this, so a thin extract produces a thin item.",
    "sources": [
      { "url": "https://prsindia.org/...", "publisher": "PRS India", "is_primary": true },
      { "url": "https://pib.gov.in/...", "publisher": "PIB", "is_primary": true }
    ]
  }
]
```

`text` is the field that matters. The prompt forbids supplying figures from
memory, so whatever is missing here will be missing from the item — which is the
correct failure, but it does mean a one-line summary yields a one-line note.

### Getting the full release text: `fetch-source.js`

Once the sweep has found a URL, this pulls the readable body so the candidate
carries what the release actually says:

```bash
node content-pipeline/ca-daily/fetch-source.js "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2295480&reg=48&lang=1"
```

Add `--json` to emit a candidates-file skeleton with the text filled in, the
headline taken from the page title, and `is_primary` set automatically from the
hostname. It leaves `date` blank on purpose — guessing the publication date is
how an item ends up filed on the wrong day.

```bash
node content-pipeline/ca-daily/fetch-source.js --json <url> <url> > cands.json
```

**This is the highest-leverage step in the pipeline.** Note quality is capped by
how much source text reaches the model, and the difference between citing a
release and reading it is large. Two of the seeded items were rewritten after
their PIB releases were actually read — the blending-obligation ladder and the
₹2,110/MMBTU price in the GOBARdhan item exist only because of it, and reading
the NIIF release caught a **date error**: it was filed as 19 August on the
strength of a search result, and the release is dated **29 June 2026**.

### What is actually reachable

Verified by trying:

| Host | Result |
|---|---|
| `pib.gov.in` | **Works.** Needs a browser `User-Agent`, which `fetch-source.js` sends — the default one gets 403. This is why the tool exists. |
| `pmindia.gov.in`, `consilium.europa.eu`, `ec.europa.eu` | Work. |
| `rbidocs.rbi.org.in` (RBI PDFs) | **CAPTCHA-gated.** Returns a human-verification page to any automated client. Open RBI documents in a real browser and paste; do not try to work around it. |
| Most national dailies | Usually work, but paywalls and consent interstitials are common — check that what came back is the article and not a subscription wall. |

The extractor is deliberately crude: block-level tags become newlines before
markup is stripped, so a table of figures survives as readable lines rather than
collapsing into one run — and on a PIB release the figures usually *are* in a
table. Navigation and footer chrome comes through too. That is accepted: the
drafting model ignores boilerplate perfectly well, whereas an aggressive
readability heuristic risks cutting the one paragraph that carried the number.

**Read what comes back before running it.** An extraction heuristic is not a
substitute for having looked at the page.

---

## Step 2 — run it

### First, a calibration run

`sample-candidates.json` holds two real candidates: the GOBARdhan approval, which
should survive, and a ministerial restatement of existing policy, which should be
discarded. Two API calls, so it costs almost nothing.

```bash
node content-pipeline/ca-daily/run.js --candidates content-pipeline/ca-daily/sample-candidates.json --date 2026-08-06 --dry-run
```

Expect: **1 drafted, 1 discarded**. GOBARdhan is also already in the app as a
hand-authored item, so `out/2026-08-06-drafts.json` can be read straight against
it — that comparison is the fastest way to see whether the routing, the tagging
and above all THE ANGLE are coming out at the standard you want, before you point
the pipeline at a real day's sweep.

If the angle reads as the fact restated, tighten the angle section of
`prompt-draft.txt` and re-run with `--fresh`.

### Then the real thing

Dry run first. It writes the JSON and touches nothing.

```bash
node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21 --dry-run
```

Read `out/2026-08-21-drafts.json`, then insert:

```bash
node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21
```

| Flag | Effect |
|---|---|
| `--candidates <file>` | The sweep output. Required. |
| `--date YYYY-MM-DD` | Which digest these items belong to. Required. |
| `--dry-run` | Write the JSON, insert nothing. |
| `--no-mcqs` | Draft items only — useful when reviewing routing before paying for questions. |
| `--mcqs-per N` | Questions per item, default 4. |
| `--limit N` | Stop after N candidates. |
| `--model <id>` | Overrides `OPENAI_MODEL`. |
| `--fresh` | Ignore `state.jsonl` and redo everything — use after editing a prompt. |

`OPENAI_API_KEY` is read from the repo-root `.env`.

**Resumable.** Every outcome is appended to `state.jsonl`, so a rate-limit at
candidate #40 resumes rather than restarting, and never pays twice for work
already done. Delete the file, or pass `--fresh`, to start over.

---

## What the triage throws away

Most news should be discarded. An item survives only if it yields **either** a
Group-II keyword angle **or** a Group-I bank slot, and — for the Group-I lane —
only if an *angle* can be written for it.

Discards are written to the database as rows with their reason, not dropped. That
record is the only way to audit whether the triage is working, and the run prints
a warning if the discard rate falls below 20%: a pipeline that keeps everything it
finds is not being ruthless enough, and a capture system nobody trims is one
nobody runs for nine months.

## The angle rule

An item routed to the Group-I lane without `g1_angle` is discarded here, rejected
by the server validator, and blocked by a database trigger. Three layers for one
rule, because it is the rule that decides whether the app produces exam material
or a news digest:

> Not an angle: *"The 16th FC retained devolution at 41%."* That is the fact
> restated, and every candidate will write it.
>
> An angle: *"Discontinuing revenue deficit grants hits AP directly — a
> revenue-deficit state since bifurcation. And 'Contribution to GDP' as a new
> criterion reopens equity-versus-efficiency."*

## The corrections guard

Every entry in `ref_corrections` is injected into the drafting prompt **and**
checked against the output afterwards. Both, because a model told the current
position may still restate the old one.

A **high**-severity hit means the draft carries a phrase associated with the
superseded position; the item is marked `needs_verify` with the correct position
attached and goes to the queue flagged rather than blocked — whether the usage is
actually wrong depends on context, and only a person can judge that.

The four seeded corrections are the ones a verification pass found had already
gone stale in fifteen months: the **Labour Codes** (in force 21 Nov 2025),
**Amaravati** (sole statutory capital, Act assented 7 Apr 2026), the **16th
Finance Commission** (award 2026-31, revenue deficit grants discontinued), and
the **Census** (2027, notified with caste enumeration). Add to the list from
**Admin → Corrections** whenever another fact moves.

## MCQ generation

Formats are assigned by the script, not chosen by the model, and cycle through a
mix weighted to direct recall, multi-statement and list-matching — the shapes
current-affairs facts take naturally — with assertion-reason and
negative-statement rotated in because the real paper leans on them and they are
where marks are lost.

Every question is validated against the server's own `validateMcq` (not a
reimplementation of it) and deduped on a normalised question hash against the
whole existing bank. Every explanation carries `fact_as_of`, so a question that
has since been superseded is identifiable rather than merely wrong.

---

## Scheduling

One command per day, so it can be wired to a scheduled task once you trust it.
Keep publishing manual: the drafting is worth automating, the approving is not.
