import { useId, useState } from 'react';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { api } from '../api/client';
import { autoFormatMcqText } from '../lib/mcqFormat';
import Markdown from './Markdown';
import ReportMcq from './ReportMcq';

const LETTERS = ['a', 'b', 'c', 'd'];
const MCQ_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

export default function McqCard({ mcq, index, onAnswered }) {
  const questionId = useId();
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null); // { is_correct, correct_option, explanation }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(letter) {
    if (result || submitting) return;
    setSelected(letter);
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post(`/mcqs/${mcq.id}/attempt`, { selected_option: letter });
      setResult(res);
      onAnswered?.(res.is_correct);
    } catch (e) {
      setSelected(null);
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-surface">
      <div className="flex gap-1.5 mb-3">
        {index != null && <span className="text-slate-600 font-semibold shrink-0">Q{index + 1}.</span>}
        <div id={questionId} className="prose-mcq font-medium flex-1 min-w-0">
          <Markdown remarkPlugins={MCQ_REMARK_PLUGINS}>{autoFormatMcqText(mcq.question)}</Markdown>
        </div>
      </div>
      {/* Grouping the options under the question text means a screen reader
          announces what's being asked when focus first lands on option A,
          instead of reading four bare answers with no context. */}
      <div className="space-y-2" role="group" aria-labelledby={questionId}>
        {LETTERS.map((letter) => {
          const text = mcq[`option_${letter}`];
          const isSelected = selected === letter;
          const isCorrectAnswer = result && result.correct_option === letter;
          const isWrongSelected = result && isSelected && !result.is_correct;
          let cls = 'border-slate-200 hover:border-brand-300';
          if (result) {
            if (isCorrectAnswer) cls = 'border-green-500 bg-green-50';
            else if (isWrongSelected) cls = 'border-red-500 bg-red-50';
            // `opacity-60` dropped the muted letter to 2.9:1 against the card.
            // A flat slate fill de-emphasises these just as well and keeps
            // every option legible for re-reading after the answer.
            else cls = 'border-slate-200 bg-slate-50 text-slate-700';
          } else if (isSelected) {
            cls = 'border-brand-500 bg-brand-50';
          }
          // aria-disabled rather than disabled: once answered, the options
          // must stay focusable so the outcome can be reviewed by keyboard.
          const locked = !!result || submitting;
          return (
            <button
              key={letter}
              aria-disabled={locked}
              aria-pressed={isSelected}
              onClick={() => submit(letter)}
              className={`w-full text-left px-3 py-2 rounded-md border text-sm flex gap-2 ${cls} ${
                locked ? 'cursor-default' : ''
              }`}
            >
              <span className="uppercase font-semibold text-slate-600 shrink-0">{letter}</span>
              <span className="whitespace-pre-line">{text}</span>
              {result && (isCorrectAnswer || isWrongSelected) && (
                <span className="sr-only">
                  {isCorrectAnswer ? ' — correct answer' : ' — your answer, incorrect'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* role="status" so the verdict and explanation are announced the moment
          they arrive — previously an answer produced no audible feedback. */}
      {result && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm rounded-md px-3 py-2 ${
            result.is_correct ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          <p className="font-medium">{result.is_correct ? 'Correct!' : 'Not quite.'}</p>
          {result.explanation && (
            <div className="prose-mcq mt-1 text-slate-600">
              <Markdown remarkPlugins={MCQ_REMARK_PLUGINS}>{autoFormatMcqText(result.explanation)}</Markdown>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
      {/* Only offered once the answer is on screen — before that a student has
          no way to judge whether the question is actually wrong, and an
          always-visible report link invites noise. */}
      {result && (
        <div className="mt-3 flex justify-end">
          <ReportMcq mcqId={mcq.id} />
        </div>
      )}
    </div>
  );
}
