import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { IconAlert, IconBook, IconLayers, IconTarget } from '../components/Icon';
import SyllabusMap from '../components/SyllabusMap';

// The topic map.
//
// Every other screen in this app is organised by DAY, which is the right shape
// for reading the news and the wrong shape for preparing an exam — the exam does
// not ask about a day, it asks about Polavaram. So this is the one screen that
// reads the other way: by the thing being asked about, with its news history and
// its exam history side by side.
//
// Three tabs, because there are three genuinely different questions:
//
//   Map    what is known, and about what
//   Reuse  which topics pay across three papers — study once, answer three times
//   Gaps   which recurring topics have nothing attached at all
//
// Gaps is the one that changes behaviour. A topic the commission returns to and
// about which this app holds nothing is the most expensive thing in the system,
// and it is completely invisible without a topic table to notice the absence.

const TABS = [
  // Syllabus first. The other three index by a vocabulary this project curated;
  // this one indexes by the document the candidate is actually examined on, and
  // it is the only tab that covers Group-II at all.
  { id: 'syllabus', label: 'Syllabus', icon: IconBook },
  { id: 'map', label: 'Map', icon: IconLayers },
  { id: 'reuse', label: 'Reuse map', icon: IconTarget },
  { id: 'gaps', label: 'Gaps', icon: IconAlert },
];

export default function Topics() {
  const [tab, setTab] = useState('syllabus');

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Topics</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The same knowledge, indexed by what the exam actually asks about rather than by the day
          it appeared — by the published syllabus, or by the topics the commission returns to.
        </p>
      </header>

      <nav className="mb-5 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ' +
              (tab === id
                ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'syllabus' ? <SyllabusMap /> : null}
      {tab === 'map' ? <Map /> : null}
      {tab === 'reuse' ? <Reuse /> : null}
      {tab === 'gaps' ? <Gaps /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Paper({ code }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      {code}
    </span>
  );
}

function TierBadge({ tier }) {
  const tone =
    tier === 1
      ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
      : tier === 2
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>T{tier}</span>;
}

function ApBadge() {
  return (
    <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-bold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
      AP
    </span>
  );
}

// ---------------------------------------------------------------------------

function Map() {
  const [q, setQ] = useState('');
  const [apOnly, setApOnly] = useState(false);
  const [tier, setTier] = useState('');

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (apOnly) params.set('ap', '1');
  if (tier) params.set('tier', tier);
  const qs = params.toString();

  const { data, error, loading, reload } = useResource(`/topics${qs ? `?${qs}` : ''}`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search topics and aliases — try APCRDA"
          className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">All tiers</option>
          <option value="1">Tier 1 only</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={apOnly} onChange={(e) => setApOnly(e.target.checked)} />
          Andhra Pradesh only
        </label>
      </div>

      {loading ? <Loading label="Loading topics…" /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      {data && !data.topics.length ? (
        <EmptyState title="No topics match" body="Try a different search, or clear the filters." />
      ) : null}

      {data && data.topics.length ? (
        <>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {data.topics.length} topic{data.topics.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1.5">
            {data.topics.map((t) => (
              <li key={t.slug}>
                <Link
                  to={`/topics/${t.slug}`}
                  className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TierBadge tier={t.tier} />
                    {t.ap ? <ApBadge /> : null}
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{t.name}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    {/* Reported separately because they are different claims: an
                        item ABOUT a topic is coverage, an item that merely
                        mentions it is not. */}
                    <span>
                      {t.about} about
                      {t.items > t.about ? ` · ${t.items - t.about} mentioning` : ''}
                    </span>
                    {t.pyq_questions ? <span>{t.pyq_questions} past question(s)</span> : null}
                    {t.papers.length ? (
                      <span className="flex items-center gap-1">
                        {t.papers.map((p) => (
                          <Paper key={p} code={p} />
                        ))}
                      </span>
                    ) : null}
                    {!t.items && !t.pyq_questions ? (
                      <span className="text-amber-700 dark:text-amber-400">nothing attached yet</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Reuse() {
  const { data, error, loading, reload } = useResource('/topics/reuse-map?minPapers=2');
  if (loading) return <Loading label="Building the reuse map…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.topics.length) {
    return <EmptyState title="No reuse recorded yet" body="Seed the Group-I blueprint to populate this." />;
  }

  const triple = data.topics.filter((t) => t.papers >= 3);
  const dbl = data.topics.filter((t) => t.papers === 2);

  return (
    <div>
      <p className="mb-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Study each of these <strong>once</strong>, from the paper marked “study from”, and tick it
        off in every paper listed. These {data.topics.length} clusters are why preparing by cluster
        beats preparing paper by paper.
      </p>

      <Group title={`Triple-payers — three or more papers (${triple.length})`} rows={triple} />
      <Group title={`Double-payers (${dbl.length})`} rows={dbl} />
    </div>
  );
}

function Group({ title, rows }) {
  if (!rows.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <ul className="space-y-1.5">
        {rows.map((t) => (
          <li key={t.slug}>
            <Link
              to={`/topics/${t.slug}`}
              className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <TierBadge tier={t.tier} />
                {t.ap ? <ApBadge /> : null}
                <span className="font-semibold text-slate-900 dark:text-slate-100">{t.name}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                {t.study_from ? (
                  <span>
                    study from <Paper code={t.study_from} />
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  answers
                  {t.paper_list.map((p) => (
                    <Paper key={p} code={p} />
                  ))}
                </span>
                <span>{t.questions} past question(s)</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Gaps() {
  const { data, error, loading, reload } = useResource('/topics/gaps');
  if (loading) return <Loading label="Finding gaps…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.gaps.length) {
    return <EmptyState title="No gaps" body="Every Tier-1 and Tier-2 topic has material attached." />;
  }

  const ap = data.gaps.filter((g) => g.ap);
  const rest = data.gaps.filter((g) => !g.ap);

  return (
    <div>
      <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
        {data.gaps.length} recurring topic{data.gaps.length === 1 ? '' : 's'} with{' '}
        <strong>no published material at all</strong>, {ap.length} of them Andhra Pradesh. A topic
        the commission returns to and about which you hold nothing is the most expensive gap you
        have — and the only way to see it is to look for the absence.
      </p>

      <GapList title={`Andhra Pradesh (${ap.length})`} rows={ap} />
      <GapList title={`National and general (${rest.length})`} rows={rest} />
    </div>
  );
}

function GapList({ title, rows }) {
  if (!rows.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((g) => (
          <li key={g.slug}>
            <Link
              to={`/topics/${g.slug}`}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800"
            >
              <TierBadge tier={g.tier} />
              <span className="flex-1 text-slate-800 dark:text-slate-200">{g.name}</span>
              {g.pyq_questions ? (
                <span className="text-xs text-slate-500">{g.pyq_questions}q</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
