import { Link } from 'react-router-dom';
import { useLens } from '../context/LensContext';
import {
  BucketBadge,
  ImportanceBadge,
  KeywordBadge,
  UnitBadge,
  VerifyBadge,
  GenreBadge,
} from './Badges';
import { shortDate } from '../lib/caFormat';
import RichText from './RichText';
import { IconCheck, IconBookmark } from './Icon';

// One news item, filed against whichever syllabus the lens asks for.
//
// Every paper this app serves is answered by ticking a box, so both lanes carry
// the same recallable facts and the same keyword angles. What differs is the
// SYLLABUS UNIT — where on each published syllabus this item sits. Under the
// 'both' lens the two sit stacked, which is the point of the app: the student
// reads once and files twice.

export default function ItemCard({ item, showDate = false }) {
  const { showG1, showG2, isBoth } = useLens();

  // THE TWO LANES ARE TWO SYLLABI, not two answer shapes.
  //
  // Both exams are answered by ticking a box, so the difference is no longer
  // written-versus-objective — it is WHICH published syllabus the unit belongs
  // to. Group-I Prelims units are `G1P-*`, Group-II units are `G2-*`, and
  // showing all of them in both places would tell a Group-II candidate their
  // syllabus includes six papers it does not.
  //
  // `exam` is null for a code no longer in ref_units — an old tag whose unit
  // was renamed. Those show in both lanes rather than disappearing.
  const units = item.units || [];
  const g1pUnits = units.filter((u) => u.exam !== 'g2');
  const g2Units = units.filter((u) => u.exam !== 'g1p');

  return (
    <article className="rounded-lg border border-slate-200 bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <BucketBadge bucket={item.bucket} />
        <ImportanceBadge importance={item.importance} />
        <GenreBadge genre={item.source_genre} author={item.source_author} />
        {item.needs_verify ? <VerifyBadge note={item.verify_note} /> : null}
        {showDate && item.day_date ? (
          <span className="text-[11px] text-slate-500">{shortDate(item.day_date)}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {item.bookmarked ? (
            <IconBookmark className="text-base text-brand-600" />
          ) : null}
          {item.marked_read ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700">
              <IconCheck /> Read
            </span>
          ) : null}
        </span>
      </div>

      <h3 className="mb-1 font-semibold leading-snug text-slate-900">
        <Link to={`/item/${item.id}`} className="hover:text-brand-700 hover:underline">
          {item.headline}
        </Link>
      </h3>

      {item.event_date && item.event_date !== item.day_date ? (
        <p className="mb-2 text-[11px] text-slate-500">
          Event dated {shortDate(item.event_date)}
        </p>
      ) : null}

      {/* ---- Group-II lane ---- */}
      {showG2 && item.relevance_g2 ? (
        <div className={isBoth ? 'mt-3 border-l-2 border-brand-200 pl-3' : 'mt-2'}>
          {isBoth ? (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
              Group II
            </p>
          ) : null}
          {item.prelims_facts ? (
            <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              <RichText>{item.prelims_facts}</RichText>
            </p>
          ) : null}
          {item.keywords?.length || g2Units.length ? (
            <div className="flex flex-wrap gap-1">
              {item.keywords?.map((k) => (
                <KeywordBadge key={k} keyword={k} />
              ))}
              {/* THE SYLLABUS TOPIC, beside the keyword angle rather than
                  instead of it. The two answer different questions and a
                  candidate needs both: the keyword is the SHAPE the question
                  takes ("Appointed", "GI tag"), the unit is WHERE ON THE
                  SYLLABUS it sits. This lane used to carry only the first, so
                  an item read as "Association, Export, Exports, Visited" with
                  no indication that it feeds AP industry and services. */}
              {g2Units.map((u) => (
                <UnitBadge key={u.unit_code} unit={u} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Group-I Prelims lane ---- */}
      {showG1 ? (
        <div className={isBoth ? 'mt-3 border-l-2 border-green-300 pl-3' : 'mt-2'}>
          {isBoth ? (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-green-800">
              Group I Prelims
            </p>
          ) : null}
          {/* The same facts, routed to the other syllabus. Only the units
              differ, which is exactly what the lens exists to show: one
              reading, filed against two published syllabi. */}
          {!showG2 && item.prelims_facts ? (
            <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              <RichText>{item.prelims_facts}</RichText>
            </p>
          ) : null}
          {g1pUnits.length ? (
            <div className="flex flex-wrap gap-1">
              {g1pUnits.map((u) => (
                <UnitBadge key={u.unit_code} unit={u} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No Group-I Prelims unit matched.</p>
          )}
        </div>
      ) : null}

      {/* MCQ count doubles as the reason to mark the item read — the questions
          are behind that click, and saying how many are waiting is what makes
          the unlock worth doing. */}
      {item.mcq_count > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          {item.marked_read ? (
            <>
              {item.mcq_count} question{item.mcq_count === 1 ? '' : 's'}
              {item.mcq_attempted > 0 ? ` · ${item.mcq_attempted} attempted` : null}
            </>
          ) : (
            <>🔒 {item.mcq_count} question{item.mcq_count === 1 ? '' : 's'} unlock once you mark this read</>
          )}
        </p>
      ) : null}
    </article>
  );
}
