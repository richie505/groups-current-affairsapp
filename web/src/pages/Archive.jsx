import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { longDate, monthName, shortDate } from '../lib/caFormat';
import { IconLayers, IconChevronRight } from '../components/Icon';

// The archive is month-first, then day.
//
// Current affairs is revised by month — nobody re-reads thirty separate days —
// so the month is the primary unit here and each one links to its own compiled
// revision page. The day list underneath is for going back to a specific date.
export default function Archive() {
  const months = useResource('/archive');
  const [openMonth, setOpenMonth] = useState(null);
  const days = useResource(openMonth ? `/days?month=${openMonth}&limit=40` : null);

  if (months.loading) return <Loading label="Loading the archive…" />;
  if (months.error) return <ErrorState error={months.error} onRetry={months.reload} />;

  const list = months.data.months;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Archive</h1>
      <p className="mb-5 text-sm text-slate-600">
        Every published digest, by month. Open a month to revise it as one compendium.
      </p>

      {list.length === 0 ? (
        <EmptyState icon={IconLayers} text="Nothing has been published yet." />
      ) : (
        <div className="space-y-2">
          {list.map((m) => {
            const open = openMonth === m.month;
            return (
              <div key={m.month} className="rounded-lg border border-slate-200 bg-surface">
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => setOpenMonth(open ? null : m.month)}
                    aria-expanded={open}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <IconChevronRight
                      className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    <span className="font-semibold text-slate-900">{monthName(m.month)}</span>
                    <span className="text-xs text-slate-500">
                      {m.days} day{m.days === 1 ? '' : 's'} · {m.items} item{m.items === 1 ? '' : 's'}
                    </span>
                  </button>
                  <Link
                    to={`/month/${m.month}`}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Revise month
                  </Link>
                </div>

                {open ? (
                  <div className="border-t border-slate-200 p-3">
                    {days.loading ? (
                      <Loading label="Loading days…" />
                    ) : days.error ? (
                      <ErrorState error={days.error} onRetry={days.reload} compact />
                    ) : (
                      <ul className="grid gap-1.5 sm:grid-cols-2">
                        {days.data.days.map((d) => {
                          const done = d.item_count > 0 && d.read_count >= d.item_count;
                          return (
                            <li key={d.id}>
                              <Link
                                to={`/day/${d.date}`}
                                className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm hover:border-brand-300 hover:bg-slate-50"
                              >
                                <span className="font-medium text-slate-800">{shortDate(d.date)}</span>
                                <span className="text-xs text-slate-500">
                                  {d.item_count} item{d.item_count === 1 ? '' : 's'}
                                  {d.ap_count > 0 ? ` · ${d.ap_count} AP` : ''}
                                </span>
                                <span
                                  className={`ml-auto text-xs font-semibold ${
                                    done ? 'text-green-700' : 'text-slate-400'
                                  }`}
                                >
                                  {d.read_count}/{d.item_count}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
