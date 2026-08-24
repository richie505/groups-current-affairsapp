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
function markdownBlock(doc, markdown, { headingSize = 11 } = {}) {
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
      doc.font('Helvetica-Bold').fontSize(size).fillColor(INK)
        .text(headingMatch[2], { continued: false });
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
  const bits = [BUCKET_LABELS[item.bucket] || item.bucket];
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

  // Header
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK)
    .text(`Current Affairs — ${longDate(day.date)}`);
  if (day.title) {
    doc.moveDown(0.15);
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
  doc.moveDown(0.6);
  sectionRule(doc);

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
    ensureRoom(doc, 40);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(ACCENT).text(BUCKET_LABELS[group.bucket]);
    doc.moveDown(0.3);

    for (const item of group.items) {
      itemNumber += 1;
      ensureRoom(doc, 60);

      doc.font('Helvetica-Bold').fontSize(12.5).fillColor(INK)
        .text(`${itemNumber}. ${tidy(item.headline)}`);
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(metaLine(item));
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

      if (item.notes_markdown) markdownBlock(doc, item.notes_markdown, { headingSize: 11 });

      if (item.static_linkage || item.static_notes) {
        ensureRoom(doc, 30);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Static background');
        doc.moveDown(0.2);
        if (item.static_linkage) paragraph(doc, `_${tidy(item.static_linkage)}_`, { size: 9.5, color: MUTED });
        if (item.static_notes) markdownBlock(doc, item.static_notes, { headingSize: 10 });
      }

      if (item.prelims_facts) {
        ensureRoom(doc, 30);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Prelims facts');
        doc.moveDown(0.2);
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
        ensureRoom(doc, 30);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Questions');
        doc.moveDown(0.2);
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
          key.push({ number: questionNumber, mcq, itemNumber });
        }
      }

      if (item.source_author) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
          .text(`Source: The Hindu${item.source_genre ? ` (${item.source_genre})` : ''} — ${tidy(item.source_author)}`);
      }
      doc.moveDown(0.5);
    }
  }

  if (key.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Answer key');
    doc.moveDown(0.3);
    sectionRule(doc);

    for (const { number, mcq, itemNumber: n } of key) {
      ensureRoom(doc, 40);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BODY)
        .text(`Q${number} — (${mcq.correct_option})`, { continued: true });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`   (item ${n})`);
      if (mcq.explanation) {
        doc.moveDown(0.1);
        paragraph(doc, tidy(mcq.explanation), { size: 9.5, color: BODY });
      }
      if (mcq.fact_as_of) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text(`Correct as of ${mcq.fact_as_of}.`);
      }
      doc.moveDown(0.35);
    }
  }

  ensureRoom(doc, 40);
  doc.moveDown(0.3);
  sectionRule(doc);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(
    'Generated by APPSC Current Affairs from The Hindu. Current-affairs facts are correct as at the ' +
      'dates shown and are superseded by later events.'
  );

  doc.end();
  return doc;
}

/** `appsc-current-affairs-2026-08-21.pdf` — sorts by date in any file list. */
function digestPdfFilename(date) {
  return `appsc-current-affairs-${date}.pdf`;
}

module.exports = { renderDigestPdf, digestPdfFilename };
