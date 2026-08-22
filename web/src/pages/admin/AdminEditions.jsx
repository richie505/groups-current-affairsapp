import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, getToken } from '../../api/client';
import useResource from '../../hooks/useResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';

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

const PUBLICATIONS = [
  { value: 'The Hindu', language: 'en' },
  { value: 'Eenadu', language: 'te' },
  { value: 'Indian Express', language: 'en' },
  { value: 'Sakshi', language: 'te' },
];

export default function AdminEditions() {
  const { id } = useParams();
  return id ? <OneEdition id={Number(id)} /> : <EditionList />;
}

// ---------------------------------------------------------------------------

function StatusPill({ status }) {
  const tone = {
    uploaded: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    processing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    processed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
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
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
    low: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  }[band];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${tone}`}>
      {score != null ? Math.round(score) : '?'} {band}
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
      <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
        why this score
      </summary>
      <div className="mt-1 rounded bg-slate-50 p-2 dark:bg-slate-900">
        {b.vetoed ? (
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Excluded: {b.vetoed}
          </p>
        ) : (
          <ul className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            {rows.map(([label, v]) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-32">{label}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Newspaper import</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Upload an edition, and it becomes articles. Everything downstream starts here.
        </p>
      </header>

      <form
        onSubmit={upload}
        className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Publication
            </span>
            <select
              value={form.publication}
              onChange={(e) => setForm((f) => ({ ...f, publication: e.target.value }))}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {PUBLICATIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Edition
            </span>
            <input
              type="text"
              value={form.edition}
              onChange={(e) => setForm((f) => ({ ...f, edition: e.target.value }))}
              placeholder="Vijayawada"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Edition date
            </span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="text-sm text-slate-700 dark:text-slate-300"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          The same file uploaded twice for the same date is recognised rather than duplicated.
          Telugu editions are accepted but cannot be read until Tesseract has{' '}
          <code>tel.traineddata</code> installed.
        </p>

        {msg ? (
          <p
            className={
              'mt-3 rounded-md px-3 py-2 text-sm ' +
              (msg.kind === 'error'
                ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'
                : msg.kind === 'ok'
                  ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200'
                  : 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300')
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
              className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={e.status} />
                <Link
                  to={`/admin/editions/${e.id}`}
                  className="font-semibold text-slate-900 hover:underline dark:text-slate-100"
                >
                  {e.publication}
                  {e.edition ? ` — ${e.edition}` : ''} · {e.date}
                </Link>
                <span className="text-xs text-slate-500">{mb(e.bytes)}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                {e.status === 'processed' ? (
                  <>
                    <span>{e.pages} pages</span>
                    <span>{e.pages_ocr} OCR'd</span>
                    <span>{e.pages_skipped} skipped as ads</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {e.distinct_articles} articles
                    </span>
                    <span>{e.ap_articles} AP</span>
                    {e.critical ? (
                      <span className="font-semibold text-red-700 dark:text-red-400">
                        {e.critical} critical
                      </span>
                    ) : null}
                    {e.high ? (
                      <span className="font-semibold text-orange-600 dark:text-orange-400">
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
                  <span className="text-red-700 dark:text-red-400">{e.error}</span>
                ) : null}
              </div>

              <div className="mt-2 flex gap-2">
                {e.status !== 'processing' ? (
                  <button
                    type="button"
                    onClick={() => process(e.id)}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                  >
                    {e.status === 'processed' ? 'Re-process' : 'Process'}
                  </button>
                ) : null}
                <Link
                  to={`/admin/editions/${e.id}`}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
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
  const { data, error, loading, reload } = useResource(`/admin/editions/${id}`);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const navigate = useNavigate();

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
    if (!window.confirm('Delete this edition and its extracted articles? Published knowledge items are kept.')) return;
    await api.del(`/admin/editions/${id}`);
    navigate('/admin/editions');
  }

  return (
    <div>
      <Link
        to="/admin/editions"
        className="mb-3 inline-block text-sm text-brand-700 hover:underline dark:text-brand-400"
      >
        ← All editions
      </Link>

      <header className="mb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <StatusPill status={e.status} />
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {e.publication}
            {e.edition ? ` — ${e.edition}` : ''} · {e.date}
          </h1>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
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
              className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{value}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {e.error ? (
        <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {e.error}
        </p>
      ) : null}

      {e.log ? (
        <details className="mb-4 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300">
            Extraction log
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400">
            {e.log}
          </pre>
        </details>
      ) : null}

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Articles ({live.length})
      </h2>
      <ArticleList rows={live} />

      {dups.length ? (
        <section className="mt-5">
          <button
            type="button"
            onClick={() => setShowDuplicates((v) => !v)}
            className="mb-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
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
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
        >
          Delete edition
        </button>
      </div>
    </div>
  );
}

function ArticleList({ rows, muted }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">None.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((a) => (
        <li
          key={a.id}
          className={
            'rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800 ' +
            (muted ? 'opacity-70' : '')
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <BandBadge band={a.band} score={a.score} />
            <span className="font-mono">p{a.page}</span>
            {a.prominence ? <span>{a.prominence}×</span> : null}
            {a.ap ? (
              <span className="rounded bg-brand-100 px-1.5 font-bold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                AP
              </span>
            ) : null}
            {a.dateline ? <span className="uppercase">{a.dateline}</span> : null}
            {a.extraction === 'ocr' ? (
              <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                OCR{a.ocr_confidence ? ` ${Math.round(a.ocr_confidence)}%` : ''}
              </span>
            ) : null}
            <span>{a.chars} chars</span>
            {a.item_id ? (
              <Link to={`/item/${a.item_id}`} className="text-green-700 hover:underline dark:text-green-400">
                drafted →
              </Link>
            ) : null}
          </div>
          <p className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{a.headline}</p>
          {a.standfirst ? (
            <p className="text-xs text-slate-600 dark:text-slate-400">{a.standfirst}</p>
          ) : null}
          {a.bucket ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {a.bucket}
              {a.subjects ? ` · ${a.subjects}` : ''}
            </p>
          ) : null}
          {a.discard_reason ? (
            <p className="mt-1 text-xs text-slate-500">{a.discard_reason}</p>
          ) : null}
          <Breakdown raw={a.breakdown} />
        </li>
      ))}
    </ul>
  );
}
