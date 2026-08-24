import { useState } from 'react';
import { download } from '../api/client';
import { IconDownload, IconSpinner } from './Icon';

// One day's digest, as a PDF.
//
// The app is where this material is meant to be read — questions feed Practice,
// wrong answers feed Mistakes, and none of that survives an export. What an
// export is for is the thing the app cannot do, which is travel: a phone with
// no signal, a printout the night before, a file that is still there when the
// account is not. A PDF opens on its own, without a markdown app, which is
// what most students asking for "the file" actually mean — the plain-markdown
// export still exists server-side (`/export.md`) for anyone who specifically
// wants it, just not surfaced here.
//
// Deliberately not a `<a href>`. The API authenticates on a bearer header and a
// link navigation sends no headers, so a plain link downloads a 401. See
// `download()` in web/src/api/client.js.
export default function DownloadDigest({ date, className = '', label = 'Download PDF' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      await download(`/days/${date}/export.pdf`, `appsc-current-affairs-${date}.pdf`);
    } catch (err) {
      // Shown next to the button rather than thrown. A failed download is not
      // a broken page, and replacing the digest with an error screen because a
      // file did not save would lose the thing the student came for.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={`Download ${date} as a PDF — notes, static background, prelims facts, questions and answer key`}
        className={`inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 ${className}`}
      >
        {busy ? <IconSpinner className="animate-spin" /> : <IconDownload />}
        {busy ? 'Preparing…' : label}
      </button>
      {error ? (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
