# APPSC Current Affairs — Retention PDF Template Kit

Drop this folder into your Claude Code project (e.g. `pdf-template/`).

```
template.html      page shell (loads theme.css + build.js; falls back to fetch('data.json') in a browser)
theme.css          all styling + design tokens (edit colours/fonts here)
build.js           data.json -> DOM (cover, contents, sections, topics, hook sheet, answer key)
render.js          node render.js data.json out.pdf   (Playwright + Chromium, A4, page numbers)
schema.json        JSON Schema for data.json
data.json          the 23 Aug 2026 compendium, already in the new shape (sample/reference)
TEMPLATE_SPEC.md   the contract for Claude Code: block order, writing rules, prompt snippet, checklist
tools/             one-off extractor that converted the old PDFKit compendium into data.json (not needed day-to-day)
```

Quick start

```bash
npm i playwright && npx playwright install chromium
node render.js data.json out.pdf
```

Preview without a PDF: `python3 -m http.server` in this folder and open http://localhost:8000/template.html

Tell Claude Code: "Read pdf-template/TEMPLATE_SPEC.md. Generate data.json in that schema from today's notes, then run node pdf-template/render.js data.json out/<date>.pdf."
