# APPSC Current Affairs Portal

Daily current affairs for the APPSC **Group-I** and **Group-II** examinations, where
one day's reading is routed to both exams at once.

Standalone: its own database, its own login, no coupling to the sibling
`appsc-group2-prep-app`.

---

## The idea: dual routing

Group-I and Group-II need the *same news* in **two different shapes**, and the
difference is not cosmetic:

| | Group-II | Group-I |
|---|---|---|
| Atomic output | An MCQ in one of **8 official formats** | A **capture card** carrying an argument |
| Tagging | **Blueprint keyword angles** — `Appointed`, `GI tag`, `Index` | **Paper-unit codes** — `[P4-U4]`, `[P3-U2]` |
| Grouping | 4 buckets: International / National / **AP** / syllabus update | 4 banks: **Q**uote / **D**ata / **E**xample / **S**cheme |
| What scores | The fact, recalled precisely | **THE ANGLE** — the argument the fact supports |
| Discipline | Distractors must be real-but-wrong | **Discard aggressively** |

So the atomic object is **one item, routed both ways**, and the student reads it
through a **lens** they switch in the header. Read once, file twice — instead of
two current-affairs habits nobody sustains for nine months.

Every item carries:

```
SHARED     headline · event date · bucket · tier · notes · static linkage · sources
GROUP-II   prelims facts · keyword angles · MCQs (8 formats)
GROUP-I    bank (Q/D/E/S) · THE FACT · THE ANGLE · paper units · themes
```

### Three rules the code actually enforces

**1. No angle, no Group-I lane.** An item you cannot argue from will never appear
in an answer, so it must not inflate the bank counts. Enforced in three places —
the pipeline discards it, `validateItem` rejects it, and a database trigger
(`trg_items_require_angle_*`) aborts the write.

**2. Discard is a first-class outcome.** Most news should be discarded. Discards
are kept as rows with their reason, the admin dashboard shows the count as a
*positive* signal, and the pipeline warns if the discard rate falls under 20% — a
run that keeps everything it finds is not being ruthless enough.

**3. Facts go stale, so say when they were true.** Every MCQ carries
`fact_as_of`, every explanation is required, and a seeded `ref_corrections`
register is both injected into the drafting prompt *and* checked against every
draft. A wrong current-affairs fact cannot be caught against a textbook, which is
why this gets three layers rather than one.

---

## Setup

Node 20+.

```bash
cd server && npm install && npm run seed
cd ../web && npm install && npm run build
```

`npm run seed` creates `server/data/ca.db` with an admin account and the
reference vocabularies: **492 blueprint keyword angles** across 9 subjects, **50
paper units**, and the **4 known corrections**.

Then load six digests of real, researched, cross-checked content:

```bash
node server/scripts/seed-content.js --publish
```

Seeded admin: `admin@appscca.local` / `Admin@123` — change it on first login via
**Your account**.

## Running

One process serves both the API and the built frontend:

```bash
cd server && npm start
```

Open **http://localhost:4100**.

For frontend work, run Vite separately — it proxies `/api` to port 4100:

```bash
cd web && npm run dev
```

---

## Layout

```
server/
  src/db/schema.sql          the dual-routing schema, with the angle triggers
  src/lib/bankReview.js      the Group-I bank review (targets, thin banks, AP coverage)
  src/lib/quiz.js            paper builder — windows, and the 8-format mix
  src/lib/corrections.js     the known-corrections guard
  src/lib/revision.js        Leitner scheduling (boxes 1-5, 1/3/7/14/30 days)
  src/routes/content.js      student API
  src/routes/admin.js        admin API + the validators the pipeline reuses
  scripts/seed.js            admin + reference vocabularies
  scripts/reference-data.js  keywords, paper units, themes, corrections
  scripts/seed-content.js    six digests of researched content
web/
  src/context/LensContext.jsx   the G1/G2/both lens every screen reads
  src/components/ItemCard.jsx   where dual routing shows up on screen
  src/pages/                    Today · Day · Item · Archive · MonthRevision ·
                                Practice · Banks · Revision · Mistakes ·
                                Bookmarks · Progress · Search · Profile
  src/pages/admin/              Dashboard · Queue · Days · ItemEditor ·
                                Flags · Runs · Students · Corrections
content-pipeline/ca-daily/
  README.md                  the sweep brief and how to run it
  run.js                     candidates → triage → draft → MCQs → review queue
  prompt-draft.txt           the dual-routing prompt
  prompt-mcq.txt             the 8 formats and the distractor rules
```

## Screens

**Student.** *Today* resolves to the latest published digest, not the literal
date — a day the pipeline hasn't run should not look like a broken app.
*Archive* is month-first, because current affairs is revised by month, not by
day. *Practice* is scoped by **window** ("last 7 days", "this month") rather than
by topic, and mixes the paper across formats instead of serving the bank in
whatever order SQL returns it. *My Banks* is the Group-I bank review: Q/D/E/S
against 40/60/50/50, the thinnest bank by share of its own target, per-theme AP
coverage flagged below three examples, cards resting on a superseded position,
and two or three specific things to hunt this week. *Mistakes* groups by keyword
angle, because "you keep missing `Appointed` questions" is actionable and a flat
list of wrong answers is not.

**Admin.** *Review queue* is the gate — every draft shows its sources, its tags
and its correction hits inline, because a review that requires clicking away to
check a URL is a review that quietly stops happening. Publishing a day checks
every draft first and reports exactly what blocks it, rather than publishing
eight of ten and failing silently on two. *Corrections* is the highest-value
maintenance surface: adding a row there is how a newly-superseded fact starts
being caught.

## The MCQ unlock

Questions are hidden until the item is marked read — the same rule as the sibling
app, for the same reason: a question answered before the notes teaches the
answer, not the topic. Practice reports how many are still locked, so a thin
paper reads as "go and read" rather than "the bank is empty".

---

## The pipeline — one command a day

```bash
node content-pipeline/ca-daily/daily.js --date 2026-08-21 --dry-run   # look first
node content-pipeline/ca-daily/daily.js --date 2026-08-21             # then insert
```

Four stages: **discover → shortlist → fetch → draft**.

| Stage | Model |
|---|---|
| Parse PIB's own release index (~40/day, 1,200+/month) | **none** |
| Shortlist on headlines and ministries — the discard gate | small |
| Fetch full body text for survivors only | **none** |
| Dual-lane routing, corrections guard, MCQs, validation, dedupe → drafts | main |

Two design decisions carry most of the value:

**Discovery uses no model.** Asking a model what happened invites invented URLs;
asking PIB for its index returns the actual list. The model is used only where it
beats code — judging examinability, and writing exam material from a release.

**The shortlist runs on headlines, not bodies.** Fetching 40 releases to throw 32
away is waste. One small call sorts them; only survivors get fetched and drafted.
That is what makes a daily habit affordable.

AP items are flagged from a district/place-name list, sorted ahead of national
items, and kept by the shortlist at a deliberately lower bar. `--ap-only` runs
just those — the highest-return fifteen minutes available.

Nothing publishes itself. The drafting is worth automating; the approving is not.
Details, including the manual route for sources PIB does not carry, in
[`content-pipeline/ca-daily/README.md`](content-pipeline/ca-daily/README.md).

## Where the notes come from

**The app has no crawler.** Nothing in the codebase hits the web on a schedule.
The source list is a *brief* for the sweep, which a person or an agent runs; then
`fetch-source.js` pulls the body text of the URLs found, and `run.js` takes it
from there. Reasoning in the pipeline README — a scraper cannot tell a superseded
figure from a current one, and this is the material where that mistake is
unrecoverable.

**Primary, preferred:** `pib.gov.in` · `prsindia.org` · `rbi.org.in` ·
`sebi.gov.in` · `isro.gov.in` · `mospi.gov.in` · MoEFCC · MNRE ·
**AP department portals** · `psc.ap.gov.in` · `pmindia.gov.in`.
**Secondary, for leads:** The Hindu, Indian Express, Down To Earth; **Eenadu,
Sakshi, The Hindu AP edition** for state news.
**Coaching sites are leads, never sources** — they disagree with each other and
propagate each other's errors.

## Content status

Six digests (5–21 Aug 2026), researched live and cross-checked. **3 of 7 items
rest on a primary source; the other 4 on two or three independent secondaries.**
That ratio is a real constraint, not a preference: RBI's document server is
CAPTCHA-gated to automated clients, and the AP plan was reported from a
review meeting rather than a notified order.

Two items carry `needs_verify` with a note saying what to check — a
forward-looking ISRO launch date, and a Visakhapatnam Economic Region figure
reported inconsistently as ₹9 lakh crore and ₹9.5 lakh crore. Those are left in
deliberately: it is what an honest current-affairs pipeline looks like, and the
review queue needs real examples of the state to be worth anything.

Two worked examples of why reading the source matters, both from building this:

- The **RBI repo rate** came back as both 5.25% and 5.5% in search. The 5.5%
  results were 2025 articles; three 2026 sources agreed on **5.25%**.
- The **NIIF item** was filed as 19 August on the strength of a search result.
  Reading the PIB release showed it dated **29 June 2026** — so it now sits in
  the 21 August digest as a catch-up item with its true `event_date`, which is
  exactly what the event-date/digest-date split exists for.

## Known limitations

- **Automated discovery covers PIB only.** That is the primary source for
  virtually every central scheme and cabinet decision, so it is the bulk of the
  daily feed — but **AP government orders, PRS Bill summaries, RBI documents and
  newspaper reporting still need the manual route.** RBI's document server is
  CAPTCHA-gated to automated clients; open those in a browser.
- **The PIB index covers the current month.** Earlier months need the browser,
  because PIB's month filter runs through an ASP.NET postback rather than the
  query string.
- **No shared login** with `appsc-group2-prep-app`. Standalone means standalone.
- **No PDF import yet.** The sibling `ca-monthly` parser already handles monthly
  compendiums and can be pointed at this database to backfill Jan–Jul 2026.
- **The service worker does not register inside the in-app browser pane.** It
  serves correctly (200, `Cache-Control: no-cache`) and works in a normal
  browser; the pane's sandbox refuses the registration.
- **The content bottleneck is real but no longer manual.** Seven items is a
  demo. The value compounds with daily runs — a month in, Practice has hundreds
  of questions and the banks start meaning something.
