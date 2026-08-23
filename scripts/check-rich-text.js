#!/usr/bin/env node
'use strict';

// Every model-written text field must be RENDERED, not printed.
//
//   node scripts/check-rich-text.js
//
// WHY THIS IS A CHECK AND NOT A CODE REVIEW
//
// The drafting prompt tells the model to bold every Article, section, case name,
// year, body and figure, because those are the recall targets. It applies that
// to every field it writes — the note, THE FACT, the angle, why-it-is-news, the
// way forward, the MCQ explanations. So EVERY one of those fields can arrive
// carrying `**`.
//
// A screen that prints them raw does not merely look untidy. The asterisks land
// on exactly the words meant to stand out, so the emphasis is inverted into
// noise precisely where it matters most:
//
//     A signed opinion by **Sahab Deen** and **Navneet Sharma**
//
// That one survived a fix that went through nine other render sites in the same
// afternoon, because "did I get all of them?" is not a question a person can
// answer by reading. It is a question for a script.
//
// WHAT COUNTS AS RENDERED
//
//   <Markdown>{item.notes_markdown}</Markdown>   block markdown — headings,
//                                                lists, tables
//   <RichText>{item.g1_angle}</RichText>         inline only — safe inside a
//                                                <p>, a <span> or a chip
//   plainText(item.verify_note)                  emphasis stripped, for the
//                                                places that can only take a
//                                                string: title, aria-label
//
// A form input binding the raw value is fine and is not flagged: an editor is
// meant to show the markdown source. So only JSX *children* are checked —
// `value={form.g1_angle}` is an attribute and is skipped.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'web', 'src');

// Fields the model writes prose into. Kept as a list rather than inferred from
// the schema because not every TEXT column is prose: `bucket`, `status` and
// `g1_bank` are enumerations, and flagging them would train people to ignore
// this check.
const TEXT_FIELDS = [
  // ca_items
  'notes_markdown', 'static_linkage', 'static_notes', 'prelims_facts',
  'g1_fact', 'g1_angle', 'g1_theme', 'g1_sub_theme', 'g1_why_news',
  'g1_background', 'g1_ap_angle', 'g1_linked', 'g1_bridges', 'g1_way_forward',
  'verify_note', 'discard_reason',
  // ca_mcqs
  'explanation', 'question_text',
  // ca_days
  'intro_markdown',
  // ca_skeletons
  'skeleton_markdown',
];

// `question` and the four options are deliberately absent from the list above.
// They are handled by McqCard, which already routes them through <Markdown>, and
// the bare word "question" appears throughout the code as a variable name — a
// check that cried wolf on `{q.question}` inside a quiz builder would be turned
// off within a week.

const WRAPPERS = /<(?:RichText|Markdown)\b[^>]*>\s*$/;
const PLAIN = /plainText\s*\(\s*$/;

// Only files that render. `web/src/lib` holds helpers that read the same fields
// to count words or build a query string, and a check that scolded them for not
// wrapping a reduce() would be noise.
const RENDERS = /\.jsx$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (RENDERS.test(entry.name)) out.push(full);
  }
  return out;
}

// The `}` that closes the `{` at `start`, counting nesting so a template
// literal's `${...}` does not end the expression early.
function closingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const FIELD_ACCESS = new RegExp(`\\.(?:${TEXT_FIELDS.join('|')})\\b`);

const findings = [];

for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const end = closingBrace(text, i);
    if (end === -1) continue;
    const inner = text.slice(i + 1, end);

    // Only a leaf expression is a render. `{item.g1_fact ? (<p>…</p>) : null}`
    // is a CONDITION whose body contains the real render, and flagging the
    // condition would report every correctly-wrapped field in the file.
    if (inner.includes('<') || inner.length > 200) continue;
    if (!FIELD_ACCESS.test(inner)) continue;

    const before = text.slice(Math.max(0, i - 120), i);
    // An attribute, not a child: value={…}, title={…}, aria-label={…}. Editors
    // bind the raw source on purpose, and a tooltip cannot hold markup.
    if (/[\w-]+=\s*$/.test(before)) continue;
    if (WRAPPERS.test(before) || PLAIN.test(before)) continue;

    const lineNo = text.slice(0, i).split('\n').length;
    const line = lines[lineNo - 1] || '';
    if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) continue;

    findings.push({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      line: lineNo,
      field: (inner.match(FIELD_ACCESS) || [''])[0].slice(1),
      snippet: line.trim().slice(0, 96),
    });
    i = end;
  }
}

// A SECOND CHECK, FOR THE FAILURE THIS ONE MISSED.
//
// `<RichText text={item.headline} />` looks exactly like rendering, so the scan
// above walks straight past it — the field IS wrapped. But RichText takes
// `children` and nothing else, so a self-closing tag renders an empty fragment
// and the text disappears entirely. That is worse than the fault this file was
// written to catch: printed asterisks are ugly, a blank card is a missing
// question.
//
// It shipped to a review screen and was only found by reading the rendered
// page. Cheap to check, and there is no legitimate self-closing RichText.
const emptyRender = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /<(RichText|Markdown)\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(text))) {
    emptyRender.push({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      line: text.slice(0, m.index).split('\n').length,
      snippet: m[0].slice(0, 96),
    });
  }
}
if (emptyRender.length) {
  console.log(
    `${emptyRender.length} self-closing <RichText>/<Markdown> — these render NOTHING:\n`
  );
  for (const f of emptyRender) console.log(`  ${f.file}:${f.line}  ${f.snippet}`);
  console.log(
    '\nBoth take their content as children, not as a prop:\n' +
      '  <RichText>{item.headline}</RichText>   not   <RichText text={item.headline} />'
  );
  process.exit(1);
}

if (!findings.length) {
  console.log(`PASS  every model-written field in web/src is rendered, not printed`);
  process.exit(0);
}

console.log(`${findings.length} field(s) rendered as raw text — their markdown will print as asterisks:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  ${f.field}`);
  console.log(`      ${f.snippet}`);
}
console.log(
  '\nWrap each in <RichText> for a sentence, <Markdown> for a document, or\n' +
    'plainText() where only a string will do. See web/src/components/RichText.jsx.'
);
process.exit(1);
