# Alias review — the principles, and how they were arrived at

Written 5 September 2026, after two approval batches, one removal and one
generalisation pass over `ref_unit_aliases`.

## The rule

**Drop an alias only when the word itself distinguishes nothing. When the word
names a real concept but the tag lands on the wrong unit, fix the mapping.**

Two different failures wear the same costume — a wrong tag — and the fix for one
makes the other worse.

A word that distinguishes nothing is a word that would be true of almost any
article on that subject. `human rights`, `good governance`, `skill development`,
`monsoon`, `transport`. Adding a unit to these does not help, because the
problem is that the word is not evidence of anything; the answer is the
blocklist, the weak list, or removal.

A word that names a real concept filed under the wrong unit is the opposite
case. `MSME` names something specific and checkable. Its tags were wrong not
because the word is vague but because it was seeded under one unit —
"AP agriculture, industry, MSMEs…" — and the concept is examined nationally too.
Removing it would have lost a good term; adding `G1P-C3` and `G2-P2-U3` kept it
and put the tags where they belong.

The test that separates them: **read the word without the article.** If you can
say what it is about, it is a concept and it wants a mapping. If you cannot, it
is a filler and it wants removing.

## Corollary: a concept alias belongs on every unit that examines it

`ref_unit_aliases` was seeded unit by unit, from each unit's own syllabus text.
That is why the defect exists at all: a word appearing in the AP-industry
syllabus was written under the AP-industry unit and nowhere else, even when the
national industry unit examines the same thing in the same words. The seeding
was per-unit; the vocabulary has to be per-concept.

## Two cautions, both learned the hard way

**"Named verbatim in the syllabus text" is not sufficient justification.** It is
exactly the test that put `MSME` on the AP unit — the label really does read
"AP agriculture, industry, MSMEs…" — and that mapping earned two tags in 411
articles, both wrong. A unit's syllabus text names the concepts it examines; it
does not say that any mention of them is about that unit's scope.

**State-qualified aliases do not fire.** `AP MSME`, `Andhra Pradesh
horticulture`, `industrial corridor in Andhra Pradesh` and every equivalent
tested match ZERO articles in this corpus. A newspaper printed in Andhra Pradesh
writes "MSMEs" and lets the story carry the state. They are worth adding as
insurance when the bare term is removed from an AP unit, but they recover
nothing today and must not be counted as if they did.

## The evidence a proposal needs

In order of weight:

1. **The tags it has already produced, judged against article text.** The only
   direct evidence. An alias with a 0-for-N record on a unit has disproved
   itself there.
2. **Corpus hits it would gain or lose.** Tells you the blast radius before you
   commit. Cheap: match the alias against every article and count.
3. **The unit's syllabus text.** Necessary — a mapping the syllabus cannot
   justify is wrong whatever the corpus says — but not sufficient, per above.

Most rows in the AP-scope pass had **no evidence of either of the first two
kinds**: 0 tags earned and 0 corpus hits, in four editions of one newspaper. A
zero-for-zero alias has not been tested, which is different from having failed.
Rules that strip such mappings are stripping them on no evidence; rules that add
them are adding on no evidence too. Say which is happening.

**A syllabus-justified mapping with zero corpus hits is untested, not failed. It
stays until the monthly audit shows it fired wrongly.** That is the standing
ruling, and it is what `provenance` and `first_hit_at` on `ref_unit_aliases`
exist to make checkable: `alias-provenance-audit.js` lists every batch or audit
row that has fired for the first time, with its tags for spot-checking, and
every one that is still silent. Neither list is a defect list. A row is
reconsidered when it has fired AND the tag was wrong — never for being quiet.

## What each mechanism is for

| mechanism | for |
|---|---|
| removing the alias | the word distinguishes nothing anywhere |
| `NOT_STANDALONE` | real concept, but one mention is not enough — needs a partner |
| `weak` | real concept, so common that two of them together still are not evidence |
| `standalone_override` | the phrase-or-acronym rule cannot see that this one word is a unique proper noun |
| adding a unit | the concept is examined in more than one place |
| dropping one unit of several | the concept is examined elsewhere, and this unit's record shows it never belonged here |
| the proper-name guard | the words are right but they are part of somebody's name |
| state-qualified phrases | insurance for a future article, after the bare term is removed from a state-scoped unit |
