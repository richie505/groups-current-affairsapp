import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import McqCard from '../components/McqCard';
import { FormatBadge, Chip } from '../components/Badges';
import { shortDate } from '../lib/caFormat';
import { IconCheck, IconChevronRight } from '../components/Icon';

// Mistakes grouped by keyword angle, not listed flat.
//
// A flat list tells the student only that they got things wrong. Grouped by
// angle it tells them something actionable: consistently missing "Appointed"
// questions is a specific, fixable gap, and it is usually one gap rather than
// thirty unrelated errors.
export default function Mistakes() {
  const { data, error, loading, reload } = useResource('/mistakes');
  const [open, setOpen] = useState(null);

  if (loading) return <Loading label="Working out what is going wrong…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  if (data.total === 0) {
    return (
      <div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Mistakes</h1>
        <EmptyState
          icon={IconCheck}
          text="Nothing wrong on your latest attempt at any question. Answer some practice and anything you miss will collect here, grouped by the angle it tests."
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Mistakes</h1>
      <p className="mb-5 text-sm text-slate-600">
        {data.total} question{data.total === 1 ? '' : 's'} you last answered wrong, grouped by the
        question angle they test. The angle at the top is where the marks are going.
      </p>

      <div className="space-y-2">
        {data.groups.map((g) => {
          const isOpen = open === g.keyword;
          return (
            <div key={g.keyword} className="rounded-lg border border-slate-200 bg-surface">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.keyword)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 p-3 text-left"
              >
                <IconChevronRight
                  className={`text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="font-semibold text-slate-900">{g.keyword}</span>
                <Chip className="ml-auto border-red-300 bg-red-100 text-red-800">
                  {g.count} wrong
                </Chip>
              </button>

              {isOpen ? (
                <div className="space-y-3 border-t border-slate-200 p-3">
                  {g.mcqs.map((mcq, i) => (
                    <div key={mcq.id}>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <FormatBadge format={mcq.format} />
                        <Link to={`/item/${mcq.item_id}`} className="hover:underline">
                          {mcq.headline}
                        </Link>
                        <span>· {shortDate(mcq.day_date)}</span>
                        <span className="text-red-700">
                          · you answered {mcq.selected_option?.toUpperCase()}
                        </span>
                      </div>
                      {/* Re-attemptable rather than shown with the key exposed:
                          seeing the right answer again is not the same as being
                          able to produce it, and the second attempt also moves
                          the Leitner box. */}
                      <McqCard mcq={mcq} index={i} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
