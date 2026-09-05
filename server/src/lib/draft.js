'use strict';

// SECTION 3 — THE ARTICLE → NOTE BRIDGE
//
// Sections 1 and 2 end with a scored `np_article`: segmented, entity-extracted,
// keyword-matched, topic-matched and given a 0-100 relevance verdict. Nothing
// downstream of that existed. `np_articles.item_id` was in the schema from the
// start and nothing ever wrote it, so an article scored CRITICAL produced
// exactly as much student-visible material as one scored LOW: none.
//
// This module closes that. It turns a scored article into the MASTER KNOWLEDGE
// OBJECT — one `ca_items` row, serving both objective syllabi at once — and
// links the two with `item_id`.
//
// WHY THIS IS A SHARED LIB AND NOT A SECOND PIPELINE
//
// The product principle is ONE SOURCE → ONE INTELLIGENCE PROCESS → MANY EXAM
// OUTPUTS. There was already a working newspaper path (np-daily/paper.js writes
// a candidates file, ca-daily/run.js drafts from it), and the temptation was to
// write a second drafting routine for the in-app path. That would mean two
// implementations of the vocabulary canonicalisation below — the code that stops
// a unit tag being silently invisible — and they would drift.
//
// So `insertDrafted` is extracted here verbatim in behaviour and run.js calls
// it. Same pattern as Section 1, where `lib/ingest.js` is shared by the CLI and
// the API rather than duplicated into both.
//
// WHAT THE MODEL IS AND IS NOT ASKED
//
// It is NOT asked to re-derive the bucket, the keyword angles or the topics.
// Section 2 already computed those deterministically and reproducibly, and a
// model asked the same question would return a second, disagreeing answer to
// one already settled. They are supplied to it as FINDINGS, and its job is to
// write the note that uses them.
//
// It is asked for exactly what a scoring function cannot produce: the note
// prose, the static material underneath it, and the memorise-this block of
// facts that questions are later written from.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PIPELINE = path.join(ROOT, 'content-pipeline', 'ca-daily');

// The one model-call implementation in the repo. It carries retry logic that
// was expensive to establish — gpt-5.x models answer a non-default temperature
// with a 400 rather than clamping it, so `complete` drops whichever sampling
// parameter the API names and retries. Reimplementing that here would mean
// rediscovering it here.
const L = require(path.join(PIPELINE, 'lib'));
const G = require(path.join(ROOT, 'content-pipeline', 'np-daily', 'genre'));

// ---------------------------------------------------------------------------
// the model input
// ---------------------------------------------------------------------------

// Everything Section 2 established about this article, written as findings the
// drafter should use rather than questions it should answer.
function findingsFor(db, article) {
  const keywords = db
    .prepare(
      `SELECT keyword, subject, in_headline, pyq_count
         FROM np_article_keywords WHERE article_id = ?
        ORDER BY in_headline DESC, pyq_count DESC, keyword`
    )
    .all(article.id);

  const topics = db
    .prepare(
      `SELECT t.name, t.tier, t.ap AS topic_ap, at.hits, at.in_headline, at.matched
         FROM np_article_topics at JOIN topics t ON t.id = at.topic_id
        WHERE at.article_id = ?
        ORDER BY at.in_headline DESC, at.hits DESC`
    )
    .all(article.id);

  // Units the matched topics can feed — CANDIDATES, deliberately few.
  //
  // This is the cross-paper reuse map doing real work rather than being a view:
  // the drafter is handed the units this event's topics are known to serve, so a
  // Polavaram story arrives already knowing it may belong to Paper II, Paper IV
  // and the essay.
  //
  // This list used to be every unit every matched topic touches, introduced as
  // "tag at least these". Both halves were wrong, and together they produced the
  // worst tagging in the corpus: a single generic Tier-1 topic ("Supreme Court
  // and judicial review") spans most of Paper III, so any story mentioning the
  // Supreme Court was handed twelve units — and the model returned all twelve,
  // verbatim, every time. Seven unrelated items ended up with an identical
  // 12-unit set: an industry ruling, trade unions, a jail transfer in Pakistan,
  // a Delhi protest, MGNREGA and CBSE marking. P3-U7 landed on 77% of items.
  //
  // A tag that appears on three quarters of everything cannot answer "which
  // items feed P3-U7", and that question is the whole cross-paper reuse map.
  //
  // The proof it was the suggestion and not the model: the one article with no
  // suggested units chose five sensible ones by itself.
  //
  // So: ordered by how strongly the source topic matched — a topic named in the
  // headline is what the story is ABOUT — and capped. The prompt now calls them
  // candidates and asks for the ones this story genuinely feeds.
  const units = topics.length
    ? db
        .prepare(
          `SELECT tu.unit_code, u.label,
                  MAX(at.in_headline) AS from_headline,
                  SUM(at.hits)        AS weight
             FROM np_article_topics at
             JOIN topic_units tu ON tu.topic_id = at.topic_id
             LEFT JOIN ref_units u ON u.unit_code = tu.unit_code
            WHERE at.article_id = ?
            GROUP BY tu.unit_code
            ORDER BY from_headline DESC, weight DESC, tu.unit_code
            LIMIT 6`
        )
        .all(article.id)
    : [];

  const entities = db
    .prepare(
      `SELECT kind, name, mentions FROM np_article_entities WHERE article_id = ?
        ORDER BY mentions DESC, kind, name`
    )
    .all(article.id);

  return { keywords, topics, units, entities };
}

/**
 * The OBJECTIVE syllabus units this article feeds, in the commission's own
 * words.
 *
 * Section 2 established these deterministically, against APPSC's published
 * syllabus vocabulary. They were reaching the question-writer and not the
 * note-writer, which is the wrong way round: the note is what a candidate
 * reads, and if it is not written to the unit then the questions are being
 * asked of prose that was written to something else.
 */
function syllabusFor(db, article) {
  try {
    return db
      .prepare(
        `SELECT au.unit_code, au.in_headline, u.label, u.syllabus_text, u.exam, u.paper
           FROM np_article_units au JOIN ref_units u ON u.unit_code = au.unit_code
          WHERE au.article_id = ? AND u.format = 'objective'
                AND u.broad = 0 AND u.unfeedable = 0
          ORDER BY au.in_headline DESC, au.hits DESC
          LIMIT 5`
      )
      .all(article.id);
  } catch {
    return [];
  }
}

/**
 * How APPSC has ACTUALLY asked this material — from the real papers, not from
 * an assumption about them.
 *
 * 1,389 past questions are in this database and the note-writer had never been
 * shown one. It was told which keyword angles matched; it was not told that
 * "Scheme" has been asked 52 times, nor what one of those questions looked
 * like. So the note was written to the article and the pattern was applied
 * afterwards, when generating questions — by which point the prose either
 * happens to carry what the paper asks for or it does not.
 *
 * Two real stems, not twenty. The point is to show the SHAPE — how specific,
 * which detail gets tested, how the options are built — and a long list would
 * push the article itself out of the model's attention for no extra signal.
 */
function pyqEvidenceFor(db, article) {
  try {
    const rows = db
      .prepare(
        `SELECT k.keyword, COUNT(*) AS n,
                GROUP_CONCAT(DISTINCT q.format) AS formats
           FROM np_article_keywords ak
           JOIN pyq_question_keywords k ON k.keyword = ak.keyword
           JOIN pyq_questions q ON q.id = k.question_id
          WHERE ak.article_id = ?
          GROUP BY k.keyword
          ORDER BY n DESC
          LIMIT 4`
      )
      .all(article.id);
    if (!rows.length) return { angles: [], examples: [] };

    const examples = db
      .prepare(
        `SELECT q.stem, q.format, p.exam, p.year
           FROM np_article_keywords ak
           JOIN pyq_question_keywords k ON k.keyword = ak.keyword
           JOIN pyq_questions q ON q.id = k.question_id
           JOIN pyq_papers p ON p.id = q.paper_id
          WHERE ak.article_id = ? AND LENGTH(q.stem) BETWEEN 40 AND 320
                AND COALESCE(q.needs_review, 0) = 0
          ORDER BY p.year DESC
          LIMIT 2`
      )
      .all(article.id);
    return { angles: rows, examples };
  } catch {
    return { angles: [], examples: [] };
  }
}

function sourceTextFor(db, article, edition) {
  const f = findingsFor(db, article);
  const lines = [];

  lines.push(`HEADLINE: ${article.headline || ''}`);
  if (article.standfirst) lines.push(`STANDFIRST: ${article.standfirst}`);
  // The dateline is the strongest single signal that a story is an AP story,
  // even when its text never names the State, so it is given its own line
  // rather than being left inside the body.
  if (article.dateline) lines.push(`DATELINE: ${article.dateline}`);
  if (article.byline) lines.push(`BYLINE: ${article.byline}`);

  // What KIND of piece this is. It goes above the findings rather than among
  // them because it changes what every one of them means: the same sentence is a
  // fact in a report and a claim in an op-ed, and nothing else in this input
  // distinguishes the two.
  const genre = article.genre || 'report';
  lines.push(`KIND: ${G.labelOf(genre)}`);
  if (article.bylines && article.bylines !== article.byline) {
    lines.push(`AUTHORS: ${article.bylines}`);
  }
  // The contributor credit — "former Governor, Reserve Bank of India" — is the
  // authority the argument rests on, and an answer that cites the argument needs
  // it. It is also the check on the argument: an expert's reading of a judgment
  // is still a reading.
  if (article.credits) lines.push(`AUTHOR'S CREDENTIALS: ${article.credits}`);
  if (G.isOpinion(genre)) {
    lines.push(
      'THIS IS NOT A NEWS REPORT. Everything below the SOURCE TEXT heading is ' +
        'argument, not record. See the rules on opinion sources in your instructions.'
    );
  }
  lines.push(`DATE: ${edition.date}`);
  lines.push(
    `SOURCE: ${edition.publication}${edition.edition ? ` (${edition.edition})` : ''}` +
      `, ${edition.date}, page ${article.page ?? '?'} — print edition`
  );

  lines.push('');
  lines.push('=== WHAT THE SYSTEM HAS ALREADY ESTABLISHED ===');
  lines.push('These are settled findings, not suggestions. Use them; do not re-derive them.');
  lines.push('');
  lines.push(
    `RELEVANCE: ${article.score == null ? 'unscored' : Math.round(article.score)}/100` +
      `${article.band ? ` (${article.band.toUpperCase()})` : ''}`
  );
  // The scorer's own one-line justification. It is already written and already
  // stored; withholding it would be another case of this function discarding
  // what Section 2 measured.
  try {
    const why = JSON.parse(article.breakdown || '{}').why;
    if (why) lines.push(`SCORED BECAUSE: ${why}`);
  } catch {
    // A breakdown that will not parse is not worth failing a draft over.
  }
  lines.push(`BUCKET: ${article.bucket || 'national'}`);
  if (article.subjects) lines.push(`SUBJECTS: ${article.subjects}`);
  // The AP signal, with its provenance — NOT a flat yes/no.
  //
  // `np_articles.ap` is a literal NAME test: does the text say "Andhra",
  // "Amaravati", "Polavaram"? That is precise and it is not the same question as
  // "is this an AP story". A Krishna-water report filed from Hyderabad, where
  // Telangana argues against "unilateral actions that prejudice the rights of
  // downstream States", names Andhra Pradesh nowhere and is entirely about it.
  //
  // Observed: of 90 articles in the 21 Aug edition, 4 carried ap = 0 while
  // matching an AP-flagged master topic — including the highest-scoring article
  // of the whole edition. `relevance.js` already handles this, awarding half the
  // AP weight for "touches an AP topic"; this function was throwing that away
  // and telling the model a flat "no", which is how a Krishna dispute came back
  // with "there is no new Andhra Pradesh-specific development in this report".
  //
  // So both signals go in, labelled. The reverse case is real too — 9 articles
  // named an AP place with no AP topic behind it — which is why neither signal
  // is allowed to overwrite the other.
  const apTopics = f.topics.filter((t) => t.topic_ap);
  if (article.ap) {
    lines.push('ANDHRA PRADESH: named directly in the text.');
  } else if (apTopics.length) {
    lines.push(
      'ANDHRA PRADESH: not named, but this updates AP master topic(s): ' +
        `${apTopics.map((t) => t.name).join('; ')}. ` +
        'Andhra Pradesh may be the unnamed party — "the downstream State", ' +
        '"the successor State", "the neighbouring State". Work out whether it is, ' +
        'and give the AP angle if so. Say plainly that there is none only if there is none.'
    );
  } else {
    lines.push('ANDHRA PRADESH: no signal — neither named nor touching an AP topic.');
  }

  if (f.keywords.length) {
    lines.push('');
    lines.push('BLUEPRINT KEYWORD ANGLES MATCHED (the angles APPSC tests this through):');
    for (const k of f.keywords.slice(0, 12)) {
      const where = k.in_headline ? 'headline' : 'body';
      const pyq = k.pyq_count ? `, asked ${k.pyq_count}x in past papers` : '';
      lines.push(`  - ${k.keyword}${k.subject ? ` [${k.subject}]` : ''} (${where}${pyq})`);
    }
  }

  if (f.topics.length) {
    lines.push('');
    lines.push('MASTER TOPICS THIS UPDATES (an existing entity, not a new note):');
    for (const t of f.topics.slice(0, 8)) {
      lines.push(`  - ${t.name}${t.tier ? ` (Tier ${t.tier})` : ''} — matched on "${t.matched}"`);
    }
  }

  if (f.units.length) {
    lines.push('');
    lines.push('PAPER UNITS THOSE TOPICS CAN FEED — candidates, not a list to copy:');
    for (const u of f.units) {
      lines.push(`  - ${u.unit_code}${u.label ? ` — ${u.label}` : ''}`);
    }
    lines.push('  Take only the ones THIS story genuinely feeds, and add any they miss.');
  }

  // THE SYLLABUS ITSELF, IN THE COMMISSION'S WORDS.
  //
  // The candidate list above comes from `topic_units`, and every one of those
  // 248 mappings is a Group-I MAINS paper unit — so a drafter working from that
  // list alone is writing for the one paper of four that is written, and the
  // three that are answered by ticking a box get whatever falls out.
  //
  // These are different: matched by Section 2 against the published syllabus,
  // and quoted rather than paraphrased. A label is enough to recognise a unit
  // and not enough to write to; the syllabus_text is the sentence the paper is
  // actually set from.
  const syllabus = syllabusFor(db, article);
  if (syllabus.length) {
    lines.push('');
    lines.push('=== THE SYLLABUS THIS STORY BELONGS TO ===');
    lines.push('');
    lines.push(
      'Objective papers — Group-II Screening and Mains, and Group-I Prelims. Three of the'
    );
    lines.push('four papers this app serves are of that kind. Quoted from APPSC:');
    lines.push('');
    for (const u of syllabus) {
      lines.push(
        `  ${u.unit_code}${u.in_headline ? ' (named in the headline)' : ''} — ${u.label}`
      );
      if (u.syllabus_text) lines.push(`      ${u.syllabus_text}`);
    }
  }

  // HOW THE COMMISSION HAS ACTUALLY ASKED THIS.
  //
  // Real stems from real papers. The note is being written so that a question
  // can be asked of it later, and the surest way to make that possible is to
  // show what those questions look like before the note is written rather than
  // after.
  const pyq = pyqEvidenceFor(db, article);
  if (pyq.angles.length) {
    lines.push('');
    lines.push('=== HOW APPSC HAS ASKED THIS BEFORE (from the real papers) ===');
    for (const a of pyq.angles) {
      lines.push(`  "${a.keyword}" — ${a.n} past question(s); formats: ${a.formats || 'mixed'}`);
    }
    for (const e of pyq.examples) {
      lines.push('');
      lines.push(`  ${e.exam} ${e.year} [${e.format}]: ${e.stem.replace(/\s+/g, ' ').trim()}`);
    }
  }

  if (f.entities.length) {
    lines.push('');
    lines.push('ENTITIES EXTRACTED:');
    const byKind = {};
    for (const e of f.entities) (byKind[e.kind] ||= []).push(e.name);
    for (const [kind, names] of Object.entries(byKind)) {
      lines.push(`  ${kind}: ${names.slice(0, 10).join(', ')}`);
    }
  }

  lines.push('');
  lines.push('SOURCE TEXT:');
  lines.push(article.body || '(no body text extracted)');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// the draft call
// ---------------------------------------------------------------------------

// Appended to the standard drafting prompt. The base prompt was written for a
// web candidate with URLs; a print article differs in two ways that matter, and
// both are honesty constraints rather than formatting ones.
// WRITE TO THE SYLLABUS AND TO THE PATTERN — the whole point of the app.
//
// This exists because of a gap between what the pipeline knew and what the
// note-writer was told. Section 2 matched every article to the published
// syllabus units; 1,389 real past questions sit in the database. Neither
// reached this step. The note was written to the ARTICLE, tagged to the
// syllabus afterwards, and only the question-writer was shown what the paper
// actually asks — by which point the prose either happens to carry the
// examinable detail or it does not, and no amount of prompting at question
// time can put back a figure the note never recorded.
//
// So both are supplied with the article now, and this says what to do with
// them. It is deliberately not a new output format: the fields are unchanged,
// and what changes is WHICH FACTS go in them.
const SYLLABUS_ADDENDUM = `
=== WRITE TO THE SYLLABUS, AND TO THE PATTERN ===

The source text may carry two extra blocks: THE SYLLABUS THIS STORY BELONGS TO,
and HOW APPSC HAS ASKED THIS BEFORE. They are the reason this app exists — the
job is not to summarise a newspaper, it is to turn one day's paper into
material for a specific syllabus, examined in a known way.

WHAT THAT CHANGES

1. The syllabus unit decides WHICH FACTS SURVIVE. The same story yields
   different notes for different units: under an economy unit the figure and
   the scheme name matter; under a polity unit the authority, the section and
   the procedure matter. Where a unit is quoted, prefer the facts that unit is
   set from over the ones the article leads with.

2. "prelims_facts" IS THE EXAMINABLE RESIDUE, and every paper this app serves
   is objective, so it is the whole output.
   This does not change its FORM — bare facts, one per line, no prose, exactly
   as specified above. Keep the compact "Label — value" shape: it is scanned at
   revision time, not read, and a sentence holds one fact where a label holds
   the same fact in a third of the space.

   What it changes is WHICH facts earn a line: a name with its post, a figure
   with its unit and date, a scheme with its ministry, a body with its parent
   Act and year. Prefer the ones the quoted unit is set from.

   NEVER DROP A FACT TO MAKE ROOM. If the note already carries a named official,
   a section number or a figure, it stays. Rewriting an existing line as a
   longer sentence and losing another line to length is a net loss, and it is
   the most likely way to make this note worse than the one before it.

3. The past-question examples show the SHAPE, not the subject. If the
   commission asks this angle by matching a scheme to its ministry, then the
   note must carry the ministry. If it asks by altering one figure in an
   otherwise true statement, the note must carry the figure exactly. Read the
   stems for what they demand, then make sure the note supplies it.

4. "static_linkage" names the standing topic this updates — and where a
   syllabus unit is quoted, name it in the unit's own terms. That is what makes
   the item findable by a candidate revising that unit rather than that week.

5. THE QUOTED UNIT CODES ARE CONTEXT, NOT A LIST TO RETURN. They are already
   settled — matched against the syllabus before you were called — and are
   attached to the item automatically. Use them to decide what the note should
   say; do not return them.

WHAT IT DOES NOT CHANGE

Do not invent a fact to satisfy a unit, and do not stretch a story to reach one.
Discard remains the right answer for a story with nothing examinable in it.
`;

const PRINT_ADDENDUM = `
=== THIS ITEM CAME FROM A PRINT NEWSPAPER ===

Two consequences, both binding:

1. DO NOT INVENT SOURCES. There is no URL. Return "sources": [] and nothing
   else — the citation is written from the edition record, which knows the
   publication, date and page exactly. A fabricated link is worse than no link.

2. ONE SECONDARY SOURCE. A single newspaper report is not the cross-check the
   research discipline requires. Set "needs_verify": true and name in
   "verify_note" the specific figures, names or dates a reader must confirm
   against a primary source (PIB, PRS, RBI, a department portal) before this is
   published. If nothing in the item is checkable in that way — a report of a
   speech, say — say so plainly instead.

Use the established findings above for the bucket, the keyword angles and the
unit tags. You are writing the note, not re-classifying the article.

=== CHOOSING THE UNIT TAGS ===

Tag the paper units this story genuinely feeds. Usually two to five; more than
six is almost always wrong.

The test: could this exact unit list sit under a completely different story? If
so it is not a routing decision, it is a default block. Seven unrelated items —
a labour-law ruling, a trade-union protest, a jail transfer abroad, a Delhi
police enquiry, MGNREGA and a CBSE marking dispute — once came back with the
same twelve units, which left P3-U7 attached to 77% of everything filed. A tag
that appears on three quarters of the corpus cannot answer "which items feed
P3-U7", and that question is the entire point of tagging.

The candidate list above is what the matched topics CAN feed, not what this
story does. A broad topic like "Supreme Court and judicial review" touches most
of Paper III; a story about it does not.

=== CHOOSING THE BANK ===

Most items fit more than one bank, so pick by what THE FACT you wrote actually
is — not by what the story is about:

  the fact IS a figure, with a source and a year        -> D
  the fact IS a named scheme, Act, Bill, rules or body  -> S
  the fact IS an instance you could narrate in an answer -> E
  the fact IS a sentence worth quoting verbatim          -> Q

A story about a scheme whose fact is a figure belongs in D, not S. Measured on
the first twenty-five items filed this way: S and E took nine each, Q two and D
ONE — while twenty-one of the twenty-five carried a figure in their notes. D is
the largest target of the four and it is the one that starves, because almost
any numeric item can also be described as a scheme or an example and keeps being
filed as one.

Use null only when the item genuinely fits none of the four. An item worth
routing to Group I at all usually fits one.
`;

// Appended ONLY when the source is an editorial, an op-ed, an interview or a
// signed column. See content-pipeline/np-daily/genre.js for how that is decided.
//
// WHY THIS IS A SEPARATE BLOCK AND NOT A LINE IN THE MAIN PROMPT
//
// Because it inverts the default. The whole of the rest of the prompt is built
// on "the source reports what happened, extract it". On an opinion page that
// premise is false, and a caution bolted onto a prompt whose every other
// instruction assumes reportage loses to the instructions around it.
//
// The two faults it exists to prevent both actually happened, on one page, on
// one day:
//
//   An op-ed characterised the Vanashakti judgment. The item filed the
//   characterisation as what the Court held.
//
//   Two economists PROJECTED a fiscal deficit of ₹18.16 lakh crore against a
//   budgeted ₹16.96 lakh crore. The item filed the projection as the figure,
//   labelled "Estimated", with no projector named.
//
// Neither is a hallucination. Both are faithful summaries of their source. That
// is exactly the difficulty: faithfully summarising an argument produces a false
// fact, and no amount of care about accuracy catches it, because the summary IS
// accurate. Only knowing what kind of page it came from catches it.
const OPINION_ADDENDUM = `
=== THIS SOURCE IS OPINION, NOT REPORTAGE ===

The KIND line in the input says what this is. It is argument, written by a named
person or by the newspaper itself. It is not a record of what happened.

That distinction is the whole of this section. A candidate who writes "the
Supreme Court held X" when a columnist argued X loses the mark — and loses it
confidently, which is the hardest kind of error to unlearn.

1. THE FACT IS THE OCCASION, NOT THE ARGUMENT.

   Every opinion piece is written ABOUT something: a judgment, a Budget, a data
   release, a Bill, a report. That occasion is verifiable and belongs in the
   note. The author's reading of it does not.

     WRONG  The Vanashakti verdict is balanced and pragmatic.
     RIGHT  The Supreme Court delivered judgment in Vanashakti v. Union of India
            on 29 July 2026, on whether prior environmental clearance may be
            granted retrospectively.

   Where the piece is occasioned by no verifiable event — a general argument
   about coaching culture, say — say so in "verify_note", and let the fact be
   the publication of the argument itself, attributed.

2. ATTRIBUTE EVERY EVALUATION, PREDICTION AND CAUSAL CLAIM.

   Name the author inside the sentence, not in a footnote. For an unsigned
   editorial the author is the newspaper, and "The Hindu argued in its editorial
   of <date>" is a citable institutional position — write it that way.

     WRONG  The fiscal deficit will reach 4.6% of GDP.
     RIGHT  Rangarajan and Srivastava project the deficit at 4.6% of GDP against
            a budgeted 4.3%.

3. EVERY FIGURE IS ONE OF THREE THINGS. SAY WHICH.

   (a) An official figure the author is CITING — give the issuing body and the
       period: "CGA data for Q1 2026-27".
   (b) The author's OWN estimate or projection — say so, and say whose:
       "projected by the authors", "the editorial's own estimate".
   (c) An illustration, or a round number used rhetorically — do not file it as
       data at all.

   Never present (b) as (a). A projection filed as a figure is the most damaging
   thing this pipeline can produce, because at the moment a student memorises it
   it is indistinguishable from a real one.

4. "prelims_facts" TAKES ONLY WHAT SURVIVES WITHOUT THE AUTHOR.

   These become MCQ answer keys, and an MCQ keyed to somebody's opinion is
   simply a wrong question. Admit only:

     - names, numbers and dates of statutes, sections, articles and rules
     - case names, courts, benches and judgment dates
     - institutions, their mandates and their office-holders
     - official figures, WITH the body that issued them

   Exclude the author's characterisation, projection, evaluation and forecast —
   however well argued, and however expert the author. If nothing survives that
   test, return fewer facts, or none. A short honest list beats a long one.

   Where a projection is genuinely worth carrying, NAME ITS AUTHOR IN THE LABEL
   ITSELF. "Estimated" is not a label — estimated by whom?

     WRONG  Estimated fiscal deficit: Rs 18.16 lakh crore
     WRONG  Projected fiscal deficit: Rs 18.16 lakh crore
     RIGHT  Fiscal deficit projected by the authors: Rs 18.16 lakh crore
            (budgeted: Rs 16.96 lakh crore)

   The official figure belongs beside the projection wherever the piece gives
   it. A projection with nothing to measure it against is the form in which a
   student memorises it as the real number.

   The same test governs the MCQs. Do not write a question whose correct answer
   is a columnist's view.

5. AN OP-ED IS THE PAPER'S POOREST SOURCE OF FACTS.

   Every paper this app serves is objective, so what an op-ed offers is thin:
   the verifiable occasion, and any figure it cites WITH its official
   counterpart. Prefer the few recallable facts to the argument around them, and
   attribute anything that remains contestable.

6. "static_notes" IS THE SAFE HARBOUR.

   Where the author's reading of the law or the policy is contested, the settled
   position underneath it is not. Make the static notes carry that uncontested
   framework — the Articles, the doctrine, the landmark cases, the scheme as
   notified — so the student has firm ground to stand on when the material above
   it is argument.
`;

async function draftArticle(db, { article, edition, model, vocabulary = '', prompt }) {
  // An opinion source needs a different premise, not an extra caution: the rest
  // of the prompt is written on "the source reports what happened", which is
  // false here. See OPINION_ADDENDUM.
  const opinion = G.isOpinion(article.genre) ? `\n\n${OPINION_ADDENDUM}` : '';

  // THE OPINION BLOCK GOES LAST, AND THAT IS ABOUT MONEY.
  //
  // Providers cache a prompt by its PREFIX and bill the cached part at about a
  // tenth of the input rate, so everything identical on every call of the day
  // belongs in front, and only what varies belongs behind it.
  //
  // THE PAPER-UNITS LISTING USED TO SIT INSIDE `vocabulary`, and it was the
  // largest block in the call: every descriptive Group-I Mains unit, for the
  // model to choose from. With the Mains layer gone the model is not asked to
  // choose units at all — the objective units are matched against the syllabus
  // deterministically before the call and attached afterwards — so that listing
  // is not smaller, it is absent. What remains in `vocabulary` is the keyword
  // angles and the corrections register, both of which the model genuinely
  // needs and both of which are identical on every call.
  //
  // SYLLABUS_ADDENDUM stays inside that head beside PRINT_ADDENDUM, because it
  // too is identical on every call. Only `opinion` varies, and it stays last,
  // which is where a binding instruction belongs.
  const system =
    `${prompt}\n\n${PRINT_ADDENDUM}\n\n${SYLLABUS_ADDENDUM}\n\n${vocabulary}${opinion}`;
  const raw = await L.complete({
    system,
    user: sourceTextFor(db, article, edition),
    model,
  });
  return L.parseJson(raw);
}

/**
 * Stamps the source's KIND onto a drafted record, and — for opinion sources —
 * makes the verify flag mean what it says.
 *
 * WHY THE FLAG IS FORCED HERE AND NOWHERE ELSE
 *
 * `draft-articles.js` deliberately does NOT force `needs_verify` on print items,
 * and the reasoning there is right: forcing it made 100% of bridged items carry
 * it against 37% on the web lane, and a warning that fires on everything
 * distinguishes nothing.
 *
 * Opinion is the case that argument does not cover. It is a minority — 8 of the
 * 121 articles in the 21 August edition — so forcing it there leaves the badge
 * discriminating, and it is the one class of source where "confirm this against
 * the record" is not boilerplate but the literal thing a reviewer must do,
 * because the record and the source genuinely differ.
 *
 * The note names the author, because that is the actionable half. "Verify before
 * publishing" tells a reviewer nothing; "these are C. Rangarajan's projections,
 * not CGA figures" tells them exactly where to look.
 */
function markProvenance(record, article) {
  const genre = article.genre || 'report';
  record._genre = genre;

  // Who is making the claim. An unsigned editorial is the newspaper's own
  // position and is citable as such, so it is attributed to the paper rather
  // than left blank — "The Hindu argued" is a real authority in an answer.
  const authors = String(article.bylines || article.byline || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (genre === 'editorial') record._author = article.publication || 'The Hindu (editorial)';
  else if (authors.length) record._author = authors.join(', ');
  else record._author = '';

  if (!G.isOpinion(genre)) return record;

  record.needs_verify = 1;
  const who = record._author || 'the author';
  record.verify_note = [
    `Drafted from ${G.labelOf(genre).toLowerCase()}, not from a news report — ` +
      `the evaluations, projections and characterisations in it are ${who}'s, ` +
      'not the record’s. Confirm any statute, case, date or official figure ' +
      'against the primary source before publishing, and check that nothing in ' +
      'the prelims facts is a claim rather than a fact.',
    String(record.verify_note || '').trim(),
  ]
    .filter(Boolean)
    .join(' ');
  return record;
}

// ---------------------------------------------------------------------------
// text-field normalisation
// ---------------------------------------------------------------------------

// A TEXT column cannot bind an array, and better-sqlite3 refuses rather than
// coercing — which rolls back the whole transaction AFTER every draft in it has
// been paid for. Observed on 3 of 28 items: `g1_bridges` and `g1_linked` came
// back as JSON arrays because the prompt describes them as lists of lines.
//
// The prompt can ask for a shape. Only code can guarantee it.
// An array of bullet strings becomes newline-separated bullets, which is how
// every one of these fields is rendered anyway. Anything else object-shaped is
// JSON-stringified rather than silently emptied, so a surprise is visible in
// the review queue instead of vanishing.
function toText(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
      .filter(Boolean)
      .map((line) => (/^[-*•]/.test(line) ? line : `- ${line}`))
      .join('\n');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// `headline`, `event_date`, `bucket` and `subject_tag` are in this list for the
// same reason as the prose fields: a model that returns an array where a string
// belongs fails the insert rather than merely looking odd.
const TEXT_FIELDS = [
  'headline', 'event_date', 'bucket', 'subject_tag', 'notes_markdown',
  'static_linkage', 'static_notes', 'prelims_facts', 'verify_note', 'discard_reason',
];

function normaliseTextFields(record) {
  if (!record || typeof record !== 'object') return record;
  for (const f of TEXT_FIELDS) {
    if (f in record) record[f] = toText(record[f]);
  }
  return record;
}

// ---------------------------------------------------------------------------
// the insert
// ---------------------------------------------------------------------------

// Takes the code off the front of an echoed vocabulary line. Splits only on a
// SPACE-DELIMITED dash, so the hyphen inside a real code (P3-U7) is untouched.
const codeOf = (value) => String(value ?? '').trim().split(/\s+[—–-]\s+/)[0].trim();

// Drops a trailing subject bracket: "Election [Polity]" -> "Election".
//
// The vocabulary is presented to the model with each term's subject beside it,
// and the model returns the whole line. This is the SAME fault as the echoed
// unit line, in a second dress, and it was reintroduced the moment a new caller
// formatted its vocabulary a new way — which is the argument for handling it
// here rather than trusting every prompt to be shaped right.
//
// Measured on the first 25 bridged items: 20 of 84 keyword tags came back as
// "Election [Polity]", "Bill [Indian History]" and so on. Every one had a valid
// bare form in `ref_keywords`, so none was WRONG — each was invisible, which is
// worse, because a query for "Election" can never match it and nothing looks
// broken.
const unbracket = (value) => String(value ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();

function canonicaliser(valid) {
  return (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    // Tried in order of decreasing faithfulness to what the model actually said.
    for (const candidate of [raw, unbracket(raw), codeOf(raw), unbracket(codeOf(raw))]) {
      if (candidate && valid.has(candidate)) return candidate;
    }
    return null;
  };
}

// Writes drafted records into the review queue as `ca_items`, resolving their
// tags against the seeded vocabularies.
//
// WHY THE VOCABULARY CHECK EXISTS
//
// The drafting prompt supplies units as "P3-U7 — Policy process, implementation"
// lines and the model sometimes echoes the whole line back. Unchecked, that
// string lands in `ca_item_units.unit_code`, where it can never match a query
// for 'P3-U7' — so the tag is not wrong, it is INVISIBLE, which is worse. One
// 28-item run lost 25 of 159 unit tags this way, and unit tags are exactly what
// the cross-paper reuse view is built on.
//
// Units and keywords are treated differently on purpose. A unit code IS a join
// key, so an unresolvable one is dropped and reported. A keyword is a tag, so an
// off-vocabulary one is kept and merely counted — losing "Federalism" because it
// is not in the seeded list would be worse than recording it.
//
// `drafted` records may carry `_articleId`. Where they do, the article is linked
// back to the item it produced and marked 'drafted'. That link is the whole
// point of Section 3, and it is set inside the same transaction as the insert so
// an article can never be marked drafted against an item that was rolled back.
/**
 * The provenance of a print item: publication, edition, date and page.
 *
 * Built here rather than at each call site because two lanes now write it —
 * the drafter and the salvage pass — and two copies of a citation format is
 * how an archive ends up with 'The Hindu (Vijayawada), 2026-08-21, p.9' beside
 * 'The Hindu 21 Aug p9' and no way to sort or match them.
 *
 * The edition row knows all of it exactly, so nothing here is asked of a model.
 * A fabricated URL on a print item is worse than no citation, which is why the
 * url is empty by construction rather than optional.
 */
function printCitation(edition, article) {
  return {
    url: '',
    publisher:
      `${edition.publication}` +
      `${edition.edition ? ` (${edition.edition})` : ''}` +
      `, ${edition.date}, p.${article?.page ?? '?'}`,
    // A newspaper report is secondary. PIB, PRS, RBI and department portals are
    // primary, and conflating them would quietly weaken every 'rests only on
    // secondary reporting' warning the review queue shows.
    is_primary: 0,
    fetched_at: edition.date,
  };
}

/**
 * Strips a trailing "(a) ... (b) ... (c) ... (d) ..." block from a question's
 * stem when it just repeats option_a-d — a habit the model falls into on
 * list_matching and assertion_reason questions maybe one time in ten, echoing
 * the exam-paper phrasing it was shown for what those options look like. The
 * prompt now says not to, but this is the backstop for whenever it slips
 * anyway, and the one place shared by every caller: draft insertion (new
 * questions) and the one-time backfill (server/scripts/dedupe-mcq-codes.js,
 * questions already in the database from before the prompt was fixed).
 *
 * Deliberately conservative: only strips when the four bracketed values at
 * the very end of the text match the actual options, normalised for case and
 * whitespace. A trailing "(a)...(d)..." that does NOT match option_a-d is
 * left alone rather than guessed at — it is either a different, legitimate
 * use of that shape, or a question the drafter got wrong in some other way,
 * and this function's only job is the one specific, verifiable duplication.
 */
function stripEmbeddedOptionCodes(question, options) {
  const text = String(question || '');
  const opts = (options || []).map((o) => String(o || '').trim());
  if (opts.length !== 4 || opts.some((o) => !o)) return text;

  const m =
    /\n{1,3}(?:[^\n:]{0,40}:\s*\n)?\(a\)\s*([^\n]+)\n\(b\)\s*([^\n]+)\n\(c\)\s*([^\n]+)\n\(d\)\s*([^\n]+)\s*$/i.exec(
      text
    );
  if (!m) return text;

  const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const found = [m[1], m[2], m[3], m[4]].map(norm);
  const expected = opts.map(norm);
  if (found.some((f, i) => f !== expected[i])) return text;

  return text.slice(0, m.index).replace(/\s+$/, '');
}

function insertDrafted(db, { date, drafted = [], discarded = [], onLog = () => {} }) {
  const offVocabKeywords = new Set();
  const droppedUnits = [];
  const itemIds = [];

  const run = db.transaction(() => {
    let day = db.prepare('SELECT id FROM ca_days WHERE date = ?').get(date);
    if (!day) {
      const info = db.prepare(`INSERT INTO ca_days (date, status) VALUES (?, 'draft')`).run(date);
      day = { id: info.lastInsertRowid };
    }

    const insItem = db.prepare(
      `INSERT INTO ca_items (day_id, headline, event_date, bucket, subject_tag,
         notes_markdown, static_linkage, static_notes, prelims_facts,
         importance, relevance_g2, needs_verify, verify_note,
         source_genre, source_author, order_index, salvaged, status)
       VALUES (@day_id, @headline, @event_date, @bucket, @subject_tag,
         @notes_markdown, @static_linkage, @static_notes, @prelims_facts,
         @importance, @relevance_g2, @needs_verify, @verify_note,
         @source_genre, @source_author, @order_index, @salvaged, 'draft')`
    );
    const insKeyword = db.prepare(
      'INSERT OR IGNORE INTO ca_item_keywords (item_id, keyword) VALUES (?, ?)'
    );
    const insUnit = db.prepare(
      'INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)'
    );
    const insSource = db.prepare(
      `INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insMcq = db.prepare(
      `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
         correct_option, explanation, format, keyword, unit_code, difficulty, fact_as_of)
       VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
         @correct_option, @explanation, @format, @keyword, @unit_code, @difficulty, @fact_as_of)`
    );
    const insDiscarded = db.prepare(
      `INSERT INTO ca_items (day_id, headline, bucket, status, discard_reason,
         relevance_g2)
       VALUES (?, ?, 'national', 'discarded', ?, 0)`
    );
    const linkArticle = db.prepare(
      `UPDATE np_articles SET item_id = ?, status = 'drafted', discard_reason = ''
        WHERE id = ?`
    );
    const priorItemOf = db.prepare('SELECT item_id FROM np_articles WHERE id = ?');
    // Supersede, rather than delete or leave. A redraft repoints the article at
    // its new item and would otherwise strand the old one in the review queue as
    // a second, unlinked draft of the same story — observed the first time
    // --redraft was used. Discarding it keeps the repo's rule that a rejection is
    // a row with a reason.
    //
    // Only a DRAFT is superseded. A published item is knowledge in its own right
    // and must not be withdrawn because somebody re-ran the drafter — the same
    // rule the edition delete follows.
    const supersede = db.prepare(
      `UPDATE ca_items SET status = 'discarded', discard_reason = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'`
    );
    const markSuperseded = db.prepare('UPDATE ca_items SET supersedes = ? WHERE id = ?');
    const discardArticle = db.prepare(
      `UPDATE np_articles SET status = 'discarded', discard_reason = ? WHERE id = ?`
    );

    const refUnits = new Set(
      db.prepare('SELECT unit_code FROM ref_units').all().map((r) => r.unit_code)
    );
    const refKeywords = new Set(
      db.prepare('SELECT keyword FROM ref_keywords').all().map((r) => r.keyword)
    );
    const unitOf = canonicaliser(refUnits);
    const keywordOf = canonicaliser(refKeywords);

    let order = db
      .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM ca_items WHERE day_id = ?')
      .get(day.id).m;

    for (const r of drafted) {
      normaliseTextFields(r);
      order += 1;
      const info = insItem.run({
        day_id: day.id,
        headline: r.headline,
        event_date: r.event_date || null,
        bucket: r.bucket || 'national',
        subject_tag: r.subject_tag || '',
        notes_markdown: r.notes_markdown || '',
        static_linkage: r.static_linkage || '',
        static_notes: r.static_notes || '',
        prelims_facts: r.prelims_facts || '',
        importance: Number(r.importance) || 2,
        relevance_g2: Number(r.relevance_g2) === 0 ? 0 : 1,
        // THE BADGE IS A PROPERTY OF THE SOURCE, NOT AN OPINION THE MODEL HOLDS.
        //
        // markProvenance sets this for opinion — an op-ed, an editorial, an
        // interview, a column — where "confirm this against the record" is the
        // literal thing a reviewer must do, because the record and the source
        // genuinely differ. That is a minority of any edition and the badge
        // discriminates.
        //
        // The model was ALSO asked, and it says yes to almost everything: 165
        // of 236 published report items on the live database carried the flag,
        // on notes like "as this is based on a single print report, verify the
        // date". True of every newspaper story ever written. A warning that
        // fires on seven items in ten is not a warning, and the comment above
        // markProvenance says exactly that — the code just was not enforcing it.
        //
        // So a report never inherits the model's answer. The NOTE is kept
        // either way: it often names a specific thing worth checking, and it
        // costs nothing to leave in a column nothing renders unless the flag is
        // set.
        needs_verify: G.isOpinion(r._genre) && Number(r.needs_verify) ? 1 : 0,
        verify_note: r.verify_note || '',
        // Set by the salvage pass, which writes a fact card rather than a note.
        // Everything else that reaches here is a full item.
        salvaged: Number(r.salvaged) ? 1 : 0,
        // What KIND of source this came from, carried onto the item rather than
        // read back through np_articles. An item outlives the edition row that
        // produced it, and "is this a fact or a columnist's claim" has to stay
        // answerable for as long as a student can read the item.
        source_genre: r._genre || 'report',
        source_author: r._author || '',
        order_index: order,
      });
      const itemId = info.lastInsertRowid;
      itemIds.push(itemId);

      for (const k of r.keywords || []) {
        const kw = keywordOf(k) || unbracket(codeOf(k));
        if (!kw) continue;
        insKeyword.run(itemId, kw);
        if (!refKeywords.has(kw)) offVocabKeywords.add(kw);
      }
      // THE SYLLABUS UNITS, TAKEN FROM THE SCORER RATHER THAN FROM THE MODEL.
      //
      // Every paper this app serves is objective, and for those the syllabus
      // unit is not a judgement call a model should be making: Section 2 matched
      // the article's own text against APPSC's published syllabus vocabulary,
      // deterministically and reproducibly. Asking a model to re-derive it
      // invites a second, disagreeing answer to a settled question — the same
      // principle this file already applies to the bucket and the keywords.
      //
      // The model used to return units too, chosen from a 6,250-token
      // vocabulary of descriptive Group-I Mains units, and item 84 is what that
      // produced: P2-U12, P4-U7, P4-U8, P4-U11, P4-U12 and P5-U7, and nothing
      // at all for Group II, while the scorer had already established that it
      // feeds G2-P2-U5. It is no longer asked, and the vocabulary is gone.
      if (r._articleId) {
        for (const u of db
          .prepare(
            `SELECT au.unit_code FROM np_article_units au
               JOIN ref_units ru ON ru.unit_code = au.unit_code
              WHERE au.article_id = ? AND ru.broad = 0 AND ru.unfeedable = 0
              ORDER BY au.in_headline DESC, au.hits DESC`
          )
          .all(r._articleId)) {
          insUnit.run(itemId, u.unit_code);
        }
      }
      for (const s of r.sources || []) {
        if (!s || (!s.url && !s.publisher)) continue;
        insSource.run(itemId, s.url || '', s.publisher || '', s.is_primary ? 1 : 0,
          s.fetched_at || null);
      }
      // What this item was actually mapped to — the set a question is allowed
      // to be filed under. Read back from the table rather than from `r`,
      // because the insert above is what decided it.
      const itemUnits = new Set(
        db
          .prepare('SELECT unit_code FROM ca_item_units WHERE item_id = ?')
          .all(itemId)
          .map((x) => x.unit_code)
      );
      for (const m of r.mcqs || []) {
        insMcq.run({
          item_id: itemId,
          question: stripEmbeddedOptionCodes(m.question, [m.option_a, m.option_b, m.option_c, m.option_d]),
          option_a: m.option_a,
          option_b: m.option_b,
          option_c: m.option_c,
          option_d: m.option_d,
          correct_option: m.correct_option,
          explanation: m.explanation || '',
          format: m.format || 'direct_recall',
          keyword: m.keyword || '',
          // Canonicalised against ref_units: a code the checker will not
          // recognise is a tag nothing can query, and it goes in as blank
          // rather than as a code that looks real.
          //
          // This is now the ONLY place a model-supplied unit code enters the
          // database — the item's own units come from the scorer — so it is
          // also the only place left that can report an unresolvable one.
          // TWICE, ON PURPOSE.
          //
          // generateMcqs already restricts the model to this article's own
          // units and blanks anything else, so in the current callers this can
          // only narrow what is already narrow. It is here because it is the
          // WRITE boundary: `unitOf` alone accepts any code in ref_units, so
          // the day something hands this function a record it did not build —
          // an import, a repair script, a new caller — an arbitrary unit would
          // go straight into the table. 192 questions in this database are
          // filed under a unit their item does not carry, all of them written
          // before the restriction existed, and the way that stops recurring is
          // for the check to live where the row is written rather than only
          // where it is generated.
          unit_code: (() => {
            const code = unitOf(m.unit_code);
            const raw = String(m.unit_code || '').trim();
            if (!code && raw) {
              droppedUnits.push(raw.slice(0, 70));
              return '';
            }
            if (code && itemUnits.size && !itemUnits.has(code)) {
              droppedUnits.push(`${code} (not a unit of this article)`);
              return '';
            }
            return code || '';
          })(),
          difficulty: Number(m.difficulty) || 2,
          fact_as_of: m.fact_as_of || null,
        });
      }

      if (r._articleId) {
        const prior = priorItemOf.get(r._articleId);
        if (prior && prior.item_id && prior.item_id !== itemId) {
          const n = supersede.run(`Superseded by item #${itemId} on redraft.`, prior.item_id)
            .changes;
          if (n) onLog(`      superseded draft item #${prior.item_id}`);
          // Nothing changed means the prior item was NOT a draft, so it is
          // published and has been left live on purpose. That is the case worth
          // recording: the new draft is a duplicate of something a student can
          // already read, and publishing both would show the same story twice.
          // The reviewer cannot see that from either row unless it is written
          // down here.
          else {
            markSuperseded.run(prior.item_id, itemId);
            onLog(`      NOTE: this redrafts PUBLISHED item #${prior.item_id}, which stays live`);
          }
        }
        linkArticle.run(itemId, r._articleId);
      }
    }

    // Discards are rows, not deletions. A run that discards nothing has stopped
    // filtering, and that is only visible if the rejections are recorded.
    for (const d of discarded) {
      if (d._articleId) discardArticle.run(d.discard_reason || '', d._articleId);
      // A discarded print article does not need a placeholder ca_item — the
      // np_articles row already carries the rejection and its reason, which is
      // more provenance than the web lane's placeholder ever had.
      else insDiscarded.run(day.id, d.headline || '(untitled candidate)', d.discard_reason || '');
    }
  });

  run();

  if (droppedUnits.length) {
    const counts = new Map();
    for (const u of droppedUnits) counts.set(u, (counts.get(u) || 0) + 1);
    onLog(`${droppedUnits.length} unit tag(s) dropped as unresolvable against ref_units:`);
    for (const [u, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      onLog(`   ${n}x ${u}`);
    }
    onLog('   (a code nothing can match is not a tag; fix the drafting prompt if this recurs)');
  }
  if (offVocabKeywords.size) {
    onLog(`${offVocabKeywords.size} keyword(s) outside ref_keywords, kept as free tags:`);
    onLog(`   ${[...offVocabKeywords].slice(0, 10).join(', ')}`);
  }

  // Over-tagging, reported rather than trimmed.
  //
  // Every one of these codes is valid, so there is nothing to drop — the fault
  // is that too many were claimed, and only a person can say which are real.
  // Reported because it is otherwise invisible: an item with twelve units looks
  // exactly like an item with three until somebody counts, and by then the
  // reuse map has already been diluted.
  const OVER_TAGGED = 6;
  const heavy = itemIds
    .map((id) => ({
      id,
      n: db.prepare('SELECT COUNT(*) AS n FROM ca_item_units WHERE item_id = ?').get(id).n,
    }))
    .filter((r) => r.n > OVER_TAGGED);
  if (heavy.length) {
    onLog(
      `${heavy.length} item(s) claim more than ${OVER_TAGGED} paper units ` +
        `(${heavy.map((r) => `#${r.id}:${r.n}`).join(', ')})`
    );
    onLog('   a unit list that would fit any story is a default block, not a routing decision');
  }

  return { itemIds, offVocabKeywords: [...offVocabKeywords], droppedUnits };
}

// ---------------------------------------------------------------------------
// MCQ generation
// ---------------------------------------------------------------------------

// Weighted to the formats that suit current-affairs facts — single events,
// several claims about one event, natural pairings — while cycling in
// assertion-reason and negative-statement, which the real paper leans on
// heavily and which are where marks are actually lost. A bank served as 90%
// plain recall trains the wrong reflex.
//
// This is only the FALLBACK. Where the PYQ layer has evidence for a keyword,
// what APPSC actually asked beats what seems reasonable.
const FORMAT_CYCLE = [
  'direct_recall',
  'multi_statement',
  'list_matching',
  'assertion_reason',
  'direct_recall',
  'negative_statement',
  'multi_statement',
  'statement_based',
  'list_matching',
  'count_based',
];

function formatsFor(index, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(FORMAT_CYCLE[(index * n + i) % FORMAT_CYCLE.length]);
  return out;
}

// PYQ-driven format selection, with the rotation as the fallback.
//
// The keyword chosen is the item's first, which is the drafting prompt's primary
// angle. Blending the distributions of four keywords at once would produce a
// mush that matches none of them; imitating the primary angle is both simpler
// and closer to how a paper-setter works.
//
// WHY `db` AND `onLog` ARE PARAMETERS
//
// Because the previous version reached for both from an enclosing scope it did
// not have. It called a `say()` defined inside run.js's `main()` from module
// scope, so the moment `plan.source === 'pyq'` — that is, exactly when the PYQ
// layer HAD evidence — it threw a ReferenceError straight into the catch below,
// which returned the rotation. Measured on the live database: keyword "Scheme"
// has 52 questions of usable evidence wanting
// [direct_recall, direct_recall, direct_recall, negative_statement], and every
// item silently received the rotation instead.
//
// So the whole PYQ format engine was inert, and inert in the quietest possible
// way: the fallback is a legitimate answer, so nothing ever looked wrong. Both
// dependencies are now passed in, where a missing one is a TypeError at the
// call site rather than a swallowed miss.
function plannedFormatsFor(db, record, index, n, onLog = () => {}) {
  const fallback = formatsFor(index, n);
  const keyword = (record.keywords || [])[0];
  if (!keyword) return fallback;

  let pyq;
  try {
    pyq = require('./pyq');
  } catch {
    // The PYQ tables may not exist in an older database. A missing evidence
    // base is a reason to fall back, not to fail a run.
    return fallback;
  }

  const plan = pyq.plannedFormats(db, keyword, n, fallback);
  // Reported rather than silently applied: "these formats came from 52 real
  // questions" and "these came from a rotation" are very different claims about
  // a practice paper, and the difference belongs in the run log.
  if (plan.source === 'pyq') {
    onLog(`      formats from ${plan.evidence} PYQ(s) on "${keyword}": ${plan.formats.join(', ')}`);
  }
  return plan.formats;
}

// Generates the questions for one drafted item, in the formats the PYQ evidence
// asks for. Returns the accepted MCQs; never throws, because an item without
// questions is still worth filing and a failed generation must not cost the
// drafting that was already paid for.
//
// `seenHashes` is shared across a whole run and mutated here, which is what
// stops the same question being generated twice from two related articles.
/**
 * The objective syllabus units this article feeds, with APPSC's own wording.
 *
 * Read from np_article_units, which the scorer wrote before any model was
 * asked — so the question-writer is TOLD which units to test rather than left
 * to infer them from the prose.
 */
function objectiveUnitsFor(db, articleId) {
  if (!articleId) return [];
  try {
    return db
      .prepare(
        `SELECT au.unit_code, au.in_headline, u.label, u.syllabus_text, u.exam
           FROM np_article_units au JOIN ref_units u ON u.unit_code = au.unit_code
          WHERE au.article_id = ? AND u.format = 'objective'
                AND u.broad = 0 AND u.unfeedable = 0
          ORDER BY au.in_headline DESC, au.hits DESC
          LIMIT 4`
      )
      .all(articleId);
  } catch {
    // An older database without the syllabus map writes questions as before.
    return [];
  }
}

/**
 * How many questions this item is worth.
 *
 * WHY IT IS NOT A FIXED FOUR
 *
 * Because three of the four APPSC papers are objective and one is written, and
 * the app was built the other way round. Measured on the first 33 published
 * items: 25,421 words of descriptive material serving ONE paper, and 129
 * questions — 3.9 an item — serving THREE.
 *
 * A flat count is the wrong shape even at the right total. An article that
 * feeds three syllabus units carries three times as much testable ground as one
 * feeding a single unit, and four questions each over-tests the thin one while
 * under-testing the rich one. So the count follows the units.
 *
 * Capped at ten because a single day's story does eventually run out of
 * distinct things to ask, and the tenth question about one press conference is
 * where a bank starts padding.
 */
function mcqCountFor(units, base = 4) {
  const n = units.length;
  if (n <= 1) return base;
  return Math.min(base + 2 * (n - 1), 10);
}

/**
 * The unit code out of whatever the model actually returned.
 *
 * WHY THIS IS NOT JUST `valid.has(trim(x))`
 *
 * It was, and it silently discarded correct answers. The prompt shows each unit
 * as `CODE — label`, and on the 23 August recovery run the model copied the
 * whole line back:
 *
 *   "G2-P1-U7 — Union and State government — legislature, executive, judiciary"
 *
 * That is the RIGHT unit, identified correctly, and an exact-match check filed
 * all four of that item's questions under no unit at all. The model was not
 * wrong; the reader was too literal.
 *
 * The check stays strict about which codes are acceptable — only a unit this
 * article actually feeds — and becomes tolerant only about the punctuation
 * around it. A code that is not in the supplied set is still rejected, because
 * that is the failure this guard exists for.
 */
function canonicalUnit(raw, valid) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (valid.has(text)) return text;

  // Ambiguity is checked FIRST, before the leading token is trusted.
  //
  // Reading the head of the string is what makes "G2-P1-U7 — Union and State
  // government" work, but applied blindly it would also read "G2-P1-U7 or
  // G1P-C5" as a confident G2-P1-U7 — and a field naming two units is the model
  // saying it could not choose. Picking the one that happens to be written
  // first is not a repair, it is a coin toss recorded as a fact.
  // Matched with a boundary rather than `includes`, because the codes are not
  // prefix-free: "G2-P1-U10" contains "G2-P1-U1", so a plain substring test
  // would call every U10 tag ambiguous and throw away a correct answer to avoid
  // a collision that is not there. `\b` is no use — the codes contain hyphens —
  // so the boundary is spelled out.
  const hits = [...valid].filter((code) =>
    new RegExp(`(?:^|[^A-Za-z0-9-])${code}(?![A-Za-z0-9])`).test(text)
  );
  return hits.length === 1 ? hits[0] : '';
}

async function generateMcqs(
  db,
  { record, index, count = 4, model, mcqPrompt, seenHashes, fallbackDate, onLog = () => {} }
) {
  const { validateMcq } = L.serverValidators();
  const units = objectiveUnitsFor(db, record._articleId);
  const wanted = plannedFormatsFor(db, record, index, mcqCountFor(units, count), onLog);
  const valid = new Set(units.map((u) => u.unit_code));

  const lines = [
    `NOTES:\n${record.notes_markdown || ''}`,
    `PRELIMS FACTS:\n${record.prelims_facts || ''}`,
    `KEYWORD ANGLES: ${(record.keywords || []).join(', ')}`,
    `FACTS TRUE AS OF: ${record.event_date || fallbackDate}`,
  ];

  if (units.length) {
    lines.push(
      '',
      '=== THE SYLLABUS UNITS THIS ITEM FEEDS ===',
      '',
      'These are OBJECTIVE papers — Group-I Prelims and Group-II, both answered by',
      'ticking a box. Three of the four papers this app serves are of that kind, and',
      'they are what these questions are for.',
      '',
      'Each unit is quoted in the commission’s own words. WRITE TO THE UNIT, not to',
      'the article: the article is today’s occasion, the unit is what is actually',
      'examined, and a question that tests the article without testing the unit is a',
      'question the paper would never ask.',
      '',
      ...units.map(
        (u) =>
          `${u.unit_code}${u.in_headline ? ' (named in the headline)' : ''} — ${u.label}\n` +
          `    ${u.syllabus_text}`
      ),
      '',
      'Put the unit code in "unit_code" on every question, exactly as written above.',
      'Spread the questions across the units rather than crowding one: an item that',
      'feeds three units and tests only the first has wasted two thirds of itself.'
    );
  }

  lines.push(
    '',
    `Write exactly ${wanted.length} questions, in these formats, in this order:`,
    ...wanted.map((f, i) => `${i + 1}. ${f}`)
  );
  const brief = lines.join('\n');

  const out = [];
  try {
    const raw = await L.complete({ system: mcqPrompt, user: brief, model });
    const list = L.parseJson(raw, { array: true });
    for (const m of list) {
      const errors = validateMcq(m);
      if (errors.length) {
        onLog(`    dropped a question — ${errors.join(' ')}`);
        continue;
      }
      const hash = L.questionHash(m.question);
      if (seenHashes && seenHashes.has(hash)) {
        onLog('    dropped a duplicate question');
        continue;
      }
      if (seenHashes) seenHashes.add(hash);
      // A unit the model invented, or one this article does not feed, is worse
      // than no unit at all: it would answer "what covers G1P-B2?" with a
      // question about something else. Only a code from the list it was handed
      // survives; anything else is recorded as blank and said out loud.
      const unit = canonicalUnit(m.unit_code, valid);
      if (units.length && !unit) {
        onLog(`    question tagged to no known unit (${m.unit_code || 'blank'})`);
      }
      out.push({
        ...m,
        unit_code: unit,
        fact_as_of: m.fact_as_of || record.event_date || fallbackDate,
      });
    }
  } catch (e) {
    onLog(`    MCQ generation failed (${e.message}) — item kept without questions`);
  }
  if (units.length) {
    const covered = new Set(out.map((m) => m.unit_code).filter(Boolean));
    onLog(
      `    ${out.length} question(s) covering ${covered.size} of ${units.length} unit(s) ` +
        `(${units.map((u) => u.unit_code).join(', ')})`
    );
  }
  return out;
}

module.exports = {
  printCitation,
  stripEmbeddedOptionCodes,
  PRINT_ADDENDUM,
  SYLLABUS_ADDENDUM,
  OPINION_ADDENDUM,
  FORMAT_CYCLE,
  findingsFor,
  sourceTextFor,
  draftArticle,
  markProvenance,
  normaliseTextFields,
  toText,
  insertDrafted,
  formatsFor,
  plannedFormatsFor,
  objectiveUnitsFor,
  mcqCountFor,
  canonicalUnit,
  generateMcqs,
};
