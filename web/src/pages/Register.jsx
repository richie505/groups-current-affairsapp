import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useRegistrationOpen from '../hooks/useRegistrationOpen';

// The exam track is asked for at registration rather than left to a default,
// because it decides what the app shows from the very first screen. Someone
// sitting only Group-II should never have to work out what a "bank" is.
const TRACKS = [
  { key: 'both', label: 'Both Group I and Group II', hint: 'Most people — read once, file for both' },
  { key: 'g2', label: 'Group II only', hint: 'Prelims facts, keyword angles, MCQs' },
  { key: 'g1', label: 'Group I only', hint: 'Capture cards, banks, paper-unit routing' },
];

export default function Register() {
  const { register } = useAuth();
  const registrationOpen = useRegistrationOpen();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', exam_track: 'both' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form.name, form.email, form.password, form.exam_track);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The hook is called above every return, and that is not stylistic — a hook
  // after an early return is React error #310, which blanks the page. See
  // scripts/check-hooks.js, which fails the build on it.
  if (registrationOpen === null) return null;

  // A URL someone bookmarked, or typed, on a deployment that creates accounts
  // from the admin screen. Filling in a form that is going to be refused is
  // worse than being told plainly, so this says so before the typing.
  if (registrationOpen === false) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Sign-up is closed</h1>
        <p className="mb-4 text-sm text-slate-600">
          Accounts on this site are created by the administrator, who will send you a link to
          set your own password. Ask them to add you.
        </p>
        <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Create an account</h1>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-5">
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
        </label>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Which exam?</legend>
          <div className="space-y-1.5">
            {TRACKS.map((t) => (
              <label
                key={t.key}
                className="flex cursor-pointer gap-2 rounded-md border border-slate-200 p-2 hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="track"
                  value={t.key}
                  checked={form.exam_track === t.key}
                  onChange={() => set('exam_track', t.key)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            You can switch view at any time — this only sets the starting lane.
          </p>
        </fieldset>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have one?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
