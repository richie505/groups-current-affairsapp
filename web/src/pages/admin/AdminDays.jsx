import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import { Chip } from '../../components/Badges';
import { longDate, todayIso } from '../../lib/caFormat';
import { IconPlus, IconCheck, IconPencil } from '../../components/Icon';

export default function AdminDays() {
  const { data, error, loading, reload } = useResource('/admin/days');
  const [newDate, setNewDate] = useState(todayIso());
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  async function createDay(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await api.post('/admin/days', { date: newDate, title });
      setTitle('');
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish(id) {
    setBusy(true);
    setMsg('');
    try {
      await api.post(`/admin/days/${id}/publish`, {});
      reload();
    } catch (err) {
      const blocked = err.data?.blocked;
      setMsg(
        blocked
          ? `${err.message} ${blocked.map((b) => `“${b.headline}”: ${b.errors.join(' ')}`).join(' | ')}`
          : err.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function unpublish(id) {
    setBusy(true);
    try {
      await api.post(`/admin/days/${id}/unpublish`, {});
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Digests</h1>

      <form
        onSubmit={createDay}
        className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-surface p-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Date</span>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 16th FC award, AP industrial policy"
            className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <IconPlus /> New digest
        </button>
      </form>

      {msg ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {msg}
        </p>
      ) : null}

      <div className="space-y-2">
        {data.days.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-surface p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">{longDate(d.date)}</p>
              {d.title ? <p className="truncate text-sm text-slate-600">{d.title}</p> : null}
              <p className="mt-0.5 text-xs text-slate-500">
                {d.published_count || 0} published · {d.draft_count || 0} draft ·{' '}
                {d.discarded_count || 0} discarded
              </p>
            </div>
            <Chip
              className={
                d.status === 'published'
                  ? 'border-green-300 bg-green-100 text-green-800'
                  : 'border-slate-300 bg-slate-100 text-slate-700'
              }
            >
              {d.status}
            </Chip>
            <Link
              to={`/admin/days/${d.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <IconPencil /> Items
            </Link>
            {d.status === 'published' ? (
              <button
                type="button"
                onClick={() => unpublish(d.id)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => publish(d.id)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700"
              >
                <IconCheck /> Publish
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
