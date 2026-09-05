# Segmentation bleed, second type: news into news

**Status:** logged, not built. Found 5 September 2026 during the batch-1 alias
review.

## The case

Item 210, article 1967. The record opens on one story and, with no break of any
kind, becomes another:

> The Central Bureau of Investigation (CBI) is learnt to have recently sought
> sanction for prosecution from Karnataka Governor Thaawarchand Gehlot against
> Planning and Statistics Minister B. Nagendra … has already filed chargesheets
> in three FIRs in which Mr. Nagendra has been named. **The Sri Sathya Sai
> district administration in Andhra Pradesh has busted an inter-State racket
> that allegedly trafficked impoverished tribal workers from Maharashtra …**

Two unrelated reports, one `np_articles` row, one item, one set of unit tags.
Whatever the mapper concludes is half wrong by construction, which is why this
item was excluded from the alias batch rather than given vocabulary: any alias
added for the CBI half would tag the trafficking half too, and the reverse.

## Why the existing detector cannot see it

`bleed_suspect` fires on a genre mismatch — a contributor credit ("The writer
is …", a byline sign-off) appearing inside a piece classified as `report`. That
signal is specific to **opinion bleeding into news**, where the joined-on text
carries the ending furniture of an op-ed.

News into news has no furniture. Both halves are `report`, both are written in
the same register by the same desk, neither ends with a credit. Every feature
the current detector reads is identical across the seam.

## How it could be detected

Three candidate signals, in the order I would try them. None is implemented and
none has been measured.

1. **A second time anchor.** A news report establishes when it happened once,
   near the top — "on Friday", "on Saturday", "on Thursday". A second
   independent anchor deep in the body, attached to a different actor, is odd.
   Article 1967 has "on Friday" in the first sentence and the trafficking half
   introduces its own sequence of events. Cheap to compute; likely noisy, since
   a genuine follow-up paragraph can carry a second date.

2. **A dateline shift.** The two halves are geographically disjoint: Bengaluru
   and Karnataka's legislature in the first, Sri Sathya Sai district and
   Maharashtra's Raigad in the second. A place-name profile computed over the
   first and second halves of the body, compared for overlap, would separate
   them. This is the strongest of the three — a single report almost always
   keeps naming the same places — and it costs one pass over the AP_TERMS and
   place vocabulary already loaded.

3. **A second lead sentence.** Both halves open in the shape a lead takes:
   full name plus designation plus verb ("The Central Bureau of Investigation
   (CBI) is learnt to have…", "The Sri Sathya Sai district administration in
   Andhra Pradesh has busted…"). A story does not re-introduce its subject with
   a full designation halfway through; a spliced one does.

Signals 2 and 3 agreeing is probably the rule worth writing. Either alone will
fire on legitimate long reports that change scene.

## Why it is deferred

One confirmed instance in 411 articles. The same reasoning that dropped the
advertisement rule applies: this is not yet a class, it is a case. It is logged
so that the second and third instances have somewhere to land, and so the next
person to see a wrongly-tagged item checks the seam before blaming the mapper.

**What to do when it recurs:** count the instances first. Below about five, keep
flagging by hand. Above that, implement signal 2, measure precision on the
flagged set, and only then consider whether a flagged article should be split
rather than merely warned about — splitting is a much larger change, because
`np_articles.item_id` and every downstream tag assume one article is one story.
