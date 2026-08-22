// Inline markdown — bold, italic and code — for the fields that are NOT block
// markdown but still arrive carrying emphasis.
//
// WHY THIS EXISTS RATHER THAN JUST USING <Markdown>
//
// The drafting prompt tells the model to bold every Article, section, case name,
// year, body and figure, because those are the recall targets. It does that for
// the notes, and it does it for THE FACT, the prelims facts, the angle and the
// verify note as well — one instruction, applied to everything it writes.
//
// Half the app rendered those fields as plain text, so a student read
//
//     The **UDISE+ 2025-26** report covers **1.47 million schools**
//
// with the asterisks showing. Worse than untidy: the asterisks landed on exactly
// the words that were meant to stand out, so the emphasis was inverted into
// noise precisely where it mattered most.
//
// <Markdown> is not the fix for these. It emits block elements — a stray <p>
// inside a <p> is invalid HTML and React will warn about it — and every one of
// these fields is rendered inside a paragraph, a list item or a chip. So this
// renders the inline subset only, and returns a fragment that is safe anywhere
// text is.
//
// Block markdown keeps going through <Markdown>. This is for the fields that are
// a sentence, not a document.

// Ordered: the two-star rule must be tried before the one-star rule, or "**x**"
// parses as an italic containing a starred word.
const RULES = [
  { re: /\*\*([^*]+)\*\*/, tag: 'strong' },
  { re: /__([^_]+)__/, tag: 'strong' },
  { re: /\*([^*\n]+)\*/, tag: 'em' },
  { re: /`([^`\n]+)`/, tag: 'code' },
];

const CODE_CLASS = 'rounded bg-slate-100 px-1 font-mono text-[0.9em] dark:bg-slate-700';

// Splits on the earliest match of any rule, emits it, and recurses on the tail.
// Recursion rather than a single pass because the tail can hold further
// emphasis, and because a bold run may itself contain code.
function parse(text, key = 0) {
  const s = String(text ?? '');
  if (!s) return [];

  let best = null;
  for (const rule of RULES) {
    const m = rule.re.exec(s);
    if (m && (!best || m.index < best.m.index)) best = { m, rule };
  }
  if (!best) return [s];

  const { m, rule } = best;
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  const inner = m[1];

  const node =
    rule.tag === 'strong' ? (
      <strong key={`b${key}`} className="font-semibold">{parse(inner, key + 1)}</strong>
    ) : rule.tag === 'em' ? (
      <em key={`i${key}`}>{parse(inner, key + 1)}</em>
    ) : (
      <code key={`c${key}`} className={CODE_CLASS}>{inner}</code>
    );

  return [before, node, ...parse(after, key + 2)];
}

/**
 * Renders inline emphasis. Use anywhere a single field of model-written text is
 * shown outside <Markdown>.
 *
 *   <RichText>{item.g1_fact}</RichText>
 */
export default function RichText({ children }) {
  return <>{parse(children)}</>;
}

/**
 * The same emphasis removed rather than rendered, for the places that can only
 * take a string: `title` attributes, `aria-label`, and anything measured for
 * length. Leaving the asterisks in a tooltip is the same fault in a smaller box.
 */
export function plainText(text) {
  return String(text ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}
