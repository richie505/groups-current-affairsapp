#!/usr/bin/env node
'use strict';

// No React hook may be called after an early return.
//
//   node scripts/check-hooks.js
//
// WHY THIS IS A CHECK AND NOT CARE
//
// Because the failure is a BLANK PAGE with nothing on it, and the only clue is
// a minified console error that names no component.
//
// The shape is always the same, and it always looks reasonable while being
// written — the hook is placed next to the code that uses it:
//
//   const { data, loading } = useResource(...);
//   if (loading) return <Loading />;          // <- render 1 stops here
//   if (error)   return <ErrorState />;
//   const e = data.edition;
//   const { confirm, dialog } = useConfirm(); // <- render 2 reaches this
//
// The loading render calls four hooks. The loaded render calls five. React
// counts them, finds more than last time, throws error #310, and unmounts the
// whole tree — so the navbar goes too and the page is white. Every route still
// returns 200, the API is fine, and the server log is clean.
//
// That shipped in AdminEditions.jsx and made every edition-detail page blank:
// clicking "Articles" on the newspaper import screen went nowhere at all. It
// was reported as "why does clicking anything in admin give me a blank page".
//
// THE RULE IT ENFORCES
//
// Hooks go at the top of the component, above every early return, whether or
// not that is where they are used. This is React's own Rules of Hooks; the
// check exists because the violation is silent rather than because the rule is
// obscure.
//
// WHAT IT CANNOT CHECK
//
// Only top-level statements of a function are examined — indentation is the
// test for "top level", which is reliable in this codebase because it is
// uniformly formatted. A hook nested inside an `if` block or a callback is not
// flagged here; the first is rarer and the second is usually legitimate.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'web', 'src');

// A hook call standing as its own top-level statement, with or without a
// binding: `const x = useFoo(`, `useEffect(`, `const { a } = useBar(`.
const HOOK = /^ {2}(?:(?:const|let|var)\s+[^=]+=\s*)?use[A-Z]\w*\s*\(/;
// `if (...) return ...` at the top level of a component.
const EARLY_RETURN = /^ {2}if\s*\(.*\)\s*return\b/;
// Where a function begins. Both `function Foo(` and `export default function Foo(`.
const FN_START = /^(?:export default )?function\s+(\w+)/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

const findings = [];

for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let fn = null;
  let returnedAt = 0;

  lines.forEach((line, i) => {
    const start = line.match(FN_START);
    if (start) {
      fn = start[1];
      returnedAt = 0;
      return;
    }
    if (!fn) return;
    // A component's name is the only signal available that it IS a component,
    // and it is the same signal React itself uses.
    if (!/^[A-Z]/.test(fn)) return;
    if (EARLY_RETURN.test(line)) {
      if (!returnedAt) returnedAt = i + 1;
      return;
    }
    if (!returnedAt) return;
    if (/^\s*\/\//.test(line)) return;
    if (!HOOK.test(line)) return;
    findings.push({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      line: i + 1,
      fn,
      returnedAt,
      code: line.trim(),
    });
  });
}

if (!findings.length) {
  console.log('PASS  no React hook is called after an early return');
  process.exit(0);
}

console.log(
  `${findings.length} hook(s) run only on some renders — each one blanks its page:\n`
);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  in ${f.fn}()`);
  console.log(`      ${f.code}`);
  console.log(`      unreachable whenever the early return on line ${f.returnedAt} fires\n`);
}
console.log(
  'Move each one above the early returns, with the component\'s other hooks.\n' +
    'React error #310 is what a user sees instead: a white page, no message.'
);
process.exit(1);
