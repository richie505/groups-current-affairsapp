# APPSC Current Affairs — Retention PDF Template (spec for Claude Code)

This file is the contract between your content generator and the PDF layout.
Paste it (or `@`-reference it) in your Claude Code project so the agent produces
`data.json` in exactly this shape and renders it with `render.js`.

## 1. Pipeline

```
newspaper PDF ──► (your existing notes generator) ──► data.json ──► node render.js data.json out.pdf
```

* `template.html` + `theme.css` + `build.js` = the layout. Never hand-edit HTML per issue.
* `data.json` = the only thing that changes each day.
* `render.js` = Playwright/Chromium renderer (A4, page numbers in footer).

Install once: `npm i playwright && npx playwright install chromium`.

If your app already draws PDFs with PDFKit (the original compendium did), you have two options:
(a) swap the PDF step for `render.js` — simplest, and the layout stays pixel-identical to this kit; or
(b) keep PDFKit and port section 3 + `theme.css` tokens into your PDFKit drawing code.
Option (a) is recommended.

## 2. Document order (what the reader sees)

1. **Cover** — title, date, exam chips, 3 stat tiles, "How to study this compendium" (4-step retention routine), meta block.
2. **Contents** — every topic with its *memory hook* under the title (so the TOC doubles as a revision list).
3. **Sections** (each starts on a new page with a banner) → **Topics**.
4. **Hook sheet** — one page listing all hooks: cover the right column, recall the recap.
5. **Answer key** — quick-check strip (`Q1 · C  Q2 · D …`), then explanations grouped by topic in two columns.

## 3. Topic anatomy (fixed order — this order is the retention design)

| # | Block | Purpose | Rules |
|---|-------|---------|-------|
| 1 | Number + Title + Paper tags | orientation | tags are uppercase chips, e.g. `GROUP-I PRELIMS — POLITY & GOVERNANCE` |
| 2 | **Memory hook** (teal) | one line the brain can hold | ≤ 110 chars; numbers, names, places joined by `·` `→` `=` `+`; no full sentences |
| 3 | **30-second recap** (amber) | the skeleton of the topic | exactly 3 bullets, each ≤ 40 words; bullet 1 = what happened (who/where/when), bullet 2 = the examinable numbers/names, bullet 3 = the static link or the "so what" |
| 4 | Why in news | context paragraph | 60–120 words; **bold** every fact that can become an MCQ option |
| 5 | Key details | table + prose | 2-column table (`header`, `rows`), then 1–2 prose paragraphs |
| 6 | Static linkage (blue box) | syllabus connection | `summary` (italic) + optional blocks: *What it is*, *Key facts* (table), *The provisions that get asked*, *Easily confused with*, *Andhra Pradesh* |
| 7 | Prelims facts | scan list | write as `Label — Value` (or `Label: Value`); the template splits on the dash and bolds the value. 6–14 items |
| 8 | Practice questions | 4 MCQs | mix types: direct, statements I/II/III, match-list, assertion–reason, INCORRECT-statement. Options are plain strings; the template adds (a)–(d) |
| 9 | Answers strip | quick self-check | generated automatically from `answer` |

Hook and recap sit **above** the notes on purpose: first pass = hooks + recaps only; second pass = notes; then MCQs; next day = hook sheet.

## 4. data.json schema (see schema.json for the formal version)

```jsonc
{
  "meta": {
    "title": "Andhra Pradesh Current Affairs",
    "subtitle": "Daily Compendium",
    "date": "23 August 2026", "weekday": "Sunday",
    "exams": ["APPSC Group-I Prelims", "APPSC Group-II Screening", "APPSC Group-II Mains"],
    "source": "The Hindu", "reading_time": "About 33 minutes",
    "disclaimer": "…", "footer": "APPSC Current Affairs · Sunday, 23 August 2026"
  },
  "sections": [
    { "label": "Section I", "title": "Governance, Polity & Administration",
      "topics": [
        { "n": 1, "title": "…", "tags": ["GROUP-I PRELIMS — POLITY & GOVERNANCE"],
          "hook": "3 hubs on one map: Vizag = network · Amaravati = sports city · Nellore = equipment factory",
          "recap": ["…", "…", "…"],
          "why_in_news": ["paragraph with **bold** facts"],
          "key_details": [
            { "type": "table", "header": ["Item", "Detail"], "rows": [["…", "…"]] },
            { "type": "p", "text": "…" }
          ],
          "static_linkage": {
            "summary": "This updates the static topics of …",
            "blocks": [
              { "title": "What it is", "type": "p", "items": ["…"] },
              { "title": "Key facts", "type": "table", "header": ["Attribute", "Value"], "rows": [["…", "…"]] },
              { "title": "The provisions that get asked", "type": "list", "items": ["…"] },
              { "title": "Easily confused with", "type": "list", "items": ["**X** vs **Y** — …"] },
              { "title": "Andhra Pradesh", "type": "list", "items": ["…"] }
            ]
          },
          "prelims_facts": ["Event date — 22 August 2026", "…"],
          "questions": [
            { "q": 1, "stem": "…\nI. …\nII. …\nWhich of the statements given above is/are correct?",
              "options": ["I only", "II only", "Both", "Neither"],
              "answer": "A", "explanation": "…", "as_of": "2026-08-22" }
          ]
        }
      ]
    }
  ]
}
```

Notes
* Inline formatting: only `**bold**` is supported (everything else is escaped).
* `stem` may contain `\n` for statement lists / List-I / List-II; the template preserves line breaks.
* Question numbers (`q`) run continuously across the whole document.
* `answer` is a single capital letter A–D.
* Keep `explanation` to the reasoning; put the date in `as_of` instead of repeating "true as of …" in every answer.

## 5. Design tokens (theme.css `:root`)

| Token | Value | Used for |
|---|---|---|
| `--brand` | `#9A3412` rust | section labels, topic numbers, tags, answer pills |
| `--hook` | `#0F766E` teal | memory hook box, how-to box |
| `--recap` | `#B45309` amber | 30-second recap box |
| `--static` | `#1D4ED8` blue | static-linkage box |
| `--font` | Segoe UI / Roboto / Helvetica | body |
| `--font-head` | Georgia / Times | titles, hooks, numbers |
| `--fs` | 9.3pt | base size; A4; margins 14/13/16/13 mm |

Change colours or fonts only here.

## 6. Prompt snippet for generating hooks and recaps

> For each topic write a `hook` (≤110 characters, no full sentences, built from the 3–5 most examinable tokens — numbers, names, places, dates — joined with `·`, `→`, `=`, `+`) and a `recap` of exactly three bullets (≤40 words each): (1) what happened — who, where, when; (2) the numbers and names an examiner would lift into options; (3) the static-syllabus link or why it matters. Do not repeat the title in the hook.

## 7. Quality checklist before rendering

- every topic has `hook`, 3 `recap` bullets, ≥1 `why_in_news` paragraph, 4 questions with 4 options each and an `answer`
- `prelims_facts` items contain a ` — ` or `: ` separator so they split into label/value
- no raw markdown tables or `\n\n` inside prose (the old generator leaked these)
- `node render.js data.json out.pdf` exits 0; the hook sheet fits on one page (≈21 topics max)
