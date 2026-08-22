import { useState } from 'react';
import { api } from '../../api/client';
import Markdown from '../Markdown';
import { autoFormatMcqText } from '../../lib/mcqFormat';
import { FormatBadge, Chip } from '../Badges';
import { FORMATS } from '../../lib/caFormat';
import { IconPlus, IconTrash, IconPencil } from '../Icon';

const LETTERS = ['a', 'b', 'c', 'd'];

const BLANK = {
  question: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_option: 'a',
  explanation: '',
  format: 'direct_recall',
  keyword: '',
  difficulty: 2,
  fact_as_of: '',
};

// Questions for one item.
//
// The format is a first-class field rather than something inferred from the
// text, because Practice uses it to mix a paper across the eight formats the
// real exam uses. An untagged bank collapses into plain recall, which trains
// the wrong reflex for a paper that leans on assertion-reason and
// list-matching.
export default function McqEditor({ itemId, mcqs, meta, onChanged }) {
  const [editing, setEditing] = useState(null);

  async function remove(id) {
    if (!window.confirm('Delete this question?')) return;
    await api.del(`/admin/mcqs/${id}`);
    onChanged();
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-600">Questions</h4>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing({ ...BLANK })}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700"
          >
            <IconPlus /> Add question
          </button>
        ) : null}
      </div>

      {editing ? (
        <McqForm
          initial={editing}
          itemId={itemId}
          meta={meta}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {mcqs.length === 0 && !editing ? (
        <p className="text-sm text-slate-500">
          No questions yet. The Group-II lane has nothing to practise against until there is at
          least one.
        </p>
      ) : null}

      <ol className="space-y-2">
        {mcqs.map((m, i) => (
          <li key={m.id} className="rounded-md border border-slate-200 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">Q{i + 1}</span>
              <FormatBadge format={m.format} />
              {m.keyword ? (
                <Chip className="border-brand-200 bg-brand-50 text-brand-700">{m.keyword}</Chip>
              ) : null}
              <Chip className="border-slate-300 bg-slate-100 text-slate-700">
                Key: {m.correct_option.toUpperCase()}
              </Chip>
              {m.fact_as_of ? (
                <Chip className="border-slate-300 bg-slate-100 text-slate-600">
                  as of {m.fact_as_of}
                </Chip>
              ) : (
                <Chip className="border-amber-400 bg-amber-100 text-amber-900" title="Current-affairs keys go stale — record when this one was true.">
                  no date
                </Chip>
              )}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  className="rounded border border-red-300 px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
                >
                  <IconTrash />
                </button>
              </span>
            </div>
            <div className="prose-mcq text-sm font-medium">
              <Markdown>{autoFormatMcqText(m.question)}</Markdown>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {LETTERS.map((l) => (
                <li
                  key={l}
                  className={m.correct_option === l ? 'font-semibold text-green-700' : 'text-slate-600'}
                >
                  {l.toUpperCase()}. {m[`option_${l}`]}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function McqForm({ initial, itemId, meta, onDone, onCancel }) {
  const [form, setForm] = useState({ ...BLANK, ...initial, fact_as_of: initial.fact_as_of || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !initial.id;

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...form, item_id: itemId, fact_as_of: form.fact_as_of || null };
    try {
      if (isNew) await api.post('/admin/mcqs', body);
      else await api.put(`/admin/mcqs/${initial.id}`, body);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600';
  const input = 'w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm';

  return (
    <form onSubmit={save} className="mb-4 space-y-3 rounded-md border-2 border-brand-300 p-3">
      {error ? (
        <p className="rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className={label}>Question</span>
        <textarea
          rows={3}
          required
          value={form.question}
          onChange={(e) => set('question', e.target.value)}
          className={input}
        />
      </label>

      {/* Live preview, because multi-statement and assertion-reason questions
          are reformatted at display time — what is typed and what the student
          sees are not the same string, and the difference is worth checking
          before saving. */}
      {form.question ? (
        <div className="rounded-md bg-slate-100 p-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            As the student will see it
          </p>
          <div className="prose-mcq text-sm">
            <Markdown>{autoFormatMcqText(form.question)}</Markdown>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {LETTERS.map((l) => (
          <label key={l} className="block">
            <span className={label}>Option {l.toUpperCase()}</span>
            <input
              required
              value={form[`option_${l}`]}
              onChange={(e) => set(`option_${l}`, e.target.value)}
              className={input}
            />
          </label>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className={label}>Correct</span>
          <select
            value={form.correct_option}
            onChange={(e) => set('correct_option', e.target.value)}
            className={input}
          >
            {LETTERS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Format</span>
          <select value={form.format} onChange={(e) => set('format', e.target.value)} className={input}>
            {Object.entries(FORMATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Angle</span>
          <input
            list="mcq-keywords"
            value={form.keyword}
            onChange={(e) => set('keyword', e.target.value)}
            className={input}
          />
          <datalist id="mcq-keywords">
            {meta.keywords.map((k) => (
              <option key={k.keyword} value={k.keyword} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className={label}>Key true as of</span>
          <input
            type="date"
            value={form.fact_as_of}
            onChange={(e) => set('fact_as_of', e.target.value)}
            className={input}
          />
        </label>
      </div>

      <label className="block">
        <span className={label}>Explanation</span>
        <textarea
          rows={3}
          required
          value={form.explanation}
          onChange={(e) => set('explanation', e.target.value)}
          placeholder="State the fact and its date. Current-affairs keys get superseded, and the explanation is where the student finds out how fresh this one is."
          className={input}
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save question'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
