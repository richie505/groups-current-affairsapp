import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const TRACKS = [
  { key: 'both', label: 'Both Group I and Group II' },
  { key: 'g2', label: 'Group II only' },
  { key: 'g1', label: 'Group I only' },
];

// Paced learning. The wording here does the work the numbers cannot: nobody
// knows what 180 words a minute feels like, but everybody knows the difference
// between a first read and a revision pass. Kept in step with PACES in
// server/src/lib/pacing.js, which is where the arithmetic lives.
const PACES = [
  { key: 'off', label: 'Off', hint: 'Questions open as soon as you mark an item read.' },
  {
    key: 'steady',
    label: 'Steady — a first read of the digest',
    hint: 'About 3 minutes on a full note. The usual choice.',
  },
  {
    key: 'thorough',
    label: 'Thorough — material to write an answer from',
    hint: 'Longer, for notes you mean to use in Mains practice.',
  },
  {
    key: 'brisk',
    label: 'Brisk — revisiting what you have already done',
    hint: 'Shorter, for a second pass through older items.',
  },
];

export default function Profile() {
  const { user, applyIdentity } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [track, setTrack] = useState(user?.exam_track || 'both');
  const [pacing, setPacing] = useState(user?.pacing || 'off');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const body = { name, exam_track: track, pacing };
      if (next) {
        body.current_password = current;
        body.new_password = next;
      }
      const res = await api.put('/auth/me', body);
      applyIdentity(res);
      setCurrent('');
      setNext('');
      setMsg('Saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Your account</h1>
      <p className="mb-5 text-sm text-slate-600">{user?.email}</p>

      <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5">
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
        ) : null}
        {msg ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Exam track</span>
          <select
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          >
            {TRACKS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Sets which lane the app opens in. The header toggle still switches view at any time.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Paced learning</span>
          <select
            value={pacing}
            onChange={(e) => setPacing(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          >
            {PACES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            {PACES.find((p) => p.key === pacing)?.hint}
          </span>
          {pacing !== 'off' ? (
            <span className="mt-1 block text-xs text-slate-500">
              With a pace set, an item&rsquo;s questions stay shut until its reading time has run.
              The clock starts when you open the item and keeps its place if you leave and come
              back. Switch it off here at any time.
            </span>
          ) : null}
        </label>

        <fieldset className="border-t border-slate-200 pt-4">
          <legend className="text-sm font-medium text-slate-700">Change password</legend>
          <p className="mb-2 text-xs text-slate-500">Leave blank to keep your current one.</p>
          <label className="mb-2 block">
            <span className="mb-1 block text-xs text-slate-600">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-600">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
            />
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
