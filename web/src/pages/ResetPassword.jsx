import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, setToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Loading from '../components/Loading';

// Reached only via a link an admin generated and sent. The token in the URL is
// the credential, which is why the page checks it before showing the form —
// otherwise someone with a dead link types a new password and only then finds
// out it was never going to work.
export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { applyIdentity } = useAuth();
  const [state, setState] = useState({ loading: true, valid: false, name: '' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/auth/reset/${token}`)
      .then((res) => setState({ loading: false, valid: true, name: res.name }))
      .catch((e) => setState({ loading: false, valid: false, error: e.message }));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/auth/reset/${token}`, { new_password: password });
      setToken(res.token);
      applyIdentity({ user: res.user, token: res.token });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <Loading label="Checking this link…" />;

  if (!state.valid) {
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <h1 className="mb-2 text-xl font-bold text-slate-900">This link is no longer valid</h1>
        <p className="text-sm text-slate-600">
          {state.error || 'Ask for a fresh reset link.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Set a new password</h1>
      <p className="mb-6 text-sm text-slate-600">for {state.name}</p>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-5">
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save and log in'}
        </button>
      </form>
    </div>
  );
}
