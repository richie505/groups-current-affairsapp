import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import RichText from '../../components/RichText';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import McqEditor from '../../components/admin/McqEditor';
import TagPicker from '../../components/admin/TagPicker';
import { Chip } from '../../components/Badges';
import { BUCKETS, longDate } from '../../lib/caFormat';
import { IconPlus, IconTrash, IconCheck } from '../../components/Icon';
import useConfirm from '../../components/useConfirm';


const BLANK = {
  headline: '',
  event_date: '',
  bucket: 'national',
  subject_tag: '',
  notes_markdown: '',
  static_linkage: '',
  static_notes: '',
  prelims_facts: '',
  // The rest of the eight-section Group-I note. These columns were added to
  // ca_items after this editor first shipped, and the editor was never caught
  // up — so the pipeline was writing six populated sections that no screen in
  // the app could display or edit. On a 28-item run that was roughly 2,250
  // characters per item of drafted content, invisible.
  importance: 2,
  relevance_g2: 1,
  needs_verify: 0,
  verify_note: '',
  keywords: [],
  units: [],
  sources: [],
};

export default function AdminItemEditor() {
  const { dayId } = useParams();
  const items = useResource(`/admin/days/${dayId}/items`);
  const days = useResource('/admin/days');
  const meta = useResource('/meta');
  const [editing, setEditing] = useState(null);

  if (items.loading || meta.loading) return <Loading />;
  if (items.error) return <ErrorState error={items.error} onRetry={items.reload} />;

  const day = days.data?.days?.find((d) => String(d.id) === String(dayId));

  return (
    <div>
      <Link to="/admin/days" className="mb-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        ← Digests
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">
        {day ? longDate(day.date) : `Digest #${dayId}`}
      </h1>
      <p className="mb-5 text-sm text-slate-600">
        {items.data.items.length} item{items.data.items.length === 1 ? '' : 's'} in this digest.
      </p>

      {editing ? (
        <ItemForm
          initial={editing}
          dayId={dayId}
          meta={meta.data}
          onDone={() => {
            setEditing(null);
            items.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ ...BLANK })}
          className="mb-5 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <IconPlus /> Add item
        </button>
      )}

      <div className="space-y-4">
        {/* An anchor per item, so a link from elsewhere can point at ONE item
            on a day that carries thirty. The review queue links here by
            #item-<id> — without the target the link opens the right day and
            leaves the reader to scroll for the row they were sent to. */}
        {items.data.items.map((it) => (
          <ItemRow
            key={it.id}
            anchorId={`item-${it.id}`}
            item={it}
            meta={meta.data}
            onEdit={() => setEditing(it)}
            onChanged={items.reload}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({ item, meta, onEdit, onChanged, anchorId }) {
  const [showMcqs, setShowMcqs] = useState(false);
  const [error, setError] = useState('');
  const { confirm, dialog } = useConfirm();

  async function remove() {
    const ok = await confirm({
      title: 'Delete this item and all its questions?',
      body: [item.headline, 'This cannot be undone.'],
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/admin/items/${item.id}`);
    onChanged();
  }

  async function publish() {
    try {
      await api.post(`/admin/items/${item.id}/publish`, {});
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <article id={anchorId} className="scroll-mt-20 rounded-lg border border-slate-200 bg-surface p-4">
      {dialog}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Chip
          className={
            item.status === 'published'
              ? 'border-green-300 bg-green-100 text-green-800'
              : item.status === 'discarded'
                ? 'border-slate-300 bg-slate-100 text-slate-500'
                : 'border-amber-300 bg-amber-100 text-amber-800'
          }
        >
          {item.status}
        </Chip>
        <Chip className="border-slate-300 bg-slate-100 text-slate-700">
          {BUCKETS[item.bucket]?.label || item.bucket}
        </Chip>
        <Chip className="border-slate-300 bg-slate-100 text-slate-700">Tier {item.importance}</Chip>
        <span className="ml-auto text-xs text-slate-500">
          {item.mcqs.length} question{item.mcqs.length === 1 ? '' : 's'}
        </span>
      </div>

      <h3 className="mb-2 font-semibold text-slate-900">{item.headline}</h3>

      {item.status === 'discarded' && item.discard_reason ? (
        <p className="mb-2 text-xs text-slate-500">
          Discarded: <RichText>{item.discard_reason}</RichText>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setShowMcqs((v) => !v)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {showMcqs ? 'Hide' : 'Questions'}
        </button>
        {item.status !== 'published' ? (
          <button
            type="button"
            onClick={publish}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
          >
            <IconCheck /> Publish
          </button>
        ) : null}
        <button
          type="button"
          onClick={remove}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          <IconTrash /> Delete
        </button>
      </div>

      {showMcqs ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <McqEditor itemId={item.id} mcqs={item.mcqs} meta={meta} onChanged={onChanged} />
        </div>
      ) : null}
    </article>
  );
}

function ItemForm({ initial, dayId, meta, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...BLANK,
    ...initial,
    event_date: initial.event_date || '',
    keywords: initial.keywords || [],
    units: (initial.units || []).map((u) => (typeof u === 'string' ? u : u.unit_code)),
    sources: initial.sources || [],
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState([]);

  const isNew = !initial.id;

  // Run the corrections guard against whatever is in the editor, not against
  // what was last saved. The point is to catch a superseded position while it
  // is still being typed.
  useEffect(() => {
    if (isNew) return;
    api
      .get(`/admin/items/${initial.id}/corrections`)
      .then((r) => setHits(r.hits))
      .catch(() => setHits([]));
  }, [initial.id, isNew]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      ...form,
      day_id: dayId,
      event_date: form.event_date || null,
      importance: Number(form.importance),
      relevance_g2: Number(form.relevance_g2),
      needs_verify: Number(form.needs_verify),
    };
    try {
      if (isNew) await api.post('/admin/items', body);
      else await api.put(`/admin/items/${initial.id}`, body);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600';
  const input = 'w-full rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-sm';

  return (
    <form onSubmit={save} className="mb-6 space-y-5 rounded-xl border-2 border-brand-300 bg-surface p-5">
      <h2 className="text-lg font-bold text-slate-900">{isNew ? 'New item' : 'Edit item'}</h2>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {hits.length ? (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-900">
            Touches a known correction
          </p>
          {hits.map((h) => (
            <p key={h.correction_id} className="text-xs text-amber-900">
              <strong>{h.topic}</strong> ({h.severity}) — {h.correct_position}
            </p>
          ))}
        </div>
      ) : null}

      <label className="block">
        <span className={label}>Headline</span>
        <input required value={form.headline} onChange={(e) => set('headline', e.target.value)} className={input} />
      </label>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={label}>Event date</span>
          <input
            type="date"
            value={form.event_date}
            onChange={(e) => set('event_date', e.target.value)}
            className={input}
          />
        </label>
        <label className="block">
          <span className={label}>Bucket</span>
          <select value={form.bucket} onChange={(e) => set('bucket', e.target.value)} className={input}>
            {Object.entries(BUCKETS).map(([k, b]) => (
              <option key={k} value={k}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Home subject</span>
          <input
            value={form.subject_tag}
            onChange={(e) => set('subject_tag', e.target.value)}
            placeholder="Economy"
            className={input}
          />
        </label>
        <label className="block">
          <span className={label}>Tier</span>
          <select
            value={form.importance}
            onChange={(e) => set('importance', e.target.value)}
            className={input}
          >
            <option value={1}>1 — recent, statutory, consequential</option>
            <option value={2}>2 — worth knowing</option>
            <option value={3}>3 — background</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={label}>Notes (markdown)</span>
        <textarea
          rows={7}
          value={form.notes_markdown}
          onChange={(e) => set('notes_markdown', e.target.value)}
          className={`${input} font-mono text-xs`}
        />
      </label>

      <label className="block">
        <span className={label}>Static linkage</span>
        <textarea
          rows={2}
          value={form.static_linkage}
          onChange={(e) => set('static_linkage', e.target.value)}
          placeholder="Which static syllabus unit does this news update?"
          className={input}
        />
      </label>

      <label className="block">
        <span className={label}>Static notes</span>
        <textarea
          rows={10}
          value={form.static_notes}
          onChange={(e) => set('static_notes', e.target.value)}
          placeholder="The standing syllabus material this news sits on — Articles, cases, bodies, the AP dimension. Markdown."
          className={input}
        />
      </label>

      {/* ---- Group-II lane ---- */}
      <fieldset className="rounded-lg border border-brand-200 bg-brand-50 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-brand-700">
          Group II lane
        </legend>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Number(form.relevance_g2) === 1}
            onChange={(e) => set('relevance_g2', e.target.checked ? 1 : 0)}
          />
          Relevant to Group II
        </label>
        <label className="mb-3 block">
          <span className={label}>Prelims facts</span>
          <textarea
            rows={3}
            value={form.prelims_facts}
            onChange={(e) => set('prelims_facts', e.target.value)}
            placeholder="The memorise-this block — names, dates, figures."
            className={input}
          />
        </label>
        <TagPicker
          label="Question angles"
          hint="How APPSC would actually test this. Check the Current Affairs list first, then the home subject."
          options={meta.keywords.map((k) => ({ value: k.keyword, group: k.subject }))}
          selected={form.keywords}
          onChange={(v) => set('keywords', v)}
        />
      </fieldset>

      {/* THE PAPER UNITS, moved out of the old Group-I fieldset.
          They are not a lane any more — both exams are objective and an item
          is routed to units in each — so they sit on their own, above the
          sources, rather than inside a block about a written paper. */}
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          Syllabus units
        </legend>
        <TagPicker
          label="Paper units"
          hint="Group-I Prelims and Group-II. Tag every unit this feeds, not just the obvious one — one event often serves three."
          options={meta.units.map((u) => ({ value: u.unit_code, group: u.paper, hint: u.label }))}
          selected={form.units}
          onChange={(v) => set('units', v)}
        />
      </fieldset>

      {/* ---- Sources ---- */}
      <SourceEditor sources={form.sources} onChange={(v) => set('sources', v)} />

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          Verification
        </legend>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Number(form.needs_verify) === 1}
            onChange={(e) => set('needs_verify', e.target.checked ? 1 : 0)}
          />
          A figure or name could not be confirmed at a second source
        </label>
        <label className="block">
          <span className={label}>What to check</span>
          <input
            value={form.verify_note}
            onChange={(e) => set('verify_note', e.target.value)}
            className={input}
          />
        </label>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SourceEditor({ sources, onChange }) {
  function update(i, patch) {
    onChange(sources.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  }
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
        Sources
      </legend>
      <p className="mb-2 text-xs text-slate-500">
        Prefer primary — PIB, PRS, RBI, ISRO, AP department portals. Treat coaching sites as leads,
        not sources.
      </p>
      <div className="space-y-2">
        {sources.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={s.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-surface px-2 py-1 text-sm"
            />
            <input
              value={s.publisher || ''}
              onChange={(e) => update(i, { publisher: e.target.value })}
              placeholder="PIB"
              className="w-24 rounded-md border border-slate-300 bg-surface px-2 py-1 text-sm"
            />
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={!!s.is_primary}
                onChange={(e) => update(i, { is_primary: e.target.checked ? 1 : 0 })}
              />
              Primary
            </label>
            <button
              type="button"
              onClick={() => onChange(sources.filter((_, j) => j !== i))}
              className="rounded-md border border-slate-300 px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...sources, { url: '', publisher: '', is_primary: 0 }])}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        <IconPlus /> Add source
      </button>
    </fieldset>
  );
}
