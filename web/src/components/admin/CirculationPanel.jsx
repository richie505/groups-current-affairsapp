import { useEffect, useState } from 'react';
import { api, download } from '../../api/client';
import { Chip } from '../Badges';
import { IconDownload, IconSpinner, IconAlert, IconPlus, IconCheck } from '../Icon';

// THE FILE THAT ACTUALLY GOES OUT.
//
// The app is where this material is made; this is where it leaves. An admin
// uploads a paper, the pipeline turns it into topics and questions, and this
// panel is the last screen before a single PDF is sent to students on whatever
// they already use — no accounts, no login, no app to install.
//
// It is a PREVIEW AND AN EDITOR, not a button, because the decisions made here
// are irreversible once the file is sent. The ranking is a good default and a
// bad master: it cannot know that today's third item is the one every coaching
// centre is talking about, or that its top pick is a review meeting dressed in
// instrument words. So every topic carries a checkbox, the ones the ranking
// left out are listed underneath, and the numbers above recompute from the
// server on every change — the running order shown here is the running order
// the file will have.
//
// Unticking is NOT deleting. The item stays in the day, in the app and in the
// archive; it simply does not travel in this file. Removing an item from the
// day itself is a different act with a different button, on the day's Items
// screen, where it belongs.

const BUCKET_LABELS = {
  ap: 'Andhra Pradesh',
  national: 'National',
  international: 'International',
  dynamic: 'Syllabus update',
};

const BUCKET_CLASS = {
  ap: 'border-amber-300 bg-amber-100 text-amber-800',
  national: 'border-slate-300 bg-slate-100 text-slate-700',
  international: 'border-brand-200 bg-brand-50 text-brand-700',
  dynamic: 'border-green-300 bg-green-100 text-green-800',
};

const ITEM_CHOICES = [8, 10, 12, 15, 20];
const QUESTION_CHOICES = [2, 3, 4, 6];

export default function CirculationPanel({ date, status }) {
  const [max, setMax] = useState(12);
  const [perItem, setPerItem] = useState(4);
  // null = let the ranking decide. An array = the admin's own list, which
  // wins outright. Kept as the single source of "who is choosing".
  const [selection, setSelection] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [showPool, setShowPool] = useState(false);

  const query =
    `max=${max}&questions=${perItem}` + (selection ? `&items=${selection.join(',')}` : '');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api
      .get(`/days/${date}/digest-plan?${query}`)
      .then((d) => live && setPlan(d))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    // Guards against the controls being used faster than the requests come
    // back, which would let an older plan overwrite a newer one.
    return () => {
      live = false;
    };
  }, [date, query]);

  // The first tick has to start from what is currently on screen, not from an
  // empty list — otherwise unticking one topic silently drops the other eleven.
  const currentIds = () => selection || (plan ? plan.selected : []);

  function toggle(id) {
    const ids = currentIds();
    setSelection(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function reset() {
    setSelection(null);
  }

  // Moving a dial is a request for the ranking to choose again, so it clears a
  // hand-picked list rather than fighting it.
  function setDial(setter) {
    return (v) => {
      setSelection(null);
      setter(v);
    };
  }

  async function run() {
    setBusy(true);
    setError('');
    setSent('');
    try {
      const name = await download(
        `/days/${date}/digest.pdf?${query}`,
        `APPSC-Current-Affairs-${date}.pdf`
      );
      setSent(name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const draft = status !== 'published';
  const topicCount = plan ? plan.sections.reduce((n, s) => n + s.items.length, 0) : 0;

  return (
    <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Daily compendium — the file you circulate</h3>
        <p className="text-xs text-slate-600">
          Cover, index, themed sections, paper mapping, static linkage, questions, answer key.
        </p>
      </div>

      {draft ? (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>
            This digest is not published yet. You can download it to read it through, but the file
            will say DRAFT across the cover — publish the day before sending it to anyone.
          </span>
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-end gap-4">
        <Dial label="Items" value={max} choices={ITEM_CHOICES} onChange={setDial(setMax)} />
        <Dial
          label="Questions each"
          value={perItem}
          choices={QUESTION_CHOICES}
          onChange={setDial(setPerItem)}
        />
        {plan?.manual ? (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Back to the automatic pick
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-xs text-slate-600">Working out what goes in…</p>
      ) : error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : plan ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure n={topicCount} label={topicCount === 1 ? 'topic' : 'topics'} />
            <Figure n={plan.questions} label="questions" />
            <Figure n={plan.minutes} label="min read" />
            <Figure n={plan.tier1} label="Tier 1" />
          </div>

          <p className="mb-3 text-xs text-slate-600">
            {plan.manual ? (
              <>
                <span className="font-semibold text-slate-800">You chose these {topicCount}.</span>{' '}
                Untick to drop one, or add from the list below.
              </>
            ) : (
              <>
                Picked automatically by tier and exam relevance. Untick anything you don&rsquo;t want,
                or add from the list below — your choice wins.
              </>
            )}
          </p>

          {/* COVERAGE, BEFORE ANYTHING ELSE.
              The syllabus examines regional, national AND international
              current events, so a missing bucket is the one thing worth
              catching before a file goes out. The two causes need different
              actions, so they are named separately. */}
          {plan.coverage?.some((c) => c.in_digest === 0) ? (
            <div className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900">
              {plan.coverage
                .filter((c) => c.in_digest === 0)
                .map((c) => (
                  <p key={c.bucket} className="flex items-start gap-2">
                    <IconAlert className="mt-0.5 shrink-0" />
                    <span>
                      <span className="font-semibold">
                        No {BUCKET_LABELS[c.bucket] || c.bucket} topic in this digest.
                      </span>{' '}
                      {c.in_day > 0
                        ? `The day has ${c.in_day} — add one from the list below.`
                        : 'The day has none at all — go back to the edition and draft more from it.'}
                    </span>
                  </p>
                ))}
            </div>
          ) : null}

          {/* ---- the running order, exactly as the file will have it ---- */}
          <div className="mb-3 space-y-3">
            {(() => {
              let n = 0;
              return plan.sections.map((section) => (
                <div key={section.numeral}>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                    Section {section.numeral} — {section.title}{' '}
                    <span className="font-normal text-slate-500">
                      ({section.items.length} {section.items.length === 1 ? 'topic' : 'topics'})
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {section.items.map((it) => {
                      n += 1;
                      return (
                        <TopicRow
                          key={it.id}
                          item={it}
                          number={n}
                          checked
                          onToggle={() => toggle(it.id)}
                        />
                      );
                    })}
                  </ul>
                </div>
              ));
            })()}
          </div>

          {/* ---- everything the cut left behind, offered back ---- */}
          {plan.excluded?.length ? (
            <div className="mb-3 rounded-md border border-slate-200 bg-surface p-3">
              <button
                type="button"
                onClick={() => setShowPool((v) => !v)}
                aria-expanded={showPool}
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-800"
              >
                <span>
                  Not in the file — {plan.excluded.length} more{' '}
                  {plan.excluded.length === 1 ? 'topic' : 'topics'} from this day
                </span>
                <span className="text-slate-500">{showPool ? 'Hide' : 'Show'}</span>
              </button>
              {showPool ? (
                <ul className="mt-2 space-y-1">
                  {plan.excluded.map((it) => (
                    <TopicRow key={it.id} item={it} checked={false} onToggle={() => toggle(it.id)} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={busy || !topicCount}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? <IconSpinner className="animate-spin" /> : <IconDownload />}
              {busy ? 'Building the file…' : 'Download the digest'}
            </button>
            {sent ? (
              <span className="text-xs text-green-700">
                Saved as <span className="font-mono">{sent}</span> — send it on.
              </span>
            ) : null}
            {!topicCount ? (
              <span className="text-xs text-slate-600">Tick at least one topic.</span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One topic, in or out. The same row either way, so an admin comparing what
 *  is in against what is out is reading one layout rather than two. */
function TopicRow({ item, number, checked, onToggle }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${checked ? 'Remove from' : 'Add to'} the digest: ${item.headline}`}
        onClick={onToggle}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
          checked
            ? 'border-brand-600 bg-brand-600 text-white'
            : 'border-slate-400 bg-surface text-transparent hover:border-brand-500'
        }`}
      >
        {checked ? <IconCheck className="h-3 w-3" /> : <IconPlus className="h-3 w-3 text-slate-500" />}
      </button>
      <span className="w-6 shrink-0 text-right font-mono text-slate-500">
        {number ? String(number).padStart(2, '0') : '—'}
      </span>
      <span className="min-w-0 flex-1">
        <span className={checked ? 'text-slate-800' : 'text-slate-500'}>{item.headline}</span>
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          <Chip className={BUCKET_CLASS[item.bucket] || BUCKET_CLASS.national}>
            {BUCKET_LABELS[item.bucket] || item.bucket}
          </Chip>
          {item.importance === 1 ? (
            <Chip className="border-red-300 bg-red-100 text-red-800">Tier 1</Chip>
          ) : null}
        </span>
        <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
          {item.papers?.length ? item.papers.join('  ·  ') : 'no paper mapping'}
        </span>
      </span>
      <span className="shrink-0 font-mono text-slate-500">{item.questions}Q</span>
    </li>
  );
}

function Dial({ label, value, choices, onChange }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <div className="inline-flex rounded-lg border border-slate-300 bg-surface p-0.5">
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={c === value}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              c === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function Figure({ n, label }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <p className="text-lg font-bold leading-none text-brand-700">{n}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
