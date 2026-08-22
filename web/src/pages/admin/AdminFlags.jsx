import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import Markdown from '../../components/Markdown';
import { autoFormatMcqText } from '../../lib/mcqFormat';
import { Chip, FormatBadge } from '../../components/Badges';
import { shortDate } from '../../lib/caFormat';
import { IconCheck, IconX } from '../../components/Icon';

const REASON_LABELS = {
  wrong_answer: 'Marked answer is wrong',
  outdated: 'Superseded by a later development',
  unclear: 'Unclear or ambiguous',
  typo: 'Typo or formatting',
  not_in_notes: 'Not covered in the notes',
  other: 'Something else',
};

const TABS = ['open', 'resolved', 'dismissed'];

// Student reports on questions.
//
// Most of the bank is generated rather than hand-written, so the people best
// placed to catch a wrong key are the students hitting it. The "outdated"
// reason is the one specific to this app: a question can have been perfectly
// correct when written and be wrong three months later, and the student who
// has just read the newer position is the first to know.
export default function AdminFlags() {
  const [tab, setTab] = useState('open');
  const { data, error, loading, reload } = useResource(`/admin/flags?status=${tab}`);
  const [busy, setBusy] = useState(null);

  async function setStatus(id, status) {
    setBusy(id);
    try {
      await api.put(`/admin/flags/${id}`, { status });
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold text-slate-900">Reported questions</h1>

      <div className="mb-4 inline-flex rounded-lg border border-slate-300 bg-surface p-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm font-semibold capitalize ${
              tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? <Loading /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      {data && data.flags.length === 0 ? (
        <EmptyState icon={IconCheck} text={`No ${tab} reports.`} />
      ) : null}

      <div className="space-y-3">
        {data?.flags.map((f) => (
          <article key={f.id} className="rounded-lg border border-slate-200 bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Chip
                className={
                  f.reason === 'wrong_answer' || f.reason === 'outdated'
                    ? 'border-red-300 bg-red-100 text-red-800'
                    : 'border-slate-300 bg-slate-100 text-slate-700'
                }
              >
                {REASON_LABELS[f.reason] || f.reason}
              </Chip>
              <FormatBadge format={f.format} />
              {f.fact_as_of ? (
                <Chip className="border-slate-300 bg-slate-100 text-slate-600">
                  key as of {shortDate(f.fact_as_of)}
                </Chip>
              ) : null}
              <span className="ml-auto text-xs text-slate-500">
                {f.student_name} · {f.created_at?.slice(0, 10)}
              </span>
            </div>

            {f.note ? (
              <p className="mb-2 rounded-md bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700">
                “{f.note}”
              </p>
            ) : null}

            <div className="prose-mcq mb-2 text-sm font-medium">
              <Markdown>{autoFormatMcqText(f.question)}</Markdown>
            </div>
            <ul className="mb-2 space-y-0.5 text-xs">
              {['a', 'b', 'c', 'd'].map((l) => (
                <li
                  key={l}
                  className={f.correct_option === l ? 'font-semibold text-green-700' : 'text-slate-600'}
                >
                  {l.toUpperCase()}. {f[`option_${l}`]}
                </li>
              ))}
            </ul>
            {f.explanation ? (
              <p className="mb-2 text-xs text-slate-600">{f.explanation}</p>
            ) : null}

            <p className="mb-2 text-xs text-slate-500">
              From{' '}
              <Link to={`/item/${f.item_id}`} className="text-brand-700 hover:underline">
                {f.headline}
              </Link>{' '}
              · {shortDate(f.day_date)}
            </p>

            {tab === 'open' ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStatus(f.id, 'resolved')}
                  disabled={busy === f.id}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  <IconCheck /> Fixed
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(f.id, 'dismissed')}
                  disabled={busy === f.id}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <IconX /> Not a problem
                </button>
                <Link
                  to={`/admin/days`}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit the question
                </Link>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setStatus(f.id, 'open')}
                disabled={busy === f.id}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Reopen
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
