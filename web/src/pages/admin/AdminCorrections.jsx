import { useState } from 'react';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import { IconPlus, IconTrash, IconAlert } from '../../components/Icon';

// The known-corrections register.
//
// This exists because a verification pass over the blueprint found four of nine
// checked facts had gone stale in fifteen months — three of them on Tier-1
// topics. That is the failure mode this app is most exposed to: a model
// drafting from older training data will confidently restate the superseded
// position, and unlike a static-subject error there is no textbook to catch it
// against.
//
// Every entry here is injected into the drafting prompt *and* checked against
// each draft afterwards, so both the instruction and the audit come from this
// one list. Adding a row is how a newly-superseded fact gets caught from then
// on, which makes this the most valuable maintenance surface in the admin.
export default function AdminCorrections() {
  const { data, error, loading, reload } = useResource('/admin/corrections');
  const [adding, setAdding] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  async function remove(id) {
    if (!window.confirm('Delete this correction? Drafts will stop being checked against it.')) return;
    await api.del(`/admin/corrections/${id}`);
    reload();
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Known corrections</h1>
      <p className="mb-5 text-sm text-slate-600">
        Facts that have changed and are commonly stated wrongly. Each one is fed into the drafting
        prompt and checked against every draft, so a superseded position cannot be quietly re-filed.
      </p>

      {adding ? (
        <CorrectionForm
          onDone={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-5 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <IconPlus /> Add a correction
        </button>
      )}

      <div className="space-y-3">
        {data.corrections.map((c) => (
          <article key={c.id} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="mb-2 flex items-start gap-2">
              <IconAlert className="mt-0.5 text-amber-700" />
              <h2 className="flex-1 font-semibold text-slate-900">{c.topic}</h2>
              {c.effective_date ? (
                <span className="text-xs text-slate-600">from {c.effective_date}</span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-surface"
              >
                <IconTrash />
              </button>
            </div>
            {c.superseded_claim ? (
              <p className="mb-1 text-sm text-slate-700">
                <span className="font-semibold text-red-700">Superseded: </span>
                <s>{c.superseded_claim}</s>
              </p>
            ) : null}
            <p className="mb-2 text-sm text-slate-900">
              <span className="font-semibold text-green-800">Correct: </span>
              {c.correct_position}
            </p>
            {c.match_terms ? (
              <p className="text-xs text-slate-600">
                <span className="font-medium">Triggers on:</span>{' '}
                <span className="font-mono">{c.match_terms}</span>
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function CorrectionForm({ onDone, onCancel }) {
  const [form, setForm] = useState({
    topic: '',
    superseded_claim: '',
    correct_position: '',
    effective_date: '',
    match_terms: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/admin/corrections', { ...form, effective_date: form.effective_date || null });
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
    <form onSubmit={save} className="mb-5 space-y-3 rounded-xl border-2 border-brand-300 bg-surface p-5">
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <label className="block">
        <span className={label}>Topic</span>
        <input
          required
          value={form.topic}
          onChange={(e) => set('topic', e.target.value)}
          placeholder="e.g. Labour Codes"
          className={input}
        />
      </label>
      <label className="block">
        <span className={label}>The superseded claim</span>
        <textarea
          rows={2}
          value={form.superseded_claim}
          onChange={(e) => set('superseded_claim', e.target.value)}
          placeholder="What people still wrongly write."
          className={input}
        />
      </label>
      <label className="block">
        <span className={label}>The correct position</span>
        <textarea
          rows={3}
          required
          value={form.correct_position}
          onChange={(e) => set('correct_position', e.target.value)}
          className={input}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Effective from</span>
          <input
            type="date"
            value={form.effective_date}
            onChange={(e) => set('effective_date', e.target.value)}
            className={input}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Items dated on or after this are treated as already correct, so they are not flagged.
          </span>
        </label>
        <label className="block">
          <span className={label}>Trigger terms</span>
          <input
            value={form.match_terms}
            onChange={(e) => set('match_terms', e.target.value)}
            placeholder="labour code, wage code, social security code"
            className={input}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Comma-separated, case-insensitive. Any match flags the item.
          </span>
        </label>
      </div>
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
