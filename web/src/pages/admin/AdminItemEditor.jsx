import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import McqEditor from '../../components/admin/McqEditor';
import TagPicker from '../../components/admin/TagPicker';
import { Chip } from '../../components/Badges';
import { BUCKETS, BANKS, longDate } from '../../lib/caFormat';
import { IconPlus, IconTrash, IconCheck } from '../../components/Icon';

const THEMES = [
  'governance',
  'ethics',
  'science & tech',
  'environment',
  'economy',
  'society & education',
  'federalism',
  'andhra pradesh',
];

const BLANK = {
  headline: '',
  event_date: '',
  bucket: 'national',
  subject_tag: '',
  notes_markdown: '',
  static_linkage: '',
  prelims_facts: '',
  g1_bank: '',
  g1_fact: '',
  g1_angle: '',
  // The rest of the eight-section Group-I note. These columns were added to
  // ca_items after this editor first shipped, and the editor was never caught
  // up — so the pipeline was writing six populated sections that no screen in
  // the app could display or edit. On a 28-item run that was roughly 2,250
  // characters per item of drafted content, invisible.
  g1_theme: '',
  g1_sub_theme: '',
  g1_why_news: '',
  g1_background: '',
  g1_ap_angle: '',
  g1_linked: '',
  g1_bridges: '',
  g1_way_forward: '',
  importance: 2,
  relevance_g1: 1,
  relevance_g2: 1,
  needs_verify: 0,
  verify_note: '',
  keywords: [],
  units: [],
  themes: [],
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
        {items.data.items.map((it) => (
          <ItemRow
            key={it.id}
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

function ItemRow({ item, meta, onEdit, onChanged }) {
  const [showMcqs, setShowMcqs] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete “${item.headline}” and all its questions? This cannot be undone.`)) {
      return;
    }
    await api.del(`/admin/items/${item.id}`);
    onChanged();
  }

  async function publish() {
    try {
      await api.post(`/admin/items/${item.id}/publish`, {});
      onChanged();
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-surface p-4">
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
        {item.g1_bank ? (
          <Chip className="border-slate-800 bg-slate-800 text-white">{item.g1_bank}</Chip>
        ) : null}
        <span className="ml-auto text-xs text-slate-500">
          {item.mcqs.length} question{item.mcqs.length === 1 ? '' : 's'}
        </span>
      </div>

      <h3 className="mb-2 font-semibold text-slate-900">{item.headline}</h3>

      {item.status === 'discarded' && item.discard_reason ? (
        <p className="mb-2 text-xs text-slate-500">Discarded: {item.discard_reason}</p>
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
    g1_bank: initial.g1_bank || '',
    keywords: initial.keywords || [],
    units: (initial.units || []).map((u) => (typeof u === 'string' ? u : u.unit_code)),
    themes: initial.themes || [],
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
      g1_bank: form.g1_bank || null,
      event_date: form.event_date || null,
      importance: Number(form.importance),
      relevance_g1: Number(form.relevance_g1),
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

      {/* ---- Group-I lane ---- */}
      <fieldset className="rounded-lg border border-green-300 bg-green-50 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-green-800">
          Group I lane
        </legend>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Number(form.relevance_g1) === 1}
            onChange={(e) => set('relevance_g1', e.target.checked ? 1 : 0)}
          />
          Relevant to Group I
        </label>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Bank</span>
            <select value={form.g1_bank} onChange={(e) => set('g1_bank', e.target.value)} className={input}>
              <option value="">— none —</option>
              {Object.entries(BANKS).map(([k, b]) => (
                <option key={k} value={k}>
                  {k} · {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mb-3 block">
          <span className={label}>The fact</span>
          <textarea
            rows={2}
            value={form.g1_fact}
            onChange={(e) => set('g1_fact', e.target.value)}
            placeholder="The exact sentence they would write in an exam — figure, name, provision or quote."
            className={input}
          />
        </label>
        <label className="mb-3 block">
          <span className={label}>The angle</span>
          <textarea
            rows={3}
            value={form.g1_angle}
            onChange={(e) => set('g1_angle', e.target.value)}
            placeholder="The ARGUMENT this fact supports — not what happened, but why it matters and what case it makes."
            className={input}
          />
          <span className="mt-1 block text-xs text-slate-600">
            Not the fact restated. If you cannot write an argument here, the item should be
            discarded — an item you cannot argue from will never appear in an answer.
          </span>
        </label>

        {/* The remaining six sections of the note template. Each is a separate
            field rather than one prose blob for the reason the schema gives: a
            note missing its AP angle will fail in the papers where AP is half
            the content, and that is only checkable if the AP angle has somewhere
            of its own to be missing from. */}
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Theme</span>
            <input
              type="text"
              value={form.g1_theme}
              onChange={(e) => set('g1_theme', e.target.value)}
              placeholder="GOVERNANCE"
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>Sub-theme</span>
            <input
              type="text"
              value={form.g1_sub_theme}
              onChange={(e) => set('g1_sub_theme', e.target.value)}
              placeholder="local government"
              className={input}
            />
          </label>
        </div>

        {[
          ['g1_why_news', 'Why in news', 2,
            'One line: what happened, and when.'],
          ['g1_background', 'Meaning / background', 4,
            'What a reader needs to know before the argument makes sense.'],
          ['g1_ap_angle', 'Andhra Pradesh angle', 3,
            'The AP dimension. If this is empty the note will fail in Papers II and IV.'],
          ['g1_linked', 'Linked schemes, reports, judgments', 3,
            'The specific instruments this connects to.'],
          ['g1_bridges', 'Essay link-lines', 3,
            'Lines ready to drop into a Paper I essay.'],
          ['g1_way_forward', 'Way forward', 2,
            'The forward-looking conclusion line.'],
        ].map(([field, labelText, rows, placeholder]) => (
          <label key={field} className="mb-3 block">
            <span className={label}>{labelText}</span>
            <textarea
              rows={rows}
              value={form[field]}
              onChange={(e) => set(field, e.target.value)}
              placeholder={placeholder}
              className={input}
            />
            {field === 'g1_ap_angle' && !String(form.g1_ap_angle || '').trim() ? (
              <span className="mt-1 block text-xs text-amber-700">
                No AP angle. Andhra Pradesh is roughly half of Papers II and IV and present in
                every Paper I essay — an item without one is worth much less.
              </span>
            ) : null}
          </label>
        ))}
        <div className="mb-3">
          <TagPicker
            label="Paper units"
            hint="Tag every paper this feeds, not just the obvious one — a single event often serves three."
            options={meta.units.map((u) => ({ value: u.unit_code, group: u.paper, hint: u.label }))}
            selected={form.units}
            onChange={(v) => set('units', v)}
          />
        </div>
        <TagPicker
          label="Themes"
          hint="For the bank review. Add 'andhra pradesh' as well as the topical theme where it applies."
          options={THEMES.map((t) => ({ value: t, group: 'themes' }))}
          selected={form.themes}
          onChange={(v) => set('themes', v)}
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
