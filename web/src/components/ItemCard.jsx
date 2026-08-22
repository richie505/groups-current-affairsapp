import { Link } from 'react-router-dom';
import { useLens } from '../context/LensContext';
import {
  BucketBadge,
  ImportanceBadge,
  KeywordBadge,
  UnitBadge,
  BankBadge,
  VerifyBadge,
  GenreBadge,
  Chip,
} from './Badges';
import { shortDate } from '../lib/caFormat';
import RichText from './RichText';
import { IconCheck, IconBookmark } from './Icon';

// One news item, in whichever shape the lens asks for.
//
// The G2 block leads with the prelims facts — what to recall — and the keyword
// angles that say how it would be asked. The G1 block leads with THE ANGLE
// rather than THE FACT, which looks backwards until you notice that the fact is
// the part every candidate will have and the argument is the part that scores.
// Under the 'both' lens the two sit stacked, which is the point of the app: the
// student reads once and files twice.

export default function ItemCard({ item, showDate = false }) {
  const { showG1, showG2, isBoth } = useLens();

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
          {item.keywords?.length ? (
            <div className="flex flex-wrap gap-1">
              {item.keywords.map((k) => (
                <KeywordBadge key={k} keyword={k} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Group-I lane ---- */}
      {showG1 && item.relevance_g1 ? (
        <div className={isBoth ? 'mt-3 border-l-2 border-green-300 pl-3' : 'mt-2'}>
          {isBoth ? (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-green-800">
              Group I
            </p>
          ) : null}
          {/* On the digest the card shows the theme header and the trigger —
              enough to decide whether to open the full note. The eight sections
              live on the item page; a digest of twelve items each showing all
              eight would be unreadable. */}
          {item.g1_theme ? (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {item.g1_theme}
              {item.g1_sub_theme ? ` → ${item.g1_sub_theme}` : ''}
            </p>
          ) : null}
          {item.g1_why_news ? (
            <p className="mb-2 text-sm leading-relaxed text-slate-900">
              <RichText>{item.g1_why_news}</RichText>
            </p>
          ) : item.g1_angle ? (
            <p className="mb-2 text-sm leading-relaxed text-slate-800">
              <span className="font-semibold">The angle:</span>{' '}
              <RichText>{item.g1_angle}</RichText>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {item.g1_bank ? <BankBadge bank={item.g1_bank} /> : null}
            {/* Which dimensions the note actually covers, and whether it has an
                AP angle at all. Both are things a student should be able to see
                without opening the item — a note with one dimension and no AP
                line is a note that will produce a thin answer. */}
            {item.dimensions?.length ? (
              <Chip
                className="border-slate-300 bg-slate-100 capitalize text-slate-600"
                title={item.dimensions.map((d) => d.dimension).join(', ')}
              >
                {item.dimensions.length} dimension{item.dimensions.length === 1 ? '' : 's'}
              </Chip>
            ) : null}
            {item.g1_ap_angle ? (
              <Chip className="border-amber-300 bg-amber-100 text-amber-800" title="Has an Andhra Pradesh angle">
                AP angle
              </Chip>
            ) : null}
            {item.units?.map((u) => (
              <UnitBadge key={u.unit_code || u} unit={u} />
            ))}
          </div>
        </div>
      ) : null}

      {/* MCQ count doubles as the reason to mark the item read — the questions
          are behind that click, and saying how many are waiting is what makes
          the unlock worth doing. */}
      {showG2 && item.mcq_count > 0 ? (
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
