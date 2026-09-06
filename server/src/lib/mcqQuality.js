'use strict';

// WHETHER A QUESTION HAS EXACTLY ONE DEFENSIBLE ANSWER.
//
// `validateMcq` in routes/admin.js already checks that a question is
// structurally a question: four options, all present, all distinct, a valid
// letter, an explanation. Everything it tests can be true of a question that is
// unanswerable, and it has no opinion about the one thing that matters — is
// there exactly one answer a person could defend from the source?
//
// Two layers here, cheapest first, because they fail differently.
//
//   inspect()    deterministic, free, and certain. It catches the faults that
//                are visible in the STRING: an option that refers to other
//                options, a key three times longer than every distractor, a
//                multi-statement stem whose options count statements that are
//                not there. These are not judgement calls and a model should
//                not be paid to have an opinion about them.
//
//   selfCheck()  one model call per item, re-reading every question against the
//                source. It catches what only reading can catch: a question
//                whose answer is not in the notes, a stem with two defensible
//                answers, a distractor that is accidentally also correct.
//
// The order matters. Running the deterministic layer first means the model is
// never asked about a question that is already known to be broken, and running
// it AGAIN over the model's rewrites means a rewrite cannot reintroduce a fault
// the first pass removed.

// Options that answer with other options. Banned outright rather than scored:
// "All of the above" is the single most common way a four-option question ends
// up with two defensible answers, because it is true whenever the writer's
// intent and the reader's reading of the distractors differ by one.
const SELF_REFERENTIAL =
  /^\s*(?:all|none|any|both|neither)\s+(?:of\s+)?(?:the\s+)?(?:above|these|them|the\s+following)\b|^\s*both\s*\(?[a-d]\)?\s*(?:and|&)\s*\(?[a-d]\)?\s*$|^\s*(?:\(?[a-d]\)?\s*(?:and|&)\s*\(?[a-d]\)?)\s*$/i;

// Hedges that make a stem unanswerable. Deliberately short, and deliberately
// NOT including "most appropriate" or "best describes" — those are real APPSC
// stems with a defensible answer, and a checker that rejects the paper's own
// house style is a checker that gets switched off.
//
// What is here is language that admits degree: if the answer is "generally"
// true then some other option is generally true as well, and the question is
// asking the candidate to guess which one the writer had in mind.
const HEDGED_STEM =
  /\b(?:generally|usually|typically|normally|often|frequently|mostly|largely|arguably|probably|perhaps|somewhat|relatively|fairly|quite|rather)\b/i;

// A stem has to ask something. Every real format opens one of these ways.
const ASKS =
  /\?|^\s*(?:which|what|who|whom|whose|when|where|why|how|consider|arrange|match|identify|choose|select|with reference to|in the context of|the correct|assertion)/i;

const LETTERS = ['a', 'b', 'c', 'd'];

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const optionsOf = (m) => LETTERS.map((l) => String(m[`option_${l}`] || '').trim());

/** How many numbered statements the stem actually lists. */
function statementCount(question) {
  const q = String(question || '');
  // Roman or arabic, at a line start or after a separator: "1. …", "II. …"
  const roman = new Set((q.match(/(?:^|\n|\s)(I{1,3}|IV|V|VI{0,3})[.):]/g) || []).map((s) => s.trim()));
  const arabic = new Set((q.match(/(?:^|\n|\s)([1-6])[.):]/g) || []).map((s) => s.trim()));
  return Math.max(roman.size, arabic.size);
}

/** The highest statement number any option refers to. */
function highestReferenced(options) {
  let top = 0;
  for (const o of options) {
    for (const n of o.match(/\b([1-6])\b/g) || []) top = Math.max(top, Number(n));
    const romans = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
    for (const r of o.match(/\b(I{1,3}|IV|V|VI{0,3})\b/g) || []) {
      if (romans[r]) top = Math.max(top, romans[r]);
    }
  }
  return top;
}

// The four options an assertion-reason question must have, in order. Fixed by
// the paper, not by us — see prompt-mcq.txt.
const AR_SHAPES = [
  /both\s+a\s+and\s+r\s+are\s+true.*r\s+(?:correctly\s+)?explains/i,
  /both\s+a\s+and\s+r\s+are\s+true.*r\s+(?:does\s+not|is\s+not)/i,
  /a\s+is\s+true.*r\s+is\s+false/i,
  /a\s+is\s+false.*r\s+is\s+true/i,
];

/**
 * Everything wrong with a question that can be seen without reading the source.
 *
 * Returns `{ fatal, soft }`. A fatal finding means the question does not go to
 * a student in this form — it is rewritten once and dropped if it fails again.
 * A soft finding is logged and kept: worth an editor's eye, not worth throwing
 * away a question that is otherwise sound.
 */
function inspect(mcq) {
  const fatal = [];
  const soft = [];
  const question = String(mcq.question || '');
  const options = optionsOf(mcq);
  const format = String(mcq.format || 'direct_recall');
  const keyIndex = LETTERS.indexOf(String(mcq.correct_option || '').toLowerCase());
  const key = keyIndex >= 0 ? options[keyIndex] : '';
  const distractors = options.filter((_, i) => i !== keyIndex);

  if (!ASKS.test(question)) {
    fatal.push('the stem does not ask anything — no question mark and no interrogative opening');
  }
  if (HEDGED_STEM.test(question)) {
    const word = question.match(HEDGED_STEM)[0];
    fatal.push(`the stem hedges ("${word}") — a question of degree has no single defensible answer`);
  }

  for (const [i, o] of options.entries()) {
    if (SELF_REFERENTIAL.test(o)) {
      fatal.push(
        `option ${LETTERS[i].toUpperCase()} answers with other options ("${o.slice(0, 32)}") — ` +
          'the commonest way a four-option question acquires two defensible answers'
      );
      break;
    }
  }

  // Distinctness, past the exact-match test validateMcq already does.
  // "Rs 2,880 crore" and "Rs. 2880 crores" are the same option twice.
  const normalised = options.map(norm);
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      if (normalised[i] && normalised[i] === normalised[j]) {
        fatal.push(
          `options ${LETTERS[i].toUpperCase()} and ${LETTERS[j].toUpperCase()} are the same answer ` +
            'once punctuation and case are ignored'
        );
      }
    }
  }

  // One option contained inside another. Legitimate where the options ARE
  // combinations — "1 and 2 only" inside "1, 2 and 3" is the whole point of the
  // format — and a defect anywhere else, because the containing option is true
  // whenever the contained one is.
  if (!['multi_statement', 'count_based', 'chronological', 'list_matching'].includes(format)) {
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        if (i === j || !normalised[i] || !normalised[j]) continue;
        if (normalised[i].length > 3 && normalised[j].includes(`${normalised[i]} `)) {
          soft.push(
            `option ${LETTERS[i].toUpperCase()} is contained in option ${LETTERS[j].toUpperCase()}`
          );
        }
      }
    }
  }

  // THE LENGTH TELL. A key written to be defensible acquires qualifiers the
  // distractors never needed, and a candidate who has learnt nothing can still
  // pick the long one. Measured against the LONGEST distractor, not the mean,
  // so one short throwaway option cannot trigger it.
  const longestDistractor = Math.max(0, ...distractors.map((d) => d.length));
  if (key.length > 24 && longestDistractor && key.length > longestDistractor * 1.8) {
    soft.push(
      `the key is ${key.length} characters against ${longestDistractor} for the longest ` +
        'distractor — length alone gives it away'
    );
  }

  if (format === 'assertion_reason') {
    const matched = AR_SHAPES.every((re) => options.some((o) => re.test(o)));
    if (!matched) {
      fatal.push(
        'an assertion-reason question must offer the four fixed options, in order — ' +
          'both true and R explains / both true and R does not / A true R false / A false R true'
      );
    }
    if (!/assertion|^\s*a\s*[:.)]/im.test(question) || !/reason|^\s*r\s*[:.)]/im.test(question)) {
      fatal.push('an assertion-reason stem must state an Assertion (A) and a Reason (R)');
    }
  }

  if (['multi_statement', 'count_based'].includes(format)) {
    const listed = statementCount(question);
    const referenced = highestReferenced(options);
    if (format === 'multi_statement') {
      if (listed < 2) {
        fatal.push('a multi-statement question must list its statements in the stem, numbered');
      } else if (referenced > listed) {
        fatal.push(
          `the options refer to statement ${referenced} and the stem lists only ${listed}`
        );
      }
    }
  }

  if (!String(mcq.explanation || '').trim()) {
    fatal.push('no explanation — a current-affairs key without one cannot be checked or dated');
  }
  if (!String(mcq.fact_as_of || '').trim()) {
    soft.push('no fact_as_of date — a current-affairs key goes stale and nothing here says when');
  }

  return { fatal, soft };
}

/** Convenience: does this question survive the deterministic layer? */
function isSound(mcq) {
  return inspect(mcq).fatal.length === 0;
}

// ---------------------------------------------------------------------------
// the model's own second reading
// ---------------------------------------------------------------------------

/**
 * Re-reads an item's questions against the source and returns keep / rewrite /
 * reject for each.
 *
 * ONE CALL FOR THE WHOLE ITEM, not one per question. The judgement being asked
 * for is partly comparative — two questions on one item can each be sound alone
 * and ask the same thing — and a per-question call cannot see that. It is also
 * eight times cheaper.
 *
 * The rewrite is capped at one round. A question the model could not fix on a
 * second reading is not going to be fixed on a third, and the honest outcome is
 * one fewer question with a line in the log saying why.
 */
async function selfCheck(
  { record, mcqs, model, prompt, complete, parseJson, onLog = () => {} }
) {
  if (!mcqs.length) return { kept: [], rejected: [], rewritten: 0 };

  const source = [
    `HEADLINE: ${record.headline || ''}`,
    '',
    'NOTES:',
    record.notes_markdown || '(none — this is a salvaged fact card)',
    '',
    'PRELIMS FACTS:',
    record.prelims_facts || '',
  ].join('\n');

  const numbered = mcqs
    .map((m, i) =>
      [
        `### ${i + 1}`,
        `FORMAT: ${m.format || 'direct_recall'}`,
        `QUESTION: ${m.question}`,
        ...LETTERS.map((l) => `(${l}) ${m[`option_${l}`]}`),
        `KEY: ${String(m.correct_option || '').toUpperCase()}`,
        `EXPLANATION: ${m.explanation || ''}`,
      ].join('\n')
    )
    .join('\n\n');

  let verdicts;
  try {
    const raw = await complete({
      system: prompt,
      user: `=== THE SOURCE ===\n${source}\n\n=== THE QUESTIONS ===\n${numbered}`,
      model,
    });
    verdicts = parseJson(raw, { array: true });
  } catch (e) {
    // A failed check must not throw away questions that passed the
    // deterministic layer. The item keeps them and the log says the second
    // reading did not happen.
    onLog(`    self-check failed (${e.message.slice(0, 70)}) — questions kept unchecked`);
    return { kept: mcqs, rejected: [], rewritten: 0, checked: false };
  }

  const byIndex = new Map();
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    const n = Number(v && v.n);
    if (Number.isInteger(n) && n >= 1 && n <= mcqs.length) byIndex.set(n, v);
  }

  const kept = [];
  const rejected = [];
  let rewritten = 0;

  for (const [i, m] of mcqs.entries()) {
    const v = byIndex.get(i + 1);
    // No verdict is not a rejection. A model that returned four verdicts for
    // six questions has not judged the other two, and dropping them would make
    // an omission look like a decision.
    if (!v) {
      kept.push(m);
      continue;
    }
    const verdict = String(v.verdict || '').toLowerCase();

    if (verdict === 'keep') {
      kept.push(m);
      continue;
    }

    if (verdict === 'rewrite' && v.question) {
      const fixed = {
        ...m,
        question: String(v.question || m.question),
        option_a: String(v.option_a ?? m.option_a),
        option_b: String(v.option_b ?? m.option_b),
        option_c: String(v.option_c ?? m.option_c),
        option_d: String(v.option_d ?? m.option_d),
        correct_option: String(v.correct_option || m.correct_option).toLowerCase(),
        explanation: String(v.explanation || m.explanation),
      };
      // The rewrite goes back through the free layer. A rewrite that
      // reintroduces "All of the above" is not an improvement, and nothing else
      // would catch it.
      const { fatal } = inspect(fixed);
      if (fatal.length) {
        rejected.push({ mcq: m, reason: `rewrite still faulty: ${fatal[0]}` });
        onLog(`    Q${i + 1} rewritten and still faulty — dropped (${fatal[0].slice(0, 60)})`);
        continue;
      }
      rewritten += 1;
      onLog(`    Q${i + 1} rewritten — ${String(v.reason || 'ambiguous as written').slice(0, 70)}`);
      kept.push(fixed);
      continue;
    }

    // reject, or a rewrite with nothing in it
    rejected.push({ mcq: m, reason: String(v.reason || 'rejected on the second reading') });
    onLog(`    Q${i + 1} dropped — ${String(v.reason || 'rejected on the second reading').slice(0, 70)}`);
  }

  return { kept, rejected, rewritten, checked: true };
}

module.exports = {
  inspect,
  isSound,
  selfCheck,
  statementCount,
  highestReferenced,
  SELF_REFERENTIAL,
  HEDGED_STEM,
};
