import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import RichText from '../RichText';
import { Chip, UnitBadge } from '../Badges';
import { formatLabel } from '../../lib/caFormat';
import { IconCheck, IconTrash } from '../Icon';

// QUESTIONS WAITING ON REVIEW — a second queue, for a case the first one cannot
// see.
//
// The review queue above lists DRAFT ITEMS, which was the whole story while
// questions only ever arrived attached to the item carrying them. It stopped
// being the whole story when questions became regenerable on their own:
// re-tagging the bank to the APPSC syllabus rewrites the questions on items that
// are already published and already reviewed.
//
// Those items are not drafts, so they will never appear in a queue filtered on
// item status — and their new questions are unreviewed content on a live item,
// which is exactly the thing this project has said from the start must not
// happen. They are held back by ca_mcqs.status and surfaced here.
//
// The unit of approval is the ITEM's set, not the individual question, because
// the regeneration replaces an item's whole list at once. Per-question edits
// stay available through the item editor, linked from each card.
export default function QuestionReview({ items, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  if (!items || !items.length) return null;

  const totalPending = items.reduce((n, it) => n + it.pending, 0);
  // Live items with NOTHING to practise against. A different and sharper
  // urgency than the rest of this queue: a student can open one of these right
  // now and find an empty question list. It happened because the first version
  // of the regeneration deleted the old questions at write time instead of at
  // approval time.
  const starved = items.filter((it) => !it.live);

  async function actAll() {
    const ok = window.confirm(
      [
        `Approve all ${totalPending} questions across ${items.length} items?`,
        '',
        'Each item’s old questions are replaced by its new ones in the same step.',
        'Questions a student has already answered are kept.',
      ].join('\n')
    );
    if (!ok) return;
    setBusy('all');
    setError('');
    try {
      await api.post('/admin/mcqs/publish-all', {});
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function act(itemId, verb) {
    if (verb === 'discard') {
      const ok = window.confirm(
        'Discard these questions? They are deleted, not hidden — the item keeps the ' +
          'questions it already had.'
      );
      if (!ok) return;
    }
    setBusy(itemId);
    setError('');
    try {
      await api.post(`/admin/items/${itemId}/mcqs/${verb}`, {});
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-8 rounded-lg border border-amber-300 bg-amber-50/60 p-4">
      <h2 className="font-bold text-slate-900">Questions waiting on review</h2>
      <p className="mt-1 text-sm text-slate-700">
        {totalPending} question{totalPending === 1 ? '' : 's'} on {items.length} already-published
        item{items.length === 1 ? '' : 's'}. The notes are live; these questions are not, and no
        student can see them until they are approved here.
      </p>
      {starved.length ? (
        <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>
            {starved.length} of these item{starved.length === 1 ? ' is' : 's are'} live with no
            questions at all
          </strong>{' '}
          while these wait. A student can read {starved.length === 1 ? 'it' : 'them'} and has
          nothing to practise against.
        </p>
      ) : null}
      {/* A bulk approve is normally the wrong shape for a review screen — it is
          a button that says "I did not read these". It earns its place because
          the regeneration is ONE mechanical change applied uniformly across
          every item, and making a reviewer click thirty times to act on a
          judgement they formed after five is how the fifth stops being read. */}
      <button
        type="button"
        disabled={busy === 'all'}
        onClick={() => actAll()}
        className="mt-3 inline-flex items-center gap-1 rounded-md bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
      >
        <IconCheck className="h-4 w-4" />
        Approve all {totalPending}
      </button>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {items.map((it) => (
          <article key={it.id} className="rounded-md border border-slate-200 bg-white p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {/* The item editor is reached through its DAY — there is no
                    per-item route — and the hash is what the editor scrolls to.
                    A link to /admin/items/:id looks right and lands on the
                    404 page. */}
                <Link
                  to={`/admin/days/${it.day_id}#item-${it.id}`}
                  className="font-semibold text-slate-900 hover:underline"
                >
                  <RichText>{it.headline}</RichText>
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {it.day_date} ·{' '}
                  {it.live ? (
                    `${it.live} live question${it.live === 1 ? '' : 's'}`
                  ) : (
                    <span className="font-semibold text-red-700">no live questions</span>
                  )}{' '}
                  · {it.pending} waiting
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => act(it.id, 'publish')}
                  className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <IconCheck className="h-3.5 w-3.5" />
                  Approve {it.pending}
                </button>
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => act(it.id, 'discard')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  Discard
                </button>
              </div>
            </header>

            <ol className="mt-3 space-y-3">
              {it.mcqs.map((m, i) => (
                <li key={m.id} className="border-t border-slate-100 pt-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                    <Chip className="border-slate-300 bg-slate-100 text-slate-700">
                      {formatLabel(m.format)}
                    </Chip>
                    {/* The unit is the point of the exercise, so a question that
                        came back without one is shown as missing rather than
                        left blank — a blank reads as "not applicable". */}
                    {m.unit_code ? (
                      <UnitBadge unit={m.unit_code} />
                    ) : (
                      <Chip className="border-amber-300 bg-amber-100 text-amber-800">
                        no syllabus unit
                      </Chip>
                    )}
                  </div>
                  <p className="font-medium text-slate-900">
                    <RichText>{m.question}</RichText>
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {['a', 'b', 'c', 'd'].map((k) => (
                      <li
                        key={k}
                        className={
                          m.correct_option === k
                            ? 'font-semibold text-green-800'
                            : 'text-slate-600'
                        }
                      >
                        <span className="font-mono text-xs">({k})</span>{' '}
                        <RichText>{m[`option_${k}`]}</RichText>
                        {m.correct_option === k ? ' ✓' : ''}
                      </li>
                    ))}
                  </ul>
                  {m.explanation ? (
                    <p className="mt-1 text-xs text-slate-600">
                      <RichText>{m.explanation}</RichText>
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
