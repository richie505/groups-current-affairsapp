import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import useResource from '../hooks/useResource';
import { api } from '../api/client';
import { useLens } from '../context/LensContext';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import Markdown from '../components/Markdown';
import McqCard from '../components/McqCard';
import G1Note from '../components/G1Note';
import {
  BucketBadge,
  ImportanceBadge,
  KeywordBadge,
  UnitBadge,
  BankBadge,
  VerifyBadge,
  Chip,
} from '../components/Badges';
import { BANKS, longDate, shortDate } from '../lib/caFormat';
import { IconBookmark, IconCheck, IconLock } from '../components/Icon';

// The prelims-facts block is line-per-fact, so it needs hard breaks. The notes
// body deliberately does not — there, single newlines inside a paragraph should
// stay inside it.
const FACT_PLUGINS = [remarkGfm, remarkBreaks];

export default function Item() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useResource(`/items/${id}`);
  const { showG1, showG2 } = useLens();
  const [busy, setBusy] = useState('');

  if (loading) return <Loading label="Loading…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const item = data.item;

  async function toggleRead() {
    setBusy('read');
    try {
      if (item.marked_read) await api.del(`/items/${item.id}/read`);
      else await api.post(`/items/${item.id}/read`, {});
      // Reload rather than patch local state: marking read unlocks the MCQs,
      // which the server only sends once the flag is set.
      reload();
    } finally {
      setBusy('');
    }
  }

  async function toggleBookmark() {
    setBusy('bookmark');
    try {
      if (item.bookmarked) await api.del(`/items/${item.id}/bookmark`);
      else await api.post(`/items/${item.id}/bookmark`, {});
      setData({ item: { ...item, bookmarked: item.bookmarked ? 0 : 1 } });
    } finally {
      setBusy('');
    }
  }

  return (
    <article>
      <nav className="mb-3 text-sm text-slate-600">
        <Link to={`/day/${item.day_date}`} className="font-medium text-brand-700 hover:underline">
          {longDate(item.day_date)}
        </Link>
      </nav>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <BucketBadge bucket={item.bucket} />
        <ImportanceBadge importance={item.importance} />
        {item.subject_tag ? (
          <Chip className="border-slate-300 bg-slate-100 text-slate-700" title="Home subject in the blueprint">
            {item.subject_tag}
          </Chip>
        ) : null}
        {item.needs_verify ? <VerifyBadge note={item.verify_note} /> : null}
      </div>

      <h1 className="mb-1 text-2xl font-bold leading-snug text-slate-900">{item.headline}</h1>
      {item.event_date ? (
        <p className="mb-4 text-sm text-slate-500">Event dated {shortDate(item.event_date)}</p>
      ) : null}

      {item.needs_verify && item.verify_note ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Not fully verified:</strong> {item.verify_note}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleRead}
          disabled={busy === 'read'}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${
            item.marked_read
              ? 'border border-green-300 bg-green-50 text-green-800'
              : 'bg-brand-600 text-white hover:bg-brand-700'
          }`}
        >
          <IconCheck />
          {item.marked_read ? 'Read' : 'Mark as read'}
        </button>
        <button
          type="button"
          onClick={toggleBookmark}
          disabled={busy === 'bookmark'}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${
            item.bookmarked
              ? 'border-brand-300 bg-brand-50 text-brand-700'
              : 'border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <IconBookmark />
          {item.bookmarked ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* ---- The shared body ---- */}
      {item.notes_markdown ? (
        <section className="prose-notes mb-5 rounded-lg border border-slate-200 bg-surface p-4">
          <Markdown>{item.notes_markdown}</Markdown>
        </section>
      ) : null}

      {/* The link back to the static syllabus. This is what stops current
          affairs being a separate subject — it names the unit this news
          actually updates. */}
      {item.static_linkage ? (
        <section className="mb-5 rounded-lg border-l-4 border-slate-400 bg-slate-100 p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Static linkage
          </h2>
          <div className="prose-notes text-sm">
            <Markdown>{item.static_linkage}</Markdown>
          </div>
        </section>
      ) : null}

      {/* ---- Group-II lane ---- */}
      {showG2 && item.relevance_g2 ? (
        <section className="mb-5 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-700">
            Group II — what to recall
          </h2>
          {/* remarkBreaks, unlike the notes above. The prelims block is written
              one fact per line, and standard markdown collapses single newlines
              into a paragraph — which turned a scannable memorise-this list into
              a run-on sentence, losing exactly the property that makes it
              useful. */}
          {item.prelims_facts ? (
            <div className="prose-notes mb-3 text-sm">
              <Markdown remarkPlugins={FACT_PLUGINS}>{item.prelims_facts}</Markdown>
            </div>
          ) : null}
          {item.keywords?.length ? (
            <>
              <p className="mb-1 text-xs font-medium text-slate-600">
                Question angles APPSC uses for this
              </p>
              <div className="flex flex-wrap gap-1">
                {item.keywords.map((k) => (
                  <KeywordBadge key={k} keyword={k} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ---- Group-I lane: the eight-section note template ---- */}
      {showG1 && item.relevance_g1 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-green-800">
            Group I — note
          </h2>
          <G1Note item={item} />
          <div className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3">
            <BankFiler item={item} onFiled={reload} />
          </div>
        </section>
      ) : null}

      {/* ---- Answer skeletons ---- */}
      {showG1 && item.skeletons?.length ? (
        <section className="mb-5 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">
            Answer skeletons
          </h2>
          {item.skeletons.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 bg-surface p-4">
              <p className="mb-2 font-medium text-slate-900">
                {s.paper ? <span className="mr-1 font-mono text-xs text-slate-500">{s.paper}</span> : null}
                {s.question_text}
              </p>
              <div className="prose-notes text-sm">
                <Markdown>{s.skeleton_markdown}</Markdown>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---- Sources ---- */}
      {item.sources?.length ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Sources</h2>
          <ul className="space-y-1 text-sm">
            {item.sources.map((s) => (
              <li key={s.url} className="flex items-start gap-2">
                {s.is_primary ? (
                  <Chip className="mt-0.5 border-green-300 bg-green-100 text-green-800" title="Primary source">
                    Primary
                  </Chip>
                ) : null}
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
        </section>
      ) : null}

      {/* ---- MCQs ---- */}
      {showG2 && item.relevance_g2 ? (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">
            Questions
          </h2>
          {!item.marked_read ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-surface p-6 text-center">
              <p className="mb-1 flex items-center justify-center gap-2 text-sm font-medium text-slate-700">
                <IconLock />
                {item.mcq_count > 0
                  ? `${item.mcq_count} question${item.mcq_count === 1 ? '' : 's'} locked`
                  : 'Questions locked'}
              </p>
              <p className="text-xs text-slate-500">
                Mark this item read to open them — answering before reading teaches the answer,
                not the topic.
              </p>
            </div>
          ) : item.mcqs.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-surface p-4 text-sm text-slate-500">
              No questions have been written for this item yet.
            </p>
          ) : (
            <div className="space-y-3">
              {item.mcqs.map((mcq, i) => (
                <div key={mcq.id}>
                  <McqCard mcq={mcq} index={i} />
                  {mcq.fact_as_of ? (
                    <p className="mt-1 px-1 text-[11px] text-slate-500">
                      Key correct as of {shortDate(mcq.fact_as_of)} — verify against the latest
                      notification if you are revising this much later.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </article>
  );
}

// Filing to a personal bank. Deliberately a distinct action from reading: the
// bank-review targets only mean something if the student chose each entry, and
// a bank that fills itself is a bank nobody has read.
function BankFiler({ item, onFiled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filed = item.my_card;

  async function file(bank) {
    setBusy(true);
    setError('');
    try {
      if (filed?.bank === bank) await api.del(`/items/${item.id}/card`);
      else await api.post(`/items/${item.id}/card`, { bank });
      onFiled();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!item.g1_angle) {
    return (
      <p className="text-xs text-slate-600">
        This item has no angle, so it cannot be filed — an item you cannot argue from will never
        reach an answer.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-600">
        {filed ? `Filed to your ${filed.bank} bank` : 'File to one of your banks'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(BANKS).map(([key, b]) => (
          <button
            key={key}
            type="button"
            disabled={busy}
            onClick={() => file(key)}
            title={b.hint}
            className={`rounded-md border px-2 py-1 text-xs font-semibold ${
              filed?.bank === key
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-300 bg-surface text-slate-700 hover:border-slate-500'
            }`}
          >
            {key} · {b.label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
