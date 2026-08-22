import { useEffect, useMemo, useRef, useState } from 'react';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { autoFormatMcqText } from '../lib/mcqFormat';
import Markdown from './Markdown';
import { IconChevronLeft, IconChevronRight, IconAlert } from './Icon';

// One question at a time, answers held back until submit.
//
// Deliberately not McqCard: that card grades on tap and shows the key
// immediately, which is right for reading notes and wrong for a test. Here
// nothing is revealed until the paper is submitted, so the student's own
// judgement is what's being measured.

const LETTERS = ['a', 'b', 'c', 'd'];
const PLUGINS = [remarkGfm, remarkBreaks];

function formatClock(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function QuizRunner({
  mcqs,
  durationSeconds,
  onSubmit,
  submitting,
  error,
  initialAnswers,
  initialCurrent = 0,
  onProgress,
}) {
  const [current, setCurrent] = useState(initialCurrent);
  const [answers, setAnswers] = useState(initialAnswers || {}); // { [mcqId]: 'a' }
  const [remaining, setRemaining] = useState(durationSeconds ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const headingRef = useRef(null);

  // A ref alongside the state so the timer's one-shot auto-submit reads the
  // answers as they are at expiry — the interval closure would otherwise
  // capture whatever the map held when it was created.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submittedRef = useRef(false);

  const total = mcqs.length;
  // Counted over values, not keys. Clearing an answer leaves the key in place
  // holding undefined, so counting keys reported questions as answered after
  // the student had explicitly un-answered them — inflating the progress bar
  // and hiding the "still unanswered" warning on submit.
  const answeredCount = Object.values(answers).filter((v) => v != null).length;
  const mcq = mcqs[current];

  // Hand the current state up after every change so it can be persisted. A
  // paper lives entirely in memory otherwise, and a reclaimed tab takes the
  // whole attempt with it.
  useEffect(() => {
    onProgress?.({ answers, current });
  }, [answers, current, onProgress]);

  const submitPaper = useMemo(
    () => () => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      onSubmit(
        mcqs.map((m) => ({ mcq_id: m.id, selected_option: answersRef.current[m.id] ?? null }))
      );
    },
    [mcqs, onSubmit]
  );

  // Time's up submits whatever is filled in. A timed paper that simply froze
  // and threw the work away would be worse than useless.
  useEffect(() => {
    if (durationSeconds == null) return undefined;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return null;
        if (r <= 1) {
          clearInterval(id);
          submitPaper();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [durationSeconds, submitPaper]);

  // Moving between questions has to announce the move for anyone not watching
  // the screen — without this the page silently swaps its contents.
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const lowTime = remaining !== null && remaining <= 60;

  function pick(letter) {
    setAnswers((a) => ({ ...a, [mcq.id]: a[mcq.id] === letter ? undefined : letter }));
  }

  return (
    <div>
      {/* Status strip: position, how many answered, and the clock. */}
      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Question <span className="font-semibold text-slate-900">{current + 1}</span> of {total}
            <span className="hidden sm:inline"> · {answeredCount} answered</span>
          </p>
          {remaining !== null && (
            <p
              role="timer"
              aria-live="off"
              className={`rounded-md px-2 py-1 font-mono text-sm font-semibold tabular-nums ${
                lowTime ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-800'
              }`}
            >
              <span className="sr-only">Time remaining </span>
              {formatClock(remaining)}
            </p>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-brand-500 transition-[width]"
            style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Jump grid — answered questions are filled, so it doubles as a
          review-before-submit checklist. */}
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Jump to question">
        {mcqs.map((m, i) => {
          const done = answers[m.id] != null;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={`Question ${i + 1}${done ? ', answered' : ', not answered'}${i === current ? ', current' : ''}`}
              aria-current={i === current ? 'true' : undefined}
              className={`h-8 w-8 rounded-md border text-xs font-semibold ${
                i === current
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : done
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-surface text-slate-600 hover:border-slate-400'
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-surface p-4">
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          Question {current + 1} of {total}
        </h2>
        <div className="prose-mcq mb-3 font-medium">
          <Markdown remarkPlugins={PLUGINS}>{autoFormatMcqText(mcq.question)}</Markdown>
        </div>

        <div className="space-y-2" role="group" aria-label={`Options for question ${current + 1}`}>
          {LETTERS.map((letter) => {
            const chosen = answers[mcq.id] === letter;
            return (
              <button
                key={letter}
                type="button"
                onClick={() => pick(letter)}
                aria-pressed={chosen}
                className={`flex w-full gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                  chosen ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-300'
                }`}
              >
                <span className="shrink-0 font-semibold uppercase text-slate-600">{letter}</span>
                <span className="whitespace-pre-line">{mcq[`option_${letter}`]}</span>
              </button>
            );
          })}
        </div>

        {answers[mcq.id] != null && (
          <button
            type="button"
            onClick={() => setAnswers((a) => ({ ...a, [mcq.id]: undefined }))}
            className="mt-2 text-xs text-slate-600 hover:underline"
          >
            Clear this answer
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCurrent((i) => Math.max(0, i - 1))}
          disabled={current === 0}
          className="flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
        >
          <IconChevronLeft /> Previous
        </button>

        {current < total - 1 ? (
          <button
            type="button"
            onClick={() => setCurrent((i) => Math.min(total - 1, i + 1))}
            className="flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200"
          >
            Next <IconChevronRight />
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => (answeredCount < total ? setConfirmOpen(true) : submitPaper())}
          disabled={submitting || answeredCount === 0}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit paper'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Submitting with blanks is allowed, but not by accident. */}
      {confirmOpen && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="flex items-start gap-1.5 text-sm text-amber-900">
            <IconAlert className="mt-0.5 shrink-0" />
            {total - answeredCount} question{total - answeredCount === 1 ? '' : 's'} still unanswered. Submit anyway?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); submitPaper(); }}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
            >
              Submit anyway
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Keep going
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
