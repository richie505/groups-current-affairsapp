import { Link } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import { IconAlert, IconList } from '../../components/Icon';

function Tile({ label, value, to, tone = 'slate', sub }) {
  const tones = {
    slate: 'text-slate-900',
    amber: 'text-amber-700',
    red: 'text-red-700',
    green: 'text-green-700',
  };
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </>
  );
  const cls = 'rounded-lg border border-slate-200 bg-surface p-4';
  return to ? (
    <Link to={to} className={`${cls} hover:border-brand-300`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useResource('/admin/overview');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const c = data.counts;

  // The three counts that mean something is wrong, rather than merely small.
  // Kept above the neutral stats because an unsourced published item is a
  // problem, whereas 40 published items is just a number.
  const problems = [
    c.draft_items > 0 && {
      label: `${c.draft_items} item${c.draft_items === 1 ? '' : 's'} awaiting review`,
      to: '/admin/queue',
      icon: IconList,
      tone: 'amber',
    },
    // Above the unsourced count deliberately. An unreviewed item shows a student
    // nothing; unreviewed questions sit on an item that is already live, whose
    // question count is visibly short until someone acts.
    c.pending_mcqs > 0 && {
      label:
        `${c.pending_mcqs} question${c.pending_mcqs === 1 ? '' : 's'} waiting on review` +
        `${c.pending_mcq_items ? ` on ${c.pending_mcq_items} published item${c.pending_mcq_items === 1 ? '' : 's'}` : ''}`,
      detail: 'The items are live; these questions are held back until they are approved.',
      to: '/admin/queue',
      icon: IconList,
      tone: 'amber',
    },
    c.unsourced > 0 && {
      label: `${c.unsourced} item${c.unsourced === 1 ? '' : 's'} with no source`,
      detail: 'Publishing one of these is how an unverifiable claim gets into the bank.',
      to: '/admin/queue',
      icon: IconAlert,
      tone: 'red',
    },
    c.needs_verify > 0 && {
      label: `${c.needs_verify} item${c.needs_verify === 1 ? '' : 's'} marked "needs verify"`,
      detail: 'A figure or name that could not be confirmed at a second source.',
      to: '/admin/queue',
      icon: IconAlert,
      tone: 'amber',
    },
    c.no_mcqs > 0 && {
      label: `${c.no_mcqs} published item${c.no_mcqs === 1 ? '' : 's'} with no questions`,
      detail: 'The Group-II lane exists but has nothing to practise against.',
      to: '/admin/days',
      icon: IconAlert,
      tone: 'amber',
    },
  ].filter(Boolean);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-slate-900">Admin</h1>

      {problems.length ? (
        <section className="mb-6 space-y-2">
          {problems.map((p) => (
            <Link
              key={p.label}
              to={p.to}
              className={`flex items-start gap-3 rounded-lg border p-3 hover:bg-slate-50 ${
                p.tone === 'red' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
              }`}
            >
              <p.icon
                className={`mt-0.5 text-lg ${p.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{p.label}</span>
                {p.detail ? (
                  <span className="block text-xs text-slate-600">{p.detail}</span>
                ) : null}
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <p className="mb-6 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Nothing needs attention — no drafts waiting, everything sourced, no open reports.
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Published digests" value={c.published_days} to="/admin/days" />
        <Tile label="Published items" value={c.published_items} to="/admin/days" />
        <Tile label="Questions" value={c.mcqs} />
        <Tile label="Students" value={c.students} to="/admin/students" />
        {/* Discards are shown as a *positive* count, not hidden. Most news
            should be discarded — a pipeline that discards nothing is not being
            ruthless enough, and this is the number that reveals it. */}
        <Tile
          label="Discarded"
          value={c.discarded_items}
          sub="Most news should be discarded"
          tone="green"
        />
        <Tile label="Draft digests" value={c.draft_days} to="/admin/queue" />
      </div>

    </div>
  );
}
