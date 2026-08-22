import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import QuizRunner from '../components/QuizRunner';
import QuizResults from '../components/QuizResults';
import { FORMATS, BUCKETS, monthName, todayIso } from '../lib/caFormat';
import { IconHelpCircle } from '../components/Icon';

// Practice is scoped by *window* first, because that is how current affairs is
// actually revised: "this week", "last month", "everything since the last
// mock". Topic filters are secondary here, which is the opposite of a
// static-subject practice screen.
const WINDOWS = [
  { key: 'week', label: 'Last 7 days' },
  { key: 'fortnight', label: 'Last 14 days' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'Last 90 days' },
  { key: 'all', label: 'Everything' },
];

const SIZES = [10, 20, 30, 50, 100];

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function windowParams(key) {
  if (key === 'week') return { from: isoDaysAgo(7), to: todayIso() };
  if (key === 'fortnight') return { from: isoDaysAgo(14), to: todayIso() };
  if (key === 'month') return { scope: 'month', month: todayIso().slice(0, 7) };
  if (key === 'quarter') return { from: isoDaysAgo(90), to: todayIso() };
  return {};
}

export default function Practice() {
  const meta = useResource('/meta');
  const [win, setWin] = useState('week');
  const [bucket, setBucket] = useState('');
  const [keyword, setKeyword] = useState('');
  const [size, setSize] = useState(20);
  const [timed, setTimed] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const [quiz, setQuiz] = useState(null);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setLoadError(null);
    setResult(null);
    try {
      const p = new URLSearchParams();
      const w = windowParams(win);
      Object.entries(w).forEach(([k, v]) => p.set(k, v));
      if (!w.scope) p.set('scope', 'range');
      if (bucket) p.set('bucket', bucket);
      if (keyword) p.set('keyword', keyword);
      if (onlyUnread) p.set('only_unread', '1');
      p.set('limit', String(size));
      const res = await api.get(`/practice?${p.toString()}`);
      if (!res.mcqs.length) {
        setLoadError(
          new Error(
            res.locked > 0
              ? `No questions are open in that window yet — ${res.locked} are waiting behind items you have not marked read.`
              : 'No questions match that window yet.'
          )
        );
      } else {
        setQuiz(res);
      }
    } catch (e) {
      setLoadError(e);
    } finally {
      setBusy(false);
    }
  }

  // QuizRunner hands back [{ mcq_id, selected_option }] for every question,
  // including the blanks.
  const submitPaper = useCallback(
    async (submitted) => {
      setBusy(true);
      const byId = new Map(quiz.mcqs.map((m) => [m.id, m]));
      const results = [];
      let correct = 0;
      let answered = 0;

      // Each answer is posted individually rather than as one batch, so a paper
      // feeds the revision cycle and the mistakes list exactly like a question
      // answered while reading. A paper that scored in isolation would leave
      // the Leitner boxes untouched by the student's most deliberate practice.
      for (const { mcq_id, selected_option } of submitted) {
        const mcq = byId.get(mcq_id);
        if (!selected_option) {
          results.push({ ...mcq, mcq_id, selected_option: null, skipped: true, is_correct: false });
          continue;
        }
        answered++;
        const res = await api.post(`/mcqs/${mcq_id}/attempt`, { selected_option });
        if (res.is_correct) correct++;
        results.push({
          ...mcq,
          mcq_id,
          selected_option,
          skipped: false,
          is_correct: !!res.is_correct,
          correct_option: res.correct_option,
          explanation: res.explanation,
        });
      }

      const total = submitted.length;
      const durationSeconds = timed ? total * 60 : null;
      await api.post('/sessions', {
        scope: quiz.scope,
        scope_ref: quiz.label,
        label: quiz.label,
        total,
        answered,
        correct,
        timed: timed ? 1 : 0,
        duration_seconds: durationSeconds,
      });

      setResult({
        total,
        answered,
        skipped: total - answered,
        correct,
        accuracy: answered ? Math.round((correct / answered) * 100) : null,
        results,
        label: quiz.label,
      });
      setQuiz(null);
      setBusy(false);
    },
    [quiz, timed]
  );

  if (meta.loading) return <Loading />;

  if (result) {
    return <QuizResults result={result} label={result.label} onRetake={() => setResult(null)} />;
  }

  if (quiz) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-600">
          {quiz.mcqs.length} questions · {quiz.label}
          {quiz.locked > 0 ? ` · ${quiz.locked} more locked behind unread items` : ''}
        </p>
        <QuizRunner
          mcqs={quiz.mcqs}
          durationSeconds={timed ? quiz.mcqs.length * 60 : undefined}
          onSubmit={submitPaper}
          submitting={busy}
        />
      </div>
    );
  }

  const keywordOptions = meta.data.keywords.filter((k) => k.subject === 'Current Affairs');

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Practice</h1>
      <p className="mb-5 text-sm text-slate-600">
        Questions are drawn only from items you have marked read, and the paper is mixed across the
        eight formats the real exam uses — not served as one long run of plain recall.
      </p>

      {loadError ? <ErrorState error={loadError} compact /> : null}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-slate-700">Window</legend>
          <div className="flex flex-wrap gap-1.5">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWin(w.key)}
                className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
                  win === w.key
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {w.label}
                {w.key === 'month' ? ` (${monthName(todayIso().slice(0, 7))})` : ''}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Bucket</span>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">All buckets</option>
              {Object.entries(BUCKETS).map(([key, b]) => (
                <option key={key} value={key}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Question angle</span>
            <select
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">All angles</option>
              {keywordOptions.map((k) => (
                <option key={k.keyword} value={k.keyword}>
                  {k.keyword}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-slate-700">Length</legend>
          <div className="flex flex-wrap gap-1.5">
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSize(n)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  size === n
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
            Timed — one minute per question
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(e) => setOnlyUnread(e.target.checked)}
            />
            Only questions I have never attempted
          </label>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <IconHelpCircle />
          {busy ? 'Building the paper…' : 'Start'}
        </button>
      </div>

      <details className="mt-4 rounded-lg border border-slate-200 bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-800">
          The eight formats you will meet
        </summary>
        <ul className="mt-2 space-y-1 text-slate-600">
          {Object.entries(FORMATS).map(([key, label]) => (
            <li key={key}>
              <span className="font-medium text-slate-800">{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Assertion–Reason, list-matching and incorrect-statement questions are heavily favoured by
          the real paper, so they are deliberately mixed in rather than saved for later.
        </p>
      </details>
    </div>
  );
}
