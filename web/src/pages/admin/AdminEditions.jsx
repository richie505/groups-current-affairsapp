import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, getToken } from '../../api/client';
import useResource from '../../hooks/useResource';
import RichText from '../../components/RichText';
import useConfirm from '../../components/useConfirm';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { IconSpinner } from '../../components/Icon';

// Section 1 — Source Intelligence.
//
// The admin uploads a newspaper PDF and watches it become articles. This is the
// front door of the whole product: everything downstream — knowledge items,
// topics, MCQs, essay banks — begins with a file dropped here.
//
// WHAT THIS SCREEN IS FOR, BEYOND UPLOADING
//
// Showing what the extractor DECIDED. A segmenter that quietly loses a column
// looks exactly like one that works, so the counts are the point: pages OCR'd,
// pages skipped as advertising, articles found, events after duplicates were
// merged. An edition that yields four articles from twenty-eight pages is
// broken, and the only way to notice is to print the numbers.

// English only, decided 22 Aug 2026. Eenadu and Sakshi were offered here before
// and are gone: Telugu OCR needs a `tel.traineddata` this machine does not have,
// so choosing them produced an edition that could never be extracted. Offering a
// broken path is worse than offering a short list.
//
// This is about SOURCE newspapers, not about Telugu as exam content — AP History
// and Society legitimately test Telugu literature and dynasties, and the
// relevance scorer still matches them.
// AND ONLY THE ONE THE PIPELINE ACTUALLY KNOWS.
//
// Indian Express was offered here and there is no profile for it —
// np-daily/profiles.js carries `the-hindu`, `eenadu` (retired) and `generic`,
// and detection falls back to `generic` on anything it does not recognise.
// So choosing it produced a silently worse extraction: no masthead rules, no
// advertisement detection, no font-name semantics for headline vs body. The
// list should name what is supported, and a second paper belongs here the day
// a profile for it exists and not before.
const PUBLICATIONS = [{ value: 'The Hindu', language: 'en' }];

export default function AdminEditions() {
  const { id } = useParams();
  return id ? <OneEdition id={Number(id)} /> : <EditionList />;
}

// ---------------------------------------------------------------------------

function StatusPill({ status }) {
  const tone = {
    uploaded: 'bg-slate-100 text-slate-700',
    processing: 'bg-amber-100 text-amber-800',
    processed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }[status];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${tone}`}>
      {status}
    </span>
  );
}

// The relevance band. Colour carries the priority so a reviewer can scan the
// list rather than read it, which is the entire point of scoring.
function BandBadge({ band, score }) {
  if (!band) return null;
  const tone = {
    critical: 'bg-red-600 text-slate-50',
    high: 'bg-orange-500 text-white',
    medium: 'bg-amber-200 text-amber-900',
    low: 'bg-slate-100 text-slate-500',
  }[band];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${tone}`}>
      {score != null ? Math.round(score) : '?'} {band}
    </span>
  );
}

// What KIND of piece this is, where it is not an ordinary report.
//
// Read off the page's own running head and section labels — see
// content-pipeline/np-daily/genre.js. Reports carry no chip: they are the norm,
// and labelling the norm is what makes the exception invisible.
const GENRE_CHIP = {
  oped: ['Op-ed', 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'],
  editorial: ['Editorial', 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'],
  interview: ['Interview', 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'],
  column: ['Column', 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'],
  letters: ['Letters', 'bg-slate-200 text-slate-600'],
  archive: ['Archive', 'bg-slate-200 text-slate-600'],
};

function GenreChip({ genre, section, why }) {
  const g = GENRE_CHIP[genre];
  if (!g) return null;
  return (
    <span
      className={`rounded px-1.5 font-semibold ${g[1]}`}
      title={[section ? `${section} page` : '', why].filter(Boolean).join(' — ')}
    >
      {g[0]}
    </span>
  );
}

// The five factors, shown on demand. A score nobody can decompose is a score
// nobody trusts, so the breakdown is one click away rather than absent.
function Breakdown({ raw }) {
  if (!raw) return null;
  let b;
  try {
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  const rows = [
    ['Syllabus', b.syllabus],
    ['PYQ angle', b.pyq],
    ['Andhra Pradesh', b.ap],
    ['Importance', b.importance],
    ['Cross-paper reuse', b.reuse],
  ].filter(([, v]) => v);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
        why this score
      </summary>
      <div className="mt-1 rounded bg-slate-50 p-2">
        {b.vetoed ? (
          <p className="text-[11px] font-semibold text-slate-600">
            Excluded: {b.vetoed}
          </p>
        ) : (
          <ul className="space-y-0.5 text-[11px] text-slate-600">
            {rows.map(([label, v]) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-32">{label}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded bg-slate-200">
                  <span
                    className="block h-full bg-brand-500"
                    style={{ width: `${v.max ? (v.score / v.max) * 100 : 0}%` }}
                  />
                </span>
                <span className="font-mono">
                  {v.score}/{v.max}
                </span>
              </li>
            ))}
          </ul>
        )}
        {b.why ? (
          <p className="mt-1 text-[11px] italic text-slate-500">{b.why}</p>
        ) : null}
      </div>
    </details>
  );
}

// `ca_runs` timestamps are SQLite `datetime('now')`, which is UTC with no zone
// marker. Parsed as UTC explicitly — read as local time a run would appear to
// have started hours before it did.
function runTime(sqlDatetime) {
  if (!sqlDatetime) return null;
  const d = new Date(`${String(sqlDatetime).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clockOf(sqlDatetime) {
  const d = runTime(sqlDatetime);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}

function durationOf(from, to) {
  const a = runTime(from);
  const b = runTime(to);
  if (!a || !b) return null;
  const secs = Math.max(0, Math.round((b - a) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function mb(bytes) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—';
}

// ---------------------------------------------------------------------------
// upload + list
// ---------------------------------------------------------------------------

function EditionList() {
  const { data, error, loading, reload } = useResource('/admin/editions');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({
    publication: 'The Hindu',
    edition: 'Vijayawada',
    date: new Date().toISOString().slice(0, 10),
  });
  const fileRef = useRef(null);

  // While anything is processing, poll. The worker runs in its own process, so
  // the only way this screen learns it finished is to ask.
  const anyProcessing = (data?.editions || []).some((e) => e.status === 'processing');
  useEffect(() => {
    if (!anyProcessing) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [anyProcessing, reload]);

  async function upload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg({ kind: 'error', text: 'Choose a PDF first.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const lang =
        PUBLICATIONS.find((p) => p.value === form.publication)?.language || 'en';
      const qs = new URLSearchParams({
        publication: form.publication,
        edition: form.edition,
        date: form.date,
        language: lang,
        filename: file.name,
      });
      // Sent as a raw body rather than multipart: the server takes the PDF bytes
      // directly, so there is no form envelope and no upload dependency.
      const res = await fetch(`/api/admin/editions?${qs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          Authorization: `Bearer ${getToken()}`,
        },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);

      if (body.duplicate) {
        setMsg({
          kind: 'info',
          text: 'That exact file is already uploaded for this date — using the existing edition.',
        });
      } else {
        setMsg({ kind: 'ok', text: `Uploaded ${file.name}. Now process it.` });
      }
      if (fileRef.current) fileRef.current.value = '';
      reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function process(id) {
    try {
      await api.post(`/admin/editions/${id}/process`, {});
      reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Newspaper import</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload an edition, and it becomes articles. Everything downstream starts here.
        </p>
      </header>

      <form
        onSubmit={upload}
        className="mb-6 rounded-lg border border-slate-200 bg-surface p-4"
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Publication
            </span>
            <select
              value={form.publication}
              onChange={(e) => setForm((f) => ({ ...f, publication: e.target.value }))}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {PUBLICATIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Edition
            </span>
            <input
              type="text"
              value={form.edition}
              onChange={(e) => setForm((f) => ({ ...f, edition: e.target.value }))}
              placeholder="Vijayawada"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Edition date
            </span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="text-sm text-slate-700"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>

        {/* THE TELUGU LINE THAT USED TO BE HERE WAS SIX WEEKS OUT OF DATE.
            It told the admin that Telugu editions are accepted and need a
            `tel.traineddata` install — but Telugu ingestion was taken out of
            scope on 22 Aug 2026, the eenadu profile was retired with it, and
            the dropdown above has offered English papers only ever since. A
            screen that describes a path the code no longer has sends the
            person reading it to install something that will not help. */}
        <p className="mt-2 text-xs text-slate-500">
          The same file uploaded twice for the same date is recognised rather than duplicated.
          English editions only — a page with no text layer is read by OCR, which is slower and
          less accurate than the ePaper&rsquo;s own text.
        </p>

        {msg ? (
          <p
            className={
              'mt-3 rounded-md px-3 py-2 text-sm ' +
              (msg.kind === 'error'
                ? 'bg-red-50 text-red-800'
                : msg.kind === 'ok'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-slate-50 text-slate-700')
            }
          >
            {msg.text}
          </p>
        ) : null}
      </form>

      {loading ? <Loading label="Loading editions…" /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data && !data.editions.length ? (
        <EmptyState
          title="No editions yet"
          body="Upload a newspaper PDF above to get started."
        />
      ) : null}

      {data && data.editions.length ? (
        <ul className="space-y-2">
          {data.editions.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-slate-200 bg-surface p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={e.status} />
                <Link
                  to={`/admin/editions/${e.id}`}
                  className="font-semibold text-slate-900 hover:underline"
                >
                  {e.publication}
                  {e.edition ? ` — ${e.edition}` : ''} · {e.date}
                </Link>
                <span className="text-xs text-slate-500">{mb(e.bytes)}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {e.status === 'processed' ? (
                  <>
                    <span>{e.pages} pages</span>
                    <span>{e.pages_ocr} OCR'd</span>
                    <span>{e.pages_skipped} skipped as ads</span>
                    <span className="font-semibold text-slate-800">
                      {e.distinct_articles} articles
                    </span>
                    <span>{e.ap_articles} AP</span>
                    {e.critical ? (
                      <span className="font-semibold text-red-700">
                        {e.critical} critical
                      </span>
                    ) : null}
                    {e.high ? (
                      <span className="font-semibold text-orange-700 dark:text-orange-400">
                        {e.high} high
                      </span>
                    ) : null}
                    {e.discarded ? <span>{e.discarded} discarded</span> : null}
                    {e.merged ? <span>{e.merged} merged</span> : null}
                    {e.drafted ? <span>{e.drafted} drafted</span> : null}
                  </>
                ) : null}
                {e.status === 'processing' ? <span>Working — this takes about 30 seconds…</span> : null}
                {e.status === 'failed' ? (
                  <span className="text-red-700">{e.error}</span>
                ) : null}
              </div>

              <div className="mt-2 flex gap-2">
                {e.status !== 'processing' ? (
                  <button
                    type="button"
                    onClick={() => process(e.id)}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50"
                  >
                    {e.status === 'processed' ? 'Re-process' : 'Process'}
                  </button>
                ) : null}
                <Link
                  to={`/admin/editions/${e.id}`}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50"
                >
                  Articles
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// one edition
// ---------------------------------------------------------------------------

function OneEdition({ id }) {
  // Which articles the admin has ticked. Held here rather than in the panel
  // because the ticking happens in the list and the drafting happens in the
  // panel, and the two are siblings.
  const [selected, setSelected] = useState([]);
  const toggleSelected = (articleId) =>
    setSelected((prev) =>
      prev.includes(articleId) ? prev.filter((n) => n !== articleId) : [...prev, articleId]
    );

  const { data, error, loading, reload } = useResource(`/admin/editions/${id}`);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const navigate = useNavigate();
  // Above the early returns below, not beside the code that uses it. A hook
  // called after `if (loading) return` runs on the loaded render and not on the
  // loading one, so React counts more hooks than last time and unmounts the
  // whole tree — a blank page, with the real cause only in the console.
  const { confirm, dialog } = useConfirm();

  const processing = data?.edition?.status === 'processing';
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [processing, reload]);

  if (loading) return <Loading label="Loading edition…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const e = data.edition;
  const live = data.articles.filter((a) => a.status !== 'duplicate');
  const dups = data.articles.filter((a) => a.status === 'duplicate');

  async function remove() {
    const ok = await confirm({
      title: 'Delete this edition?',
      body: 'Its extracted articles go with it. Knowledge items already published are kept.',
      confirmLabel: 'Delete edition',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/admin/editions/${id}`);
    navigate('/admin/editions');
  }

  return (
    <div>
      {dialog}
      <Link
        to="/admin/editions"
        className="mb-3 inline-block text-sm text-brand-700 hover:underline"
      >
        ← All editions
      </Link>

      <header className="mb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <StatusPill status={e.status} />
          <h1 className="text-xl font-bold text-slate-900">
            {e.publication}
            {e.edition ? ` — ${e.edition}` : ''} · {e.date}
          </h1>
        </div>
        <p className="text-xs text-slate-500">
          {e.source_file} · {mb(e.bytes)} · profile {e.profile || '—'} ·{' '}
          {data.file_present ? 'file on disk' : 'file missing — cannot re-process'}
        </p>
      </header>

      {/* The decision counts. This is the honest report on the extractor. */}
      {e.status === 'processed' ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Pages', e.pages],
            ['OCR needed', e.pages_ocr],
            ['Skipped as ads', e.pages_skipped],
            ['Articles', live.length],
            ['Distinct events', e.events],
            ['Merged', e.merged],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-slate-200 bg-surface p-2.5"
            >
              <div className="text-lg font-bold text-slate-900">{value}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {e.error ? (
        <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {e.error}
        </p>
      ) : null}

      {e.log ? (
        <details className="mb-4 rounded-md border border-slate-200 bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Extraction log
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">
            {e.log}
          </pre>
        </details>
      ) : null}

      {e.status === 'processed' ? (
        <DraftPanel
          editionId={id}
          articles={live}
          selected={selected}
          onClearSelection={() => setSelected([])}
          onSelect={setSelected}
          onFinished={reload}
        />
      ) : null}

      {e.status === 'processed' ? <SalvagePanel editionId={id} onFinished={reload} /> : null}

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        Articles ({live.length})
      </h2>
      <ArticleList rows={live} selected={selected} onToggle={toggleSelected} />

      {dups.length ? (
        <section className="mt-5">
          <button
            type="button"
            onClick={() => setShowDuplicates((v) => !v)}
            className="mb-2 text-sm font-semibold text-brand-700 hover:underline"
          >
            {showDuplicates ? 'Hide' : 'Show'} {dups.length} article(s) merged as the same event
          </button>
          {showDuplicates ? <ArticleList rows={dups} muted /> : null}
        </section>
      ) : null}

      <div className="mt-6">
        <button
          type="button"
          onClick={remove}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          Delete edition
        </button>
      </div>
    </div>
  );
}

// Section 3 — the article → note bridge, from the admin's side.
//
// Everything above this panel is a filing cabinet: articles extracted, scored
// and ranked, and until this existed that was where they stopped. This is the
// door out — it turns the ones worth keeping into drafted knowledge items in the
// review queue, where the existing approve-and-publish flow takes over.
//
// WHY THE THRESHOLD IS A CONTROL AND NOT A CONSTANT
//
// Because it is the one number that decides what the day costs. Each article is
// a model call, so 'draft everything' on a 28-page edition is both expensive and
// against the point — most news should be discarded. The default of 55 is the
// bottom of the HIGH band; the counts below the slider say exactly how many
// articles each choice would send, so the decision is made with the number in
// view rather than after the bill.
// THE SECOND PASS: the facts inside the articles drafting turned down.
//
// A button of its own rather than something drafting does on the way out. It
// costs money per article and the paper decides how many articles there are —
// the same reason drafting is a button and not a consequence of uploading.
//
// It deliberately sits BELOW the drafting panel, because that is the order it
// has to run in: salvage reads what drafting leaves behind, so running it first
// would take the good material out of the notes.
function SalvagePanel({ editionId, onFinished }) {
  const [state, setState] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const running = state?.run?.status === 'running';

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/editions/${editionId}/salvage`);
      setState(res);
      return res.run?.status === 'running';
    } catch {
      return false;
    }
  }, [editionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      const still = await load();
      if (!still) onFinished?.();
    }, 4000);
    return () => clearInterval(t);
  }, [running, load, onFinished]);

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/admin/editions/${editionId}/salvage`, {});
      const now = new Date();
      // Roughly 12s an article — a short prompt and a short answer, against the
      // ~33s the full drafter takes. Stated as a finishing time rather than a
      // duration, because that is the thing a person actually wants to know.
      const done = new Date(now.getTime() + (state?.waiting || 0) * 12 * 1000);
      const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMsg({
        kind: 'ok',
        text:
          `Started at ${hhmm(now)} — ${state?.waiting || 0} article(s), expected to finish about ` +
          `${hhmm(done)}. Most will yield nothing, which is normal. You can leave this page.`,
      });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const last = state.run;
  return (
    <section className="mb-5 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-violet-800">
        Salvage the rest
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Reads the articles drafting turned down and keeps only the examinable facts inside them —
        a named project with its cost, a body with its Act, a rank with its index. No notes, no
        background. They arrive as <strong>Miscellaneous</strong> cards in the review queue.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        This runs automatically after drafting. The button is here for when you want to run it
        again, or on an edition drafted before the pass existed.
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-700">
        <span>
          <strong>{state.waiting}</strong> article(s) left to examine
        </span>
        {state.salvaged ? (
          <span>
            <strong>{state.salvaged}</strong> card(s) already salvaged from this edition
          </span>
        ) : null}
        {last && last.status !== 'running' ? (
          <span className="text-slate-500">
            last run: {last.status}
            {last.drafted != null ? ` — kept ${last.drafted} of ${last.candidates}` : ''}
          </span>
        ) : null}
      </p>

      {msg ? (
        <p
          className={`mt-2 rounded-md px-2.5 py-1.5 text-xs ${
            msg.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'
          }`}
          role={msg.kind === 'error' ? 'alert' : undefined}
        >
          {msg.text}
        </p>
      ) : null}

      <button
        type="button"
        onClick={start}
        disabled={busy || running || !state.waiting}
        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {running ? <IconSpinner className="animate-spin" /> : null}
        {running
          ? 'Salvaging…'
          : state.waiting
            ? `Salvage ${state.waiting} article(s)`
            : 'Nothing left to salvage'}
      </button>
    </section>
  );
}

function DraftPanel({ editionId, articles, selected = [], onSelect, onClearSelection, onFinished }) {
  // THE SCREEN SHOWS THE DECISION INSTEAD OF ASKING FOR A NUMBER.
  //
  // This panel used to open with a"minimum score" slider defaulted to 45, and
  // report how many articles sat above it. That asked the admin a question the
  // score cannot answer: it is a blend of five factors, so a threshold on it
  // admits articles that feed no syllabus unit and rejects articles that feed
  // four. Measured over 248 articles, `>= 45` drafted 10 that connect to nothing
  // and skipped 54 that connect to something.
  //
  // So the default is now the adaptive selector — the same module the worker
  // runs — and the screen's job is to show what it chose and why, before any
  // money is spent. The flat threshold is still reachable, under Advanced,
  // because a person overriding a rule deliberately is different from a person
  // being handed the rule as a default.
  const [plan, setPlan] = useState(null);
  const [planErr, setPlanErr] = useState('');
  // The band is the knob that IS adaptive: how many items a day should yield,
  // with the selector deciding which. Null means"the defaults the worker uses",
  // so an untouched screen previews exactly what an untouched run will draft.
  const [band, setBand] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [minScore, setMinScore] = useState(45);
  const [run, setRun] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPicks, setShowPicks] = useState(false);

  const running = run?.status === 'running';

  const loadRun = useCallback(async () => {
    try {
      const res = await api.get(`/admin/editions/${editionId}/draft`);
      setRun(res.run);
      return res.running;
    } catch {
      // A missing run is not an error state for this panel — it just means
      // nothing has been drafted from this edition yet.
      return false;
    }
  }, [editionId]);

  const loadPlan = useCallback(async () => {
    try {
      const qs = band ? `?max=${band.max}&min=${band.min}` : '';
      setPlan(await api.get(`/admin/editions/${editionId}/plan${qs}`));
      setPlanErr('');
    } catch (e) {
      setPlanErr(e.message);
    }
  }, [editionId, band]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);
  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // The worker is a separate process, so the only way this screen learns the run
  // finished is to ask. Same pattern as the extraction poll above.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      const stillRunning = await loadRun();
      if (!stillRunning) {
        onFinished?.();
        loadPlan();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [running, loadRun, loadPlan, onFinished]);

  const picking = selected.length > 0;
  const cfg = plan?.config;
  const picks = plan?.picked || [];
  const unmatched = plan?.unmatched || [];

  // The flat-threshold path, kept for Advanced. Counted from the rows this
  // screen already has rather than from the plan, because the plan deliberately
  // does not model a threshold.
  const flatEligible = articles.filter((a) => a.score != null && a.score >= minScore && !a.item_id);

  const todo = picking ? selected.length : advanced ? flatEligible.length : picks.length;
  // ~33s per article, measured across every run so far: one model call for the
  // note and one for the questions.
  const eta = Math.max(1, Math.round((todo * 33) / 60));

  // How the leverage was earned, as a distribution. One article feeding four
  // units and one feeding one are both"selected", and the difference is the
  // whole basis of the ranking — so it is shown rather than averaged away.
  const byUnits = picks.reduce((acc, p) => {
    const n = p.units.length >= 4 ? '4+' : String(p.units.length || 0);
    acc[n] = (acc[n] || 0) + 1;
    return acc;
  }, {});
  const pyqBacked = picks.filter((p) => p.pyqBacked > 0).length;
  const headlineAnchored = picks.filter((p) => p.units.some((u) => u.in_headline)).length;

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      const qs = picking
        ? `articles=${selected.join(',')}`
        : advanced
          ? `min_score=${minScore}`
          : band
            ? `max=${band.max}&min=${band.min}`
            : '';
      await api.post(`/admin/editions/${editionId}/draft${qs ? `?${qs}` : ''}`, {});
      const now = new Date();
      const done = new Date(now.getTime() + todo * 33 * 1000);
      const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMsg({
        kind: 'ok',
        text:
          `Started at ${hhmm(now)} — ${todo} article(s), expected to finish about ${hhmm(done)}. ` +
          'You can leave this page; the run keeps going.',
      });
      await loadRun();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const chip = 'rounded bg-surface px-1.5 py-0.5 font-semibold text-slate-700';

  return (
    <section className="mb-5 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">
        Draft knowledge items
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Turns scored articles into drafted items in the review queue. Nothing reaches students
        until you approve it there.
      </p>
      {/* Said here, on the button that starts it, rather than left to be
          discovered. The salvage pass costs money too, and a spend that begins
          without having been mentioned is the kind a person finds on a bill. */}
      <p className="mt-1 text-xs text-violet-800">
        When this finishes, the <strong>salvage pass</strong> starts by itself on the articles this
        run did not take — keeping only the examinable facts inside them, as Miscellaneous cards.
      </p>

      {picking ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-brand-800">
          <strong>{selected.length} article(s) picked by hand.</strong>
          <span className="text-slate-600">
            The selector is ignored for this run — what you ticked is what gets drafted.
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            className="font-semibold text-brand-700 underline"
          >
            Clear the selection
          </button>
        </p>
      ) : advanced ? (
        <div className="mt-3">
          <label className="text-xs font-semibold text-slate-700">
            Minimum score (flat threshold)
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={minScore}
              disabled={running}
              onChange={(ev) => setMinScore(Number(ev.target.value))}
              className="mt-1 block w-44"
            />
            <span className="font-mono text-sm font-bold text-slate-900">
              {minScore}
            </span>
          </label>
          <p className="mt-1 text-xs text-amber-700">
            {flatEligible.length} article(s) at or above {minScore}. A flat threshold ignores the
            syllabus: it will draft articles that feed no unit and skip articles that feed several.
          </p>
        </div>
      ) : !plan ? (
        <p className="mt-3 text-xs text-slate-500">
          {planErr ? `Could not work out the selection: ${planErr}` : 'Working out the selection…'}
        </p>
      ) : (
        <>
          {/* THE HEADLINE CLAIM, and the one number that matters: every article
              selected connects to a published syllabus unit. */}
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {picks.length} article{picks.length === 1 ? '' : 's'} selected
            {picks.length ? ' — all of them feed a syllabus unit' : ''}
            {plan.alreadyDrafted ? (
              <span className="font-normal text-slate-500"> · {plan.alreadyDrafted} already drafted</span>
            ) : null}
          </p>

          <p className="mt-1 text-xs text-slate-600">
            Ranked by <strong>55% syllabus leverage + 45% relevance score</strong>. Leverage counts
            the distinct syllabus units an article feeds, with a bonus when a unit is named in the
            headline. Nothing that connects to no unit is drafted automatically.
          </p>

          {picks.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
              <span className="font-semibold uppercase tracking-wide text-slate-500">Syllabus</span>
              {['4+', '3', '2', '1'].map((k) =>
                byUnits[k] ? (
                  <span key={k} className={chip}>
                    {byUnits[k]} feed {k} unit{k === '1' ? '' : 's'}
                  </span>
                ) : null
              )}
              {headlineAnchored ? (
                <span className={chip}>{headlineAnchored} named in the headline</span>
              ) : null}
              <span className="mx-1 text-slate-400">|</span>
              <span className="font-semibold uppercase tracking-wide text-slate-500">Blueprint</span>
              <span className={chip}>
                {pyqBacked} of {picks.length} carry an angle APPSC has asked before
              </span>
            </div>
          ) : null}

          {/* THE BAND — the knob that is genuinely adaptive. Not"which
              articles", which the selector decides, but"how big a digest should
              a day yield". */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">Digest size</span>
            <input
              type="number"
              min="1"
              max="200"
              disabled={running}
              value={band ? band.min : cfg?.minItems ?? 12}
              onChange={(ev) =>
                setBand({
                  min: Math.max(1, Number(ev.target.value) || 1),
                  max: band ? band.max : cfg?.maxItems ?? 35,
                })
              }
              className="w-16 rounded-md border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-500">to</span>
            <input
              type="number"
              min="1"
              max="200"
              disabled={running}
              value={band ? band.max : cfg?.maxItems ?? 35}
              onChange={(ev) =>
                setBand({
                  min: band ? band.min : cfg?.minItems ?? 12,
                  max: Math.max(1, Number(ev.target.value) || 1),
                })
              }
              className="w-16 rounded-md border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-500">
              items. A thin paper reaches further down the ranking; a rich one stops at the cap.
            </span>
            {band ? (
              <button
                type="button"
                onClick={() => setBand(null)}
                className="font-semibold text-brand-700 underline"
              >
                reset
              </button>
            ) : null}
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={busy || running || !todo}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {running
            ? 'Drafting…'
            : picking
              ? `Draft the ${todo} you picked · about ${eta} min`
              : `Draft ${todo} article(s) · about ${eta} min`}
        </button>

        {!picking ? (
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
          >
            {advanced ? 'Use the adaptive selection' : 'Advanced: use a flat score threshold'}
          </button>
        ) : null}
      </div>

      {/* WHAT IT PICKED, on demand. Collapsed by default because the summary
          above is the decision; this is the audit trail behind it. */}
      {!picking && !advanced && picks.length ? (
        <details className="mt-3" open={showPicks} onToggle={(e) => setShowPicks(e.target.open)}>
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            What it picked, and why ({picks.length})
          </summary>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2 font-semibold">Rank</th>
                  <th className="py-1 pr-2 font-semibold">Score</th>
                  <th className="py-1 pr-2 font-semibold">Headline</th>
                  <th className="py-1 font-semibold">Syllabus units it feeds</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => (
                  <tr key={p.id} className="border-t border-slate-200 align-top">
                    <td className="py-1 pr-2 font-mono font-bold text-brand-800">
                      {p.rank}
                    </td>
                    <td className="py-1 pr-2 font-mono text-slate-500">{Math.round(p.score)}</td>
                    <td className="py-1 pr-2 text-slate-800">
                      <span className="text-slate-400">p{p.page} </span>
                      {(p.headline || '').slice(0, 70)}
                    </td>
                    <td className="py-1">
                      <span className="flex flex-wrap gap-1">
                        {p.units.map((u) => (
                          <span
                            key={u.unit_code}
                            title={u.label}
                            className={
                              'rounded px-1 py-px font-mono ' +
                              (u.exam === 'g2'
                                ? 'bg-brand-100 text-brand-800'
                                : 'bg-green-100 text-green-800')
                            }
                          >
                            {u.unit_code}
                            {u.in_headline ? '★' : ''}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-slate-500">
              ★ = the unit is named in the headline, which is what the story is about rather than
              something it mentions. Blue = Group II, green = Group I Prelims.
            </p>
          </div>
        </details>
      ) : null}

      {/* THE VOCABULARY TO-DO LIST. Named rather than silently excluded: these
          are articles the scorer liked and the syllabus map could not place, and
          that is usually a missing alias rather than a worthless article. */}
      {!picking && !advanced && unmatched.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-amber-800">
            Turned down — scored 45+ but match no syllabus unit ({unmatched.length})
          </summary>
          <p className="mt-1 text-[11px] text-slate-600">
            Each is either a gap in the syllabus vocabulary or a genuinely unexaminable story. The
            score cannot tell them apart, which is why they are shown rather than guessed at.
          </p>
          <ul className="mt-1 space-y-0.5">
            {unmatched.map((u) => (
              <li key={u.id} className="text-[11px] text-slate-700">
                <span className="font-mono text-slate-500">{Math.round(u.score)}</span>{' '}
                <span className="text-slate-400">p{u.page}</span> {(u.headline || '').slice(0, 78)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={running}
            onClick={() => onSelect?.(unmatched.map((u) => u.id))}
            className="mt-1 text-[11px] font-semibold text-brand-700 underline disabled:opacity-40"
          >
            Draft these anyway, by hand
          </button>
        </details>
      ) : null}

      {msg ? (
        <p
          className={
            'mt-2 text-xs ' +
            (msg.kind === 'error'
              ? 'text-red-700'
              : 'text-green-700')
          }
        >
          {msg.text}
        </p>
      ) : null}

      {run ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-surface p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                'rounded px-1.5 py-0.5 font-bold uppercase ' +
                (run.status === 'running'
                  ? 'bg-amber-100 text-amber-800'
                  : run.status === 'failed'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800')
              }
            >
              {run.status}
            </span>
            <span className="text-slate-600">
              {run.candidates} considered · {run.drafted} drafted · {run.discarded} discarded ·{' '}
              {run.model}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
            <span>Started {clockOf(run.created_at)}</span>
            {run.finished_at ? <span>Finished {clockOf(run.finished_at)}</span> : null}
            {durationOf(run.created_at, run.finished_at) ? (
              <span>Took {durationOf(run.created_at, run.finished_at)}</span>
            ) : null}
          </div>
          {run.status === 'done' ? (
            <p className="mt-2 rounded bg-green-50 px-2 py-1.5 text-xs font-semibold text-green-800">
              {run.drafted > 0
                ? `Done — ${run.drafted} item${run.drafted === 1 ? '' : 's'} inserted into the review queue` +
                  (run.discarded ? `, ${run.discarded} discarded` : '') +
                  '. Nothing is visible to students until you approve it there.'
                : 'Done — nothing was drafted. Every article the model saw was discarded as not examinable.'}
              {run.drafted > 0 ? (
                <>
                  {' '}
                  <Link to="/admin/queue" className="underline">
                    Open the review queue →
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}

          {run.log ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold text-slate-700">
                Run log
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-600">
                {run.log}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// The Group-II syllabus units an article feeds, read off np_article_units.
//
// This is the column that answers the question the score cannot: not"how
// examinable does this look" but"what does it actually feed". An article with
// nothing here is filler however many AP place names it contains — nineteen
// articles scoring between 35 and 48 on the two stored editions matched no unit
// at all, among them a search for missing fishermen, a diesel loco shed
// inspection and a road-safety drive.
function UnitChips({ units }) {
  if (!units?.length) {
    return (
      <span
        className="rounded bg-slate-200 px-1.5 font-semibold text-slate-600"
        title="Matches no unit of the Group-I or Group-II syllabus. Usually not worth drafting."
      >
        off-syllabus
      </span>
    );
  }
  return (
    <>
      {units.slice(0, 3).map((u) => (
        <span
          key={u.unit_code}
          className={`rounded px-1.5 font-semibold ${
            u.in_headline
              ? 'bg-green-200 text-green-900'
              : 'bg-green-100 text-green-800'
          }`}
          title={`${u.label || u.unit_code}${u.matched ? ` — matched on"${u.matched}"` : ''}${
            u.in_headline ? ' (named in the headline)' : ''
          }`}
        >
          {u.unit_code}
        </span>
      ))}
      {units.length > 3 ? <span>+{units.length - 3}</span> : null}
    </>
  );
}

function ArticleList({ rows, muted, selected = [], onToggle }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">None.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((a) => (
        <li
          key={a.id}
          className={
            'rounded-md border p-2.5 ' +
            (selected.includes(a.id)
              ? 'border-brand-400 bg-brand-50 '
              : 'border-slate-200 bg-surface ') +
            (muted ? 'opacity-70' : '')
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {onToggle ? (
              <label className="inline-flex cursor-pointer items-center" title="Draft this article">
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  onChange={() => onToggle(a.id)}
                  className="h-4 w-4 cursor-pointer accent-brand-600"
                  aria-label={`Select: ${a.headline}`}
                />
              </label>
            ) : null}
            <BandBadge band={a.band} score={a.score} />
            <UnitChips units={a.units} />
            <span className="font-mono">p{a.page}</span>
            {/* What kind of piece the page says this is. Shown BEFORE drafting,
                because on the editorial page the difference between a report and
                an argument is the difference between a fact and a claim, and the
                admin deciding what to draft should see it here rather than
                discover it in the queue. */}
            <GenreChip genre={a.genre} section={a.section} why={a.genre_why} />
            {a.prominence ? <span>{a.prominence}×</span> : null}
            {a.ap ? (
              <span className="rounded bg-brand-100 px-1.5 font-bold text-brand-800">
                AP
              </span>
            ) : null}
            {a.dateline ? <span className="uppercase">{a.dateline}</span> : null}
            {a.extraction === 'ocr' ? (
              <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800">
                OCR{a.ocr_confidence ? ` ${Math.round(a.ocr_confidence)}%` : ''}
              </span>
            ) : null}
            <span>{a.chars} chars</span>
            {a.item_id ? (
              <Link to={`/item/${a.item_id}`} className="text-green-700 hover:underline">
                drafted →
              </Link>
            ) : null}
          </div>
          <p className="mt-0.5 font-medium text-slate-900">{a.headline}</p>
          {a.standfirst ? (
            <p className="text-xs text-slate-600">{a.standfirst}</p>
          ) : null}
          {a.bucket ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {a.bucket}
              {a.subjects ? ` · ${a.subjects}` : ''}
            </p>
          ) : null}
          {a.discard_reason ? (
            <p className="mt-1 text-xs text-slate-500">
              <RichText>{a.discard_reason}</RichText>
            </p>
          ) : null}
          <Breakdown raw={a.breakdown} />
        </li>
      ))}
    </ul>
  );
}
