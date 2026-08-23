#!/usr/bin/env node
'use strict';

// Every internal link must point at a route that exists.
//
//   node scripts/check-routes.js
//
// WHY THIS IS A CHECK AND NOT CARE
//
// A wrong `to=` is invisible in every way a developer normally looks. It
// compiles, it renders, it is styled like a link, it has the right label, and
// the router answers it with the 404 page rather than an error — so nothing in
// the console, the build or the test suite says a word. It is found by clicking
// it, which means it is found by a user.
//
// Two shipped in one afternoon. A review screen linked each item to
// `/admin/items/<id>`, which reads exactly like a route this app would have and
// is not one: items are edited through their DAY, at `/admin/days/<dayId>`.
// Both links landed on "Page not found".
//
// WHAT IT CANNOT CHECK
//
// A `to` built from a variable — `to={backTo}` — is skipped, because the value
// is only known at runtime. Template literals ARE checked: `/admin/days/${id}`
// becomes `/admin/days/:param` and is matched against the route table, which is
// the form nearly every dynamic link in this app takes.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'web', 'src');
const APP = path.join(SRC, 'App.jsx');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The route table, read from the <Route path="..."> declarations themselves.
// Kept in sync by construction rather than by a second list someone has to
// remember to update — a duplicated route table would drift and then this check
// would be the thing reporting false failures.
const routeSrc = fs.readFileSync(APP, 'utf8');
const routes = [...routeSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
if (!routes.length) {
  console.error('check-routes: found no <Route path="..."> in web/src/App.jsx — has it moved?');
  process.exit(2);
}

const wildcard = routes.includes('*');

// A route as a matcher: ':id' and a template hole both become one path segment.
const toMatcher = (route) =>
  new RegExp(`^${route.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
const matchers = routes.filter((r) => r !== '*').map(toMatcher);

const findings = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  // to="/literal"  and  to={`/tpl/${x}`}
  const links = [
    ...text.matchAll(/\bto="([^"]+)"/g),
    ...text.matchAll(/\bto=\{`([^`]+)`\}/g),
  ];
  for (const m of links) {
    let target = m[1];
    if (!target.startsWith('/')) continue; // relative or external: not ours to resolve
    // Strip the query and the hash — neither takes part in route matching.
    target = target.split('#')[0].split('?')[0];
    // Every `${...}` hole stands for exactly one segment's worth of value.
    const probe = target.replace(/\$\{[^}]*\}/g, 'X');
    if (matchers.some((re) => re.test(probe))) continue;
    findings.push({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      line: text.slice(0, m.index).split('\n').length,
      target: m[1],
    });
  }
}

if (!findings.length) {
  console.log(`PASS  every internal link matches one of the ${routes.length} declared routes`);
  process.exit(0);
}

console.log(`${findings.length} link(s) point at no route — they land on the 404 page:\n`);
for (const f of findings) console.log(`  ${f.file}:${f.line}  to="${f.target}"`);
console.log(
  `\nDeclared routes:\n${routes.map((r) => `  ${r}`).join('\n')}\n\n` +
    (wildcard
      ? 'The "*" route is why these fail silently: it renders NotFound instead of throwing.'
      : '')
);
process.exit(1);
