import { BUCKETS, IMPORTANCE, formatLabel } from '../lib/caFormat';
import { plainText } from './RichText';

// The small labelled chips that carry an item's routing. They matter more than
// decoration here: the bucket, the tier, the keyword angle and the paper unit
// *are* the exam-orientation of the app, and a student scanning a digest should
// be able to see at a glance which items are AP, which are Tier 1, and which
// paper each one feeds.

export function Chip({ children, className = '', title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${className}`}
    >
      {children}
    </span>
  );
}

export function BucketBadge({ bucket, short = false }) {
  const b = BUCKETS[bucket] || BUCKETS.national;
  return (
    <Chip className={b.cls} title={b.label}>
      {short ? b.short : b.label}
    </Chip>
  );
}

export function ImportanceBadge({ importance }) {
  const t = IMPORTANCE[importance] || IMPORTANCE[2];
  // Tier 2 and 3 are the norm, so only Tier 1 earns a badge. Labelling every
  // item's tier turns the signal into wallpaper.
  if (Number(importance) !== 1) return null;
  return (
    <Chip className={t.cls} title={t.hint}>
      {t.label}
    </Chip>
  );
}

// The blueprint question angle. This is the Group-II routing: it says how
// APPSC would actually test the item, which is the difference between a news
// summary and exam material.
export function KeywordBadge({ keyword }) {
  return (
    <Chip
      className="bg-brand-50 text-brand-700 border-brand-200"
      title={`Blueprint question angle — APPSC tests this item through the "${keyword}" angle`}
    >
      {keyword}
    </Chip>
  );
}

// The Group-I routing. The tooltip carries the unit's full label because the
// code alone ('P4-U4') means nothing until you have learnt the map, and the
// whole point of the tag is that current affairs become updates to a skeleton
// the student already has.
// A paper unit, named rather than coded.
//
// This used to show "P3-U7" and hide "Policy process, implementation, scheme
// design and failure" in a tooltip — so a row of six chips read P1 P3-U1 P3-U5
// P3-U7 P4-U6 P4-U11 and told a reader nothing without six hovers.
//
// The code stays, in monospace, because it is the canonical handle: it is what
// the drafting prompt uses, what ref_units is keyed on, and what a person types
// when they want to query one. The label sits beside it.
//
// The full label, not a shortened one. Truncating to the first clause was tried
// and is worse than the code: six different units all shorten to "AP history",
// which makes P2-U2 (Satavahanas and Ikshvakus) and P2-U6 (colonial
// administration) indistinguishable. At a median of 54 characters the labels are
// short enough to show whole.
export function UnitBadge({ unit }) {
  const code = typeof unit === 'string' ? unit : unit.unit_code;
  const label = typeof unit === 'string' ? '' : unit.label;
  return (
    <Chip
      className="bg-green-100 text-green-800 border-green-300"
      title={label ? `${code} — ${label}` : code}
    >
      <span className="font-mono text-[10px] opacity-70">{code}</span>
      {label ? <span className="ml-1">{label}</span> : null}
    </Chip>
  );
}

export function FormatBadge({ format }) {
  return (
    <Chip className="bg-slate-100 text-slate-600 border-slate-200" title="MCQ format used by the real paper">
      {formatLabel(format)}
    </Chip>
  );
}

// What KIND of piece the item was drafted from.
//
// A news report and an op-ed are different objects, and until this badge existed
// nothing on the screen said so: an item summarising a columnist's reading of a
// judgment looked exactly like an item summarising the judgment. The student
// reading it has no way to know that the confident sentence in front of them is
// somebody's argument unless the page says so.
//
// A report earns no badge — it is the norm, and labelling the norm makes the
// exception invisible, the same reasoning that keeps Tier 2 and 3 unbadged.
const GENRE_CHIP = {
  oped: { label: 'Op-ed', hint: 'Drafted from signed opinion. The evaluations and projections in it are the author’s, not the record’s.' },
  editorial: { label: 'Editorial', hint: 'Drafted from the newspaper’s own unsigned editorial — an institutional argument, not a report.' },
  interview: { label: 'Interview', hint: 'Drafted from an interview or debate. The claims are the speakers’, not the record’s.' },
  column: { label: 'Column', hint: 'Drafted from a signed column — argument rather than reportage.' },
};

export function GenreBadge({ genre, author }) {
  const g = GENRE_CHIP[genre];
  if (!g) return null;
  return (
    <Chip
      className="border-violet-300 bg-violet-100 text-violet-900"
      title={author ? `${g.hint} — ${author}` : g.hint}
    >
      {g.label}
      {author ? <span className="font-normal opacity-80">· {author}</span> : null}
    </Chip>
  );
}

// Shown when a figure or name could not be confirmed at a second source. It is
// deliberately loud: an acknowledged gap is worth more than a confident guess,
// but only if the student actually sees it before memorising the number.
export function VerifyBadge({ note }) {
  return (
    <Chip
      className="bg-amber-100 text-amber-900 border-amber-400"
      title={plainText(note) || 'This detail could not be confirmed at a second source — check before memorising it.'}
    >
      ⚠ Verify
    </Chip>
  );
}
