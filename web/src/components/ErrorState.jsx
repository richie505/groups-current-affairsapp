import { IconAlert } from './Icon';

// Shown in place of content when a fetch fails. Before this existed every
// page sat on its <Loading /> spinner forever after a rejected request —
// indistinguishable from a slow network, with nothing the user could do.
//
// Three kinds of error land here:
//  - api/client.js rejections, which carry a numeric `.status` — mapped to a
//    plain-language explanation instead of the raw server string;
//  - locally-constructed validation Errors (no status, but a message written
//    for the user), which are shown verbatim;
//  - a failed fetch, which has neither — the only case that genuinely means
//    "couldn't reach the server".
const FETCH_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

function friendlyMessage(error) {
  const status = error?.status;
  if (status === 401) return 'Your session has expired — log in again to continue.';
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "We couldn't find this — it may have been removed.";
  if (status >= 500) return 'The server ran into a problem. This is usually temporary.';
  if (status) return error?.message || 'Something went wrong.';
  if (error?.message && !FETCH_FAILURE.test(error.message)) return error.message;
  return "Couldn't reach the server. Check your connection and try again.";
}

export default function ErrorState({ error, onRetry, retryLabel = 'Retry', compact = false }) {
  const message = friendlyMessage(error);

  if (compact) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
        <IconAlert className="shrink-0" />
        <span>{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="font-medium underline hover:no-underline">
            {retryLabel}
          </button>
        )}
      </p>
    );
  }

  return (
    <div role="alert" className="text-center bg-surface border border-dashed border-red-200 rounded-xl px-6 py-10">
      <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-xl">
        <IconAlert />
      </div>
      <p className="text-sm text-slate-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded-md px-4 py-2 font-medium"
        >
          Try again
        </button>
      )}
    </div>
  );
}
