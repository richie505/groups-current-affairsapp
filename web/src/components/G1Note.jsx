import Markdown from './Markdown';
import RichText from './RichText';
import { BankBadge, UnitBadge, Chip } from './Badges';
import { longDate } from '../lib/caFormat';

// The Group-I note, in the eight-section template.
//
// Group-I answers are written, not ticked, and each section here is a different
// thing a Mains answer needs — and a different thing that is easy to leave out.
// Rendering them as labelled blocks rather than one flowing note is the point:
// a missing AP angle or a missing bridge is meant to be visible as a gap, not
// smoothed over by prose.
//
// The order follows the template exactly, because it is also the order an answer
// gets built in: trigger → background → dimensions → AP → linkages → bridge →
// way forward → the questions this could be asked as.

const DIMENSION_LABELS = {
  economic: 'Economic',
  social: 'Social',
  political: 'Political',
  ethical: 'Ethical',
  environmental: 'Environmental',
  legal: 'Legal',
  international: 'International',
};

// Fixed order, so the same dimension sits in the same place on every note and
// the eye learns where to look.
const DIMENSION_ORDER = [
  'economic',
  'social',
  'political',
  'ethical',
  'environmental',
  'legal',
  'international',
];

function Section({ n, title, children, tone = 'plain', hint }) {
  const tones = {
    plain: 'border-slate-200',
    ap: 'border-amber-400 bg-amber-50',
    bridge: 'border-brand-300 bg-brand-50',
    forward: 'border-green-400 bg-green-50',
  };
  return (
    <section className={`rounded-lg border p-3 ${tones[tone]}`}>
      <h3 className="mb-1.5 flex items-baseline gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
        <span className="text-slate-400">{n}.</span>
        {title}
      </h3>
      {hint ? <p className="mb-1.5 text-[11px] italic text-slate-500">{hint}</p> : null}
      {children}
    </section>
  );
}

export default function G1Note({ item }) {
  const dims = (item.dimensions || [])
    .slice()
    .sort((a, b) => DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension));
  const essays = item.essay_questions || [];
  const direct = essays.filter((e) => e.kind === 'direct');
  const indirect = essays.filter((e) => e.kind === 'indirect');

  return (
    <div className="space-y-3">
      {/* Template header: [THEME] → Sub-theme, and the date tag. */}
      {item.g1_theme || item.g1_sub_theme ? (
        <div className="rounded-lg bg-slate-800 px-3 py-2 text-white">
          <p className="text-sm font-bold uppercase tracking-wide">
            <RichText>{item.g1_theme}</RichText>
            {item.g1_sub_theme ? (
              <span className="font-medium text-slate-300">
                {' → '}
                <RichText>{item.g1_sub_theme}</RichText>
              </span>
            ) : null}
          </p>
          <p className="text-[11px] text-slate-400">
            {item.headline}
            {item.event_date ? ` — ${longDate(item.event_date)}` : ''}
          </p>
        </div>
      ) : null}

      {item.g1_why_news ? (
        <Section n="1" title="Why in News">
          <p className="text-sm leading-relaxed text-slate-900">
            <RichText>{item.g1_why_news}</RichText>
          </p>
        </Section>
      ) : null}

      {item.g1_background ? (
        <Section n="2" title="Meaning / Background">
          <div className="prose-notes text-sm">
            <Markdown>{item.g1_background}</Markdown>
          </div>
        </Section>
      ) : null}

      {dims.length ? (
        <Section
          n="3"
          title="Multi-dimensional tags"
          hint="A topic tagged on one dimension only produces a one-dimensional answer."
        >
          <ul className="space-y-1.5">
            {dims.map((d) => (
              <li key={d.dimension} className="text-sm">
                <span className="mr-1.5 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {DIMENSION_LABELS[d.dimension] || d.dimension}
                </span>
                <span className="text-slate-800">{d.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* AP gets the loud treatment. It is roughly half of Papers II and IV and
          the one thing no national source will hand you, so it should never
          read as just another section. */}
      {item.g1_ap_angle ? (
        <Section n="4" title="Andhra Pradesh angle" tone="ap">
          <div className="prose-notes text-sm">
            <Markdown>{item.g1_ap_angle}</Markdown>
          </div>
        </Section>
      ) : null}

      {item.g1_linked ? (
        <Section n="5" title="Linked schemes / reports / judgments">
          <div className="prose-notes text-sm">
            <Markdown>{item.g1_linked}</Markdown>
          </div>
        </Section>
      ) : null}

      {/* Pre-built transitions. These are the sentences people improvise badly
          under time pressure, so they are written once and reused. */}
      {item.g1_bridges ? (
        <Section
          n="6"
          title="Essay link-lines (bridges)"
          tone="bridge"
          hint="Ready to drop into an essay to connect this topic to a wider theme."
        >
          <div className="prose-notes text-sm italic">
            <Markdown>{item.g1_bridges}</Markdown>
          </div>
        </Section>
      ) : null}

      {item.g1_way_forward ? (
        <Section n="7" title="Way forward" tone="forward">
          <p className="text-sm leading-relaxed text-slate-900">
            <RichText>{item.g1_way_forward}</RichText>
          </p>
        </Section>
      ) : null}

      {essays.length ? (
        <Section n="8" title="Possible essay questions">
          {direct.length ? (
            <>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Direct
              </p>
              <ul className="mb-2 space-y-1">
                {direct.map((e) => (
                  <li key={e.id} className="text-sm text-slate-900">
                    “{e.question}”
                    {e.note ? <span className="block text-[11px] text-slate-500">{e.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {indirect.length ? (
            <>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                As an example inside a wider essay
              </p>
              <ul className="space-y-1">
                {indirect.map((e) => (
                  <li key={e.id} className="text-sm text-slate-900">
                    “{e.question}”
                    {e.note ? <span className="block text-[11px] text-slate-500">{e.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Section>
      ) : null}

      {/* The capture card proper. Kept below the template because the template
          is what gets written from, while the fact and the bank are how the item
          is filed and found again. */}
      <section className="rounded-lg border border-slate-300 bg-slate-100 p-3">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
          Capture card
        </h3>
        {item.g1_fact ? (
          <p className="mb-1.5 text-sm text-slate-800">
            <span className="font-semibold">The fact: </span>
            <RichText>{item.g1_fact}</RichText>
          </p>
        ) : null}
        {item.g1_angle ? (
          <p className="mb-2 text-sm text-slate-900">
            <span className="font-semibold">The angle: </span>
            <RichText>{item.g1_angle}</RichText>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {item.g1_bank ? <BankBadge bank={item.g1_bank} /> : null}
          {item.units?.map((u) => (
            <UnitBadge key={u.unit_code} unit={u} />
          ))}
          {item.themes?.map((t) => (
            <Chip key={t} className="border-slate-300 bg-surface capitalize text-slate-600">
              {t}
            </Chip>
          ))}
        </div>
      </section>
    </div>
  );
}
