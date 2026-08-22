import { useState } from 'react';
import useResource from '../../hooks/useResource';
import { api } from '../../api/client';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import { Chip } from '../../components/Badges';

const TRACK_LABELS = { g1: 'Group I', g2: 'Group II', both: 'Both' };

export default function AdminStudents() {
  const { data, error, loading, reload } = useResource('/admin/students');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  async function makeLink(id) {
    setBusy(id);
    try {
      const res = await api.post(`/admin/students/${id}/reset-link`, {});
      setLink({
        name: res.name,
        url: `${window.location.origin}/reset/${res.token}`,
        expires_at: res.expires_at,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Students</h1>

      {/* Shown once, at creation, and not recoverable afterwards — only the
          hash is stored, so a copy of the database is not a pile of working
          reset links. */}
      {link ? (
        <div className="mb-4 rounded-lg border border-brand-300 bg-brand-50 p-4">
          <p className="mb-1 text-sm font-semibold text-slate-900">
            Reset link for {link.name}
          </p>
          <p className="mb-2 break-all rounded bg-surface px-2 py-1.5 font-mono text-xs text-slate-800">
            {link.url}
          </p>
          <p className="text-xs text-slate-600">
            Send this over however you already talk to them. It expires {link.expires_at} and is
            shown only once — it cannot be recovered from here or from the database.
          </p>
          <button
            type="button"
            onClick={() => setLink(null)}
            className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-surface"
          >
            Done
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Track</th>
              <th className="px-3 py-2">Read</th>
              <th className="px-3 py-2">Accuracy</th>
              <th className="px-3 py-2">Cards</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => {
              const pct = s.attempts ? Math.round((s.correct / s.attempts) * 100) : null;
              return (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-slate-900">{s.name}</span>
                    <span className="block text-xs text-slate-500">{s.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Chip className="border-slate-300 bg-slate-100 text-slate-700">
                      {TRACK_LABELS[s.exam_track] || s.exam_track}
                    </Chip>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{s.items_read}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {pct === null ? '—' : `${pct}% of ${s.attempts}`}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{s.cards || 0}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => makeLink(s.id)}
                      disabled={busy === s.id}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Reset link
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.students.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No students have registered yet.</p>
      ) : null}
    </div>
  );
}
