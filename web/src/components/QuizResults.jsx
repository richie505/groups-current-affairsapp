import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { autoFormatMcqText } from '../lib/mcqFormat';
import Markdown from './Markdown';
import { IconCheck, IconX, IconRepeat } from './Icon';

// The score, then the whole paper marked up. Reviewing what you got wrong is
// the part that actually teaches, so it's on the same screen rather than
// behind another click.

const LETTERS = ['a', 'b', 'c', 'd'];
const PLUGINS = [remarkGfm, remarkBreaks];

export default function QuizResults({ result, onRetake, label }) {
  const { total, answered, skipped, correct, accuracy, results } = result;
  const wrong = results.filter((r) => !r.skipped && !r.is_correct);

  return (
    <div>
      <div className="mb-6 rounded-xl border border-slate-200 bg-surface p-5">
        <p className="text-sm text-slate-500">{label ? `${label} — result` : 'Result'}</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">
          {correct}
          <span className="text-xl font-semibold text-slate-500">/{total}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {accuracy === null
            ? 'Nothing answered.'
            : `${accuracy}% of the ${answered} you answered`}
          {skipped > 0 && ` · ${skipped} left blank`}
        </p>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-500" style={{ width: `${total ? (correct / total) * 100 : 0}%` }} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetake}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <IconRepeat /> New paper
          </button>
          {wrong.length > 0 && (
            <Link
              to="/mistakes"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              Review all my mistakes
            </Link>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Review</h2>
      <ol className="space-y-3">
        {results.map((r, i) => (
          <li key={r.mcq_id} className="rounded-lg border border-slate-200 bg-surface p-4">
            <div className="mb-2 flex items-start gap-2">
              <span className="shrink-0 font-semibold text-slate-600">Q{i + 1}.</span>
              <div className="prose-mcq min-w-0 flex-1 font-medium">
                <Markdown remarkPlugins={PLUGINS}>{autoFormatMcqText(r.question)}</Markdown>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                  r.skipped
                    ? 'bg-slate-100 text-slate-700'
                    : r.is_correct
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                {r.skipped ? 'Blank' : r.is_correct ? 'Correct' : 'Wrong'}
              </span>
            </div>

            <div className="space-y-1.5">
              {LETTERS.map((letter) => {
                const isKey = r.correct_option === letter;
                const isMine = r.selected_option === letter;
                let cls = 'border-slate-200 bg-slate-50 text-slate-700';
                if (isKey) cls = 'border-green-500 bg-green-50 text-slate-900';
                else if (isMine) cls = 'border-red-500 bg-red-50 text-slate-900';
                return (
                  <div key={letter} className={`flex gap-2 rounded-md border px-3 py-1.5 text-sm ${cls}`}>
                    <span className="shrink-0 font-semibold uppercase text-slate-600">{letter}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-line">{r[`option_${letter}`]}</span>
                    {isKey && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-700">
                        <IconCheck /> Answer
                      </span>
                    )}
                    {isMine && !isKey && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-red-700">
                        <IconX /> You
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {r.explanation && (
              <div className="prose-mcq mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <Markdown remarkPlugins={PLUGINS}>{autoFormatMcqText(r.explanation)}</Markdown>
              </div>
            )}

            {/* Stating when the key was true is not decoration here: a
                current-affairs answer can be superseded between the day it was
                written and the day it is revised, and the student needs to know
                which of those they are looking at. */}
            {r.fact_as_of && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Key correct as of {r.fact_as_of} — time-sensitive.
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-3">
              <Link to={`/item/${r.item_id}`} className="truncate text-xs text-brand-700 hover:underline">
                Back to the item: {r.headline}
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
