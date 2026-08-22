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
const G = require('./genre');

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

// Page-pointer lines — "CONTINUED ON » PAGE 8", "SPORT » PAGE 15".
//
// Typographically these are terminators and navigation: they are furniture, not
// prose. Left in the body they end up inside a note, and worse, inside the text
// the relevance scorer and the entity extractor read.
//
// There are two kinds, and conflating them would be a factual error rather than
// a tidiness one. Page 7 of the test edition carries both:
//
//   CONTINUED ON » PAGE 8            this story runs on to page 8
//   JUDGE BACKS DEFINITION » PAGE 8  a DIFFERENT story about the same case
//   SPORT » PAGE 15                  a pointer to an unrelated section
//
// Only the first is a continuation. Recording "SPORT » PAGE 15" as where a
// Supreme Court story continues would invent a jump that does not exist. All
// three are stripped from the prose; only the first sets `continues_on`.
const POINTER_LINE = /(?:CONTINUED\s+ON|[A-Z][A-Z\s'’.]{3,40})\s*»\s*PAGE\s*(\d{1,3})/gi;
const CONTINUATION = /CONTINUED\s+ON\s*»\s*PAGE\s*(\d{1,3})/gi;
const JUMP_ONLY = /^\s*(?:(?:CONTINUED\s+ON|[A-Z][A-Z\s'’.]{3,40})\s*»\s*PAGE\s*\d{1,3}\s*)+$/i;

// The modal width of a body block on this page — one column, in points.
//
// WHY THIS IS NEEDED
//
// Because the PDF text layer occasionally emits ONE block spanning several
// columns, merging text from unrelated stories that happen to share a vertical
// band. On page 7 of the 21 August edition, 40 of 44 body blocks were exactly
// 105pt wide and one was 886pt — and that one carried a Supreme Court story's
// jump line followed by the lead paragraph of an entirely different report on
// core-sector growth. Assigned wholesale to the SC article, it became that
// article's opening paragraph, and the core-sector article was left starting at
// its own second paragraph.
//
// The damage ran past the text. The article's relevance score, its extracted
// entities and its keyword tags were all computed over the mixture. It also
// silently decapitated the story: the drop-cap re-attach below is guarded on the
// body starting lowercase, and a foreign paragraph in front of it made that
// false, so "In a verdict" was stored as "n a verdict".
//
// Modal rather than mean, because the mean is exactly what one 886pt outlier
// destroys.
function columnWidth(blocks) {
  const weight = new Map();
  for (const b of blocks) {
    if (b.role !== 'body') continue;
    const w = Math.round((b.bbox[2] - b.bbox[0]) / 5) * 5;
    if (w <= 0) continue;
    weight.set(w, (weight.get(w) || 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [w, n] of weight) {
    if (n > bestN) {
      best = w;
      bestN = n;
    }
  }
  return best || 0;
}

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

// A byline is a name, and the emphasis face it is set in is not reserved to it:
// the paper uses the same bold for section kickers ("PARLEY", "NOTEBOOK") and
// for the bolded question that opens each turn of an interview. Keeping only the
// first byline hid that; listing them all exposes it, so the list is shaped as
// well as collected.
//
// A name is a few words. It does not end in a colon, a question mark or a
// sentence's full stop, and it is not a single word set in capitals — which is
// what every kicker on the opinion pages is.
//
// The full stop needs the exception: "Sankar Narayanan E.H." is a byline and
// ends in one. A trailing initial is not a sentence ending, so only a stop that
// closes a word is disqualifying.
function looksLikeByline(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60) return false;
  if (/[?:!]$/.test(t)) return false;
  if (/\.$/.test(t) && !/\b[A-Z]\.$/.test(t)) return false;
  if (!/\s/.test(t) && t === t.toUpperCase()) return false;
  return true;
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

  // A block that is nothing but jump lines is furniture, whatever face it is
  // set in. Reclassified before ownership so it is never attached to a story.
  for (const b of blocks) {
    // Not conditioned on role 'body'. These are set in the publication's
    // sans face rather than its body face, so they arrive classified as
    // whatever that face implies — never as body.
    if (b.role !== 'headline' && JUMP_ONLY.test(b.text)) b.role = 'jumpline';
  }

  // Column-spanning blocks cannot belong to one article, so they are refused
  // ownership rather than handed to whichever headline happens to claim their
  // left edge. See columnWidth() for the page this was found on.
  //
  // The threshold is deliberately loose, and was set by measuring the whole
  // edition rather than by taste. Against a 105pt column:
  //
  //   8.4x  p7   jump line + an unrelated story's lead   <- artifact
  //   6.0x  p15  a pull-quote welded to a story's lead   <- artifact
  //   2.1x  p16  a genuine two-column measure            <- legitimate
  //   1.8x  p16  a genuine two-column measure            <- legitimate
  //
  // A first attempt at 1.9x refused the p16 block, which is real prose. 3x sits
  // in the gap with room on both sides. Refusing a genuine block costs a
  // paragraph and says so in `dropped`; accepting a merged one silently rewrites
  // an article's opening and everything computed from it.
  const colW = columnWidth(blocks);
  const maxBodyWidth = colW ? colW * 3 : Infinity;

  const dropped = [];
  let headlines = blocks.filter((b) => b.role === 'headline').sort((a, b) => y0(a) - y0(b));

  // A drop cap opens a story, so the headline-face line directly above one is
  // that story's headline — whatever size it is set in.
  //
  // WHY THIS IS NEEDED
  //
  // The headline test carries an absolute floor (`minSize`, 13pt for The Hindu)
  // to stop small Banner text — standfirsts, pull-quotes, kickers — inventing
  // articles. That floor is right for news pages, where headlines run 17-41pt,
  // and wrong for the editorial page, where the unsigned editorials are set at
  // 11.7pt. "Trial by fire — West Bengal should rebuild its crumbling..." and
  // "Socialist surge — Affordability issues propel democratic socialists..."
  // both came back as 'secondary', were discarded as pull-quotes, and their body
  // was then orphaned into the neighbouring op-ed.
  //
  // The result was two full editorials welded onto one signed column: an 8,835
  // character article headlined "Centre's fiscal outlook faces geopolitical,
  // revenue risks" whose first 2,700 characters were about fires in West Bengal.
  // It was drafted and published, and its prelims facts list Shikha Inn and
  // Tarapith inside a note about tax revenue.
  //
  // It also corrupted the opening word. The drop-cap re-attach prepends a letter
  // when the assembled text starts lowercase; with the fire editorial's body
  // ("hat is it with West Bengal") leading the article, it fired using the
  // fiscal piece's drop cap and stored "Ghat is it" for "What is it".
  //
  // THE GUARD
  //
  // Only where the drop cap has NO owning headline already. A drop cap sitting
  // under a real headline with a standfirst between them must not promote the
  // standfirst — that would invent an article on every news page. Asking
  // `ownerOf` first means this fires exactly where a story visibly begins and
  // nothing claims it.
  const promoted = [];
  for (const d of blocks.filter((b) => b.role === 'dropcap')) {
    if (ownerOf(d, headlines)) continue;
    const above = blocks
      .filter(
        (b) =>
          b.role === 'secondary' &&
          y0(b) < y0(d) &&
          y0(d) - y0(b) <= 90 &&
          x0(b) < x1(d) + COVER_SLACK &&
          x1(b) > x0(d) - COVER_SLACK
      )
      .sort((a, b) => y0(b) - y0(a));
    if (!above.length) continue;

    // A headline set over two lines arrives as one block per line, and the line
    // nearest the drop cap is the SECOND one. Taking it verbatim produced the
    // headline "socialists in the United States" for an editorial actually
    // headlined "Socialist surge — Affordability issues propel democratic
    // socialists in the United States". So the promotion starts at the nearest
    // line that opens like a headline and folds the continuation lines back on.
    const startIdx = above.findIndex((b) => !isFragment(b.text));
    if (startIdx === -1) continue;
    const candidate = above[startIdx];
    const continuation = above.slice(0, startIdx).reverse();
    if (continuation.length) {
      candidate.text = clean([candidate.text, ...continuation.map((b) => b.text)].join(' '));
      for (const b of continuation) b.role = 'noise';
    }
    candidate.role = 'headline';
    promoted.push(candidate.text.slice(0, 70));
  }
  if (promoted.length) {
    headlines = blocks.filter((b) => b.role === 'headline').sort((a, b) => y0(a) - y0(b));
    for (const t of promoted) {
      dropped.push({ reason: 'promoted to headline — a drop cap opens a story here', text: t });
    }
  }

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
    bylineBlocks: [],
    captionBlocks: [],
    bodyBlocks: [],
    dropcaps: [],
    jumps: [],
    bbox: [x0(h), y0(h), x1(h), y1(h)],
    _h: h,
  }));
  const byHeadline = new Map(articles.map((a) => [a._h, a]));

  function attach(owner, b) {
    // A jump line is a fact ABOUT the story — where it continues — not a
    // sentence in it. Recorded on the article and kept out of the prose.
    if (b.role === 'jumpline') {
      for (const m of b.text.matchAll(CONTINUATION)) owner.jumps.push(Number(m[1]));
    } else if (b.role === 'dropcap') owner.dropcaps.push(b);
    else if (b.role === 'caption') owner.captionBlocks.push(b);
    // Every byline, not just the first. Op-eds are routinely co-authored — the
    // 21 August fiscal-outlook piece carries two — and keeping only the first
    // silently reassigns the whole argument to one of its authors.
    else if (b.role === 'byline') owner.bylineBlocks.push(b);
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

    if (b.role === 'body' && width(b) > maxBodyWidth) {
      dropped.push({
        reason:
          `body block spans ${Math.round(width(b))}pt against a ${colW}pt column ` +
          '— the text layer merged several columns, so it belongs to no single story',
        text: b.text.slice(0, 80),
      });
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
    // Bylines in reading order, and the credit lines that belong to them.
    //
    // The contributor's credit — "Former Chairman, Prime Minister's Economic
    // Advisory Council and former Governor, Reserve Bank of India" — is set in
    // the caption face and sits immediately under the byline, in the same
    // column. Nothing else in the paper does that, which is what makes the
    // geometric test safe.
    //
    // It is kept because on an opinion piece it is provenance, not decoration:
    // an argument about fiscal policy FROM A FORMER RBI GOVERNOR is a different
    // object from the same argument unattributed, and an answer that leans on it
    // has to be able to say which.
    // The byline role is set by the emphasis FACE, which the paper also uses for
    // section kickers and bold lead-ins — "PARLEY", "NOTEBOOK", and the bolded
    // question that opens each turn of an interview. Keeping only the first
    // byline hid that; listing them all exposes it, so the list is shaped as
    // well as collected. A byline is a name: a few words, not a sentence, not a
    // question, and not a one-word kicker set in capitals.
    a.bylineBlocks.sort((p, q) => y0(p) - y0(q));
    const bylines = a.bylineBlocks.map((b) => clean(b.text)).filter(looksLikeByline);
    a.byline = bylines[0] || '';
    const credits = [];
    for (const c of a.captionBlocks) {
      const under = a.bylineBlocks.find(
        (b) => y0(c) - y1(b) >= -2 && y0(c) - y1(b) <= 32 && Math.abs(x0(c) - x0(b)) <= 24
      );
      if (under) credits.push(clean(c.text));
      else a.captions.push(c.text);
    }

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

    // Any jump marker still embedded in the prose is stripped, and where it
    // goes is kept. A story that continues on another page is a fact about the
    // story, not a sentence in it.
    const jumps = [...text.matchAll(CONTINUATION)].map((m) => Number(m[1]));
    const continuesOn = a.jumps.length ? a.jumps[0] : jumps.length ? jumps[0] : null;
    text = text.replace(POINTER_LINE, ' ');

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
      bylines,
      credits,
      dateline: datelineFrom(a.byline),
      body: text,
      chars,
      // The page this story runs on to, where it says so. Not yet used to join
      // the continuation — but a jump that is recorded can be joined later,
      // and one that was silently deleted cannot.
      continues_on: continuesOn,
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

// The printed page number, read off the running head: "9 Friday, August 21,
// 2026 Vijayawada News" and "THE HINDU 10 Friday, August 21, 2026".
const RUNNING_HEAD_PAGE = /^(?:THE\s+HINDU\s+)?(\d{1,3})\s+[A-Z][a-z]+day,/;

function printedPageOf(page) {
  for (const b of page.blocks || []) {
    const m = String(b.text || '').replace(/\s+/g, ' ').trim().match(RUNNING_HEAD_PAGE);
    if (m) return Number(m[1]);
  }
  return null;
}

// How far the PDF index runs ahead of the printed page number.
//
// A jump line says "CONTINUED ON » PAGE 8" and means printed page 8, which is
// not PDF page 8: this edition opens with six pages of advertising wrap, so
// printed 8 is PDF 14. Without this, a recorded jump points at the wrong page
// and can never be joined.
//
// Taken as the MODE across the edition rather than per page, because per-page
// reading is not reliable enough to depend on — it resolved on only 18 of 28
// pages of the test edition, and page 7, which carries the jump that prompted
// all this, was one of the misses. One advertising page also reported an offset
// of 0 against seventeen pages reporting 6, so the mode is doing real work
// rather than just averaging agreement.
function pageOffsetOf(ir) {
  const votes = new Map();
  for (const page of ir.pages || []) {
    const printed = printedPageOf(page);
    if (printed == null) continue;
    const off = page.page - printed;
    if (off < 0) continue;
    votes.set(off, (votes.get(off) || 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [off, n] of votes) {
    if (n > bestN) {
      best = off;
      bestN = n;
    }
  }
  // A single vote is a coincidence, not a measurement.
  return bestN >= 3 ? best : 0;
}

function segment(ir, opts = {}) {
  const profile = detect(ir, opts.profile);
  const pageOffset = pageOffsetOf(ir);
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
    const seg = segmentPage(page, pageProfile, opts);
    // What page of the paper this is, and therefore what kind of writing sits on
    // it. Read off the running head, which every page carries and which the role
    // classifier was already matching in order to discard it. See genre.js.
    seg.section = G.sectionOf(page);
    const markers = G.markersOf(page);
    for (const a of seg.articles) {
      a.section = seg.section;
      const g = G.genreOf(a, seg.section, G.markerFor(a, markers));
      a.genre = g.genre;
      a.genre_why = g.why;
      // The disclaimer has now done its work as evidence, so it comes out of the
      // prose. It is a statement by the newspaper about the piece, not a
      // sentence in it, and left in place it reads as content.
      a.body = clean(a.body.replace(G.DISCLAIMER_LINE, ' '));
      a.chars = a.body.length;
    }
    pages.push(seg);
  }

  // `continues_on` is a PRINTED page number as the paper wrote it. Resolved here
  // to the PDF index everything else in the pipeline uses, so a consumer never
  // has to know the difference — and kept alongside the original, so a wrong
  // offset is visible rather than baked in.
  const articles = pages.flatMap((p) => p.articles);
  for (const a of articles) {
    a.printed_page = a.page - pageOffset;
    a.continues_on_pdf = a.continues_on == null ? null : a.continues_on + pageOffset;
  }

  // Join a jump to what it jumps to.
  //
  // Without this, the two halves of one story are drafted as two knowledge items
  // — observed on the test edition, where a Supreme Court ruling produced two
  // items and eight questions about a single event.
  //
  // The page alone is not enough of a signal: the target page carries several
  // unrelated stories. So a candidate must also SHARE VOCABULARY with the
  // origin's headline — two or more significant tokens. On the test edition the
  // origin read "1978 'industry' definition void under new code: SC" and the
  // continuation "SC says 1978 'industry' definition rendered void", sharing
  // 1978, industry and definition; the other stories on that page share nothing.
  //
  // The link is advisory: `continuation_of` marks it, and it is left to the
  // caller whether to merge. This file segments, and deciding that one story is
  // another is a judgement the merge step already owns.
  const significant = (headline) =>
    new Set(
      String(headline || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 || /^\d{4}$/.test(w))
    );

  const byPage = new Map();
  for (const a of articles) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  }
  for (const a of articles) {
    if (a.continues_on_pdf == null || a.continues_on_pdf === a.page) continue;
    const origin = significant(a.headline);
    let best = null;
    let bestShared = 0;
    for (const cand of byPage.get(a.continues_on_pdf) || []) {
      if (cand === a || cand.continuation_of) continue;
      const shared = [...significant(cand.headline)].filter((w) => origin.has(w)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = cand;
      }
    }
    if (best && bestShared >= 2) {
      best.continuation_of = { page: a.page, headline: a.headline, shared: bestShared };
    }
  }

  return {
    profile: profile.id,
    language: profile.language,
    page_offset: pageOffset,
    pages,
    skipped,
    articles,
  };
}

module.exports = { segment, segmentPage, clean, dehyphenate, bodySize, ownerOf };
