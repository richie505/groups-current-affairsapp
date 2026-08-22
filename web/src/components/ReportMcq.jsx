import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconAlert, IconCheck, IconX } from './Icon';

// Reporting a bad question.
//
// Most of the 46,000-odd MCQs were generated rather than hand-written, so a
// share of them will have a wrong key or a garbled stem. The students working
// through them are the only people who reliably find those, and until now
// they had nowhere to say so. Each report lands in an admin queue.

// "Outdated" sits near the top because it is the failure mode specific to this
// material: a question can have been perfectly correct when written and be
// wrong three months later, and a student who has just read the newer position
// is the person most likely to notice. Lumping that in with "wrong answer"
// would lose the distinction the admin needs to fix it.
const REASONS = [
  { key: 'wrong_answer', label: 'The marked answer is wrong' },
  { key: 'outdated', label: 'This has been superseded by a later development' },
  { key: 'not_in_notes', label: "This isn't covered in the notes" },
  { key: 'unclear', label: 'The question is unclear or ambiguous' },
  { key: 'typo', label: 'Typo or formatting problem' },
  { key: 'other', label: 'Something else' },
];

export default function ReportMcq({ mcqId }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].key);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null); // 'sent' | 'already'
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  // Same dismissal contract as the rest of the app's popovers: Escape closes
  // and hands focus back to whatever opened it, and a click elsewhere closes.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(e) {
      if (!panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  async function send() {
    setSending(true);
    setError('');
    try {
      const res = await api.post(`/mcqs/${mcqId}/flag`, { reason, note });
      setDone(res?.already_reported ? 'already' : 'sent');
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-green-700">
        <IconCheck />
        {done === 'already' ? "You've already reported this one." : 'Reported — thanks, we’ll review it.'}
      </p>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:underline"
      >
        <IconAlert /> Report a problem
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Report a problem with this question"
          className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-surface p-3 shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-sm font-medium">What's wrong with it?</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <IconX />
            </button>
          </div>

          <div className="space-y-1.5">
            {REASONS.map((r) => (
              <label key={r.key} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`report-${mcqId}`}
                  value={r.key}
                  checked={reason === r.key}
                  onChange={() => setReason(r.key)}
                  className="mt-0.5"
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>

          <label className="mt-2 block">
            <span className="sr-only">Extra detail (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))}
              rows={2}
              placeholder="Anything else that would help (optional)"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500"
            />
          </label>

          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="mt-2 w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      )}
    </div>
  );
}
