import { Link, useParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import LensToggle from '../components/LensToggle';
import Markdown from '../components/Markdown';
import { BUCKETS, longDate, readingMinutes } from '../lib/caFormat';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconLock } from '../components/Icon';
import { formatDuration } from '../components/PacingBar';

// One day's digest.
//
// Items are grouped by bucket rather than presented as a flat list, and Andhra
// Pradesh is pulled to the top. That ordering is the exam talking: AP is
// roughly half of Papers II and IV and the material no national source covers
// properly, so on a day when the student only has ten minutes, the AP block is
// the one that should get them.
const BUCKET_ORDER = ['ap', 'national', 'international', 'dynamic'];

export default function Day() {
  const { date } = useParams();
  const { data, error, loading, reload } = useResource(`/days/${date}`);

  if (loading) return <Loading label="Loading the digest…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { day, items, pacing, prev, next } = data;
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: items.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length);

  const readCount = items.filter((i) => i.marked_read).length;
  const paced = !!pacing && pacing.mode !== 'off';

  return (
    <div>
      <header className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{longDate(day.date)}</h1>
          <LensToggle className="ml-auto" />
        </div>
        {day.title ? <p className="mb-2 text-slate-700">{day.title}</p> : null}
        {/* One reading estimate, not two.
            With a pace set, the header's figure IS the paced figure — the
            generic 200-words-a-minute guess sitting beside "31 min of reading
            left at a steady pace" would make a liar of both. */}
        <p className="text-sm text-slate-600">
          {items.length} item{items.length === 1 ? '' : 's'} · about{' '}
          {paced ? formatDuration(pacing.total_seconds) : `${readingMinutes(items)} min`} ·{' '}
          {readCount}/{items.length} read
        </p>
        {/* The day's plan at the student's chosen pace. Shown only when a pace
            is set, and stated as what is LEFT rather than what the day totals —
            an estimate that never falls stops being information after the third
            item. See server/src/lib/pacing.js. */}
        {paced && pacing.locked ? (
          <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-sm text-brand-900">
            <IconLock />
            {/* Before anything is opened, "43 min left" only repeats the header
                two lines above it. What a student needs at that point is what
                the pace DOES; what they need afterwards is how much is left. */}
            {pacing.remaining_seconds >= pacing.total_seconds ? (
              <span>
                Paced learning is on
                {pacing.mode === 'custom'
                  ? ` at your own ${pacing.minutes} minutes an item`
                  : ` at a ${pacing.mode} pace`}{' '}
                — each item&rsquo;s questions open once its reading time has run.
              </span>
            ) : (
              <span>
                <strong>{formatDuration(pacing.remaining_seconds)}</strong> of reading left today —{' '}
                {pacing.locked} item{pacing.locked === 1 ? '' : 's'} still to open their questions.
              </span>
            )}
          </p>
        ) : null}
        {day.intro_markdown ? (
          <div className="prose-notes mt-3 rounded-lg border border-slate-200 bg-surface p-4 text-sm">
            <Markdown>{day.intro_markdown}</Markdown>
          </div>
        ) : null}
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={IconCalendar}
          text="This digest has no published items yet."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ bucket, items: group }) => (
            <section key={bucket}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
                {BUCKETS[bucket].label}
                <span className="rounded-full bg-slate-200 px-1.5 text-xs font-semibold text-slate-700">
                  {group.length}
                </span>
              </h2>
              <div className="space-y-3">
                {group.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <nav className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
        {prev ? (
          <Link to={`/day/${prev}`} className="flex items-center gap-1 font-medium text-brand-700 hover:underline">
            <IconChevronLeft /> {longDate(prev)}
          </Link>
        ) : (
          <span className="text-slate-400">No earlier digest</span>
        )}
        {next ? (
          <Link to={`/day/${next}`} className="flex items-center gap-1 font-medium text-brand-700 hover:underline">
            {longDate(next)} <IconChevronRight />
          </Link>
        ) : (
          <span className="text-slate-400">Up to date</span>
        )}
      </nav>
    </div>
  );
}
