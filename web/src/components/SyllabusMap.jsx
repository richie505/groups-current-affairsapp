import { useState } from 'react';
import { Link } from 'react-router-dom';
import useResource from '../hooks/useResource';
import Loading from './Loading';
import ErrorState from './ErrorState';
import RichText from './RichText';
import { Chip } from './Badges';

// THE SYLLABUS, WITH WHAT HAS FED EACH UNIT.
//
// The other three tabs are indexed by TOPIC — a vocabulary this project
// curated. Useful, and not what a candidate revises against. They revise
// against the syllabus the commission published, unit by unit, and the question
// they arrive with is"how much have I got for this one, and which ones have I
// got nothing for at all".
//
// The topic layer could not answer that for Group-II, because all 248 of its
// topic→unit mappings are Group-I Mains paper units. A Group-II candidate
// opening Topics was reading a map of somebody else's exam.
//
// This reads from ca_item_units instead, which Section 2 populates by matching
// the article's own text against the published syllabus vocabulary — so every
// exam is covered, and a unit sitting at zero is a real gap rather than a
// vocabulary nobody got round to curating.

export default function SyllabusMap() {
  const { data, error, loading, reload } = useResource('/topics/syllabus');
  const [open, setOpen] = useState(null);

  if (loading) return <Loading label="Loading the syllabus…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
        Every unit of the APPSC syllabus, with how much of this app’s material feeds it.{' '}
        <strong>Three of the four papers are answered by ticking a box</strong> — Group-II
        Screening and Mains, and Group-I Prelims — and only Group-I Mains is written, so the same
        news reaches them in different shapes.
      </p>

      {data.exams.map((exam) => (
        <section key={exam.id}>
          <header className="mb-2 border-b border-slate-200 pb-2">
            <h2 className="font-bold text-slate-900">{exam.name}</h2>
            <p className="text-xs text-slate-500">
              {exam.note} · <strong>{exam.covered}</strong> of {exam.feedable} feedable units have
              material · {exam.items} item{exam.items === 1 ? '' : 's'} ·{' '}
              {exam.questions} question{exam.questions === 1 ? '' : 's'}
            </p>
          </header>

          <ul className="divide-y divide-slate-100">
            {exam.units.map((u) => {
              // Three states, not two."Nothing yet" is a gap worth chasing;
              //"cannot be fed" is a decision already taken and explaining it
              // here stops it reading as the same thing.
              const cannotFeed = !!u.broad || !!u.unfeedable;
              const empty = !cannotFeed && !u.items;
              return (
                <li key={u.unit_code} className="py-2">
                  <button
                    type="button"
                    onClick={() => setOpen(open === u.unit_code ? null : u.unit_code)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span
                      className={
                        'mt-0.5 w-14 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[10px] font-bold ' +
                        (empty
                          ? 'bg-amber-100 text-amber-800'
                          : cannotFeed
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-green-100 text-green-800')
                      }
                    >
                      {u.unit_code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">
                        {u.label}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {cannotFeed ? (
                          <Chip className="border-slate-300 bg-slate-100 text-slate-500">
                            {u.unfeedable ? 'a newspaper cannot feed this' : 'matches everything'}
                          </Chip>
                        ) : u.items ? (
                          <>
                            <span>
                              {u.items} item{u.items === 1 ? '' : 's'}
                            </span>
                            {u.questions ? (
                              <span>
                                · {u.questions} question{u.questions === 1 ? '' : 's'}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="font-medium text-amber-700">
                            nothing yet
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  {open === u.unit_code ? <UnitItems code={u.unit_code} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UnitItems({ code }) {
  const { data, error, loading } = useResource(`/topics/syllabus/${encodeURIComponent(code)}`);
  if (loading) return <p className="ml-16 mt-2 text-xs text-slate-500">Loading…</p>;
  if (error) return <p className="ml-16 mt-2 text-xs text-red-600">{error.message}</p>;

  return (
    <div className="ml-16 mt-2">
      {/* The commission's own wording, where the map records it. A one-line
          label is enough to recognise a unit and not enough to revise against;
          this is the sentence the paper is actually set from. */}
      {data.unit.syllabus_text ? (
        <p className="mb-2 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">
          <RichText>{data.unit.syllabus_text}</RichText>
        </p>
      ) : null}
      {data.items.length ? (
        <ul className="space-y-1">
          {data.items.map((it) => (
            <li key={it.id} className="text-sm">
              <Link to={`/item/${it.id}`} className="text-brand-700 hover:underline">
                <RichText>{it.headline}</RichText>
              </Link>
              <span className="ml-1 text-xs text-slate-400">
                {it.day_date}
                {it.mcq_count ? ` · ${it.mcq_count}q` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">
          No published material feeds this unit yet.
        </p>
      )}
    </div>
  );
}
