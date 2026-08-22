import { useTheme } from '../context/ThemeContext';
import { IconSun, IconMoon, IconMonitor } from './Icon';

// Three-way, not a switch. "System" is the default and needs to be reachable
// again after someone has picked light or dark, which a two-state toggle
// can't express.
//
// The labels are hidden below `sm` in CSS rather than through the `compact`
// prop, because the navbar needs one component that is wide on a desktop and
// narrow on a phone, and a prop cannot be responsive. With the labels showing,
// this control was 215px of a 375px header — the single largest contributor to
// 74px of horizontal scroll on a phone.
//
// The icons stay, the accessible name stays, and the hit area grows rather than
// shrinks: 44px is the minimum a thumb can hit reliably.

const OPTIONS = [
  { key: 'light', label: 'Light', Icon: IconSun },
  { key: 'dark', label: 'Dark', Icon: IconMoon },
  { key: 'system', label: 'System', Icon: IconMonitor },
];

export default function ThemeToggle({ compact = false }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-slate-300 bg-slate-100 p-0.5"
    >
      {OPTIONS.map(({ key, label, Icon }) => {
        const active = preference === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(key)}
            title={label}
            className={`flex min-h-[44px] items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium sm:min-h-0 ${
              active ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon />
            <span className={compact ? 'sr-only' : 'sr-only sm:not-sr-only'}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
