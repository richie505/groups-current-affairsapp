import { Link, useParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import LensToggle from '../components/LensToggle';
import Markdown from '../components/Markdown';
import { BUCKETS, longDate, readingMinutes } from '../lib/caFormat';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '../components/Icon';

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

  const { day, items, prev, next } = data;
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: items.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length);

  const readCount = items.filter((i) => i.marked_read).length;

  return (
    <div>
      <header className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{longDate(day.date)}</h1>
          <LensToggle className="ml-auto" />
        </div>
        {day.title ? <p className="mb-2 text-slate-700">{day.title}</p> : null}
        <p className="text-sm text-slate-600">
          {items.length} item{items.length === 1 ? '' : 's'} · about {readingMinutes(items)} min ·{' '}
          {readCount}/{items.length} read
        </p>
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
