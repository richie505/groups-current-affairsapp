import { useCallback, useRef, useState } from 'react';

// An in-page confirm, replacing window.confirm and window.prompt.
//
// WHY THIS EXISTS
//
// Because the native ones silently do nothing in more places than you would
// expect, and "silently" is the whole problem. A browser may refuse to show a
// dialog — every embedded/in-app webview does, and every desktop browser does
// it too once the user ticks "prevent this page from creating additional
// dialogs" on the second prompt. When it refuses, `window.confirm` does not
// throw and does not warn: it returns `false`, which every call site in this
// app reads as "the user clicked Cancel".
//
// So the button appears to be broken. It highlights, it does nothing, there is
// no error, and nothing in the console unless you go looking. That is exactly
// what happened to "Approve all" — clicked four times, four suppressed dialogs,
// no questions approved and no way to tell why.
//
// A dialog rendered by the page cannot be suppressed by the browser, cannot be
// disabled by a user setting, and can say more than one line of plain text —
// which matters here, because the things worth confirming in this app are worth
// describing ("their old questions are replaced in the same step", "questions a
// student has already answered are kept").
//
// The API deliberately mirrors the native one — `await confirm(...)` returns a
// boolean, `await prompt(...)` returns a string or null — so a call site
// changes by one keyword rather than by being rewritten.
//
//   const { confirm, dialog } = useConfirm();
//   ...
//   if (!(await confirm({ title: 'Delete this?', danger: true }))) return;
//   ...
//   return <>{dialog}<button onClick={...}/></>;
export default function useConfirm() {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  // The promise's resolve, held across renders so the buttons below can settle
  // the call that opened the dialog.
  const resolver = useRef(null);

  const open = useCallback((opts, kind) => {
    setValue(opts.initial || '');
    setState({ ...opts, kind });
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((answer) => {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    setValue('');
    if (resolve) resolve(answer);
  }, []);

  const confirm = useCallback((opts) => open(opts || {}, 'confirm'), [open]);
  const prompt = useCallback((opts) => open(opts || {}, 'prompt'), [open]);

  const dialog = state ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.title || 'Confirm'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      // Clicking the backdrop cancels, matching what every dialog does and what
      // pressing Escape does below.
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(state.kind === 'prompt' ? null : false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') settle(state.kind === 'prompt' ? null : false);
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
        <h2 className="text-base font-bold text-slate-900">{state.title || 'Are you sure?'}</h2>
        {state.body ? (
          <div className="mt-2 space-y-1.5 text-sm text-slate-600">
            {(Array.isArray(state.body) ? state.body : [state.body]).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}

        {state.kind === 'prompt' ? (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) settle(value.trim());
            }}
            placeholder={state.placeholder || ''}
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(state.kind === 'prompt' ? null : false)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {state.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            // A prompt whose answer is the RECORD of a decision — the discard
            // reason — must not be submittable empty, or the record is a blank.
            disabled={state.kind === 'prompt' && !value.trim()}
            autoFocus={state.kind !== 'prompt'}
            onClick={() => settle(state.kind === 'prompt' ? value.trim() : true)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
              state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-700 hover:bg-green-800'
            }`}
          >
            {state.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, prompt, dialog };
}
