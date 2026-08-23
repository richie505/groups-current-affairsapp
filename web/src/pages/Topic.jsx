import { Link, useParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import RichText from '../components/RichText';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import { formatLabel } from '../lib/caFormat';

// The topic dossier.
//
// The one screen in this app that answers"is this worth my time?" — because it
// is the only place the two histories sit together:
//
//   NEWS HISTORY   what has appeared, and whether the item was ABOUT the topic
//                  or merely mentioned it
//   EXAM HISTORY   what the commission has actually asked, how often, and in
//                  which papers
//
// Either alone is misleading. A topic with eight news items and no exam history
// is a topic the newspapers care about and the examiner does not. A topic asked
// in four papers with nothing captured is the most expensive gap in the system.
// Neither is visible until they are on the same page.

export default function Topic() {
  const { slug } = useParams();
  const { data, error, loading, reload } = useResource(`/topics/${slug}`);

  if (loading) return <Loading label="Loading topic…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { topic, items, evidence, papers, related, units, formats } = data;
  const about = items.filter((i) => i.in_headline);
  const mentions = items.filter((i) => !i.in_headline);

  return (
    <div>
      <Link
        to="/topics"
        className="mb-3 inline-block text-sm text-brand-700 hover:underline"
      >
        ← All topics
      </Link>

      <header className="mb-5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">
            TIER {topic.tier}
          </span>
          {topic.ap ? (
            <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-800">
              ANDHRA PRADESH
            </span>
          ) : null}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase text-slate-600">
            {topic.kind}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{topic.name}</h1>
        {topic.summary ? (
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{topic.summary}</p>
        ) : null}
      </header>

      {/* The headline claim: how many papers this one topic pays across. */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-surface p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Serves {papers.length} paper{papers.length === 1 ? '' : 's'}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {papers.length ? (
            papers.map((p) => (
              <span
                key={p}
                className="rounded bg-brand-50 px-2 py-1 text-sm font-semibold text-brand-800"
              >
                {p}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-500">Not yet mapped to a paper.</span>
          )}
        </div>
        {units.length ? (
          <ul className="mt-3 space-y-0.5 text-xs text-slate-600">
            {units.slice(0, 8).map((u) => (
              <li key={u.unit_code}>
                <span className="font-mono font-semibold">{u.unit_code}</span>{' '}
                {u.label ? <span>— {u.label}</span> : null}{' '}
                <span className="text-slate-400">×{u.weight}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Exam history. Deliberately ABOVE the news, because it is the thing that
          decides whether the news is worth reading. */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          What has been asked
        </h2>
        {evidence.length ? (
          <ul className="space-y-1.5">
            {evidence.map((e, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-surface p-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold">
                    {e.paper || '—'}
                  </span>
                  {e.is_primary ? (
                    <span className="text-[11px] font-bold uppercase text-green-700">
                      study from here
                    </span>
                  ) : null}
                  <span className="text-xs text-slate-500">
                    {e.questions} question{e.questions === 1 ? '' : 's'}
                    {e.years ? ` · ${e.years}` : ''}
                  </span>
                </div>
                {e.evidence ? (
                  <p className="mt-1 text-slate-700">{e.evidence}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No recorded past questions. Either the commission has not asked it, or the papers that
            would show it have not been loaded — the two look identical here, so do not read this as
            evidence that it is unimportant.
          </p>
        )}

        {formats && formats.length ? (
          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              How it gets asked
            </h3>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
              {formats.map((f) => (
                <li key={f.format}>
                  {formatLabel(f.format)}
                  <span className="ml-1 text-slate-400">×{f.n}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* News history. */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Current affairs ({items.length})
        </h2>

        {!items.length ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Nothing captured on this topic yet.
            {topic.tier === 1
              ? ' It is Tier 1, so this is a gap worth closing rather than an absence to accept.'
              : ''}
          </p>
        ) : null}

        <ItemGroup title="About this topic" rows={about} />
        <ItemGroup title="Mentions it in passing" rows={mentions} muted />
      </section>

      {related && related.length ? (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Related topics
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {related.map((r) => (
              <li key={r.slug + r.relation}>
                <Link
                  to={`/topics/${r.slug}`}
                  className="inline-block rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:border-brand-400"
                >
                  {r.name}
                  <span className="ml-1 text-slate-400">{r.relation}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ItemGroup({ title, rows, muted }) {
  if (!rows.length) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-xs font-semibold text-slate-500">
        {title} ({rows.length})
      </h3>
      <ul className="space-y-1.5">
        {rows.map((it) => (
          <li key={it.id}>
            <Link
              to={`/item/${it.id}`}
              className={
                'block rounded-md border border-slate-200 bg-surface p-2.5 hover:border-brand-400 ' +
                (muted ? 'opacity-80' : '')
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{it.date}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase">
                  {it.bucket}
                </span>
              </div>
              <p className="mt-1 font-medium text-slate-900">{it.headline}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
