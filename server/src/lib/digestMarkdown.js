// One day's digest, rendered as a single markdown file.
//
// WHY THIS EXISTS
//
// The app is the product: a digest lands in Today, questions feed Practice,
// wrong answers feed Mistakes, and the whole thing accumulates. None of that
// travels. A file does — into Obsidian, onto a phone with no signal, into a
// printout the night before, into a WhatsApp group.
//
// So this is deliberately a LOSSY export and not a backup. It carries the
// material a candidate revises from — the note, the static layer, the prelims
// facts, the questions and the key — and drops everything that only means
// something inside the app: read state, bookmarks, spaced-revision schedules,
// relevance scores, per-user anything. A file that tried to carry those would
// be a database dump with markdown syntax.
//
// Rendered from rows, in one place, with no HTTP in sight, because the same
// digest has to come out identically whether an admin exports a draft to check
// it or a student downloads the published day.

const BUCKET_ORDER = ['ap', 'national', 'international', 'dynamic'];

const BUCKET_LABELS = {
  ap: 'Andhra Pradesh',
  national: 'National',
  international: 'International',
  dynamic: 'Syllabus update',
  misc: 'Miscellaneous',
};

const FORMAT_LABELS = {
  direct_recall: 'Direct recall',
  negative_statement: 'Incorrect statement',
  assertion_reason: 'Assertion–Reason',
  statement_based: 'Two statements',
  multi_statement: 'Multi-statement',
  chronological: 'Chronological',
  list_matching: 'List matching',
  count_based: 'How many',
};

const IMPORTANCE_LABELS = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };

/** '2026-08-21' → 'Friday, 21 August 2026'. UTC on purpose: these are plain
 *  date strings, and reading them as local time moves the digest by a day. */
function longDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Trailing whitespace off, and no more than one blank line in a row. Model
 *  output arrives with ragged spacing, and a file with four blank lines
 *  between sections reads as broken even when every word in it is right. */
function tidy(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `prelims_facts` is stored as free text, one fact per line, and the drafter is
 * asked for a bare 'Label — value' shape rather than for bullets. Some models
 * supply the bullet anyway. Normalising here means the file is a list either
 * way, instead of being a list on the days a model felt like it.
 */
function factsToList(text) {
  return tidy(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-*+]\s/.test(l) ? `- ${l.replace(/^[-*+]\s+/, '')}` : `- ${l}`))
    .join('\n');
}

/**
 * Re-levels the headings inside model-written prose so the block sits under
 * the heading that owns it.
 *
 * NOT a fixed offset, which was the first version and was wrong. `static_notes`
 * is asked for with 'subheadings where the topic has natural parts', and one
 * model reaches for `#` while another reaches for `##` — so adding a constant
 * put the same content two levels apart depending on the day, and a `##` block
 * demoted by four came out as `######`, the smallest heading markdown has,
 * rendered smaller than the body text it introduces.
 *
 * So the SHALLOWEST heading in the block is moved to `target` and everything
 * else keeps its distance from it. Relative structure survives; absolute depth
 * is set by the caller, which is the only one that knows what it nested this
 * under.
 */
function reheading(markdown, target) {
  const text = tidy(markdown);
  let min = 7;
  for (const [, hashes] of text.matchAll(/^(#{1,6})\s/gm)) min = Math.min(min, hashes.length);
  if (min === 7) return text; // no headings — nothing to move
  const shift = target - min;
  if (shift === 0) return text;
  return text.replace(/^(#{1,6})(\s)/gm, (_, hashes, space) => {
    return '#'.repeat(Math.min(6, Math.max(1, hashes.length + shift))) + space;
  });
}

/**
 * Line breaks the model MEANT, preserved.
 *
 * A multi-statement question is written as a stem, then numbered statements on
 * their own lines, then the ask. Markdown treats a single newline as a space,
 * so that arrives in a reader as one run-on paragraph: 'Consider the following
 * statements: I. ... II. ... III. ... Which of the above are correct?' — which
 * is not a hard question, it is an unreadable one. Two trailing spaces is the
 * hard break, applied only between consecutive non-blank lines so paragraph
 * spacing is left alone.
 */
function hardBreaks(text) {
  const lines = tidy(text).split('\n');
  return lines
    .map((line, i) => {
      const next = lines[i + 1];
      return next !== undefined && line.trim() && next.trim() ? `${line}  ` : line;
    })
    .join('\n');
}

// The format label goes ABOVE the question, not after it.
//
// Appended, it landed on whatever the last line of the question happened to
// be — flush against 'Which of the statements given above are correct?' on a
// multi-statement item and against the whole question on a one-line recall.
// Above, it is a badge in a fixed place, and a student scanning for the three
// assertion-reason questions in a file of forty can find them by eye.
function renderQuestion(mcq, number) {
  const label = FORMAT_LABELS[mcq.format] || 'Direct recall';
  return [
    `**Q${number}.** _(${label})_`,
    '',
    hardBreaks(mcq.question),
    '',
    `- (a) ${tidy(mcq.option_a)}`,
    `- (b) ${tidy(mcq.option_b)}`,
    `- (c) ${tidy(mcq.option_c)}`,
    `- (d) ${tidy(mcq.option_d)}`,
  ].join('\n');
}

/**
 * The metadata line under an item's heading.
 *
 * Inline code rather than prose because these are labels to scan past, not
 * sentences to read — and because a keyword written as `Committees & Reports`
 * survives being pasted into a note-taking app that would otherwise try to
 * interpret the ampersand.
 */
function metaLine(item) {
  const bits = [`\`${BUCKET_LABELS[item.bucket] || item.bucket}\``];
  if (item.bucket === 'dynamic' && item.subject_tag) bits.push(`\`${item.subject_tag}\``);
  bits.push(`\`${IMPORTANCE_LABELS[item.importance] || 'Tier 2'}\``);
  if (item.event_date) bits.push(`Event: ${item.event_date}`);
  return bits.join(' · ');
}

/**
 * @param {object}   day      ca_days row — date, title, intro_markdown, status
 * @param {object[]} items    published items, any order; grouped here
 * @param {Map<number, object[]>} mcqsByItem  questions keyed by item id
 * @param {object}   opts     { draft: boolean } — stamps an unpublished export
 * @returns {string} the whole file
 */
function renderDigest(day, items, mcqsByItem, { draft = false } = {}) {
  // Salvaged cards are pulled out of the bucket grouping and given their own
  // section at the end, exactly as the digest screen shows them. They carry no
  // note and no static background — filed under National they would read as
  // broken items rather than as the facts they are.
  const salvaged = items.filter((i) => Number(i.salvaged) === 1);
  const main = items.filter((i) => Number(i.salvaged) !== 1);
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: main.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length);
  if (salvaged.length) grouped.push({ bucket: 'misc', items: salvaged });

  const totalQuestions = items.reduce((n, i) => n + (mcqsByItem.get(i.id) || []).length, 0);

  const out = [];

  // Front matter, because the most likely destination for this file is a vault
  // that indexes on it. Quoted values throughout: an unquoted title containing
  // a colon — 'FC award: what changed' — is a YAML parse error, and a title
  // with a colon in it is not unusual.
  out.push('---');
  out.push(`title: "APPSC Current Affairs — ${longDate(day.date)}"`);
  out.push(`date: ${day.date}`);
  if (day.title) out.push(`subtitle: "${String(day.title).replace(/"/g, '\\"')}"`);
  out.push('source: "The Hindu"');
  out.push('exam: "APPSC Group-II · Group-I Prelims"');
  out.push(`items: ${items.length}`);
  out.push(`questions: ${totalQuestions}`);
  if (draft) out.push('status: draft');
  out.push('---');
  out.push('');

  out.push(`# Current Affairs — ${longDate(day.date)}`);
  out.push('');
  if (day.title) {
    out.push(`**${tidy(day.title)}**`);
    out.push('');
  }
  out.push(
    `The Hindu · ${items.length} item${items.length === 1 ? '' : 's'} · ` +
      `${totalQuestions} question${totalQuestions === 1 ? '' : 's'}`
  );
  out.push('');

  // An unpublished export says so at the top, not in a footer nobody reads.
  // The whole discipline of this app is that nothing reaches a student
  // unreviewed; a draft that leaves as a file and loses that mark on the way
  // out defeats it, because a file has no status once it is in a folder.
  if (draft) {
    out.push('> **DRAFT — not published.** These items have not been reviewed.');
    out.push('> Facts and question keys may be wrong. Do not circulate.');
    out.push('');
  }

  if (day.intro_markdown) {
    out.push(reheading(day.intro_markdown, 2));
    out.push('');
  }

  if (!items.length) {
    out.push('_This digest has no published items._');
    out.push('');
    return out.join('\n');
  }

  // Numbering runs across the whole file rather than restarting per bucket, so
  // the answer key at the end can be one flat list. 'Q41' means one thing in
  // this file; 'Andhra Pradesh Q3' would mean scrolling back to find out which
  // section you are in.
  let itemNumber = 0;
  let questionNumber = 0;
  const key = [];

  for (const group of grouped) {
    out.push(`## ${BUCKET_LABELS[group.bucket]}`);
    out.push('');

    for (const item of group.items) {
      itemNumber += 1;
      out.push(`### ${itemNumber}. ${tidy(item.headline)}`);
      out.push('');
      out.push(metaLine(item));
      out.push('');

      if (item.keywords?.length) {
        out.push(`**Blueprint angles:** ${item.keywords.join(' · ')}`);
        out.push('');
      }
      if (item.units?.length) {
        const units = item.units.map((u) => `${u.unit_code}${u.label ? ` — ${u.label}` : ''}`);
        out.push(`**Syllabus:** ${units.join(' · ')}`);
        out.push('');
      }

      // The item is flagged as unverified INSIDE the item, next to the facts
      // the flag is about. A caveat collected into a list at the end of the
      // file is a caveat nobody reads at the moment it applies.
      if (Number(item.needs_verify) === 1) {
        out.push(`> ⚠ **Verify:** ${tidy(item.verify_note) || 'A figure or name in this item is unconfirmed.'}`);
        out.push('');
      }

      if (item.notes_markdown) {
        out.push(reheading(item.notes_markdown, 4));
        out.push('');
      }

      if (item.static_linkage || item.static_notes) {
        out.push('#### Static background');
        out.push('');
        if (item.static_linkage) {
          out.push(`_${tidy(item.static_linkage)}_`);
          out.push('');
        }
        if (item.static_notes) {
          out.push(reheading(item.static_notes, 5));
          out.push('');
        }
      }

      if (item.prelims_facts) {
        out.push('#### Prelims facts');
        out.push('');
        out.push(factsToList(item.prelims_facts));
        out.push('');
      }

      const mcqs = mcqsByItem.get(item.id) || [];
      if (mcqs.length) {
        out.push('#### Questions');
        out.push('');
        for (const mcq of mcqs) {
          questionNumber += 1;
          out.push(renderQuestion(mcq, questionNumber));
          out.push('');
          key.push({ number: questionNumber, mcq, itemNumber });
        }
      }

      if (item.source_author) {
        out.push(`_Source: The Hindu${item.source_genre ? ` (${item.source_genre})` : ''} — ${tidy(item.source_author)}_`);
        out.push('');
      }
    }
  }

  // THE KEY GOES AT THE END, AND THAT IS THE POINT.
  //
  // Answers printed beside their question make the file a reference and not a
  // test — the eye reaches the key before the recall attempt, every time. At
  // the end, the same file is both: read it top to bottom, then answer, then
  // scroll.
  if (key.length) {
    out.push('---');
    out.push('');
    out.push('## Answer key');
    out.push('');
    for (const { number, mcq, itemNumber: n } of key) {
      out.push(`**Q${number}** — **(${mcq.correct_option})**  _(item ${n})_`);
      if (mcq.explanation) {
        out.push('');
        out.push(tidy(mcq.explanation));
      }
      // Current-affairs keys go stale, and the app says so on screen with a
      // date. A file outlives the screen, so it has to carry the date itself.
      if (mcq.fact_as_of) {
        out.push('');
        out.push(`_Correct as of ${mcq.fact_as_of}._`);
      }
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push(
    '_Generated by APPSC Current Affairs from The Hindu. ' +
      'Current-affairs facts are correct as at the dates shown and are superseded by later events._'
  );
  out.push('');

  return out.join('\n');
}

/** `appsc-current-affairs-2026-08-21.md` — sorts by date in any file list. */
function digestFilename(date) {
  return `appsc-current-affairs-${date}.md`;
}

module.exports = { renderDigest, digestFilename, BUCKET_ORDER, BUCKET_LABELS };
