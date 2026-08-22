import { shortDate } from '../lib/caFormat';

// Reading activity over the last N days, as a row of squares.
//
// Fed from the `daily` array /progress already returns rather than fetching its
// own endpoint, so the strip can never disagree with the streak figure sitting
// above it — two independent queries over the same data is how a dashboard ends
// up claiming a 5-day streak next to a gap.
//
// Days with no activity are drawn as empty squares rather than omitted. The
// gaps are the information: a strip of 30 squares with four filled says
// something a list of four dates does not.

const DAYS = 35;

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function shade(count, max) {
  if (!count) return 'bg-slate-100';
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.66) return 'bg-brand-600';
  if (ratio > 0.33) return 'bg-brand-500';
  return 'bg-brand-300';
}

export default function ActivityStrip({ daily = [] }) {
  const byDate = new Map(daily.map((d) => [d.date, d.n]));
  const max = daily.reduce((m, d) => Math.max(m, d.n), 0);

  const cells = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const iso = isoDaysAgo(i);
    cells.push({ iso, n: byDate.get(iso) || 0 });
  }

  const activeDays = cells.filter((c) => c.n > 0).length;
  const total = cells.reduce((s, c) => s + c.n, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-4">
      <div className="mb-2 flex flex-wrap gap-1">
        {cells.map((c) => (
          <span
            key={c.iso}
            title={`${shortDate(c.iso)} — ${c.n} item${c.n === 1 ? '' : 's'} read`}
            className={`h-4 w-4 rounded-sm ${shade(c.n, max)}`}
          />
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {total} item{total === 1 ? '' : 's'} read on {activeDays} of the last {DAYS} days.
      </p>
    </div>
  );
}
