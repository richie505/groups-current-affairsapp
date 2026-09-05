'use strict';

// THE DOCUMENT THAT LEAVES THE BUILDING.
//
// Not an export of the app — a revision publication. It is sent to students on
// whatever they already use, opened on a phone with no account and no login,
// and read the way a printed compendium is read: front to back once, then
// looked up by section three weeks later.
//
// The shape is deliberately the one this exam's candidates already recognise
// from published compendia — a cover, a numbered index, five themed sections,
// and for each topic a paper mapping, WHY IN NEWS, the detail, the static
// background it sits on, and the facts worth memorising. It is not a new
// layout invented here; matching what candidates already know how to read is
// most of what makes a revision document usable.
//
// WHY IT IS FILED BY THEME AND NOT BY BUCKET
//
// See lib/sections.js. Briefly: bucket answers "where did this happen", which
// is right for a daily reading order, and section answers "what is this about",
// which is the only one that survives being looked up later.
//
// The drawing primitives come from lib/digestPdf.js rather than being copied —
// same sanitiser, same markdown subset, same table renderer, same page-break
// arithmetic. See the note on its `primitives` export.

const PDFDocument = require('pdfkit');
const { primitives: P } = require('./digestPdf');
const { groupIntoSections, papersFor } = require('./sections');

const {
  tidy,
  factLines,
  inlineSegments,
  fontFor,
  paragraph,
  markdownBlock,
  ensureRoom,
  afterFlow,
  longDate,
} = P;

// A palette of its own, one step warmer and more restrained than the app's.
// The app is a screen a person scans; this is a document a person reads for
// twenty minutes, and the blue that carries a UI is tiring in body copy.
const INK = '#111827';
const BODY = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#9a3412'; // a deep ochre, the colour of the AP block in the app
const ACCENT_SOFT = '#fdf6ec';
const RULE = '#d6d3d1';
const SECTION_TINT = '#f5f3f0';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// TWO COLUMNS
// ---------------------------------------------------------------------------
//
// A revision compendium is set in two columns for the same reason a newspaper
// is: at a full A4 measure, body text runs to about 110 characters a line and
// the eye loses its place returning to the left margin. Two columns bring it
// to roughly 55 — near the 45-75 a reader actually holds — and cut the page
// count by about a third, which matters for a file sent over mobile data.
//
// HOW IT IS DONE, AND WHY IT IS DONE THIS WAY
//
// pdfkit has no column model. What it does have is page margins that every
// width calculation reads from, and this file's drawing primitives are shared
// with digestPdf.js, so they all measure against `doc.page.margins`. So a
// column IS a margin setting: narrow the margins to the column's bounds and
// every primitive — tables, bullets, callout boxes, wrapped headlines —
// follows without knowing columns exist.
//
// The break is taken at BLOCK boundaries by `need()` below rather than inside
// a text flow, because pdfkit's own overflow handling adds a page and cannot
// be redirected into the next column. A block taller than a whole column (a
// long static-notes table) still overflows onto a new page, and the
// `pageAdded` hook re-applies column geometry there, so the worst case is a
// table that continues at the top of the next page rather than a broken layout.

const COLUMN_GAP = 20;

// The page margin, held here rather than read back from the document.
//
// pdfkit stores a single `margin: 52` as options.margin and only populates
// options.margins when an OBJECT was passed — so reading doc.options.margins
// returned undefined and every column calculation threw on the first index
// page. Keeping the number is both simpler and immune to which of the two
// shapes the document happened to be constructed with.
const MARGIN = 52;

function columnState(doc) {
  if (!doc._compendium) {
    doc._compendium = { columns: 1, index: 0, top: doc.page.margins.top, maxY: 0 };
  }
  return doc._compendium;
}

/** The horizontal bounds of column `i`, measured from the page rather than
 *  from the current (possibly already narrowed) margins. */
function columnBounds(doc, i, columns) {
  const usable = doc.page.width - MARGIN * 2;
  const colW = (usable - COLUMN_GAP * (columns - 1)) / columns;
  const left = MARGIN + i * (colW + COLUMN_GAP);
  return { left, width: colW, right: left + colW };
}

function applyColumn(doc) {
  const st = columnState(doc);
  const { left, right } = columnBounds(doc, st.index, st.columns);
  doc.page.margins.left = left;
  doc.page.margins.right = doc.page.width - right;
  doc.x = left;
}

/** Switch the document into `n`-column flow, starting at the top of column 0. */
function beginColumns(doc, n) {
  const st = columnState(doc);
  st.columns = n;
  st.index = 0;
  st.top = doc.y;
  st.maxY = doc.y;
  applyColumn(doc);
}

/**
 * Back to the full measure — for a cover, or a section banner that should span
 * both columns.
 *
 * THE CURSOR MOVES BELOW *EVERY* COLUMN, NOT JUST THE CURRENT ONE.
 *
 * This was the worst bug in the document, and it looked like a rendering
 * failure rather than a layout one. Leaving column flow restored the margins
 * and left `doc.y` wherever the LAST column happened to stop — so a section
 * that ended a third of the way down the right-hand column set the cursor
 * high, and the full-width banner for the next section was then drawn straight
 * over the bottom two-thirds of the left-hand column. On a real edition that
 * printed a section heading, a topic number, a paper mapping and a whole WHY
 * IN NEWS block on top of the previous section's last questions and their
 * options, all legible, all unreadable.
 *
 * `maxY` is the deepest point any column reached on this page, recorded as
 * each column is left. Coming out of column flow the cursor goes there, so
 * whatever is drawn next starts below all of it.
 */
function endColumns(doc) {
  const st = columnState(doc);
  if (st.columns > 1) doc.y = Math.max(doc.y, st.maxY);
  st.columns = 1;
  st.index = 0;
  st.maxY = 0;
  doc.page.margins.left = MARGIN;
  doc.page.margins.right = MARGIN;
  doc.x = MARGIN;
}

function bottomOf(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

/** Move to the next column, or to the next page when the last one is full. */
function nextColumn(doc) {
  const st = columnState(doc);
  // Record how deep this column got before leaving it — endColumns() needs
  // the deepest of all of them, not the last one's.
  st.maxY = Math.max(st.maxY, doc.y);
  if (st.index < st.columns - 1) {
    st.index += 1;
    applyColumn(doc);
    doc.y = st.top;
  } else {
    doc.addPage(); // the pageAdded hook resets to column 0
  }
}

/** The column-aware replacement for ensureRoom: if `h` will not fit in what is
 *  left of this column, start the next one. */
function need(doc, h) {
  const st = columnState(doc);
  if (st.columns === 1) return ensureRoom(doc, h);
  if (doc.y + h > bottomOf(doc)) nextColumn(doc);
  return undefined;
}

function monthName(iso) {
  const m = Number(String(iso).slice(5, 7));
  return MONTHS[m - 1] || '';
}

// ---------------------------------------------------------------------------
// cover
// ---------------------------------------------------------------------------

function cover(doc, { title, subtitle, topics, questions, minutes, sections, publication, draft }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  doc.y = 96;

  // A rule ABOVE the title rather than under it. The eye lands on the title
  // first either way, and a line above closes the top of the page — a cover
  // whose first ink is 96pt down reads as a page that failed to load.
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(2.5).strokeColor(ACCENT).stroke();
  doc.moveDown(1.1);

  doc.font('Helvetica-Bold').fontSize(27).fillColor(INK)
    .text(title.toUpperCase(), { characterSpacing: 0.6, lineGap: 3 });

  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(15).fillColor(ACCENT).text(subtitle);

  doc.moveDown(0.9);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.moveDown(0.9);

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BODY)
    .text('APPSC Group-I Prelims   |   APPSC Group-II Screening   |   APPSC Group-II Mains');

  doc.moveDown(0.8);

  const rows = [
    ['Compiled topics', `${topics} high-yield current affairs`],
    ['Practice questions', `${questions}, with an answer key and explanations`],
    ['Sections', sections.map((s) => `${s.title} (${s.items.length})`).join(' · ')],
    ['Format', 'Why in News + Detailed Notes + Static Integration + Paper Mapping'],
    ['Reading time', `About ${minutes} minutes`],
    ['Source', publication],
  ];

  // BOTH COLUMNS ARE MEASURED, and the row is as tall as the taller of them.
  //
  // Advancing by a fixed 12pt assumed every label and every value fitted on one
  // line. "PRACTICE QUESTIONS" wraps to two and so does a three-section list,
  // so each wrap pushed the value column one row further out of step with its
  // label — the cover came out reading "READING TIME: The Hindu" and
  // "SOURCE:" with nothing beside it. A cover is the one page where a reader
  // decides whether the document was made carefully.
  const labelW = 112;
  const valueX = left + labelW + 12;
  const valueW = width - labelW - 12;
  for (const [label, value] of rows) {
    const text = label.toUpperCase();
    doc.font('Helvetica-Bold').fontSize(9);
    const labelH = doc.heightOfString(text, { width: labelW, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10);
    const valueH = doc.heightOfString(value, { width: valueW });
    const rowH = Math.max(labelH, valueH);

    ensureRoom(doc, rowH + 8);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
      .text(text, left, y, { width: labelW, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10).fillColor(BODY)
      .text(value, valueX, y, { width: valueW });
    doc.y = y + rowH;
    doc.moveDown(0.4);
  }

  if (draft) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#b91c1c').text(
      'DRAFT — these topics have not been reviewed. Do not circulate this file.',
      left,
      doc.y,
      { width }
    );
  }

  // Pinned to the foot of the page rather than following the flow: the
  // provenance line belongs at the bottom whatever the section list above did
  // to the layout.
  const footY = doc.page.height - doc.page.margins.bottom - 40;
  doc.moveTo(left, footY).lineTo(right, footY).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(
    'A comprehensive revision resource. Current-affairs facts are correct as at the dates shown ' +
      'and are superseded by later events.',
    left,
    footY + 10,
    { width }
  );

  doc.addPage();
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

// THE NUMBERED INDEX, and why it carries no page numbers.
//
// Page numbers would need a second pass — render once to find where things
// landed, then render again — and pdfkit's buffered-page mode makes that
// possible but doubles the work for a document that is read on a phone, where
// nobody types a page number. What a reader actually uses is the TOPIC number:
// the index says 14, the topic is headed 14, and the answer key cites 14.
// The order the papers are listed in, where a paper has to be named — the
// order a candidate sits them, not alphabetical.
const PAPER_ORDER = [
  'Group-II Screening',
  'Group-II Paper I — History & Polity',
  'Group-II Paper I — Polity & Governance',
  'Group-II Paper II — Economy',
  'Group-II Paper II — Science, Environment & Health',
  'Group-I Prelims — Polity & Governance',
  'Group-I Prelims — Economy & Development',
  'Group-I Prelims — History & Culture',
  'Group-I Prelims — Geography',
  'Group-I Prelims — Science & Technology',
  'Group-I Prelims — Current Affairs',
];

/**
 * THE INDEX / TABLE OF CONTENTS.
 *
 * Structured the way a compendium's contents page is structured, because that
 * is the shape a candidate can already use: the five sections in order, each
 * with its topic count, and ONE continuous run of topic numbers through the
 * whole document. The number in the index is the number on the topic and the
 * number the answer key cites — one sequence, three places, no translation.
 *
 * WHAT REPLACED WHAT, AND WHY
 *
 * The first version of this listed every topic once under each syllabus paper
 * it fed. That is a genuinely useful view and it is a bad table of contents:
 * a topic mapped to three papers appeared three times, the numbers jumped
 * about, and the counts beside each heading added up to far more than the
 * document held — so the one job a contents page has, telling you how much
 * there is and in what order, was the job it could not do.
 *
 * The syllabus did not go with it. Each entry carries its paper mapping on a
 * second line, so the division by syllabus is visible against every topic
 * without the structure being built on it.
 */
function index(doc, sections, numbered) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK)
    .text('INDEX / TABLE OF CONTENTS', { characterSpacing: 1 });
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.7);

  const numberOf = new Map(numbered.map((e) => [e.item.id, e.n]));

  beginColumns(doc, 2);

  for (const section of sections) {
    const count = section.items.length;
    need(doc, 52);
    doc.moveDown(0.25);
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT).text(
      `SECTION ${section.numeral} — ${section.title.toUpperCase()}`,
      doc.page.margins.left,
      doc.y,
      { width: w, characterSpacing: 0.4 }
    );
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `${count} ${count === 1 ? 'Topic' : 'Topics'}`,
      doc.page.margins.left,
      doc.y + 1,
      { width: w }
    );
    doc.moveDown(0.35);

    for (const item of section.items) {
      // The entry and its paper line are reserved together: a topic whose
      // syllabus mapping ended up at the top of the next column reads as a
      // mapping for the topic above it.
      need(doc, 26);
      const l = doc.page.margins.left;
      const textX = l + 20;
      const textW = doc.page.width - doc.page.margins.right - textX;
      const y = doc.y;

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
        .text(`${numberOf.get(item.id)}.`, l, y, { width: 16, align: 'right' });
      doc.font('Helvetica').fontSize(8.5).fillColor(BODY)
        .text(tidy(item.headline), textX, y, { width: textW });
      afterFlow(doc, y, 10);

      const papers = papersFor(item);
      if (papers.length) {
        doc.font('Helvetica').fontSize(6.5).fillColor(ACCENT)
          .text(papers.slice(0, 2).join('  ·  ').toUpperCase(), textX, doc.y + 0.5, {
            width: textW,
            characterSpacing: 0.3,
          });
      }
      doc.moveDown(0.3);
    }
    doc.moveDown(0.3);
  }

  endColumns(doc);
  doc.addPage();
}

// ---------------------------------------------------------------------------
// one topic
// ---------------------------------------------------------------------------

/** The uppercase block label the reference format uses throughout — a short
 *  rule, then the label. Structure the eye can find when skimming, without
 *  another size in the type scale. */
function blockLabel(doc, text) {
  need(doc, 24);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y + 2)
    .lineTo(doc.page.margins.left + 14, y + 2)
    .lineWidth(2).strokeColor(ACCENT).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
    .text(text.toUpperCase(), doc.page.margins.left + 20, y - 2.5, { characterSpacing: 0.9 });
  doc.moveDown(0.35);
}

/**
 * Splits the item's note into the opening paragraph and everything after it.
 *
 * The drafting prompt writes the note as "what happened" followed by the
 * detail, which is exactly the WHY IN NEWS / detail split this format wants —
 * so the split is taken from the text rather than asking the model for a
 * second field it would have to invent. The first block is the first PARAGRAPH
 * and not the first sentence: a lead sentence cut off from the one that
 * qualifies it routinely changes what it says.
 *
 * A note that opens with a table (a few do) yields no lead — everything goes
 * to the detail block, which is better than promoting a table row into a
 * position labelled WHY IN NEWS.
 */
function splitNote(markdown) {
  const text = tidy(markdown || '');
  if (!text) return { lead: '', rest: '' };
  const lines = text.split('\n');
  if (!lines[0] || lines[0].trim().startsWith('|') || lines[0].trim().startsWith('#')) {
    return { lead: '', rest: text };
  }
  let i = 0;
  const lead = [];
  while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('|')) {
    lead.push(lines[i].trim());
    i += 1;
  }
  return { lead: lead.join(' '), rest: lines.slice(i).join('\n').trim() };
}

function renderTopic(doc, item, n, mcqs, { withStatic }) {
  // GEOMETRY IS RE-READ AFTER EVERY need(), NEVER CARRIED ACROSS ONE.
  //
  // need() can move the cursor into the next column, and an x captured before
  // it still belongs to the column the block just left. Drawing at that x with
  // the new column's y is how two answer-key entries came out printed on top
  // of each other, character for character — and the same trap sits under the
  // paper box, the prelims bullets and every option of every question here.
  //
  // `let` plus refresh() rather than `const`, so the values cannot go stale
  // silently: every break is followed by the line that re-reads them.
  let left = doc.page.margins.left;
  let right = doc.page.width - doc.page.margins.right;
  let width = right - left;
  const refresh = () => {
    left = doc.page.margins.left;
    right = doc.page.width - doc.page.margins.right;
    width = right - left;
  };

  // The number and the headline, kept together. 90pt is a headline, its paper
  // line and the first label — less than that and a topic starts at the foot
  // of a page with its title orphaned from its content.
  need(doc, 96);
  refresh();

  const numW = 26;
  const y0 = doc.y;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT)
    .text(String(n).padStart(2, '0'), left, y0 - 1, { width: numW });
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK)
    .text(tidy(item.headline), left + numW, y0, { width: width - numW, lineGap: 0.5 });
  afterFlow(doc, y0, 18);
  doc.moveDown(0.25);

  // THE PAPER MAPPING. The single line that turns a news item into revision
  // material: it says which paper this is worth marks in, which is the
  // question a candidate is actually asking while deciding whether to read it.
  // Three at most. A well-tagged item reaches five or six papers and the line
  // is one row deep, so the rest were being cut mid-word by the ellipsis —
  // and a candidate reads the first paper named as "this is what it is for".
  // Beyond the third, the line stops being a mapping and becomes a list.
  const papers = papersFor(item).slice(0, 3);
  if (papers.length) {
    // The box GROWS to hold the line rather than clipping it.
    //
    // Fixed at one row, three full paper names ran past the right margin and
    // came back ellipsised — "GROUP-I PRELIMS — GEOGRAPHY · GROUP-I PRELIMS —
    // SCIENCE & TECHNOLOGY · GROUP-II…" — which cuts off exactly the third
    // mapping a well-tagged item earned. Measuring first costs one call and
    // the box is two rows deep on the items that need it.
    const text = papers.join('   ·   ').toUpperCase();
    const inset = 10;
    const textW = width - inset - 8;
    doc.font('Helvetica-Bold').fontSize(7);
    const h = Math.max(14, doc.heightOfString(text, { width: textW, characterSpacing: 0.4 }) + 7);

    need(doc, h + 10);
    refresh();
    const py = doc.y;
    doc.rect(left, py, width, h).fillColor(ACCENT_SOFT).fill();
    doc.rect(left, py, 3, h).fillColor(ACCENT).fill();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(ACCENT)
      .text(text, left + inset, py + 3.5, { width: textW, characterSpacing: 0.4 });
    doc.y = py + h;
    doc.moveDown(0.5);
  }

  const { lead, rest } = splitNote(item.notes_markdown);

  if (lead) {
    blockLabel(doc, 'Why in news');
    paragraph(doc, lead, { size: 9, color: BODY });
  }
  if (rest) {
    if (lead) blockLabel(doc, 'Key details');
    markdownBlock(doc, rest, { headingSize: 9.5, accent: RULE });
  }

  // STATIC LINKAGE — the standing material the news sits on top of.
  //
  // The reference format names the topic in the heading itself ("STATIC
  // LINKAGE — STATE COMMISSIONS FOR SC & ST"), which is what makes it findable
  // three weeks later. `static_linkage` is a sentence rather than a title, so
  // the heading takes the sentence and the body follows underneath.
  if (item.static_linkage || (withStatic && item.static_notes)) {
    blockLabel(doc, 'Static linkage');
    if (item.static_linkage) {
      paragraph(doc, `_${tidy(item.static_linkage)}_`, { size: 8.5, color: MUTED });
    }
    if (withStatic && item.static_notes) {
      markdownBlock(doc, item.static_notes, { headingSize: 9, accent: RULE });
    }
  }

  if (item.prelims_facts) {
    blockLabel(doc, 'Prelims facts');
    for (const line of factLines(item.prelims_facts)) {
      need(doc, 15);
      refresh();
      doc.fontSize(9).fillColor(BODY);
      doc.text('•  ', left + 6, doc.y, { continued: true });
      const segs = inlineSegments(line);
      segs.forEach((seg, k) => {
        doc.font(fontFor(seg)).text(seg.text, {
          continued: k < segs.length - 1,
          width: width - 18,
        });
      });
    }
    doc.moveDown(0.35);
  }

  if (mcqs.length) {
    blockLabel(doc, 'Practice questions');
    for (const mcq of mcqs) {
      // The stem plus four options, measured. A four-option question in a
      // narrow column is 90-140pt, not the 72 a fixed reservation assumed, so
      // the stem could sit at the foot of a column with its options in the
      // next one — which is a question a reader cannot answer.
      doc.font('Helvetica').fontSize(9);
      let qh = doc.heightOfString(tidy(mcq.question), { width }) + 6;
      doc.fontSize(8.5);
      for (const val of [mcq.option_a, mcq.option_b, mcq.option_c, mcq.option_d]) {
        qh += doc.heightOfString(tidy(val || ''), { width: width - 24 }) + 2;
      }
      need(doc, Math.min(qh + 10, 420));
      refresh();

      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
        .text(`Q${mcq._number}. `, left, doc.y, { continued: true });
      doc.font('Helvetica').fontSize(9).fillColor(BODY);
      const segs = inlineSegments(tidy(mcq.question));
      segs.forEach((seg, k) => {
        doc.font(fontFor(seg)).text(seg.text, { continued: k < segs.length - 1, width });
      });
      doc.moveDown(0.2);
      for (const [letter, val] of [
        ['a', mcq.option_a], ['b', mcq.option_b], ['c', mcq.option_c], ['d', mcq.option_d],
      ]) {
        need(doc, 13);
        refresh();
        doc.font('Helvetica').fontSize(8.5).fillColor(BODY)
          .text(`(${letter})  `, left + 8, doc.y, { continued: true });
        doc.text(tidy(val), { width: width - 24 });
      }
      doc.moveDown(0.35);
    }
  }

  doc.moveDown(0.2);
  refresh();
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.moveDown(0.8);
}

// ---------------------------------------------------------------------------
// answer key
// ---------------------------------------------------------------------------

// AT THE BACK, WHICH IS THE WHOLE REASON THE QUESTIONS ARE WORTH INCLUDING.
//
// An answer printed beside its question is not a question. The key repeats the
// topic number and headline it belongs to, because "Q37: (b)" a dozen pages
// later is unusable on its own.
function answerKey(doc, key) {
  endColumns(doc);
  doc.addPage();
  endColumns(doc);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK)
    .text('ANSWER KEY', { characterSpacing: 1.2 });
  doc.moveDown(0.35);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.8);

  beginColumns(doc, 2);

  let lastTopic = null;
  for (const entry of key) {
    if (entry.topicNumber !== lastTopic) {
      need(doc, 40);
      if (lastTopic !== null) doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
        .text(`${String(entry.topicNumber).padStart(2, '0')}.  ${tidy(entry.headline)}`, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        });
      doc.moveDown(0.3);
      lastTopic = entry.topicNumber;
    }

    // MEASURED, NOT ASSUMED.
    //
    // A flat 34pt reservation is the height of the badge, and an explanation
    // in a narrow column routinely runs to eighty. So the entry started
    // drawing near the foot of a column, pdfkit paginated inside the text, and
    // the answer badge was left behind on the previous page above an
    // explanation that belonged to a different question. Two lines of the
    // answer key came out reading "Q47 · B  the examination."
    //
    // Reserving what it will actually take keeps the pair together, which is
    // the only thing this block has to get right.
    // THE HEIGHT IS MEASURED AND THE CURSOR IS SET, NOT INFERRED.
    //
    // The obvious version — draw the badge, draw the explanation beside it,
    // let pdfkit's cursor land where it lands — does not survive a two-column
    // measure. An explanation is drawn as a run of inline segments so that
    // **bold** still bolds, and after a segmented run the cursor is where the
    // last segment finished rather than below the wrapped block. In a narrow
    // column that produced the answer key's worst possible failure: the
    // badges marched down the page 14pt apart while the explanations flowed
    // independently past them, so "Q47 - B" sat beside the tail of a different
    // question's explanation. An answer key that pairs answers with the wrong
    // questions is worse than no answer key.
    //
    // So the block is measured first, drawn, and the cursor is then placed at
    // a y this code chose rather than one pdfkit arrived at.
    // MEASURE, THEN BREAK, THEN READ THE GEOMETRY. In that order.
    //
    // Reading `doc.page.margins.left` before calling need() is the whole bug:
    // need() can move the cursor into the NEXT column, and the x captured a
    // moment earlier still belongs to the previous one. The badge was then
    // drawn at column 0's x and column 1's y, on top of whatever was already
    // there — two answers printed character-over-character.
    //
    // The measurement can safely happen first because both columns are the
    // same width; only their left edge differs.
    const badgeW = 38;
    const textW = doc.page.width - doc.page.margins.right - doc.page.margins.left - badgeW - 8;

    const explanation = entry.mcq.explanation
      ? tidy(entry.mcq.explanation)
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/_(.+?)_/g, '$1')
      : '';
    doc.font('Helvetica').fontSize(8.5);
    const bodyH = explanation ? doc.heightOfString(explanation, { width: textW }) : 0;
    const asOfH = entry.mcq.fact_as_of ? 11 : 0;
    const blockH = Math.max(16, bodyH + asOfH);

    need(doc, blockH + 6);

    const left = doc.page.margins.left;
    const textX = left + badgeW + 8;
    const y0 = doc.y;

    doc.roundedRect(left, y0, badgeW, 14, 3).fillColor(ACCENT).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
      .text(`Q${entry.number} · ${entry.mcq.correct_option.toUpperCase()}`, left, y0 + 4, {
        width: badgeW,
        align: 'center',
      });

    if (explanation) {
      // ONE text call, with explicit coordinates.
      //
      // The segmented version — draw each **bold** run with `continued` so the
      // emphasis survives — cannot be positioned deterministically. pdfkit
      // chains a continued run from wherever the previous one ended, and after
      // the first entry that wrapped, every later entry's explanation was
      // drawn from a cursor this code had not set: two answers printed on top
      // of each other, character for character.
      //
      // Bold inside an answer explanation is worth less than the explanation
      // being under its own question, so the markup is stripped and the block
      // is drawn once, at a y this code chose.
      doc.font('Helvetica').fontSize(8.5).fillColor(BODY)
        .text(explanation, textX, y0, { width: textW });
    }

    doc.y = y0 + bodyH;
    if (entry.mcq.fact_as_of) {
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
        .text(`Correct as of ${entry.mcq.fact_as_of}.`, textX, doc.y, { width: textW });
    }
    doc.y = y0 + blockH;
    doc.moveDown(0.35);
  }
  // Back to the full measure before the document ends, so numberPages() draws
  // each footer across the page rather than inside the last column.
  endColumns(doc);
}

// ---------------------------------------------------------------------------
// pagination
// ---------------------------------------------------------------------------

function numberPages(doc, footerText) {
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    // The cover is skipped: a page number under a title page reads as an
    // internal report rather than as something a person was handed.
    doc.switchToPage(i);
    // Zeroing the bottom margin for this one draw call is what stops pdfkit
    // paginating FOR the footer on a page whose content already reaches the
    // margin — see the same note in digestPdf.js, where it doubled the page
    // count with blanks.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // The DOCUMENT's margins, not this page's. Column flow rewrites
    // page.margins.left/right as it goes, and switchToPage() hands back
    // whatever those were left at — so a footer measured from them lands
    // inside one column, centred on the wrong half of the page.
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `${footerText}          ${i + 1} / ${range.count}`,
      MARGIN,
      doc.page.height - savedBottom + 16,
      { width: doc.page.width - MARGIN * 2, align: 'center' }
    );
    doc.page.margins.bottom = savedBottom;
  }
}

// ---------------------------------------------------------------------------

/**
 * @param {object[]} items      the topics, already selected and ordered
 * @param {Map<number, object[]>} mcqsByItem
 * @param {object} opts
 * @returns {PDFDocument} a readable stream — pipe it to the response
 */
function renderCompendiumPdf(
  items,
  mcqsByItem,
  {
    title = 'Andhra Pradesh Current Affairs',
    subtitle,
    date,
    draft = false,
    publication = 'The Hindu',
    minutes = 0,
    staticForAll = false,
  } = {}
) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const sections = groupIntoSections(items);
  const totalQuestions = items.reduce((n, i) => n + (mcqsByItem.get(i.id) || []).length, 0);

  cover(doc, {
    title,
    subtitle: subtitle || `Daily Compendium — ${longDate(date)}`,
    topics: items.length,
    questions: totalQuestions,
    minutes,
    sections,
    publication,
    draft,
  });

  if (!items.length) {
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(MUTED)
      .text('This compendium has no topics.');
    doc.end();
    return doc;
  }

  // Number every topic BEFORE the index is drawn, because the index refers to
  // those numbers and the body assigns them. Two passes over the same order
  // rather than one pass that guesses.
  const numbered = [];
  {
    let i = 0;
    for (const section of sections) {
      for (const item of section.items) {
        i += 1;
        numbered.push({ n: i, item, section });
      }
    }
  }

  // Registered BEFORE the index, which is itself two-column: an index long
  // enough to need a second page would otherwise add one with no hook attached
  // and carry on writing into a column that no longer exists.
  //
  // A new page inside the two-column flow starts at the top of column 0. This
  // is what makes an automatic pdfkit page break — one taken inside a block
  // too tall for a column — land somewhere sane instead of at the full page
  // width with the previous column's margins still applied.
  doc.on('pageAdded', () => {
    const st = columnState(doc);
    if (st.columns > 1) {
      st.index = 0;
      st.top = doc.page.margins.top;
      // A new page is a clean sheet: nothing has been drawn on it yet, so the
      // deepest point resets with it. Carrying the previous page's maxY over
      // would push the next section banner most of a page down for no reason.
      st.maxY = doc.page.margins.top;
      applyColumn(doc);
      doc.y = doc.page.margins.top;
    }
  });

  index(doc, sections, numbered);

  let n = 0;
  let q = 0;
  const key = [];

  for (const section of sections) {
    // The section banner spans the full measure. A heading confined to one
    // column reads as a heading for that column rather than for the section,
    // which is the one thing a banner has to communicate.
    endColumns(doc);
    ensureRoom(doc, 76);
    const y = doc.y;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.rect(left, y, width, 26).fillColor(SECTION_TINT).fill();
    doc.rect(left, y, 4, 26).fillColor(ACCENT).fill();
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK)
      .text(`SECTION ${section.numeral} — ${section.title.toUpperCase()}`, left + 12, y + 8, {
        width: width - 20,
        characterSpacing: 0.6,
      });
    doc.y = y + 26;
    doc.moveDown(0.7);
    beginColumns(doc, 2);

    for (const item of section.items) {
      n += 1;
      const mcqs = (mcqsByItem.get(item.id) || []).map((m) => {
        q += 1;
        return { ...m, _number: q };
      });
      for (const m of mcqs) {
        key.push({ number: m._number, mcq: m, topicNumber: n, headline: item.headline });
      }
      renderTopic(doc, item, n, mcqs, {
        withStatic: staticForAll || Number(item.importance) === 1,
      });
    }
  }

  if (key.length) answerKey(doc, key);

  numberPages(doc, `APPSC Current Affairs · ${longDate(date)}`);
  doc.end();
  return doc;
}

/** `APPSC-Current-Affairs-2026-08-23.pdf` — hyphens rather than spaces,
 *  because some messaging clients break a filename at a space. */
function compendiumFilename(date) {
  return `APPSC-Current-Affairs-${date}.pdf`;
}

/** `APPSC-Current-Affairs-August-2026.pdf` for the monthly edition. */
function monthlyFilename(month) {
  return `APPSC-Current-Affairs-${monthName(`${month}-01`)}-${month.slice(0, 4)}.pdf`;
}

module.exports = { renderCompendiumPdf, compendiumFilename, monthlyFilename, monthName };

// THE COLUMN HELPERS, EXPOSED FOR ONE TEST AND NOTHING ELSE.
//
// The overlap bug this guards against is invisible to every cheap check made
// from the outside: the text is all present, in reading order, with a complete
// question sequence — it is simply drawn on top of other text. Verified by
// re-breaking the renderer on purpose and watching the structural check pass.
//
// So the invariant is asserted where it lives instead: leaving column flow
// must put the cursor below the DEEPEST column, not the current one. Driving
// these four functions over a stub is enough to catch the line going missing
// again, which is exactly how it went missing the first time.
module.exports.__columns = { beginColumns, endColumns, nextColumn, need, columnState };
