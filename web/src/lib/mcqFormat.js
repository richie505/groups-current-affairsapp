// Auto-formats MCQ question/explanation text before it's handed to
// react-markdown, so admins don't have to remember an exact markdown
// convention (blank lines, **bold**, numbered-list syntax) to get
// structured question types — multi-statement, Assertion-Reason,
// chronological-ordering — to render legibly. This runs at *display time*
// only: it never touches what's stored in the database, so it's safe to
// change or extend, and it retroactively cleans up content that was typed
// before this existed.
//
// It recognizes these shapes, all of which occur in real content:
//
// 1. An inline enumerated list glued into one line, in any of three marker
//    styles — "(1) Wheat (2) Barley", "1. Wheat 2. Barley", "I. Wheat
//    II. Barley" — reflowed into a lead-in, a real markdown list, and the
//    trailing prompt as its own paragraph.
//
// 2. A run-on Assertion-Reason question, split onto three paragraphs with
//    **Assertion (A):** / **Reason (R):** bolded.
//
// All are no-ops on text that's already well-formatted, so this is safe to
// run on every question unconditionally.

const QUESTION_PROMPT_RE = /(?:Which|How\s+many|Select|Choose|What|Who|Identify|Arrange|Consider)\b/;

// Roman-numeral lists are deliberately NOT reflowed.
//
// A markdown ordered list can only render arabic numerals, so reflowing
// "I. Sira, II. Sita, III. Datra" turns it into "1. Sira, 2. Sita, 3. Datra"
// — and every one of these in the bank is a matching question whose options
// read "I-a, II-b, III-c". Renumbering would silently break the answer
// options' correspondence with the statements. Twelve questions render as
// run-on prose instead, which is untidy but correct.

// The marker styles, each with the rules that stop it firing on prose.
//
// The bare "1." style is the delicate one: it has to enumerate a list without
// also matching a decimal ("1.5 million tonnes"), a year ending a sentence
// ("...founded in 1919. Its headquarters..."), or a figure mid-sentence. Three
// guards do that — the marker must be at a word boundary, must be followed by
// whitespace and then a non-digit, and (below) the numbers must run 1, 2, 3…
// in order. Prose satisfying all three is essentially always a real list.
// The trailing whitespace is a lookahead, not part of the match, and that
// detail is load-bearing. Consuming it moved lastIndex past the separator the
// *next* marker needs, so in "…enforceable under Article 14. 2. It is a
// constitutional goal…" the stray "14." swallowed the space before "2." and
// the real second marker was never found — the question stayed run-on.
//
// A lookbehind for the leading separator would be tidier, but Safari only
// gained lookbehind in 16.4 and an unsupported one is a parse error that takes
// the whole bundle down, not a quiet failure. Keeping it as a consumed
// alternation is safe everywhere.
const STYLES = [
  { name: 'paren', re: /(?:^|[\s:;,])\((\d{1,2})\)(?=\s)/g, value: (m) => Number(m[1]) },
  // No `(?!\d)` guard here. It was meant to exclude decimals, but "1.5" can
  // never match anyway — the pattern already demands whitespace after the dot.
  // All it actually did was reject list items that begin with a number
  // ("1. 27% had low jointness", "2. 13th Major Rock Edict"), which are common.
  // The ascending-run check below is what keeps prose out.
  { name: 'dot', re: /(?:^|[\s:;])(\d{1,2})\.(?=\s)/g, value: (m) => Number(m[1]) },
];

function findMarkers(text, style) {
  const markers = [];
  style.re.lastIndex = 0;
  let m;
  while ((m = style.re.exec(text))) {
    // The separator before the marker is part of the match, so skip it —
    // otherwise the lead-in would lose its final character (a colon, usually).
    const sep = /^[\s:;,]/.test(m[0]) ? 1 : 0;
    // The whitespace after the marker is a lookahead, so step over it here to
    // find where the item's text actually begins.
    const afterMarker = m.index + m[0].length;
    const ws = text.slice(afterMarker).match(/^\s+/);
    markers.push({
      num: style.value(m),
      start: m.index + sep,
      contentStart: afterMarker + (ws ? ws[0].length : 0),
    });
  }
  return markers;
}

// Pick out the 1, 2, 3… sequence, ignoring numbers that don't continue it.
//
// Figures ending a sentence look exactly like list markers, and they turn up
// both at the end — "…APSFC - Schedule 9. How many of the above…" — and in
// the middle of an item — "1. Parsvanatha died at age 100, while Mahavira
// died at age 72. 2. Parsvanatha renounced…". Requiring every candidate to
// fit the run, or even just taking a prefix, left those questions run-on.
// Skipping non-matching candidates finds the real list in both shapes, and
// the stray number stays where it belongs, inside its item.
//
// This stays strict enough because the sequence must still start at 1 and
// climb by one, and two markers minimum are required.
function ascendingRun(markers) {
  const run = [];
  for (const mk of markers) {
    if (mk.num === run.length + 1) run.push(mk);
  }
  return run;
}

function splitInlineList(text) {
  for (const style of STYLES) {
    const markers = ascendingRun(findMarkers(text, style));
    if (markers.length < 2) continue;

    const lead = text.slice(0, markers[0].start).trim();
    if (!lead) continue; // a list with no lead-in isn't the shape we're fixing

    const items = markers.map((mk, i) => {
      const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
      return text.slice(mk.contentStart, end).trim();
    });

    // The final item usually has the actual question glued onto it:
    // "…88 recognized constellations. How many of the above are correct?"
    // Greedy up to the last sentence end, so an item containing its own full
    // stop ("founded in 1919. Its headquarters…") isn't cut at the first one.
    let trailing = '';
    const last = items[items.length - 1];
    const promptSplit = last.match(new RegExp(`^(.*[.)?])\\s+(${QUESTION_PROMPT_RE.source}.*)$`, 's'));
    if (promptSplit) {
      items[items.length - 1] = promptSplit[1].trim();
      trailing = promptSplit[2].trim();
    }

    return { lead, items, trailing };
  }
  return null;
}

function formatInlineLists(text) {
  const parsed = splitInlineList(text);
  if (!parsed) return text;
  const { lead, items, trailing } = parsed;
  const list = items.map((it, i) => `${i + 1}. ${it}`).join('\n');
  const parts = [lead, list];
  if (trailing) parts.push(trailing);
  return parts.join('\n\n').trim();
}

function formatAssertionReason(text) {
  // Anchor on the labels that introduce the actual statements — "Assertion
  // (A):" with a colon — not on any mention of the words.
  //
  // Some questions open with a preamble that names both before either is
  // stated: "Consider the following Assertion (A) and Reason (R): Assertion
  // (A): … Reason (R): …". Replacing the *first* match, as this did, bolded
  // the preamble's label and left the real pair as run-on prose. Taking the
  // last "Assertion (A):" and the last "Reason (R):" after it finds the real
  // pair in both shapes.
  // The optional asterisks let this match text this function already
  // formatted, consuming the bold markers instead of stranding them in the
  // preamble — which is what makes a second pass a no-op.
  const aRe = /\*{0,2}Assertion\s*\(A\)\s*:\s*\*{0,2}\s*/gi;
  const rRe = /\*{0,2}Reason\s*\(R\)\s*:\s*\*{0,2}\s*/gi;
  const lastMatch = (re, from = 0) => {
    re.lastIndex = 0;
    let found = null;
    let m;
    while ((m = re.exec(text))) {
      if (m.index >= from) found = { start: m.index, end: m.index + m[0].length };
    }
    return found;
  };

  const a = lastMatch(aRe);
  if (!a) return text;
  const r = lastMatch(rRe, a.end);
  if (!r) return text;

  const preamble = text.slice(0, a.start).trim();
  const assertion = text.slice(a.end, r.start).trim();
  let reason = text.slice(r.end).trim();

  // The closing prompt is usually glued to the end of the reason.
  let prompt = '';
  const split = reason.match(new RegExp(`^(.*[.)?])\\s+(${QUESTION_PROMPT_RE.source}.*)$`, 's'));
  if (split) {
    reason = split[1].trim();
    prompt = split[2].trim();
  }

  return [preamble, `**Assertion (A):** ${assertion}`, `**Reason (R):** ${reason}`, prompt]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

// Does this text already have its list markers on their own lines? If so the
// markdown renderer will handle it and reflowing would be a no-op at best.
function alreadyListFormatted(text) {
  return /\n\s*(?:\(?\d{1,2}[.)]|I{1,3}\.)\s/.test(text);
}

// "Match List-I with List-II" questions pair two halves — "A. Chairman;
// B. Member 1" against "1. Special knowledge; 2. Experience" — and the answer
// options encode that pairing as "A-1, B-3". Reflowing only the numbered half
// leaves the two visually lopsided, and reflowing the lettered half isn't
// possible in markdown without renumbering it. They stay as prose, for the
// same reason roman-numeral lists do.
const MATCH_LIST = /\bList\s*-?\s*(I|1)\b[\s\S]*\bList\s*-?\s*(II|2)\b/i;

export function autoFormatMcqText(raw) {
  if (!raw) return raw;
  let text = raw;
  if (!alreadyListFormatted(text) && !MATCH_LIST.test(text)) text = formatInlineLists(text);
  if (/Assertion\s*\(A\)/i.test(text) && /Reason\s*\(R\)/i.test(text)) text = formatAssertionReason(text);
  return text;
}
