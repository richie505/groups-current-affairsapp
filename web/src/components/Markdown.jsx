import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Wide content — ASCII-art diagrams in fenced code blocks, many-column
// tables — must never be allowed to stretch the notes/MCQ card. `pre` has no
// width limit by default and `white-space: pre`, so a long diagram line
// pushes the card wider than its container instead of wrapping. Give both
// elements their own horizontally-scrollable box instead.
const COMPONENTS = {
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

// Shared wrapper around ReactMarkdown — every place in the app that renders
// admin-authored markdown (notes, MCQ questions/explanations) should go
// through this instead of importing ReactMarkdown directly, so overflow
// handling and remark plugins stay consistent as content grows.
export default function Markdown({ children, remarkPlugins = DEFAULT_PLUGINS }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
