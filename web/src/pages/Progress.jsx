import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import ActivityStrip from '../components/ActivityStrip';
import { BUCKETS } from '../lib/caFormat';
import { IconFlame } from '../components/Icon';

function Stat({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900',
    green: 'text-green-700',
    amber: 'text-amber-700',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export default function Progress() {
  const { data, error, loading, reload } = useResource('/progress');
  const sessions = useResource('/sessions');

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { totals, read, accuracy, buckets, weak_keywords: weak, daily, streak } = data;
  const apPct = totals.ap_items ? Math.round((read.ap / totals.ap_items) * 100) : null;

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-slate-900">Progress</h1>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Streak"
          value={`${streak} day${streak === 1 ? '' : 's'}`}
          sub={streak === 0 ? 'Read an item to start one' : 'Consecutive days reading'}
          tone={streak > 0 ? 'green' : 'slate'}
        />
        <Stat
          label="Items read"
          value={`${read.items}`}
          sub={`of ${totals.published_items} published`}
        />
        <Stat
          label="Accuracy"
          value={accuracy.pct === null ? '—' : `${accuracy.pct}%`}
          sub={accuracy.attempts ? `over ${accuracy.attempts} answers` : 'no answers yet'}
        />
        {/* AP coverage gets its own tile rather than being buried in the bucket
            table. It is roughly half of Papers II and IV, and it is the axis
            that quietly rots while national reading feels productive. */}
        <Stat
          label="AP coverage"
          value={apPct === null ? '—' : `${apPct}%`}
          sub={`${read.ap} of ${totals.ap_items} AP items`}
          tone={apPct !== null && apPct < 60 ? 'amber' : 'green'}
        />
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          Coverage by bucket
        </h2>
        <div className="space-y-2">
          {buckets.map((b) => {
            const pct = b.total ? Math.round((b.read / b.total) * 100) : 0;
            const meta = BUCKETS[b.bucket] || BUCKETS.national;
            return (
              <div key={b.bucket} className="rounded-lg border border-slate-200 bg-surface p-3">
                <div className="mb-1.5 flex items-baseline gap-2 text-sm">
                  <span className="font-semibold text-slate-800">{meta.label}</span>
                  <span className="ml-auto text-slate-600">
                    {b.read}/{b.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${b.bucket === 'ap' ? 'bg-amber-500' : 'bg-brand-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {weak.length ? (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-600">
            Weakest question angles
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Angles you have attempted at least three times, worst first. These are gaps in a habit
            of thought, not thirty unrelated facts.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Angle</th>
                  <th className="px-3 py-2">Right</th>
                  <th className="px-3 py-2">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {weak.map((k) => {
                  const pct = Math.round((k.correct / k.attempts) * 100);
                  return (
                    <tr key={k.keyword} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-800">{k.keyword}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {k.correct}/{k.attempts}
                      </td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          pct < 50 ? 'text-red-700' : pct < 75 ? 'text-amber-700' : 'text-green-700'
                        }`}
                      >
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          <IconFlame /> Reading activity
        </h2>
        <ActivityStrip daily={daily} />
      </section>

      {sessions.data?.sessions?.length ? (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Recent papers
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.sessions.slice(0, 15).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-800">
                      {s.label || s.scope}
                      {s.timed ? <span className="ml-1 text-xs text-slate-500">(timed)</span> : null}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {s.correct}/{s.total}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{s.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
