import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../hooks/useResource';
import { api } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import McqCard from '../components/McqCard';
import RichText from '../components/RichText';
import { BucketBadge, Chip } from '../components/Badges';
import { shortDate } from '../lib/caFormat';
import { IconRepeat } from '../components/Icon';

// The Leitner queue. Five boxes, intervals 1/3/7/14/30 days: "got it" pushes an
// item to a longer box, a miss drops it back to box 1.
//
// It matters more for current affairs than for static subjects, because news
// read once in August is genuinely gone by November unless something drags it
// back. The forward view is deliberate too — seeing the load coming is what
// stops a week away from turning into a 200-item backlog nobody opens.
export default function Revision() {
  const { data, error, loading, reload } = useResource('/revision/due');
  const [done, setDone] = useState({});

  if (loading) return <Loading label="Checking what is due…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { items, mcqs, upcoming } = data;

  async function review(itemType, itemId, success) {
    await api.post('/revision/review', { item_type: itemType, item_id: itemId, success });
    setDone((d) => ({ ...d, [`${itemType}-${itemId}`]: success ? 'kept' : 'again' }));
  }

  const nothingDue = items.length === 0 && mcqs.length === 0;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Revision</h1>
      <p className="mb-5 text-sm text-slate-600">
        {nothingDue
          ? 'Nothing is due today.'
          : `${items.length} item${items.length === 1 ? '' : 's'} and ${mcqs.length} question${
              mcqs.length === 1 ? '' : 's'
            } due.`}
      </p>

      {nothingDue ? (
        <EmptyState
          icon={IconRepeat}
          text="Nothing due today. Items enter the cycle when you mark them read, and questions when you first answer them."
          action={
            <Link
              to="/"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Read today's digest
            </Link>
          }
        />
      ) : null}

      {items.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Items to re-read
          </h2>
          <div className="space-y-2">
            {items.map((it) => {
              const key = `item-${it.id}`;
              const state = done[key];
              return (
                <div
                  key={it.id}
                  className="rounded-lg border border-slate-200 bg-surface p-3"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <BucketBadge bucket={it.bucket} short />
                    <Chip className="border-slate-300 bg-slate-100 text-slate-600">
                      Box {it.box}
                    </Chip>
                    <span className="text-[11px] text-slate-500">{shortDate(it.day_date)}</span>
                  </div>
                  <Link
                    to={`/item/${it.id}`}
                    className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                  >
                    {it.headline}
                  </Link>
                  {state ? (
                    <p className="mt-2 text-xs font-medium text-green-700">
                      {state === 'kept' ? 'Moved to a longer interval.' : 'Back to tomorrow.'}
                    </p>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => review('item', it.id, true)}
                        className="rounded-md border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 hover:bg-green-100"
                      >
                        Got it
                      </button>
                      <button
                        type="button"
                        onClick={() => review('item', it.id, false)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Needs practice
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {mcqs.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Questions to re-attempt
          </h2>
          <div className="space-y-3">
            {mcqs.map((mcq, i) => (
              <div key={mcq.id}>
                <p className="mb-1 text-xs text-slate-500">
                  From <Link to={`/item/${mcq.item_id || ''}`} className="hover:underline">{mcq.headline}</Link>
                  {' · '}Box {mcq.box}
                </p>
                {/* McqCard posts the attempt itself, and the server advances the
                    Leitner box off that attempt — so there is no separate
                    "got it" control here, and none is wanted: the answer *is*
                    the outcome. */}
                <McqCard mcq={mcq} index={i} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {upcoming.length ? (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Coming up
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {upcoming.map((u) => (
              <Chip key={u.due_date} className="border-slate-300 bg-surface text-slate-700">
                {shortDate(u.due_date)} · {u.n}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
