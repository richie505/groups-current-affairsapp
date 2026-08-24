// Shared display vocabulary for current-affairs items.
//
// The labels live here rather than inline in each page because the same four
// buckets, four banks and eight formats appear on the digest, the item page,
// practice, the banks screen and the admin editors — and a bucket rendered as
// "AP" in one place and "Andhra Pradesh" in another reads like two different
// things.

export const BUCKETS = {
  international: { label: 'International', short: 'Intl', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  national: { label: 'National', short: 'India', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  // AP gets the one colour that stands out. It is roughly half of Papers II
  // and IV and the material no national source covers properly, so on a screen
  // of twelve items the AP ones should be the ones the eye lands on.
  ap: { label: 'Andhra Pradesh', short: 'AP', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  dynamic: { label: 'Syllabus update', short: 'Update', cls: 'bg-green-100 text-green-800 border-green-300' },
};

// Not a bucket in the database — a salvaged item keeps its real bucket, so a
// tunnel in Karnataka is still `national` and filtering by bucket still works.
// This is the label for the group the digest shows them in.
export const MISC = {
  label: 'Miscellaneous',
  short: 'Misc',
  cls: 'bg-violet-100 text-violet-800 border-violet-300',
  blurb: 'Facts worth knowing, lifted from stories that were not themselves exam material.',
};

export const FORMATS = {
  direct_recall: 'Direct recall',
  negative_statement: 'Incorrect-statement',
  assertion_reason: 'Assertion–Reason',
  statement_based: 'Statement A / B',
  multi_statement: 'Multi-statement',
  chronological: 'Chronological order',
  list_matching: 'List matching',
  count_based: 'Count-based',
};

export const IMPORTANCE = {
  1: { label: 'Tier 1', cls: 'bg-red-100 text-red-800 border-red-300', hint: 'Recent, statutory, consequential — the profile examiners reach for' },
  2: { label: 'Tier 2', cls: 'bg-slate-100 text-slate-700 border-slate-300', hint: 'Worth knowing' },
  3: { label: 'Tier 3', cls: 'bg-slate-100 text-slate-500 border-slate-200', hint: 'Background' },
};

export function bucketOf(key) {
  return BUCKETS[key] || BUCKETS.national;
}

export function formatLabel(key) {
  return FORMATS[key] || 'Direct recall';
}

// '2026-08-21' → 'Fri, 21 Aug 2026'. Parsed as UTC on purpose: these are plain
// date strings with no timezone, and letting the browser read them as local
// time shifts the digest by a day for anyone west of UTC.
export function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// '2026-08' → 'August 2026'
export function monthName(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Rough reading time for a digest. Deliberately conservative — the point of
// showing it is that a day's current affairs is a small, finishable task, and
// an under-promise that turns out to take longer is worse than the reverse.
export function readingMinutes(items) {
  // `words` is counted on the server and sent as one integer per item.
  //
  // This used to count the text itself, which meant the digest had to SHIP the
  // text — nine kilobytes of notes per card so that a card which renders none of
  // them could produce the number 15. The count is the only part that was ever
  // used here.
  //
  // The fallback keeps an older cached response working: the service worker can
  // still be holding a digest fetched before the server sent `words`.
  const words = items.reduce((sum, it) => {
    if (Number.isFinite(Number(it.words))) return sum + Number(it.words);
    const text = [it.notes_markdown, it.prelims_facts].filter(Boolean).join(' ');
    return sum + (text ? text.split(/\s+/).length : 0);
  }, 0);
  return Math.max(1, Math.round(words / 200));
}
