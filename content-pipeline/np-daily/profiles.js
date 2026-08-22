'use strict';

// Per-publication layout profiles.
//
// WHY THIS IS A FILE AND NOT A HEURISTIC
//
// The Hindu's typesetter names its fonts semantically: `PublicoBannerRs-*` is
// the headline face and `PublicoTextRs-Roman` is body. That makes headline
// detection nearly deterministic on its pages, and it is a much stronger signal
// than "bigger than the median", which mistakes a drop cap, a pull-quote and a
// section title for headlines.
//
// But that signal is worth exactly one publication. Eenadu sets in a different
// family, and any page that arrives as OCR has no font identity at all. So the
// profile carries the strong signal where it exists, and `generic` carries the
// size-percentile fallback for everywhere it does not. `detect()` picks between
// them from the fonts actually present, rather than trusting a filename.
//
// Adding a publication means adding an entry here. Nothing else should need to
// know a font name.

// Text that is page furniture rather than content, in any publication.
const UNIVERSAL_NOISE = [
  /^[\s|.,:;_-]*$/,                       // rules and separators that OCR'd as punctuation
  /^(?:[CMYK]\s*)+$/i,                    // registration marks
  /^[A-Z]{1,3}\s+[A-Z]{2}-[A-Z]{3}\b/,    // plate codes, e.g. "M VJ-VJE C M Y K"
  /^e\d{6,}$/i,                           // the per-copy watermark id
  /^(?:page|pg)\s*\d+$/i,
  /^\d{1,3}$/,                            // bare folio numbers
  // Photo credits, which sit in caption type next to the caption itself.
  /^(?:SPECIAL ARRANGEMENT|SPECIAL\s+ARRANGEMENT|FILE PHOTO|PHOTO:|BY ARRANGEMENT|GETTY IMAGES|AFP|PTI|ANI|REUTERS)\b/i,
  /^ARRANGEMENT$/i,
  // The publisher's legal imprint and registration block. Matched on its text
  // rather than on its position: on the test edition it began at y=1495.6
  // against a 1500pt bottom strip, so it escaped a coordinate test by 4.4pt -
  // and the strip cannot simply be moved up, because genuine body text on
  // another page starts at y=1491. Wording is stable across editions in a way
  // that placement is not.
  /^Published by\b/i,
  /\bPrinted (?:by|at)\b.{0,40}\bat\b/i,
  /\bRegd\.\s*[A-Z]{2}\//,
  /\bRNI No\b/i,
  /^Vol\.\s*\d+\s*(?:No\.|\W)\s*\d+/i,
];

// The running head, which repeats on every page and does not always sit in the
// top strip - supplement pages move it down or set it mid-page. Matched on shape
// ("<folio> <weekday>, <month> <day>, <year>" with optional section words)
// rather than position, because position is exactly what is unreliable here.
const RUNNING_HEAD = [
  // The full "Friday, August 21, 2026" form, anywhere in the block. Deliberately
  // unanchored: the folio in front of it is sometimes a digit and sometimes a
  // roman numeral ("I Friday, August 21, 2026 Vijayawada Sport"), so anchoring
  // on digits misses half of them. Body copy says "on Thursday" or "August 21"
  // and essentially never prints the full weekday-comma-year form, which is what
  // makes this safe to match loosely.
  /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\w+\s+\d{1,2},\s*\d{4}/i,
  /^THE HINDU\b.{0,60}\d{4}\s*$/i,
  // "<edition> <section>" on its own: Vijayawada Sport, Vijayawada HEALTH,
  // Vijayawada SPOTLIGHT, Vijayawada metro PLUS. Length-capped so that a real
  // sentence opening with a city name is not swallowed.
  /^(?:Vijayawada|Visakhapatnam|Amaravati|Hyderabad|Chennai|Bengaluru|Kochi|Madurai|Coimbatore)\s+[A-Za-z ]{2,22}$/,
];

// Classified-advertisement stack headers. These sit in body-sized type in a
// news column, so nothing geometric separates them from an article - only the
// vocabulary does.
const CLASSIFIED_MARKERS = [
  /^PERSONAL$/i,
  /^GENERAL$/i,
  /^EDUCATIONAL$/i,
  /^PUBLIC NOTICE$/i,
  /^CHANGE OF NAME$/i,
  /^SITUATION[S]? (?:VACANT|WANTED)$/i,
  /^MATRIMONIAL$/i,
  /^TENDER[S]?( NOTICE)?$/i,
  /^LOST AND FOUND$/i,
  /^OBITUARY$/i,
  /\bI,\s+[A-Z][A-Za-z. ]+,\s*(?:R\/o|S\/o|D\/o|W\/o)\b/,   // the affidavit formula
  /\bhave changed my name\b/i,
  /\blost the Original\b/i,
];

const the_hindu = {
  id: 'the-hindu',
  label: 'The Hindu',
  language: 'en',
  ocrLang: 'eng',

  // Matched against the block's dominant font name.
  fonts: {
    headline: /PublicoBanner/i,
    body: /PublicoText(?!.*Bold)/i,
    emphasis: /PublicoText.*Bold/i,     // bylines and lead-ins
    caption: /SourceSansPro|Helvetica/i,
    // PoynterGothic sets the plate codes. The small-caps roman ("...RomanSC") is
    // reserved for section furniture - it is what "Vijayawada SPOTLIGHT",
    // "Vijayawada Sport" and "Vijayawada HEALTH" are set in, and nothing else
    // in the paper uses it.
    furniture: /PoynterGothic|RomanSC/i,
  },

  // A Banner-font block is only a headline if it also clears these. Each guard
  // exists because of a specific false positive seen on a real page:
  //   dropcap    - a single letter set at 37pt ("P" opening a story)
  //   standfirst - the summary line under a headline, also Banner but small
  //   pullquote  - an inset quotation mid-column, also Banner but small
  //   pagetitle  - "Vijayawada/Region" across the top of the page
  headline: {
    minSize: 13,             // in points; below this Banner text is furniture
    minChars: 12,
    maxChars: 220,
    // A headline never ends in a full stop; a standfirst or pull-quote usually
    // does. Weak on its own, decisive in combination with size.
    dislikeTerminalPeriod: true,
  },

  // Blocks above this y (in points, on a ~1531pt page) are the masthead strip.
  furnitureTopY: 70,
  furnitureBottomY: 1500,

  bylinePatterns: [
    /^(?:THE HINDU BUREAU|The Hindu Bureau)\b/,
    /\b(?:Special|Staff)\s+Correspondent\b/i,
    /^[A-Z][a-z]+\.?\s*[A-Z]?\.?\s*[A-Z][a-z]+\s+[A-Z]{3,}$/,   // "G.P. Shukla TIRUMALA"
  ],

  // Section titles that identify the page rather than an article on it.
  pageTitlePatterns: [
    /^(?:Vijayawada|Visakhapatnam|Andhra Pradesh|Telangana|National|World|Sport|Business|Life|Text\b)/i,
    /^(?:NEWS|OPINION|EDITORIAL|LETTERS|IN BRIEF|IN\s?BRIEF)$/i,
  ],

  // Pages of the edition that are never worth segmenting. Kept as patterns on
  // the page's own text, not page numbers: the ad wrap moves between days.
  pageNoise: [
    /thehindubusinessline/i,
    /MahaRERA/i,
    /\bRERA No\b/i,
  ],

  noise: UNIVERSAL_NOISE,
  runningHead: RUNNING_HEAD,
  classified: CLASSIFIED_MARKERS,
};

// Eenadu ships as a Telugu-set paper and, in the editions seen so far, as
// flattened artwork - which means OCR, which means no font identity. So its
// profile leans entirely on the generic size-percentile path and only carries
// what is language-specific. Refine once a real edition has been run.
const eenadu = {
  id: 'eenadu',
  label: 'Eenadu',
  language: 'te',
  ocrLang: 'tel',
  fonts: {},
  headline: { minSize: 13, minChars: 6, maxChars: 220, dislikeTerminalPeriod: false },
  furnitureTopY: 70,
  furnitureBottomY: 1500,
  bylinePatterns: [/^(?:ఈనాడు|ఈనాడు\s*-)/],
  pageTitlePatterns: [],
  pageNoise: [],
  noise: UNIVERSAL_NOISE,
  runningHead: RUNNING_HEAD,
  classified: CLASSIFIED_MARKERS,
};

// The fallback: no font names, so role comes from size relative to the page's
// own body size. Used for every OCR'd page and every publication not profiled.
const generic = {
  id: 'generic',
  label: 'Generic',
  language: 'en',
  ocrLang: 'eng',
  fonts: {},
  headline: { minSize: 12, minChars: 10, maxChars: 220, dislikeTerminalPeriod: true },
  furnitureTopY: 60,
  furnitureBottomY: 1500,
  bylinePatterns: [/\b(?:Bureau|Correspondent|Reporter)\b/i],
  pageTitlePatterns: [],
  pageNoise: [],
  noise: UNIVERSAL_NOISE,
  runningHead: RUNNING_HEAD,
  classified: CLASSIFIED_MARKERS,
};

const PROFILES = { 'the-hindu': the_hindu, eenadu, generic };

// Picks a profile from the fonts a document actually contains. Filenames lie
// ("TH- Vijayawada 21-08.pdf" is a guess at best); the typesetter's font names
// do not.
function detect(ir, hint) {
  if (hint && PROFILES[hint]) return PROFILES[hint];
  const fonts = new Set();
  for (const page of ir.pages || []) {
    for (const b of page.blocks || []) if (b.font) fonts.add(b.font);
  }
  const all = [...fonts].join(' ');
  if (/Publico(?:Banner|Text)/i.test(all)) return the_hindu;
  return generic;
}

// True when a whole page is an advertisement or a supplement wrapper rather
// than news. Deliberately conservative: a page wrongly dropped here is content
// silently lost, which is worse than an ad page reaching the relevance gate,
// where it will be discarded anyway with a reason attached.
function isNoisePage(profile, page) {
  const text = (page.blocks || []).map((b) => b.text).join(' ');
  if ((profile.pageNoise || []).some((re) => re.test(text))) return 'supplement or advertisement wrap';
  // A flattened page carrying almost no words is artwork. The threshold sits in
  // a two-orders-of-magnitude gap: the ad pages of a real edition came back
  // with 138-1,802 characters, its news pages with 6,000-22,000.
  if (page.source === 'ocr' && text.length < 2500) return 'flattened artwork, too little text to be news';
  return null;
}

module.exports = {
  PROFILES, detect, isNoisePage,
  UNIVERSAL_NOISE, RUNNING_HEAD, CLASSIFIED_MARKERS,
};
