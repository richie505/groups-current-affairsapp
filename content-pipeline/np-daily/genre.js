'use strict';

// What KIND of piece this is — and therefore what may honestly be taken from it.
//
// WHY THIS EXISTS
//
// The pipeline treated every article on a page as a report. It is not. Page 12
// of the 21 August edition carries four pieces, and not one of them is
// reportage: two signed op-eds and two unsigned editorials. Everything on that
// page is argument.
//
// That distinction was invisible downstream, and it produced exactly the fault
// you would predict. An op-ed characterised the Vanashakti judgment; the item
// drafted from it stated that characterisation as a fact about the judgment. A
// columnist PROJECTED a fiscal deficit of ₹18.16 lakh crore against a budgeted
// ₹16.96 lakh crore; the item filed the projection as the figure. Both reached
// the review queue looking exactly like a PIB release.
//
// A fact from a report and a claim from an op-ed are different objects. A
// candidate who writes "the Supreme Court held X" when a columnist argued X
// loses the mark, and loses it in the way that is hardest to unlearn —
// confidently.
//
// WHY IT IS DETERMINISTIC AND NOT A MODEL CALL
//
// Because the paper already says so, in three places, for free:
//
//   1. THE RUNNING HEAD NAMES THE PAGE. "Vijayawada Editorial", "Vijayawada
//      Opinion", "Vijayawada Business", "Vijayawada Sport". Every page of the
//      edition carries one. `profiles.js` was already matching these lines —
//      and throwing them away as furniture.
//
//   2. THE PAGE LABELS ITS OWN SECTIONS. "LETTERS TO THE EDITOR", "PARLEY",
//      "NOTEBOOK", "FROM THE ARCHIVES", "A HUNDRED YEARS AGO".
//
//   3. THE PAPER PRINTS A DISCLAIMER on signed opinion: "The views expressed are
//      personal", set in 7pt italic at the foot of the piece.
//
// A model asked "is this an op-ed?" would be right most of the time and wrong
// silently. The running head is right always and costs nothing — the same
// argument that made `profiles.js` key headline detection on the typesetter's
// font names rather than on relative size.
//
// The three signals are used together rather than in isolation: the section
// alone cannot separate the four pieces ON the editorial page from each other,
// and the disclaimer alone would miss the unsigned editorials, which carry none.

// The edition city, which prefixes the section in the running head. Same list as
// the running-head patterns in profiles.js, and for the same reason: it is the
// token that has to be removed before what remains is the section name.
const EDITION_CITY =
  /^(?:Vijayawada|Visakhapatnam|Amaravati|Hyderabad|Chennai|Bengaluru|Kochi|Madurai|Coimbatore|Delhi|Mumbai|Kolkata)\b\s*/;

// "THE HINDU 6 Friday, August 21, 2026 Vijayawada Editorial" — the masthead, the
// folio and the date, all of which precede the part that identifies the page.
const HEAD_PREFIX =
  /^(?:THE\s+HINDU\s*)?(?:[A-Z]?\d{1,3}\s+)?(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+\w+\s+\d{1,2},\s*\d{4}\s*)?/i;

/**
 * The section this page belongs to, read off its running head.
 *
 * Returns '' rather than guessing. An advertising wrap page genuinely has no
 * section, and a blank is a truer answer than the previous page's.
 */
function sectionOf(page) {
  const seen = [];
  for (const b of page.blocks || []) {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 90) continue;
    // The running head sits at the top of the page. Capping the scan keeps a
    // sentence of body copy that opens with the city name — "Vijayawada
    // Municipal Corporation said..." — from being read as a section.
    if (b.bbox && b.bbox[1] > 130) continue;
    const stripped = text.replace(HEAD_PREFIX, '');
    if (!EDITION_CITY.test(stripped)) continue;
    const rest = stripped.replace(EDITION_CITY, '').trim();
    if (rest) seen.push(rest);
  }
  // Some pages print the running head twice — once in the masthead strip and
  // once in the small-caps furniture line. They agree; take the shortest, which
  // is the one without trailing decoration.
  const named = seen.filter(looksLikeSection);
  if (!named.length) return '';
  named.sort((a, b) => a.length - b.length);
  return named[0];
}

// A section name is a word or two: "News", "Business", "Text & Context",
// "Vijayawada/Region", "metro PLUS". It carries no digits, no URL and no date.
//
// Without this the promotional strip on the supplement page — "G
// www.thehindu.com G Friday, August 21, 2026" — was read as that page's section,
// which is not merely useless: a section nobody can recognise is a section that
// silently answers "is this an opinion page?" with no.
function looksLikeSection(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 28) return false;
  return /^[A-Za-z][A-Za-z&/ '’-]*$/.test(t);
}

// Sections that carry argument rather than reportage. Matched loosely because
// The Hindu titles them slightly differently across editions and days:
// "Editorial", "Opinion", "OPINION", "Editorial/Opinion".
const OPINION_SECTION = /\b(?:Editorial|Opinion|Comment|Leader\s?page)\b/i;

// The paper's own disclaimer on signed opinion, set in 7pt italic under the
// piece. Definitive where it appears, and it appears on most signed op-eds.
const PERSONAL_VIEWS = /\bviews expressed are (?:personal|those of the)\b/i;

// The same line as a whole sentence, for removal from the prose once it has been
// read as evidence. It is a statement by the newspaper ABOUT the piece, not a
// sentence in it.
const DISCLAIMER_LINE = /\s*\bThe views expressed are (?:personal|those of the [^.]{0,60})\.?/gi;

// Page-section kickers, printed in the piece itself and therefore surviving into
// the text. Where each one lands differs — "A HUNDRED YEARS AGO" arrives as part
// of the headline, "PARLEY" as a stray word in the prose — so both are searched.
const MARKERS = [
  { genre: 'letters', label: 'LETTERS TO THE EDITOR', re: /\bLETTERS TO THE EDITOR\b/ },
  { genre: 'archive', label: 'an archive reprint', re: /\b(?:A HUNDRED YEARS AGO|FIFTY YEARS AGO|FROM THE ARCHIVES)\b/ },
  { genre: 'interview', label: 'PARLEY', re: /\bPARLEY\b/ },
  { genre: 'column', label: 'NOTEBOOK', re: /\bNOTEBOOK\b/ },
];

/**
 * The section kickers printed on a page, with where each one sits.
 *
 * Read off the raw page rather than off the segmented articles, because a
 * kicker's fate in segmentation depends on the face it happens to be set in and
 * the paper is not consistent about that. On page 13 of the 21 August edition
 * "A HUNDRED YEARS AGO" is set in the headline face and survives into a
 * headline, while "FIFTY YEARS AGO" — the piece beside it, doing the identical
 * job — is set in the caption face and is discarded. Reading the page directly
 * finds both.
 *
 * Position matters and is kept: a kicker labels the piece BELOW it, and a page
 * carries several. "PARLEY", "NOTEBOOK" and "FROM THE ARCHIVES" all appear on
 * that one page, over three different pieces.
 */
function markersOf(page) {
  const found = [];
  for (const b of page.blocks || []) {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 70) continue;
    for (const m of MARKERS) {
      if (m.re.test(text)) {
        found.push({ genre: m.genre, label: m.label, bbox: b.bbox || [0, 0, 0, 0] });
        break;
      }
    }
  }
  return found;
}

/**
 * The kicker that labels a given article, if any.
 *
 * The paper's own convention: a kicker sits immediately above the headline it
 * labels, within the headline's horizontal span. Both halves are required — the
 * vertical cap stops a kicker at the top of a column claiming everything under
 * it, and the horizontal test stops it reaching across into the next column.
 */
function markerFor(article, markers) {
  const [hx0, hy0, hx1] = article.bbox || [0, 0, 0, 0];
  let best = null;
  let bestGap = Infinity;
  for (const m of markers) {
    const gap = hy0 - m.bbox[3];
    if (gap < -4 || gap > 40) continue;
    if (m.bbox[0] > hx1 + 12 || m.bbox[2] < hx0 - 12) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = m;
    }
  }
  return best;
}

// An interview transcribed as a Q&A repeats the speaker's initials at the head
// of every answer: "BC:", "AS:", "Buddha Chandrasekhar:". Three or more turns is
// a transcript; one is a quotation inside an ordinary report.
const TURN = /(?:^|\s)(?:[A-Z]{2,3}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s?:\s/g;

/**
 * Classifies one segmented article.
 *
 * @param {object} article  as emitted by segmentPage — headline, byline, body
 * @param {string} section  the page's section, from sectionOf()
 * @param {object} [marker]  the kicker above its headline, from markerFor()
 * @returns {{genre: string, why: string}}
 */
function genreOf(article, section, marker) {
  const body = String(article.body || '');
  const opinionPage = OPINION_SECTION.test(section || '');
  // Every fragment the page attached to this piece, not the prose alone. Which
  // one a kicker lands in depends on the face it is set in, and the paper is not
  // consistent: "A HUNDRED YEARS AGO" is set in the headline face and arrives in
  // the headline, while "FIFTY YEARS AGO" on the same page is set in the caption
  // face and arrives in the captions. Searching only the body classified the
  // second of those two as an unsigned editorial.
  const text = [
    article.headline,
    article.standfirst,
    ...(article.captions || []),
    ...(article.credits || []),
    body,
  ]
    .filter(Boolean)
    .join(' ');

  // 1. Explicit labels first. These are the paper naming the piece itself, and
  //    nothing inferred should be allowed to overrule them. The kicker printed
  //    over this headline outranks one merely found in its text, because a page
  //    carries several and only position says which piece each belongs to.
  if (marker) return { genre: marker.genre, why: `page label ${marker.label}` };
  for (const m of MARKERS) {
    if (m.re.test(text)) return { genre: m.genre, why: `page label ${m.label}` };
  }

  // 2. A Q&A transcript, whether or not the PARLEY kicker survived segmentation.
  if ((body.match(TURN) || []).length >= 3 && body.includes('?')) {
    return { genre: 'interview', why: 'question-and-answer transcript' };
  }

  // 3. The disclaimer. Works even where the running head was not extracted,
  //    which is the case on any page that arrives as OCR.
  if (PERSONAL_VIEWS.test(body)) {
    return { genre: 'oped', why: 'carries the paper’s "views expressed are personal" line' };
  }

  // 4. The section. On an opinion page the byline separates the two kinds: a
  //    signed piece is an outside contributor's argument, an unsigned one is the
  //    newspaper's own institutional position. Both are argument; they differ in
  //    whose it is, and an answer that attributes it has to know which.
  if (opinionPage) {
    return article.byline
      ? { genre: 'oped', why: `signed piece on the ${section} page` }
      : { genre: 'editorial', why: `unsigned piece on the ${section} page` };
  }

  return { genre: 'report', why: section ? `${section} page` : 'no contrary signal' };
}

// Genres whose content is argument, projection or characterisation rather than
// reported fact. This is the single question the rest of the pipeline asks.
const OPINION_GENRES = new Set(['editorial', 'oped', 'interview', 'column']);

// Genres that are not events at all and should never become an item. Letters are
// readers' opinions; archive columns are reprints of century-old copy. Both read
// as plausible current-affairs prose, and both would otherwise score.
const NON_EVENT_GENRES = new Set(['letters', 'archive']);

const LABELS = {
  report: 'News report',
  editorial: 'Editorial (unsigned)',
  oped: 'Op-ed (signed opinion)',
  interview: 'Interview / debate',
  column: 'Column',
  letters: 'Letters to the Editor',
  archive: 'From the archives',
};

const isOpinion = (genre) => OPINION_GENRES.has(String(genre || ''));
const isNonEvent = (genre) => NON_EVENT_GENRES.has(String(genre || ''));
const labelOf = (genre) => LABELS[String(genre || '')] || 'News report';

module.exports = {
  sectionOf, markersOf, markerFor, genreOf,
  isOpinion, isNonEvent, labelOf, DISCLAIMER_LINE,
  OPINION_GENRES, NON_EVENT_GENRES, LABELS,
};
