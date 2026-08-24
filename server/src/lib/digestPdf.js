// One day's digest, rendered as a single PDF.
//
// WHY THIS EXISTS ALONGSIDE digestMarkdown.js
//
// The markdown export is for a vault or a text editor; most students asking
// for "the file" mean something they can open and read as-is, on a phone,
// or print the night before — which a .md file is not, without an app that
// renders it. A PDF is. Same source data, same structure (bucket order,
// per-item sections, answer key at the end), different output.
//
// pdfkit rather than a headless browser: this renders on a small VPS that
// also runs the app itself, and a full Chromium (as puppeteer would pull in)
// is a few hundred MB and a wider attack surface for what is, in the end, a
// page of styled text. pdfkit is pure JS, draws directly, and has no child
// process to manage or crash.
//
// Standard 14 fonts only (Helvetica family) — no embedded font file to keep
// in the repo or licence. The one real gap that leaves is the rupee sign
// (U+20B9), which is not in the WinAnsi encoding those fonts use; sanitize()
// below spells it "Rs." instead rather than risk a missing-glyph box in
// content that is often exactly a rupee figure.

const PDFDocument = require('pdfkit');

const BUCKET_ORDER = ['ap', 'national', 'international', 'dynamic'];

const BUCKET_LABELS = {
  ap: 'Andhra Pradesh',
  national: 'National',
  international: 'International',
  dynamic: 'Syllabus update',
  misc: 'Miscellaneous',
};

const FORMAT_LABELS = {
  direct_recall: 'Direct recall',
  negative_statement: 'Incorrect statement',
  assertion_reason: 'Assertion–Reason',
  statement_based: 'Two statements',
  multi_statement: 'Multi-statement',
  chronological: 'Chronological',
  list_matching: 'List matching',
  count_based: 'How many',
};

const IMPORTANCE_LABELS = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };

// Same palette as the section headers on the day screen in the app itself —
// a student flipping between the app and a printout should not have to learn
// a second colour language for the same five buckets.
const BUCKET_COLORS = {
  ap: '#b45309',
  national: '#475569',
  international: '#2563eb',
  dynamic: '#15803d',
  misc: '#7c3aed',
};

const INK = '#0f172a';
const BODY = '#1e293b';
const MUTED = '#64748b';
const ACCENT = '#2563eb';
const RULE = '#cbd5e1';

function longDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// The characters WinAnsiEncoding (what the standard 14 PDF fonts use) can
// actually draw, beyond plain ASCII: Latin-1 supplement, plus the specific
// punctuation block CP1252 adds at 0x80-0x9F — curly quotes, en/em dash,
// ellipsis, bullet, and a handful of others. Anything else has no glyph.
const WINANSI_SPECIAL = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function isWinAnsiSafe(cp) {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return WINANSI_SPECIAL.has(cp);
}

/**
 * The rupee sign is a known, common case — this app's AP content is full of
 * them — spelled out rather than dropped. Everything else the font can't
 * draw is stripped rather than left to render as whatever the font falls
 * back to: a stray ⚠ once rendered as a mangled character glued onto the
 * next word, which is worse than the symbol just not being there.
 */
function sanitize(text) {
  const s = String(text || '').replace(/₹/g, 'Rs. ');
  let out = '';
  for (const ch of s) {
    if (isWinAnsiSafe(ch.codePointAt(0))) out += ch;
  }
  return out;
}

function tidy(text) {
  return sanitize(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function factLines(text) {
  return tidy(text)
    .split('\n')
    .map((l) => l.replace(/^[-*+]\s+/, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// A small renderer for the loose markdown this app's own content actually
// uses — headings, **bold**, _italic_/*italic*, "- " bullets, paragraphs.
// Not a CommonMark implementation: there is no need for one when the writer
// (the drafting prompts) only ever produces this subset.
// ---------------------------------------------------------------------------

function inlineSegments(line) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_|\*(.+?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ text: m[1], bold: true });
    else parts.push({ text: m[2] ?? m[3], italic: true });
    last = re.lastIndex;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts.length ? parts : [{ text: line }];
}

function fontFor(seg) {
  if (seg.bold && seg.italic) return 'Helvetica-BoldOblique';
  if (seg.bold) return 'Helvetica-Bold';
  if (seg.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** Renders one paragraph's inline formatting, wrapping at the page margin. */
function paragraph(doc, text, { size = 10, color = BODY, indent = 0 } = {}) {
  const segs = inlineSegments(text);
  doc.fontSize(size).fillColor(color);
  const x = doc.page.margins.left + indent;
  doc.text('', x, doc.y, { continued: false }); // establish left edge after any indent change
  segs.forEach((seg, i) => {
    doc.font(fontFor(seg)).text(seg.text, { continued: i < segs.length - 1 });
  });
  doc.moveDown(0.4);
}

const TABLE_ROW_RE = /^\|.*\|\s*$/;
const TABLE_SEP_RE = /^\|(\s*:?-+:?\s*\|)+\s*$/;

function stripInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/_(.+?)_/g, '$1').replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1');
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => stripInline(c.trim()));
}

/** GFM-style tables the drafting prompts sometimes produce for a compact
 *  fact grid ("Item | Detail"). Rendered as an actual ruled table rather
 *  than left as literal pipe characters in running text. */
function renderTable(doc, lines) {
  const header = parseTableRow(lines[0]);
  const rows = lines.slice(2).map(parseTableRow);
  const cols = header.length;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = totalWidth / cols;
  const pad = 4;

  function measure(cells, font, size) {
    doc.font(font).fontSize(size);
    return Math.max(...cells.map((c) => doc.heightOfString(c, { width: colWidth - pad * 2 }))) + pad * 2;
  }

  function drawRow(cells, { bold = false } = {}) {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = 9.5;
    const h = measure(cells, font, size);
    ensureRoom(doc, h + 4);
    const y0 = doc.y;
    cells.forEach((c, i) => {
      doc.font(font).fontSize(size).fillColor(bold ? INK : BODY)
        .text(c, doc.page.margins.left + i * colWidth + pad, y0, { width: colWidth - pad * 2 });
    });
    doc.y = y0 + h;
    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += 3;
  }

  ensureRoom(doc, 30);
  drawRow(header, { bold: true });
  for (const r of rows) drawRow(r);
  doc.moveDown(0.3);
}

/**
 * Renders a markdown-ish field (notes_markdown, static_notes) by scanning it
 * line by line rather than splitting on blank lines first.
 *
 * The first version split on blank lines and classified each resulting block
 * as a heading, a list, or a paragraph — and a table sitting mid-paragraph
 * with no blank line around it (which is how the drafting prompts actually
 * write one: prose, then a compact fact grid, then more prose, no blank line
 * anywhere) fell into "paragraph" and printed as literal pipe characters.
 * Scanning line-by-line and switching mode on what the CURRENT line looks
 * like — independent of blank lines — catches a table wherever it sits.
 */
function markdownBlock(doc, markdown, { headingSize = 11, accent = RULE } = {}) {
  const lines = tidy(markdown).split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const size = Math.max(9, headingSize - (level - 1));
      ensureRoom(doc, size + 10);
      const hy = doc.y;
      doc.moveTo(doc.page.margins.left, hy + 1)
        .lineTo(doc.page.margins.left, hy + size - 1)
        .lineWidth(2).strokeColor(accent).stroke();
      doc.font('Helvetica-Bold').fontSize(size).fillColor(INK)
        .text(headingMatch[2], doc.page.margins.left + 8, hy, { continued: false });
      doc.moveDown(0.25);
      i += 1;
      continue;
    }

    if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[i + 1] || '')) {
      let j = i;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j])) j += 1;
      renderTable(doc, lines.slice(i, j));
      i = j;
      continue;
    }

    if (/^[-*+]\s+/.test(line.trim())) {
      let j = i;
      while (j < lines.length && (/^[-*+]\s+/.test(lines[j].trim()) || !lines[j].trim())) {
        if (lines[j].trim()) {
          const item = lines[j].replace(/^[-*+]\s+/, '').trim();
          doc.fontSize(10).fillColor(BODY);
          const bx = doc.page.margins.left + 10;
          ensureRoom(doc, 14);
          doc.text('•', bx, doc.y, { continued: false, width: 10 });
          doc.text(' ', { continued: true });
          const segs = inlineSegments(item);
          segs.forEach((seg, k) => {
            doc.font(fontFor(seg)).text(seg.text, {
              continued: k < segs.length - 1,
              width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14,
            });
          });
        }
        j += 1;
      }
      doc.moveDown(0.3);
      i = j;
      continue;
    }

    // Plain prose: gather consecutive plain lines into one paragraph, the way
    // markdown treats a single newline inside a paragraph as a soft wrap.
    let j = i;
    const para = [];
    while (
      j < lines.length &&
      lines[j].trim() &&
      !/^(#{1,6})\s/.test(lines[j]) &&
      !/^[-*+]\s+/.test(lines[j].trim()) &&
      !TABLE_ROW_RE.test(lines[j])
    ) {
      para.push(lines[j].trim());
      j += 1;
    }
    ensureRoom(doc, 20);
    paragraph(doc, para.join(' '));
    i = j;
  }
}

function metaLine(item) {
  const bits = [];
  if (item.bucket === 'dynamic' && item.subject_tag) bits.push(item.subject_tag);
  bits.push(IMPORTANCE_LABELS[item.importance] || 'Tier 2');
  if (item.event_date) bits.push(`Event: ${item.event_date}`);
  return bits.join('   ·   ');
}

function ensureRoom(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function sectionRule(doc) {
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(0.75).strokeColor(RULE).stroke();
  doc.moveDown(0.5);
}

/** A small filled pill with a label — the bucket tag on an item, drawn to
 *  match the coloured badge the app itself shows, not left as plain text
 *  competing with everything else on the meta line. Returns its width, so
 *  the caller can place what comes after it. */
function pill(doc, x, y, text, color) {
  doc.font('Helvetica-Bold').fontSize(8);
  const w = doc.widthOfString(text) + 12;
  doc.roundedRect(x, y, w, 14, 7).fillColor(color).fill();
  doc.fillColor('#ffffff').text(text, x, y + 3.5, { width: w, align: 'center' });
  return w;
}

/** A small filled circle holding a number or short label — used for the
 *  running item number against the headline, and echoed in the answer key
 *  for the correct-option letter, so the two visually reference each other. */
function badge(doc, x, y, text, color, size = 15) {
  doc.roundedRect(x, y, size, size, 3).fillColor(color).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(size >= 15 ? 9 : 8)
    .text(text, x, y + (size - 9) / 2 + 1, { width: size, align: 'center' });
}

/**
 * Sets doc.y to at least `before + minHeight` — UNLESS a page break happened
 * during whatever was just drawn, in which case doc.y already reset to the
 * top of the new page and is naturally smaller than `before`. Comparing
 * across that boundary is how the answer key's "Correct as of" line once
 * ended up floating near the bottom of a page with a blank gap above it;
 * every fixed-height element placed after a variable-height text flow in
 * this file goes through this rather than a bare Math.max.
 */
function afterFlow(doc, before, minHeight) {
  if (doc.y >= before) doc.y = Math.max(doc.y, before + minHeight);
}

/** A left-hand colour tick plus a bold label — the recurring sub-section
 *  marker (Static background, Prelims facts, Questions) so those read as
 *  structure rather than as bold text sitting in the middle of a paragraph. */
function subHeader(doc, text, color = ACCENT) {
  ensureRoom(doc, 26);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y + 1)
    .lineTo(doc.page.margins.left, y + 11)
    .lineWidth(2.5).strokeColor(color).stroke();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(text, doc.page.margins.left + 8, y);
  doc.moveDown(0.2);
}

/**
 * @param {object}   day
 * @param {object[]} items
 * @param {Map<number, object[]>} mcqsByItem
 * @param {object}   opts  { draft: boolean }
 * @returns {PDFDocument} a readable stream — pipe it to the response
 */
function renderDigestPdf(day, items, mcqsByItem, { draft = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

  const salvaged = items.filter((i) => Number(i.salvaged) === 1);
  const main = items.filter((i) => Number(i.salvaged) !== 1);
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: main.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length);
  if (salvaged.length) grouped.push({ bucket: 'misc', items: salvaged });

  const totalQuestions = items.reduce((n, i) => n + (mcqsByItem.get(i.id) || []).length, 0);

  // Header. A coloured rule under the eyebrow rather than a plain black block
  // of text at the top — the same weight given to the cover of the standalone
  // "how to read this" guide, so the two feel like one product's output
  // rather than a styled page followed by a plain-text dump.
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT)
    .text('APPSC CURRENT AFFAIRS', { characterSpacing: 0.5 });
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK)
    .text(longDate(day.date));
  if (day.title) {
    doc.moveDown(0.1);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BODY).text(tidy(day.title));
  }
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(
    `The Hindu   ·   ${items.length} item${items.length === 1 ? '' : 's'}   ·   ` +
      `${totalQuestions} question${totalQuestions === 1 ? '' : 's'}`
  );

  if (draft) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c')
      .text('DRAFT — not published. These items have not been reviewed. Do not circulate.');
  }
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.6);

  if (!items.length) {
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(MUTED)
      .text('This digest has no published items.');
    doc.end();
    return doc;
  }

  let itemNumber = 0;
  let questionNumber = 0;
  const key = [];

  for (const group of grouped) {
    ensureRoom(doc, 46);
    const bucketColor = BUCKET_COLORS[group.bucket] || ACCENT;
    const gy = doc.y;
    doc.roundedRect(doc.page.margins.left, gy + 1, 6, 17, 2).fillColor(bucketColor).fill();
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK)
      .text(BUCKET_LABELS[group.bucket], doc.page.margins.left + 15, gy, { continued: true });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`   ${group.items.length} item${group.items.length === 1 ? '' : 's'}`);
    doc.moveDown(0.35);

    for (const item of group.items) {
      itemNumber += 1;
      ensureRoom(doc, 70);

      // A numbered badge against the headline, and the bucket repeated as a
      // coloured pill on the meta row below it — the same colour a student
      // sees on this item in the app, rather than a plain-text label that
      // reads no differently from the sentence next to it.
      const badgeSize = 18;
      const ix = doc.page.margins.left;
      const headX = ix + badgeSize + 8;
      const headWidth = doc.page.width - headX - doc.page.margins.right;
      const iy = doc.y;

      badge(doc, ix, iy, String(itemNumber), bucketColor, badgeSize);
      doc.font('Helvetica-Bold').fontSize(12.5).fillColor(INK)
        .text(tidy(item.headline), headX, iy, { width: headWidth });
      afterFlow(doc, iy, badgeSize);
      doc.moveDown(0.15);

      const py = doc.y;
      const pw = pill(doc, headX, py, BUCKET_LABELS[group.bucket], bucketColor);
      const meta = metaLine(item);
      if (meta) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
          .text(meta, headX + pw + 8, py + 3, { width: headWidth - pw - 8 });
      }
      afterFlow(doc, py, 16);
      doc.moveDown(0.35);

      if (item.units?.length) {
        const units = item.units.map((u) => `${u.unit_code}${u.label ? ` — ${u.label}` : ''}`);
        paragraph(doc, `**Syllabus:** ${units.join(' · ')}`, { size: 9.5, color: MUTED });
      }
      if (Number(item.needs_verify) === 1) {
        paragraph(
          doc,
          `**Verify:** ${tidy(item.verify_note) || 'A figure or name in this item is unconfirmed.'}`,
          { size: 9.5, color: '#b45309' }
        );
      }

      if (item.notes_markdown) markdownBlock(doc, item.notes_markdown, { headingSize: 11, accent: bucketColor });

      if (item.static_linkage || item.static_notes) {
        subHeader(doc, 'Static background', bucketColor);
        if (item.static_linkage) paragraph(doc, `_${tidy(item.static_linkage)}_`, { size: 9.5, color: MUTED });
        if (item.static_notes) markdownBlock(doc, item.static_notes, { headingSize: 10, accent: bucketColor });
      }

      if (item.prelims_facts) {
        subHeader(doc, 'Prelims facts', bucketColor);
        for (const line of factLines(item.prelims_facts)) {
          doc.fontSize(10).fillColor(BODY);
          const bx = doc.page.margins.left + 10;
          doc.text('• ', bx, doc.y, { continued: true });
          doc.font('Helvetica').text(line, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14,
          });
        }
        doc.moveDown(0.3);
      }

      const mcqs = mcqsByItem.get(item.id) || [];
      if (mcqs.length) {
        subHeader(doc, 'Questions', bucketColor);
        for (const mcq of mcqs) {
          questionNumber += 1;
          ensureRoom(doc, 70);
          const label = FORMAT_LABELS[mcq.format] || 'Direct recall';
          doc.font('Helvetica-Bold').fontSize(10).fillColor(BODY)
            .text(`Q${questionNumber}. `, { continued: true });
          doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED).text(`(${label})`);
          doc.moveDown(0.15);
          paragraph(doc, tidy(mcq.question), { size: 10 });
          for (const [letter, val] of [['a', mcq.option_a], ['b', mcq.option_b], ['c', mcq.option_c], ['d', mcq.option_d]]) {
            doc.font('Helvetica').fontSize(10).fillColor(BODY)
              .text(`(${letter}) `, doc.page.margins.left + 10, doc.y, { continued: true });
            doc.text(tidy(val), {
              width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 24,
            });
          }
          doc.moveDown(0.3);
          key.push({ number: questionNumber, mcq, itemNumber, headline: item.headline });
        }
      }

      if (item.source_author) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
          .text(`Source: The Hindu${item.source_genre ? ` (${item.source_genre})` : ''} — ${tidy(item.source_author)}`);
      }
      doc.moveDown(0.4);
      // A visible boundary between one item and the next — moveDown alone
      // left 58 items reading as one continuous flow with no fixed point
      // to tell where one ended and the next began.
      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .lineWidth(0.5).strokeColor(RULE).stroke();
      doc.moveDown(0.4);
    }
  }

  if (key.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Answer key');
    doc.moveDown(0.3);
    sectionRule(doc);
    doc.moveDown(0.3);

    // Grouped by item, with the headline repeated as a running header — "Q71
    // (item 11)" on its own told a student nothing about what item 11 was,
    // a hundred entries deep with no way to scan back to page 3 and check.
    // Answer letters get a filled badge rather than plain "(b)" text, and a
    // rule closes each entry, so a page of a hundred questions reads as a
    // list rather than one continuous run of paragraphs.
    let lastItem = null;
    const badgeSize = 15;
    const textX = doc.page.margins.left + badgeSize + 8;
    const textWidth = doc.page.width - textX - doc.page.margins.right;

    for (const { number, mcq, itemNumber: n, headline } of key) {
      if (n !== lastItem) {
        ensureRoom(doc, 36);
        if (lastItem !== null) doc.moveDown(0.35);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT)
          .text(`${n}. ${tidy(headline)}`);
        doc.moveDown(0.25);
        lastItem = n;
      }

      ensureRoom(doc, 40);
      const y0 = doc.y;
      badge(doc, doc.page.margins.left, y0, mcq.correct_option.toUpperCase(), ACCENT, badgeSize);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BODY)
        .text(`Q${number}`, textX, y0, { continued: true, width: textWidth });
      if (mcq.explanation) {
        doc.font('Helvetica').fillColor(BODY).text(`  ${tidy(mcq.explanation)}`, { continued: false });
      } else {
        doc.text('', { continued: false });
      }

      // See afterFlow's own comment: a long explanation can wrap onto a new
      // page, where doc.y resets near the top and is naturally smaller than
      // y0 — that boundary is exactly what once put "Correct as of" near the
      // bottom of the new page with a blank gap above it.
      afterFlow(doc, y0, badgeSize);
      if (mcq.fact_as_of) {
        doc.x = textX;
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text(`Correct as of ${mcq.fact_as_of}.`, textX, doc.y, { width: textWidth });
      }
      doc.moveDown(0.2);
      doc.moveTo(textX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .lineWidth(0.4).strokeColor(RULE).stroke();
      doc.moveDown(0.25);
    }
  }

  ensureRoom(doc, 40);
  doc.moveDown(0.3);
  sectionRule(doc);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(
    'Generated by APPSC Current Affairs from The Hindu. Current-affairs facts are correct as at the ' +
      'dates shown and are superseded by later events.'
  );

  numberPages(doc, day);
  doc.end();
  return doc;
}

/**
 * A footer on every page — date and "Page N of M" — added last, after every
 * page already exists, using pdfkit's buffered-page mode: switch to each
 * page in turn and draw into its bottom margin, which an explicit-position
 * call can do regardless of where the page's own text cursor stopped.
 *
 * A document this long (a heavy day is 150+ pages) with no page numbers at
 * all was the single thing that made it feel like an undifferentiated dump
 * rather than a document — nothing to cite, nothing to find your way back to.
 */
function numberPages(doc, day) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    // The footer sits BELOW margins.bottom, in the margin itself — and
    // pdfkit's own overflow check for .text() compares the y it's given
    // against that same margins.bottom, whatever the actual page content
    // does. On a page already full to the bottom, that silently added a
    // brand new page to hold "the overflowing" footer, which then needed
    // its own footer, on every page whose content ran close to the edge —
    // doubling the page count with blanks and leaving the footers on those
    // pages numbered for a total that no longer matched. Zeroing the bottom
    // margin for just this one draw call is the standard way to tell pdfkit
    // "this is deliberately in the margin, don't paginate for it."
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `${longDate(day.date)}   ·   Page ${i + 1} of ${range.count}`,
      doc.page.margins.left,
      doc.page.height - savedBottom + 16,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
    );
    doc.page.margins.bottom = savedBottom;
  }
}

/** `appsc-current-affairs-2026-08-21.pdf` — sorts by date in any file list. */
function digestPdfFilename(date) {
  return `appsc-current-affairs-${date}.pdf`;
}

module.exports = { renderDigestPdf, digestPdfFilename };
