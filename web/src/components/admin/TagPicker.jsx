import { useMemo, useState } from 'react';
import { IconX, IconSearch } from '../Icon';

// A searchable multi-select over a fixed vocabulary.
//
// Deliberately not a free-text field. Both tag sets — the blueprint keyword
// angles and the paper unit codes — are closed vocabularies, and the whole value
// of tagging is that a filter for "Appointed" or "P4-U4" finds everything. A
// free-text box produces "appointed", "Appointment", "Appointed " and three
// invisible partitions of the same data.
//
// There are ~490 keywords, so a plain <select multiple> is unusable: the search
// box is what makes the vocabulary navigable rather than merely present.
export default function TagPicker({ label, hint, options, selected, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => !selected.includes(o.value))
      .filter(
        (o) =>
          o.value.toLowerCase().includes(q) ||
          (o.hint || '').toLowerCase().includes(q) ||
          (o.group || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [query, options, selected]);

  function add(value) {
    onChange([...selected, value]);
    setQuery('');
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {hint ? <p className="mb-1.5 text-xs text-slate-500">{hint}</p> : null}

      {selected.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-slate-800"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s !== v))}
                aria-label={`Remove ${v}`}
                className="text-slate-400 hover:text-red-700"
              >
                <IconX />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A blur that fires before the click lands would close the list and
          // swallow the selection, so closing is deferred a tick.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type to search…"
          className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-7 pr-2 text-sm"
        />

        {open && matches.length ? (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-300 bg-surface shadow-lg">
            {matches.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => add(o.value)}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-800">{o.value}</span>
                  {o.group ? (
                    <span className="text-[11px] text-slate-500">{o.group}</span>
                  ) : null}
                  {o.hint ? (
                    <span className="truncate text-[11px] text-slate-400">{o.hint}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
