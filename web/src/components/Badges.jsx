import { BUCKETS, BANKS, IMPORTANCE, formatLabel } from '../lib/caFormat';

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
export function UnitBadge({ unit }) {
  const code = typeof unit === 'string' ? unit : unit.unit_code;
  const label = typeof unit === 'string' ? '' : unit.label;
  return (
    <Chip
      className="bg-green-100 text-green-800 border-green-300 font-mono"
      title={label ? `${code} — ${label}` : code}
    >
      {code}
    </Chip>
  );
}

export function BankBadge({ bank }) {
  const b = BANKS[bank];
  if (!b) return null;
  return (
    <Chip className="bg-slate-800 text-white border-slate-800" title={b.hint}>
      {bank} · {b.label}
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

// Shown when a figure or name could not be confirmed at a second source. It is
// deliberately loud: an acknowledged gap is worth more than a confident guess,
// but only if the student actually sees it before memorising the number.
export function VerifyBadge({ note }) {
  return (
    <Chip
      className="bg-amber-100 text-amber-900 border-amber-400"
      title={note || 'This detail could not be confirmed at a second source — check before memorising it.'}
    >
      ⚠ Verify
    </Chip>
  );
}
