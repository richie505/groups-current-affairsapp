'use strict';

// Layout IR -> articles.
//
// THE ONE IDEA IN THIS FILE
//
// A newspaper page is not a document; it is a set of columns with headlines
// stamped across them. So the question for every body block is only ever
// "which headline owns this column, here?" and the answer is:
//
//     the nearest headline ABOVE the block whose horizontal span
//     COVERS the block's centre
//
// That single rule reconstructs reading order without needing a column grid,
// and not needing one matters: a real page carries more than one grid at once.
// Page 8 of the edition this was built against sets its upper half on a 119pt
// pitch and its lower strip on a 110pt pitch, so any global grid misassigns the
// strip. The rule above was checked by hand against all twelve ambiguous body
// blocks on that page and places every one correctly.
//
// It works because of how pages are designed rather than by luck: a headline
// placed in a column is precisely the mark that the story above it has ended
// there. A six-column headline owns body text six columns to its right; a
// one-column headline owns only its own column. Both fall out of the same rule.
//
// WHAT COMES OUT
//
// Articles, plus an explicit list of what was dropped and why. The dropped list
// is not decoration - it is the only way to see that the segmenter is discarding
// advertisements rather than news, and this pipeline's sibling already treats
// discard as a first-class outcome for the same reason.

const { detect, isNoisePage } = require('./profiles');

// ---------------------------------------------------------------------------
// text cleanup
// ---------------------------------------------------------------------------

const LIGATURES = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'st'],
];

// Column-set text is hyphenated at every line break, so the extracted string is
// full of "Brahmotsa- vams" and "oﬃ- cials". Joining them is required before any
// of it reaches a model, or the entity names arrive broken.
//
// The guard is the space: a real compound ("Tirumala-Tirupati") has no space
// after its hyphen, and a numeric range ("2166 - 3140") has spaces on both
// sides. Only "letter, hyphen, space(s), lowercase letter" is a soft break.
function dehyphenate(text) {
  return String(text).replace(/([A-Za-z])-\s+([a-z])/g, '$1$2');
}

function clean(text) {
  let t = String(text || '');
  for (const [re, to] of LIGATURES) t = t.replace(re, to);
  t = t.replace(/­/g, '');            // soft hyphen
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  t = dehyphenate(t);
  return t.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

const x0 = (b) => b.bbox[0];
const y0 = (b) => b.bbox[1];
const x1 = (b) => b.bbox[2];
const y1 = (b) => b.bbox[3];
const cx = (b) => (b.bbox[0] + b.bbox[2]) / 2;
const width = (b) => b.bbox[2] - b.bbox[0];

// ---------------------------------------------------------------------------
// role classification
// ---------------------------------------------------------------------------

// The size that most of the page's characters are set in. Everything else is
// judged relative to this rather than to an absolute point size, so the same
// code works on a text-layer page and on an OCR'd page whose sizes are
// estimated from glyph heights.
function bodySize(blocks) {
  const weight = new Map();
  for (const b of blocks) {
    const k = Math.round((b.size || 0) * 2) / 2;
    weight.set(k, (weight.get(k) || 0) + b.text.length);
  }
  let best = 0;
  let bestChars = -1;
  for (const [size, chars] of weight) {
    if (chars > bestChars) {
      best = size;
      bestChars = chars;
    }
  }
  return best || 9;
}

function matchesAny(patterns, text) {
  return (patterns || []).some((re) => re.test(text));
}

// A display headline set over several lines is emitted as one block per line on
// some pages, so the second and third lines arrive looking like small headlines
// of their own ("for the festival"). A real headline opens on a capital, a digit
// or a quotation mark; a continuation opens on a lowercase function word. Left
// unchecked these fragments become articles that steal body text from the story
// they were lifted out of.
function isFragment(text) {
  return /^[a-z]/.test(text) && !/^[a-z]{2,}\s+[A-Z]/.test(text);
}

// Assigns one of: noise, classified, furniture, pagetitle, dropcap, headline,
// standfirst, byline, caption, body.
//
// Font family is used where the publication provides a semantic one, and size
// relative to the page body carries the rest. Every guard below exists because
// of a false positive observed on a real page - a 37pt single letter opening a
// story, an 11.7pt summary line under a 35pt headline, a 10pt inset quotation
// mid-column, and a 27pt page section title.
function classify(block, ctx) {
  const { profile, body, page } = ctx;
  const text = block.text;
  const size = block.size || 0;
  const font = block.font || '';
  const rel = body ? size / body : 1;

  if (matchesAny(profile.noise, text)) return 'noise';
  if (matchesAny(profile.runningHead, text)) return 'furniture';
  if (matchesAny(profile.classified, text)) return 'classified';

  // Tested on where the block STARTS, not where it ends. The running head on one
  // page ran from y=35.6 to y=70.3 against a 70pt strip, so testing the bottom
  // edge let it through by three tenths of a point - and a threshold that can be
  // missed by 0.3pt is not a threshold. On this paper the first real headline of
  // a page sits at y>=109, so there is ample clearance.
  const inTopStrip = y0(block) <= profile.furnitureTopY;
  const inBottomStrip = y0(block) >= profile.furnitureBottomY;
  if (inTopStrip || inBottomStrip) {
    // The masthead line and the plate codes. A page title can also sit up here,
    // and either way it is furniture rather than an article.
    return 'furniture';
  }

  if (profile.fonts.furniture && profile.fonts.furniture.test(font)) return 'furniture';

  const looksHeadlineFace = profile.fonts.headline
    ? profile.fonts.headline.test(font)
    : rel >= 1.35;   // no font identity available: fall back on relative size

  if (looksHeadlineFace) {
    // A drop cap is one or two glyphs set very large. It is the first letter of
    // the body text, not a headline, and if left alone it both invents an
    // article and decapitates a real one.
    if (text.replace(/\W/g, '').length <= 2 && rel >= 1.8) return 'dropcap';

    if (matchesAny(profile.pageTitlePatterns, text)) return 'pagetitle';

    const h = profile.headline;
    const bigEnough = size >= h.minSize && rel >= 1.2;
    const rightLength = text.length >= h.minChars && text.length <= h.maxChars;
    const terminal = h.dislikeTerminalPeriod && /[.!?]$/.test(text);

    if (bigEnough && rightLength && !terminal && !isFragment(text)) return 'headline';
    // Headline face but not headline shape: a standfirst under the main
    // headline, or a pull-quote lifted out of the body. Both belong to a
    // surrounding article, so they are resolved positionally later.
    return 'secondary';
  }

  if (profile.fonts.caption && profile.fonts.caption.test(font)) return 'caption';

  if (
    matchesAny(profile.bylinePatterns, text) ||
    (profile.fonts.emphasis && profile.fonts.emphasis.test(font) && text.length <= 90)
  ) {
    return 'byline';
  }

  if (rel >= 1.35 && text.length >= profile.headline.minChars && !/[.!?]$/.test(text)) {
    // No headline face, but set well above body size and shaped like a headline.
    // This is the only path that finds headlines on an OCR'd page.
    return 'headline';
  }

  if (page.source === 'ocr' && block.conf != null && block.conf < 55) return 'noise';

  return 'body';
}

// ---------------------------------------------------------------------------
// the assignment rule
// ---------------------------------------------------------------------------

// Nearest headline above whose horizontal span covers the block's centre.
//
// COVER_SLACK forgives a body column that overhangs its headline by a few
// points, which happens constantly with justified text. It is deliberately
// small: widening it lets a narrow one-column headline start claiming its
// neighbour's columns, which is the one failure mode that silently merges two
// unrelated stories into one.
const COVER_SLACK = 14;
const ABOVE_SLACK = 4;

// How far an orphaned block may be from an article's occupied region before it
// is dropped rather than attached. One column pitch on this page geometry is
// ~119pt, so this permits a block to join across roughly one empty column but
// not across half a page.
const ORPHAN_MAX_GAP = 140;

function ownerOf(block, headlines) {
  const centre = cx(block);
  let best = null;
  for (const h of headlines) {
    if (y1(h) > y0(block) + ABOVE_SLACK) continue;                  // not above
    if (centre < x0(h) - COVER_SLACK || centre > x1(h) + COVER_SLACK) continue;  // not covered
    if (!best || y1(h) > y1(best)) best = h;                         // nearest above
  }
  return best;
}

// ---------------------------------------------------------------------------
// segmentation
// ---------------------------------------------------------------------------

function segmentPage(page, profile, opts = {}) {
  const minBodyChars = opts.minBodyChars ?? 140;
  const blocks = (page.blocks || [])
    .map((b) => ({ ...b, text: clean(b.text) }))
    .filter((b) => b.text.length > 0);

  const body = bodySize(blocks);
  const ctx = { profile, body, page };
  for (const b of blocks) b.role = classify(b, ctx);

  const dropped = [];
  const headlines = blocks.filter((b) => b.role === 'headline').sort((a, b) => y0(a) - y0(b));

  // No headline means nothing to hang body text on. Rather than emit one
  // undifferentiated blob, say so - it is a signal that the profile is wrong for
  // this page, and a blob would look like success.
  if (!headlines.length) {
    return {
      page: page.page,
      source: page.source,
      articles: [],
      dropped: [{ reason: 'no headline detected on page', blocks: blocks.length }],
    };
  }

  const articles = headlines.map((h) => ({
    headline: h.text,
    headlineSize: h.size,
    prominence: body ? Math.round((h.size / body) * 100) / 100 : null,
    standfirst: '',
    byline: '',
    captions: [],
    bodyBlocks: [],
    dropcaps: [],
    bbox: [x0(h), y0(h), x1(h), y1(h)],
    _h: h,
  }));
  const byHeadline = new Map(articles.map((a) => [a._h, a]));

  function attach(owner, b) {
    if (b.role === 'dropcap') owner.dropcaps.push(b);
    else if (b.role === 'caption') owner.captions.push(b.text);
    else if (b.role === 'byline' && !owner.byline) owner.byline = b.text;
    else if (b.role === 'secondary') {
      // Immediately under its headline, a headline-face block is the standfirst.
      // Further down it is a pull-quote, whose text already appears in the body.
      const gap = y0(b) - y1(owner._h);
      if (gap >= 0 && gap <= 60 && !owner.standfirst) owner.standfirst = b.text;
      else dropped.push({ reason: 'pull-quote or inset', text: b.text.slice(0, 80) });
    } else owner.bodyBlocks.push(b);
  }

  // PASS 1 - the strict rule.
  const orphans = [];
  for (const b of blocks) {
    if (b.role === 'headline') continue;

    if (b.role === 'noise' || b.role === 'furniture' || b.role === 'pagetitle') {
      dropped.push({ reason: b.role, text: b.text.slice(0, 80) });
      continue;
    }
    if (b.role === 'classified') {
      dropped.push({ reason: 'classified advertisement', text: b.text.slice(0, 80) });
      continue;
    }

    const owner = byHeadline.get(ownerOf(b, headlines));
    if (owner) attach(owner, b);
    else orphans.push(b);
  }

  // PASS 2 - recover the orphans by region.
  //
  // The strict rule assumes a headline is set at least as wide as the story it
  // introduces. That holds for news pages and fails for feature pages, where a
  // narrow display headline is set over a story running six columns wide: the
  // four columns outside the headline's span are left with no owner at all.
  //
  // So an orphan is attached to whichever article's occupied region it sits
  // closest to, measuring gap from the region the article's assigned blocks
  // actually cover rather than from its headline alone. A single-article feature
  // page therefore reassembles completely, which is the case that motivated
  // this pass.
  //
  // The cap keeps it honest. Attaching across a large empty gap is how two
  // unrelated stories get silently welded together, and that error is invisible
  // downstream - so beyond the cap the block is dropped with a reason instead.
  if (orphans.length) {
    const regionOf = (a) => {
      const parts = [a._h, ...a.bodyBlocks];
      return [
        Math.min(...parts.map(x0)), Math.min(...parts.map(y0)),
        Math.max(...parts.map(x1)), Math.max(...parts.map(y1)),
      ];
    };
    // Recomputed per orphan, so a block joined in this pass widens the region
    // and can carry the next one with it - which is how a column-by-column
    // feature page reassembles rather than only its first stray column.
    for (const b of orphans) {
      let best = null;
      let bestGap = Infinity;
      for (const a of articles) {
        const r = regionOf(a);
        const hGap = Math.max(0, r[0] - x1(b), x0(b) - r[2]);
        const vGap = Math.max(0, r[1] - y1(b), y0(b) - r[3]);
        const gap = Math.hypot(hGap, vGap);
        if (gap < bestGap) {
          bestGap = gap;
          best = a;
        }
      }
      if (best && bestGap <= ORPHAN_MAX_GAP) attach(best, b);
      else {
        dropped.push({
          reason: `no owning headline (nearest article ${Math.round(bestGap)}pt away)`,
          text: b.text.slice(0, 80),
        });
      }
    }
  }

  // Reading order within an article: column by column, top to bottom inside each
  // column. Columns are ordered left to right, and are derived from the blocks
  // this article actually occupies rather than from a page-wide grid.
  const out = [];
  for (const a of articles) {
    const cols = new Map();
    for (const b of a.bodyBlocks) {
      const key = Math.round(x0(b) / 24) * 24;   // tolerate justification jitter
      if (!cols.has(key)) cols.set(key, []);
      cols.get(key).push(b);
    }
    const ordered = [...cols.keys()].sort((p, q) => p - q).flatMap((k) =>
      cols.get(k).sort((p, q) => y0(p) - y0(q))
    );

    let text = ordered.map((b) => b.text).join(' ');

    // Re-attach the drop cap to the word it belongs to. The body block after it
    // begins mid-word and lowercase ("rofessor at the Paari School"), which is
    // both how it is recognised and why leaving it alone is not an option.
    for (const dc of a.dropcaps) {
      const letter = dc.text.replace(/\W/g, '');
      if (letter && /^[a-z]/.test(text)) text = letter + text;
    }
    text = clean(text);

    const chars = text.length;
    if (chars < minBodyChars) {
      dropped.push({
        reason: `article body too short (${chars} chars)`,
        text: a.headline.slice(0, 80),
      });
      continue;
    }

    const confs = ordered.map((b) => b.conf).filter((c) => c != null);
    out.push({
      page: page.page,
      source: page.source,
      headline: a.headline,
      standfirst: a.standfirst,
      byline: a.byline,
      dateline: datelineFrom(a.byline),
      body: text,
      chars,
      captions: a.captions,
      prominence: a.prominence,
      headline_size: a.headlineSize,
      bbox: a.bbox.map((v) => Math.round(v)),
      block_count: ordered.length,
      ocr_confidence: confs.length
        ? Math.round((confs.reduce((s, c) => s + c, 0) / confs.length) * 10) / 10
        : null,
    });
  }

  // Down the page, then across. Prominence ordering is left to the caller: on
  // the page it is position that carries the editor's judgement.
  out.sort((p, q) => p.bbox[1] - q.bbox[1] || p.bbox[0] - q.bbox[0]);
  return { page: page.page, source: page.source, articles: out, dropped };
}

// "The Hindu Bureau VIJAYAWADA" and "G.P. Shukla TIRUMALA" both end in the
// place, set in capitals. That place is worth keeping: it is the strongest
// available signal that a story is an Andhra Pradesh story.
function datelineFrom(byline) {
  const m = /\b([A-Z][A-Z .]{3,})\s*$/.exec(String(byline || '').trim());
  if (!m) return '';
  const place = m[1].trim();
  return place.length >= 4 && place.length <= 40 ? place : '';
}

function segment(ir, opts = {}) {
  const profile = detect(ir, opts.profile);
  const pages = [];
  const skipped = [];

  for (const page of ir.pages || []) {
    // OCR'd pages have no font identity, so they are always read with the
    // generic profile even when the document as a whole was identified.
    const pageProfile = page.source === 'ocr' && profile.fonts.headline
      ? { ...profile, fonts: {} }
      : profile;

    const noise = isNoisePage(pageProfile, page);
    if (noise) {
      skipped.push({ page: page.page, reason: noise, source: page.source });
      continue;
    }
    pages.push(segmentPage(page, pageProfile, opts));
  }

  return {
    profile: profile.id,
    language: profile.language,
    pages,
    skipped,
    articles: pages.flatMap((p) => p.articles),
  };
}

module.exports = { segment, segmentPage, clean, dehyphenate, bodySize, ownerOf };
