import { Link, useParams } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import ItemCard from '../components/ItemCard';
import { Chip } from '../components/Badges';
import { BANKS } from '../lib/caFormat';
import { IconFolder, IconAlert } from '../components/Icon';

// The bank review.
//
// This screen exists because cards accumulate and nobody looks at them again —
// that is how a capture system quietly becomes a graveyard, and the student
// finds out in the final weeks, when the banks were supposed to have become
// their revision resource.
//
// So it reports problems rather than a score. "142 cards" is flattering and
// useless; "Quotations at 6 of 40, and three themes have no AP example" is what
// changes what gets done this week.
export default function Banks() {
  const { bank } = useParams();
  if (bank) return <OneBank bank={bank.toUpperCase()} />;
  return <Review />;
}

function Review() {
  const { data, error, loading, reload } = useResource('/banks');
  if (loading) return <Loading label="Reviewing your banks…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const r = data;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">My banks</h1>
      <p className="mb-5 text-sm text-slate-600">
        {r.total} of {r.target_total} cards filed. These four banks feed Paper I and double as
        recall material for Papers II–V.
      </p>

      {/* Hunt list first. It is the only part of this page that says what to do
          next, and burying it under four progress bars is how it gets skipped. */}
      <section className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">
          Hunt this week
        </h2>
        <ul className="space-y-1.5 text-sm text-slate-800">
          {r.hunt.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-brand-600">→</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          The four banks
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {r.banks.map((b) => (
            <Link
              key={b.bank}
              to={`/banks/${b.bank}`}
              className={`rounded-lg border bg-surface p-4 hover:border-brand-300 ${
                r.thinnest_bank?.bank === b.bank ? 'border-amber-400' : 'border-slate-200'
              }`}
            >
              <div className="mb-1 flex items-baseline gap-2">
                <span className="font-mono text-lg font-bold text-slate-900">{b.bank}</span>
                <span className="text-sm font-semibold text-slate-800">{b.label}</span>
                {r.thinnest_bank?.bank === b.bank ? (
                  <Chip className="ml-auto border-amber-400 bg-amber-100 text-amber-900">
                    Thinnest
                  </Chip>
                ) : null}
              </div>
              <p className="mb-2 text-sm text-slate-600">
                <span className="text-xl font-bold text-slate-900">{b.count}</span>
                <span className="text-slate-500"> / {b.target}</span>
                {b.gap > 0 ? <span className="ml-2 text-xs">· {b.gap} to go</span> : null}
              </p>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full ${b.pct >= 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
              {b.gap > 0 ? <p className="text-xs text-slate-500">{b.hint}</p> : null}
            </Link>
          ))}
        </div>
      </section>

      {/* Theme coverage, with the AP count beside the total. The two numbers
          have to be read together: a theme with twelve cards and no AP example
          is a theme that will not survive Paper II or IV. */}
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-600">
          Coverage by theme
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Every theme should carry at least three Andhra Pradesh examples. A bank that is nationally
          rich and AP-thin fails in exactly the papers where AP is half the content.
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Theme</th>
                <th className="px-3 py-2">Cards</th>
                <th className="px-3 py-2">AP examples</th>
              </tr>
            </thead>
            <tbody>
              {r.themes.map((t) => (
                <tr key={t.theme} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 capitalize text-slate-800">{t.theme}</td>
                  <td className="px-3 py-2 text-slate-600">{t.count}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        t.ap_short > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-green-700'
                      }
                    >
                      {t.ap_count}
                    </span>
                    <span className="text-slate-400"> / {t.ap_target}</span>
                    {t.ap_short > 0 ? (
                      <span className="ml-2 text-xs text-amber-700">· {t.ap_short} short</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* The dangerous ones: filed in good faith, and now superseded. */}
      {r.stale.length ? (
        <section className="mb-6 rounded-xl border border-amber-400 bg-amber-50 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-900">
            <IconAlert /> Cards resting on a superseded position
          </h2>
          <ul className="space-y-2 text-sm">
            {r.stale.map((s) => (
              <li key={`${s.id}-${s.topic}`}>
                <Link to={`/item/${s.id}`} className="font-medium text-brand-700 hover:underline">
                  {s.headline}
                </Link>
                <p className="text-xs text-amber-900">
                  <strong>{s.topic}:</strong> {s.correct_position}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.duplicates.length ? (
        <section className="mb-6 rounded-xl border border-slate-300 bg-surface p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Possible duplicates
          </h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {r.duplicates.map((d) => (
              <li key={d.key}>
                {d.headline} <span className="text-xs text-slate-500">({d.n} cards)</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OneBank({ bank }) {
  const { data, error, loading, reload } = useResource(`/banks/${bank}`);
  const meta = BANKS[bank];

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div>
      <Link to="/banks" className="mb-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        ← All banks
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">
        <span className="font-mono">{bank}</span> · {meta?.label}
      </h1>
      <p className="mb-5 text-sm text-slate-600">{meta?.hint}</p>

      {data.items.length === 0 ? (
        <EmptyState
          icon={IconFolder}
          text="Nothing filed here yet. Open any item under the Group I lens and file it to a bank."
        />
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <div key={item.id}>
              <ItemCard item={item} showDate />
              {item.own_note ? (
                <p className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">Your note: </span>
                  {item.own_note}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
