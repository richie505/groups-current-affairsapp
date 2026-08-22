import { useState } from 'react';
import useResource from '../../hooks/useResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { Chip } from '../../components/Badges';
import { IconRepeat } from '../../components/Icon';

// Pipeline run history.
//
// The discard count sits beside the drafted count deliberately. Most news
// should be discarded, so a run that drafted everything it found is a run that
// was not being ruthless enough — and that is only visible if both numbers are
// shown together. A high discard rate here is a sign of health, not waste.
export default function AdminRuns() {
  const { data, error, loading, reload } = useResource('/admin/runs');
  const [open, setOpen] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  if (!data.runs.length) {
    return (
      <div>
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Pipeline runs</h1>
        <EmptyState
          icon={IconRepeat}
          text="No runs recorded yet. The pipeline is run from the command line — see content-pipeline/ca-daily/README.md."
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Pipeline runs</h1>
      <p className="mb-5 text-sm text-slate-600">
        A high discard rate is healthy — most news should not become an item.
      </p>

      <div className="space-y-2">
        {data.runs.map((r) => {
          const isOpen = open === r.id;
          const discardRate = r.candidates ? Math.round((r.discarded / r.candidates) * 100) : null;
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-surface">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.id)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
              >
                <span className="font-semibold text-slate-900">
                  {r.window_start === r.window_end
                    ? r.window_start
                    : `${r.window_start} → ${r.window_end}`}
                </span>
                <Chip
                  className={
                    r.status === 'done'
                      ? 'border-green-300 bg-green-100 text-green-800'
                      : r.status === 'failed'
                        ? 'border-red-300 bg-red-100 text-red-800'
                        : 'border-slate-300 bg-slate-100 text-slate-700'
                  }
                >
                  {r.status}
                </Chip>
                <span className="text-xs text-slate-500">{r.mode}</span>
                <span className="ml-auto text-xs text-slate-600">
                  {r.candidates} found · {r.drafted} drafted · {r.discarded} discarded
                  {discardRate !== null ? ` (${discardRate}%)` : ''}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-slate-200 p-3">
                  <dl className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">Model</dt>
                      <dd className="font-mono text-slate-800">{r.model || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Started</dt>
                      <dd className="text-slate-800">{r.created_at}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Finished</dt>
                      <dd className="text-slate-800">{r.finished_at || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Approved since</dt>
                      <dd className="text-slate-800">{r.approved}</dd>
                    </div>
                  </dl>
                  {r.log ? (
                    <pre className="max-h-80 overflow-auto rounded-md bg-slate-100 p-2 text-xs leading-relaxed">
                      {r.log}
                    </pre>
                  ) : (
                    <p className="text-xs text-slate-500">No log recorded.</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
