import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import { api } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import LensToggle from '../components/LensToggle';
import QuizRunner from '../components/QuizRunner';
import QuizResults from '../components/QuizResults';
import { BUCKETS, monthName } from '../lib/caFormat';
import { IconLayers, IconHelpCircle } from '../components/Icon';

// A whole month as one compendium, plus a monthly test.
//
// This is the unit current affairs is actually revised in — nobody re-reads
// thirty separate days in November. Items are ordered by importance rather than
// by date, because the point of a monthly re-read is to catch what matters, not
// to relive the chronology.
const BUCKET_ORDER = ['ap', 'national', 'international', 'dynamic'];
const TEST_SIZE = 50;

export default function MonthRevision() {
  const { month } = useParams();
  const { data, error, loading, reload } = useResource(`/months/${month}`);
  const [quiz, setQuiz] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testError, setTestError] = useState(null);

  if (loading) return <Loading label="Compiling the month…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  async function startTest() {
    setBusy(true);
    setTestError(null);
    try {
      const res = await api.get(`/practice?scope=month&month=${month}&limit=${TEST_SIZE}`);
      if (!res.mcqs.length) {
        setTestError(
          new Error(
            res.locked > 0
              ? `All ${res.locked} questions for this month are still locked — mark the items read first.`
              : 'No questions have been written for this month yet.'
          )
        );
      } else {
        setQuiz(res);
      }
    } catch (e) {
      setTestError(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitPaper(submitted) {
    setBusy(true);
    const byId = new Map(quiz.mcqs.map((m) => [m.id, m]));
    const results = [];
    let correct = 0;
    let answered = 0;
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
    await api.post('/sessions', {
      scope: 'month',
      scope_ref: month,
      label: `${monthName(month)} monthly test`,
      total,
      answered,
      correct,
      timed: 0,
    });
    setResult({
      total,
      answered,
      skipped: total - answered,
      correct,
      accuracy: answered ? Math.round((correct / answered) * 100) : null,
      results,
      label: `${monthName(month)} monthly test`,
    });
    setQuiz(null);
    setBusy(false);
  }

  if (result) {
    return <QuizResults result={result} label={result.label} onRetake={() => setResult(null)} />;
  }

  if (quiz) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-600">
          {monthName(month)} monthly test · {quiz.mcqs.length} questions
        </p>
        <QuizRunner mcqs={quiz.mcqs} onSubmit={submitPaper} submitting={busy} />
      </div>
    );
  }

  const { items, mcq_total: mcqTotal } = data;
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: items.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length);
  const readCount = items.filter((i) => i.marked_read).length;

  return (
    <div>
      <Link to="/archive" className="mb-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        ← Archive
      </Link>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{monthName(month)}</h1>
        <LensToggle className="ml-auto" />
      </div>
      <p className="mb-4 text-sm text-slate-600">
        {items.length} item{items.length === 1 ? '' : 's'} · {readCount} read · {mcqTotal} question
        {mcqTotal === 1 ? '' : 's'} in the bank. Ordered by importance, not by date.
      </p>

      {mcqTotal > 0 ? (
        <div className="mb-5">
          {testError ? <ErrorState error={testError} compact /> : null}
          <button
            type="button"
            onClick={startTest}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <IconHelpCircle />
            {busy ? 'Building…' : `Monthly test (${Math.min(TEST_SIZE, mcqTotal)} questions)`}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon={IconLayers} text="Nothing was published in this month." />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ bucket, items: group }) => (
            <section key={bucket}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
                {BUCKETS[bucket].label}
                <span className="rounded-full bg-slate-200 px-1.5 text-xs font-semibold text-slate-700">
                  {group.length}
                </span>
              </h2>
              <div className="space-y-3">
                {group.map((item) => (
                  <ItemCard key={item.id} item={item} showDate />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
