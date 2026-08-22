#!/usr/bin/env node
'use strict';

// Pulls the readable body text of a source page, so a candidates file can carry
// what a release actually says rather than a one-line summary of it.
//
// This exists because of a specific, verified problem. The drafting prompt is
// forbidden from supplying figures from memory — which is correct, and which
// means a thin `text` field produces a thin item rather than a confident
// invention. So the quality of every note is capped by how much source text
// reaches it, and getting the full release body in is the single highest-value
// thing in the whole pipeline.
//
// pib.gov.in returns 403 to some automated clients but serves normally to a
// plain request with a browser User-Agent. Since PIB is the primary source for
// virtually every central scheme and cabinet decision, that one header is the
// difference between citing a release and reading it.
//
//   node content-pipeline/ca-daily/fetch-source.js <url> [<url> ...]
//   node content-pipeline/ca-daily/fetch-source.js --json <url> [<url> ...] > cands.json
//
// --json emits a candidates-file skeleton ready for run.js: the text is filled
// in, the headline is guessed from the page title, and `date` is left for you to
// set. Always read what comes back before running it — an extraction heuristic
// is not a substitute for having looked at the page.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Publishers whose pages are worth marking is_primary in the candidates file.
// Matched on hostname suffix, so subdomains count.
const PRIMARY_HOSTS = [
  'pib.gov.in',
  'pmindia.gov.in',
  'prsindia.org',
  'rbi.org.in',
  'sebi.gov.in',
  'isro.gov.in',
  'drdo.gov.in',
  'mospi.gov.in',
  'moef.gov.in',
  'mnre.gov.in',
  'censusindia.gov.in',
  'ap.gov.in',
  'psc.ap.gov.in',
  'consilium.europa.eu',
  'ec.europa.eu',
  'un.org',
  'who.int',
  'imf.org',
  'worldbank.org',
];

const PUBLISHER_NAMES = {
  'pib.gov.in': 'PIB',
  'pmindia.gov.in': 'PMO India',
  'prsindia.org': 'PRS India',
  'rbi.org.in': 'RBI',
  'sebi.gov.in': 'SEBI',
  'isro.gov.in': 'ISRO',
  'drdo.gov.in': 'DRDO',
  'mospi.gov.in': 'MoSPI',
  'ap.gov.in': 'Government of Andhra Pradesh',
  'psc.ap.gov.in': 'APPSC',
};

function hostMatch(host, list) {
  return list.find((h) => host === h || host.endsWith(`.${h}`));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&rupee;': '₹',
};

function decode(s) {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  // Numeric entities last, so a named entity containing digits isn't mangled.
  return out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
}

// Titles that identify the site rather than the release. PIB is the offender
// that matters most: every release on the site is titled "Press Release Page |
// Press Information Bureau", so taking the <title> as the headline throws away
// the one line that actually says what happened.
const GENERIC_TITLE = /^(press release page|press release|home|index|untitled)\b|^\s*$/i;

// Best available headline: the <title> when it says something, otherwise the
// first substantial line of the extracted body — which on a PIB release is the
// release heading itself.
function headlineOf(html, text) {
  const title = titleOf(html);
  if (title && !GENERIC_TITLE.test(title)) return title;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    // Long enough to be a heading, short enough not to be a paragraph.
    .find((l) => l.length > 25 && l.length < 220 && !GENERIC_TITLE.test(l));
  return line || title;
}

// Text extraction, deliberately simple.
//
// Block-level tags become newlines before the rest of the markup is stripped,
// which is what keeps a table of figures from collapsing into one unreadable
// run — and on a PIB release the figures usually *are* in a table. Nav and
// footer chrome survives this; that is accepted, because the drafting model
// ignores boilerplate perfectly well and an aggressive readability heuristic
// risks cutting the one paragraph that carried the number.
function extractText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' · ')
    .replace(/<[^>]+>/g, ' ');

  t = decode(t);

  return t
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    // Drop one-word fragments — almost always menu items, and they crowd out
    // the real content in the character budget.
    .filter((line) => line.split(' ').length > 2 || /\d/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function describe(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  const primary = hostMatch(host, PRIMARY_HOSTS);
  return {
    publisher: PUBLISHER_NAMES[primary] || host,
    is_primary: primary ? true : false,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const urls = args.filter((a) => !a.startsWith('--'));

  if (!urls.length) {
    console.error('Usage: node fetch-source.js [--json] <url> [<url> ...]');
    process.exit(1);
  }

  const out = [];
  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      const text = extractText(html);
      const { publisher, is_primary } = describe(url);
      if (asJson) {
        out.push({
          headline: headlineOf(html, text),
          // Left blank on purpose: the publication date has to come from the
          // page or from you, and guessing it is how an item ends up filed on
          // the wrong day.
          date: '',
          text,
          sources: [{ url, publisher, is_primary }],
        });
      } else {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`${publisher}${is_primary ? ' [PRIMARY]' : ''} — ${url}`);
        console.log(`headline: ${headlineOf(html, text)}`);
        console.log(`extracted: ${text.length} chars`);
        console.log('='.repeat(70));
        console.log(text.slice(0, 6000));
        if (text.length > 6000) console.log(`\n… ${text.length - 6000} more chars (use --json to keep all of it)`);
      }
    } catch (e) {
      // A failure is reported and skipped rather than aborting the batch: one
      // dead URL in a sweep of twelve should not cost the other eleven.
      const msg = `FAILED ${url} — ${e.message}`;
      if (asJson) out.push({ headline: '', date: '', text: '', fetch_error: msg, sources: [{ url }] });
      console.error(msg);
    }
  }

  if (asJson) console.log(JSON.stringify(out, null, 2));
}

// Only run the CLI when invoked directly — daily.js imports fetchBody from here
// rather than shelling out or keeping a second copy of the extractor.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// One URL in, readable body text out. The single function daily.js needs.
async function fetchBody(url) {
  const html = await fetchPage(url);
  return extractText(html);
}

module.exports = { fetchBody, fetchPage, extractText, headlineOf, describe, UA };
