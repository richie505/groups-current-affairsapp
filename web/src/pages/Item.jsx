import { useRef, useState } from 'react';
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
import RichText from '../components/RichText';
import PacingBar from '../components/PacingBar';
import {
  BucketBadge,
  ImportanceBadge,
  KeywordBadge,
  UnitBadge,
  VerifyBadge,
  GenreBadge,
  Chip,
} from '../components/Badges';
import { longDate, shortDate } from '../lib/caFormat';
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
  // Mirrors the clock in PacingBar so the button below can enable itself the
  // moment the time is up, without another round trip. The server still decides
  // — this only stops the student clicking a button that would be refused.
  const [paceDone, setPaceDone] = useState(false);
  const [paceError, setPaceError] = useState('');
  // Where "Practise the questions" lands. The questions are below the whole
  // note, so opening them without moving the page leaves the student looking at
  // the same paragraph they just finished, wondering whether anything happened.
  const questionsRef = useRef(null);

  if (loading) return <Loading label="Loading…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const item = data.item;
  // The two published syllabi, kept apart. Both exams are answered by ticking a
  // box, so the split is no longer written-versus-objective — it is which
  // syllabus the unit belongs to, and a candidate revising for one should not be
  // handed the other's routing. A unit whose code is no longer in ref_units has
  // no `exam`, and shows in both rather than disappearing.
  const g1pUnits = (item.units || []).filter((u) => u.exam !== 'g2');
  const g2Units = (item.units || []).filter((u) => u.exam !== 'g1p');

  async function toggleRead() {
    setBusy('read');
    setPaceError('');
    try {
      if (item.marked_read) await api.del(`/items/${item.id}/read`);
      else await api.post(`/items/${item.id}/read`, {});
      // Reload rather than patch local state: marking read unlocks the MCQs,
      // which the server only sends once the flag is set.
      reload();
    } catch (err) {
      // The pacing gate answers 409 when the reading clock has not run. Shown
      // where the click happened rather than as a page-level error: it is not a
      // failure, it is the feature working.
      setPaceError(err.message);
    } finally {
      setBusy('');
    }
  }

  // Time is up and the student pressed the button in the pacing bar: mark it
  // read (which is what the server gates on) and take them to the questions.
  async function practise() {
    setBusy('read');
    setPaceError('');
    try {
      if (!item.marked_read) await api.post(`/items/${item.id}/read`, {});
      reload();
      // After the reload has painted, so the section exists to scroll to.
      setTimeout(
        () => questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        150
      );
    } catch (err) {
      setPaceError(err.message);
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
        <GenreBadge genre={item.source_genre} author={item.source_author} />
        {item.needs_verify ? <VerifyBadge note={item.verify_note} /> : null}
      </div>

      <h1 className="mb-1 text-2xl font-bold leading-snug text-slate-900">{item.headline}</h1>
      {item.event_date ? (
        <p className="mb-4 text-sm text-slate-500">Event dated {shortDate(item.event_date)}</p>
      ) : null}

      {item.needs_verify && item.verify_note ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Not fully verified:</strong> <RichText>{item.verify_note}</RichText>
        </p>
      ) : null}

      {/* The reading clock, when paced learning is on. Hidden entirely when it
          is off, which is the default — see server/src/lib/pacing.js. */}
      <PacingBar
        pacing={item.pacing}
        markedRead={!!item.marked_read}
        onUnlock={() => setPaceDone(true)}
        onPractise={practise}
        mcqCount={item.mcq_count || 0}
        busy={busy === 'read'}
      />

      {paceError ? (
        <p className="mb-3 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm text-brand-900" role="alert">
          {paceError}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleRead}
          disabled={busy === 'read' || (!item.marked_read && !!item.pacing?.required_seconds && !paceDone)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
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

      {/* The static material itself. `static_linkage` says which syllabus topic
          the news updates; this is that topic, set out so the news can actually
          be used in an answer without going elsewhere first. Given its own
          section rather than folded into the notes, because it is the part that
          does NOT change with the day. */}
      {item.static_notes ? (
        <section className="mb-5 rounded-lg border border-slate-300 bg-surface p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Static notes — the standing material behind this
          </h2>
          <div className="prose-notes text-sm">
            <Markdown>{item.static_notes}</Markdown>
          </div>
        </section>
      ) : null}

      {/* ---- Group-II lane ---- */}
      {showG2 ? (
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
          {/* WHERE THIS SITS ON THE SYLLABUS.
              Given its own heading rather than mixed in with the angles above,
              because it answers a different question. The angle is the SHAPE the
              examiner uses; the unit is the part of the syllabus being examined,
              and it is the one a candidate revises by. */}
          {g2Units.length ? (
            <>
              <p className="mb-1 mt-3 text-xs font-medium text-slate-600">
                Syllabus topics this feeds
              </p>
              <div className="flex flex-wrap gap-1">
                {g2Units.map((u) => (
                  <UnitBadge key={u.unit_code} unit={u} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ---- Group-I Prelims lane ---- */}
      {showG1 ? (
        <section className="mb-5 rounded-lg border border-green-300 bg-green-50 p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-green-800">
            Group I Prelims — what to recall
          </h2>
          {/* The facts are not repeated when both lanes are showing: they are
              the same facts. What the lens changes is which syllabus they are
              filed against, and that is what this block carries. */}
          {!showG2 && item.prelims_facts ? (
            <div className="prose-notes mb-3 text-sm">
              <Markdown remarkPlugins={FACT_PLUGINS}>{item.prelims_facts}</Markdown>
            </div>
          ) : null}
          {g1pUnits.length ? (
            <>
              <p className="mb-1 text-xs font-medium text-slate-600">
                Syllabus topics this feeds
              </p>
              <div className="flex flex-wrap gap-1">
                {g1pUnits.map((u) => (
                  <UnitBadge key={u.unit_code} unit={u} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-600">
              No Group-I Prelims unit matched this item.
            </p>
          )}
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
        <section ref={questionsRef} className="scroll-mt-4">
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
                {item.pacing?.required_seconds && !item.pacing?.unlocked
                  ? 'They open when your reading time is up — answering before reading teaches the answer, not the topic.'
                  : 'Mark this item read to open them — answering before reading teaches the answer, not the topic.'}
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

