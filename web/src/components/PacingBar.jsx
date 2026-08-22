import { useEffect, useState } from 'react';
import { IconLock, IconCheck } from './Icon';

// The reading clock, shown on an item while paced learning is on.
//
// It is deliberately not a stopwatch a student watches. It is a bar that fills,
// with one line of text saying what it is for — because the moment this becomes
// a countdown to stare at, it has replaced the reading rather than protecting
// it. So: no seconds ticking past one minute, no alarm, no big numerals.
//
// The tick runs in the browser but the truth is on the server. `started_at` and
// `required_seconds` come down with the item, elapsed time is recomputed from
// the wall clock on every tick rather than accumulated, and the server refuses
// to mark the item read early regardless of what this component believes. A
// backgrounded tab, a closed laptop or a fiddled system clock therefore changes
// what is drawn and not what is allowed.

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  return m === 1 ? '1 min' : `${m} min`;
}

// Below a minute the exact seconds are useful — the student is nearly there and
// a bar that says "1 min" for fifty seconds looks stuck. Above it they are not,
// and would only invite watching.
function remainingLabel(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s <= 0) return 'unlocked';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${String(rest).padStart(2, '0')}s` : `${m}m`;
}

/**
 * @param {object} pacing        the item's pacing state, from the API
 * @param {boolean} markedRead   whether the item is already read
 * @param {() => void} onUnlock  called once, when the clock runs out
 */
export default function PacingBar({ pacing, markedRead, onUnlock }) {
  const required = Number(pacing?.required_seconds) || 0;
  const startedAt = pacing?.started_at || null;

  // Recomputed from the wall clock each tick rather than counted down, so a tab
  // that was backgrounded for five minutes comes back correct instead of five
  // minutes behind.
  const elapsedNow = () => {
    if (!startedAt) return 0;
    // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, which
    // Date parses as local time — an offset of hours. Naming the zone is the
    // whole fix, and getting it wrong here would unlock everything instantly.
    const started = Date.parse(`${startedAt.replace(' ', 'T')}Z`);
    if (Number.isNaN(started)) return 0;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  };

  const [elapsed, setElapsed] = useState(elapsedNow);

  useEffect(() => {
    if (!required || !startedAt) return undefined;
    setElapsed(elapsedNow());
    const t = setInterval(() => setElapsed(elapsedNow()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, startedAt]);

  const remaining = Math.max(0, required - elapsed);
  const unlocked = required === 0 || remaining === 0;

  // Told once, on the transition. The parent uses it to enable its button; it
  // must not fire on every tick or the button re-renders every second.
  useEffect(() => {
    if (unlocked && onUnlock) onUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  if (!required || markedRead) return null;

  const pct = required ? Math.min(100, Math.round((elapsed / required) * 100)) : 100;

  return (
    <section
      className={`mb-4 rounded-lg border px-3 py-2.5 ${
        unlocked
          ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40'
          : 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40'
      }`}
      aria-live="polite"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {unlocked ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-green-800 dark:text-green-300">
            <IconCheck /> Reading time complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-brand-800 dark:text-brand-200">
            <IconLock /> Questions unlock in {remainingLabel(remaining)}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-400">
          {/* Where the number came from, which matters: a student who set four
              minutes should be told it is their four minutes, not the app's. */}
          {pacing.mode === 'custom'
            ? `${formatDuration(required)} — your own setting`
            : `${formatDuration(required)} at a ${pacing.mode} pace`}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading time"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
            unlocked ? 'bg-green-600' : 'bg-brand-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
        {unlocked
          ? 'Mark it read to open the questions.'
          : 'The clock is running — leave and come back and it keeps its place. Change or switch off your pace in Your account.'}
      </p>
    </section>
  );
}
