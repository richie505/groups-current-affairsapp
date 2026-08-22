import { useTheme } from '../context/ThemeContext';
import { IconSun, IconMoon, IconMonitor } from './Icon';

// Three-way, not a switch. "System" is the default and needs to be reachable
// again after someone has picked light or dark, which a two-state toggle
// can't express.

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
            className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium ${
              active ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon />
            {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
