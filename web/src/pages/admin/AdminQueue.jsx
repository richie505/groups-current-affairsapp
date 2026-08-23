import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import Markdown from '../../components/Markdown';
import RichText from '../../components/RichText';
import QuestionReview from '../../components/admin/QuestionReview';
import {
  BucketBadge, ImportanceBadge, KeywordBadge, UnitBadge, BankBadge, GenreBadge, Chip,
} from '../../components/Badges';
import { longDate } from '../../lib/caFormat';
import { IconCheck, IconTrash, IconAlert, IconList, IconPencil } from '../../components/Icon';

// The review queue — the gate everything passes through before a student sees
// it.
//
// The design principle here is that the review that matters is "is this true,
// and is it sourced". So the sources are on the card with the text, not behind a
// click: making the admin navigate away to check a URL is how the checking
// quietly stops happening.
export default function AdminQueue() {
  const { data, error, loading, reload } = useResource('/admin/queue');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  // Content shown, not hidden. A reviewer is here to read the item and decide;
  // a queue that shows only headlines makes them click every card to do the one
  // job the screen exists for. The toggle stays for when the day is long.
  const [expandAll, setExpandAll] = useState(true);

  if (loading) return <Loading label="Loading the queue…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  // A redraft of an item that is STILL LIVE has to answer one extra question
  // before it can be published: does the live one stay? Both is a valid answer
  // and so is neither, so it is asked rather than assumed — publishing a
  // duplicate silently is how a student ends up reading the same story twice,
  // and retiring the old one silently is a withdrawal of published knowledge
  // performed by a button that says "publish".
  async function publishItem(id, supersedes) {
    let retire = false;
    if (supersedes) {
      const answer = window.confirm(
        [
          `This is a redraft of published item #${supersedes.id}, which is still live:`,
          '',
          `“${supersedes.headline}”`,
          '',
          'OK — publish this and retire the old one.',
          'Cancel — publish this and leave both live.',
        ].join('\n')
      );
      retire = answer;
    }
    setBusy(id);
    setActionError('');
    try {
      const res = await api.post(`/admin/items/${id}/publish`, { retire_superseded: retire });
      reload();
      if (res.retired) setActionError(`Published. Item #${res.retired} was retired.`);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function discardItem(id) {
    const reason = window.prompt(
      'Why is this being discarded? The reason is kept — it is the record of the judgement.'
    );
    if (!reason) return;
    setBusy(id);
    setActionError('');
    try {
      await api.post(`/admin/items/${id}/discard`, { reason });
      reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function publishDay(dayId) {
    setBusy(`day-${dayId}`);
    setActionError('');
    try {
      const res = await api.post(`/admin/days/${dayId}/publish`, {});
      reload();
      if (res.published === 0) setActionError('That digest had no draft items to publish.');
    } catch (e) {
      // The server checks every draft before publishing any, so a day either
      // goes out whole or says exactly what is blocking it.
      const blocked = e.data?.blocked;
      setActionError(
        blocked
          ? `${e.message} ${blocked.map((b) => `“${b.headline}”: ${b.errors.join(' ')}`).join(' | ')}`
          : e.message
      );
    } finally {
      setBusy(null);
    }
  }

  const questionReview = data.question_review || [];

  if (!data.items.length && !data.days.length && !questionReview.length) {
    return (
      <div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Review queue</h1>
        <EmptyState icon={IconList} text="Nothing is waiting for review." />
      </div>
    );
  }

  // Questions on live items come FIRST, above the draft items.
  //
  // Not because there are more of them, but because they are the only thing on
  // this screen attached to something a student is already reading. A draft item
  // left unreviewed shows a student nothing; an approved question set left
  // unreviewed is the one queue where doing nothing is not the safe default —
  // the item is live and its question count is visibly short.
  if (!data.items.length && !data.days.length) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-slate-900">Review queue</h1>
        <QuestionReview items={questionReview} onChanged={reload} />
      </div>
    );
  }

  const byDay = data.items.reduce((acc, it) => {
    (acc[it.day_date] = acc[it.day_date] || []).push(it);
    return acc;
  }, {});

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Review queue</h1>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">
          {data.items.length} draft item{data.items.length === 1 ? '' : 's'}. Nothing reaches a
          student until it is approved here.
        </p>
        <button
          type="button"
          onClick={() => setExpandAll((v) => !v)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {expandAll ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {actionError ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      <QuestionReview items={questionReview} onChanged={reload} />

      <div className="space-y-8">
        {Object.entries(byDay).map(([date, items]) => {
          const day = data.days.find((d) => d.date === date);
          return (
            <section key={date}>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
                <h2 className="font-bold text-slate-900">{longDate(date)}</h2>
                <span className="text-xs text-slate-500">
                  {items.length} draft{items.length === 1 ? '' : 's'}
                </span>
                {day ? (
                  <>
                    <Link
                      to={`/admin/days/${day.id}`}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <IconPencil /> Edit digest
                    </Link>
                    <button
                      type="button"
                      onClick={() => publishDay(day.id)}
                      disabled={busy === `day-${day.id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      <IconCheck /> Publish whole day
                    </button>
                  </>
                ) : null}
              </div>

              <div className="space-y-4">
                {items.map((it) => (
                  <QueueItem
                    key={it.id}
                    item={it}
                    busy={busy === it.id}
                    onPublish={() => publishItem(it.id, it.supersedes_item)}
                    onDiscard={() => discardItem(it.id)}
                    defaultOpen={expandAll}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function QueueItem({ item, busy, onPublish, onDiscard, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  // Follows the page-level Expand all / Collapse all, while still allowing a
  // single card to be toggled on its own afterwards.
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  const highHits = (item.correction_hits || []).filter((h) => h.severity === 'high');
  const lowHits = (item.correction_hits || []).filter((h) => h.severity === 'low');

  return (
    <article className="rounded-lg border border-slate-200 bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <BucketBadge bucket={item.bucket} />
        <ImportanceBadge importance={item.importance} />
        {item.g1_bank ? <BankBadge bank={item.g1_bank} /> : null}
        <GenreBadge genre={item.source_genre} author={item.source_author} />
        {item.needs_verify ? (
          <Chip className="border-amber-400 bg-amber-100 text-amber-900">⚠ Needs verify</Chip>
        ) : null}
        {item.sources.length === 0 ? (
          <Chip className="border-red-400 bg-red-100 text-red-800">No source</Chip>
        ) : null}
        <span className="ml-auto text-xs text-slate-500">
          {item.mcq_count} question{item.mcq_count === 1 ? '' : 's'}
        </span>
      </div>

      <h3 className="mb-1 font-semibold leading-snug text-slate-900">{item.headline}</h3>

      {/* This draft is a redraft of an item a student can ALREADY read. Shown
          on the card rather than only in the publish dialog, because the
          decision a reviewer makes here is whether to bother reading it at
          all, and that decision changes if the story is already published. */}
      {item.supersedes_item ? (
        <div className="mb-2 rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm text-sky-900">
          <span className="font-semibold">Redraft of a live item.</span> Item #
          {item.supersedes_item.id} is published and says the same thing:{' '}
          <Link
            to={`/admin/days/${item.supersedes_item.day_id}#item-${item.supersedes_item.id}`}
            className="underline"
          >
            <RichText>{item.supersedes_item.headline}</RichText>
          </Link>
          . Publishing this without retiring that one shows a student the story twice — the
          publish button will ask.
        </div>
      ) : null}

      {/* The corrections guard. A 'high' hit means the text carries a phrase
          associated with the superseded position — worth blocking on. A 'low'
          hit just means the item touches the topic, which is usually fine. */}
      {highHits.length ? (
        <div className="mb-2 rounded-md border border-red-400 bg-red-50 p-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-800">
            <IconAlert /> Probably states a superseded position
          </p>
          {highHits.map((h) => (
            <p key={h.correction_id} className="text-xs text-red-900">
              <strong>{h.topic}</strong> — found “{h.stale_signals.join('”, “')}”. Correct position:{' '}
              {h.correct_position}
            </p>
          ))}
        </div>
      ) : null}
      {lowHits.length ? (
        <p className="mb-2 text-xs text-slate-500">
          Touches a known correction ({lowHits.map((h) => h.topic).join(', ')}) — check it uses the
          current position.
        </p>
      ) : null}

      {item.verify_note ? (
        <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <strong>To verify:</strong> <RichText>{item.verify_note}</RichText>
        </p>
      ) : null}

      {/* Sources next to the claim, not behind a click. */}
      {item.sources.length ? (
        <ul className="mb-2 space-y-0.5 text-xs">
          {item.sources.map((s) => (
            <li key={s.url}>
              {s.is_primary ? <span className="mr-1 font-semibold text-green-700">Primary</span> : null}
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-brand-700 hover:underline"
              >
                {s.publisher || s.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mb-2 flex flex-wrap gap-1">
        {item.keywords.map((k) => (
          <KeywordBadge key={k} keyword={k} />
        ))}
        {item.units.map((u) => (
          <UnitBadge key={u.unit_code || u} unit={u} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 text-xs font-medium text-brand-700 hover:underline"
      >
        {open ? 'Hide' : 'Show'} full content
      </button>

      {open ? (
        <div className="mb-3 space-y-3 rounded-md border border-slate-200 p-3">
          {item.notes_markdown ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Notes</p>
              <div className="prose-notes text-sm">
                <Markdown>{item.notes_markdown}</Markdown>
              </div>
            </div>
          ) : null}
          {item.static_linkage ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Static linkage
              </p>
              <p className="text-sm text-slate-700">
                <RichText>{item.static_linkage}</RichText>
              </p>
            </div>
          ) : null}
          {item.static_notes ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Static notes
              </p>
              <div className="prose-notes text-sm">
                <Markdown>{item.static_notes}</Markdown>
              </div>
            </div>
          ) : null}
          {item.prelims_facts ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-brand-700">
                Prelims facts (G2)
              </p>
              <p className="whitespace-pre-line text-sm text-slate-700">
                <RichText>{item.prelims_facts}</RichText>
              </p>
            </div>
          ) : null}
          {item.g1_fact ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-green-800">
                The fact (G1)
              </p>
              <p className="text-sm text-slate-700">
                <RichText>{item.g1_fact}</RichText>
              </p>
            </div>
          ) : null}
          {item.g1_angle ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-green-800">
                The angle (G1)
              </p>
              <p className="text-sm text-slate-900">
                <RichText>{item.g1_angle}</RichText>
              </p>
            </div>
          ) : (
            <p className="text-xs text-red-700">
              No angle — this cannot be published to the Group-I lane. Either write one or turn the
              G1 lane off for this item.
            </p>
          )}

          {/* The remaining six sections of the note template. Absent from this
              panel until now, which meant a reviewer was approving a note while
              seeing about a third of it — and `validateItem` already requires
              two of these fields, so the queue was demanding content it would
              not show. */}
          {[
            ['g1_why_news', 'Why in news'],
            ['g1_background', 'Background'],
            ['g1_ap_angle', 'AP angle'],
            ['g1_linked', 'Linked schemes / reports / judgments'],
            ['g1_bridges', 'Essay link-lines'],
            ['g1_way_forward', 'Way forward'],
          ].map(([field, labelText]) =>
            item[field] ? (
              <div key={field}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-green-800">
                  {labelText}
                </p>
                <p className="whitespace-pre-line text-sm text-slate-700">{item[field]}</p>
              </div>
            ) : null
          )}

          {/* Flagged rather than merely absent: Andhra Pradesh is roughly half
              of Papers II and IV, so a missing AP angle is the one gap in this
              template worth interrupting a review for. */}
          {item.relevance_g1 && !String(item.g1_ap_angle || '').trim() ? (
            <p className="text-xs text-amber-700">
              No AP angle on a Group-I item — worth adding before publishing.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <IconCheck /> Publish
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <IconTrash /> Discard
        </button>
        <Link
          to={`/admin/days/${item.day_id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <IconPencil /> Edit
        </Link>
      </div>
    </article>
  );
}
