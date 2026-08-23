import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Wide content — ASCII-art diagrams in fenced code blocks, many-column
// tables — must never be allowed to stretch the notes/MCQ card. `pre` has no
// width limit by default and `white-space: pre`, so a long diagram line
// pushes the card wider than its container instead of wrapping. Give both
// elements their own horizontally-scrollable box instead.
const BASE_COMPONENTS = {
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-xs leading-relaxed">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

const DEFAULT_PLUGINS = [remarkGfm];

/**
 * The shallowest heading level present in a markdown string, or 0 for none.
 */
function shallowestHeading(markdown) {
  let min = 7;
  for (const [, hashes] of String(markdown || '').matchAll(/^(#{1,6})\s/gm)) {
    min = Math.min(min, hashes.length);
  }
  return min === 7 ? 0 : min;
}

/**
 * Heading overrides that re-level model-written markdown to sit UNDER the
 * heading of the section rendering it.
 *
 * WHY
 *
 * Every block on the item page is a `<section>` with its own `<h2>` — 'Static
 * notes — the standing material behind this'. The markdown inside it is written
 * with `##` subheadings, which react-markdown renders as `<h2>` as well. So the
 * contained headings came out as PEERS of the heading that contains them: the
 * document outline said five sections where there is one, and a screen-reader
 * user navigating by heading was given no way to tell the section title from
 * its own contents.
 *
 * It was survivable while static notes were free-form and often had no
 * headings at all. It stopped being survivable when the brief for that field
 * was fixed to five named headings, because now every item has them.
 *
 * A RELATIVE shift, not a fixed tag. The shallowest heading in the block moves
 * to `startLevel` and the rest keep their distance from it, so a block written
 * with `#` and a block written with `##` land in the same place — which is the
 * point, since which one a model produces is not something the page controls.
 */
function headingComponents(markdown, startLevel) {
  const min = shallowestHeading(markdown);
  if (!min) return null;
  const shift = startLevel - min;
  if (shift === 0) return null;

  const overrides = {};
  for (let level = 1; level <= 6; level++) {
    const target = Math.min(6, Math.max(1, level + shift));
    const Tag = `h${target}`;
    overrides[`h${level}`] = ({ children, ...props }) => <Tag {...props}>{children}</Tag>;
  }
  return overrides;
}

// Shared wrapper around ReactMarkdown — every place in the app that renders
// admin-authored markdown (notes, MCQ questions/explanations) should go
// through this instead of importing ReactMarkdown directly, so overflow
// handling and remark plugins stay consistent as content grows.
//
// `startLevel` is the heading level the block's own top-level heading should
// render at. Pass it wherever the surrounding section has a heading of its own;
// omit it and headings render at whatever level the markdown asked for.
export default function Markdown({ children, remarkPlugins = DEFAULT_PLUGINS, startLevel }) {
  const components = startLevel
    ? { ...BASE_COMPONENTS, ...(headingComponents(children, startLevel) || {}) }
    : BASE_COMPONENTS;
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
}
