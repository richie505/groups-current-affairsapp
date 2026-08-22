import { useLens, LENS_LABELS } from '../context/LensContext';

// The switch that makes one digest serve two exams.
//
// Kept visible in the header rather than buried in settings, because it is not
// a preference — it is a mode the student changes within a session. Reading the
// same day's items as "facts to recall" and as "arguments to deploy" are
// different activities, and the toggle is how they say which one they are doing
// right now.

const ORDER = ['g2', 'g1', 'both'];

const HINTS = {
  g2: 'Group II shape — prelims facts, blueprint keyword angles, MCQs',
  g1: 'Group I shape — the fact, the angle, bank and paper-unit routing',
  both: 'Both lanes on every item',
};

export default function LensToggle({ className = '' }) {
  const { lens, setLens } = useLens();

  return (
    <div
      className={`inline-flex rounded-lg border border-slate-300 bg-surface p-0.5 ${className}`}
      role="group"
      aria-label="Exam track lens"
    >
      {ORDER.map((key) => {
        const active = lens === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setLens(key)}
            title={HINTS[key]}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              active
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {LENS_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
