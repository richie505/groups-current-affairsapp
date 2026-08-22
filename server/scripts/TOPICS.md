# The topic layer

```bash
node server/scripts/seed-topics.js                    # seed vocabulary + rebuild links + report
node server/scripts/seed-topics.js --relink           # rebuild links only (after new items land)
node server/scripts/seed-topics.js --report           # report only, no writes
node server/scripts/seed-topics.js --topic apcrda     # the dossier for one topic
```

## The problem it solves

Everything else in this database is organised by **day**. An item belongs to a
digest, carries its tags, and is then finished with. That is the right shape for
reading a day's news and the wrong shape for preparing an exam, because the exam
does not ask about a day. It asks about Polavaram.

Before this layer, ten items across eight months mentioning Polavaram were ten
unrelated notes. There was nowhere for the eleventh to attach, no way to ask what
was already known, and no way to see that the topic spans Paper II, Paper IV and
the Paper I essay at once.

## Four tables, two of them disposable

| Table | Curated or derived |
|---|---|
| `topics` | curated — the master entity, with `ap`, `tier`, `kind` |
| `topic_aliases` | curated — **the load-bearing part** |
| `topic_items` | **derived** — rebuilt from scratch every run |
| `topic_units` | **derived** — the cross-paper reuse map |
| `topic_links` | curated — parent/related relations item overlap cannot express |

The derived tables are truncated and rebuilt, never merged. That is deliberate:
the matcher will improve, and a derived table that cannot be thrown away becomes
a liability the moment it disagrees with the vocabulary.

`topic-data.js` is **authoritative** for aliases, not merely additive — the seed
prunes aliases that are no longer in the file. This matters more than it sounds:
upserting alone meant that *deleting* a bad alias had no effect on the database,
so `Tirupati` was removed from the TTD topic, the seed re-run, and it carried on
matching from the stale row. An alias list you cannot shrink is one you cannot
correct.

## Aliases are the whole game

A paper writes "APCRDA", "CRDA" and "Capital Region Development Authority" for
one body across three paragraphs. A topic that knows only its own formal name
matches none of them.

`strict: true` marks an alias short enough to collide with ordinary words or
other acronyms — `HAM`, `TTD`, `CAA`, `SC`. Those are matched case-sensitively
and on word boundaries; loose and lowercased, `HAM` fires inside dozens of words.

Telugu aliases are matched by containment rather than by `\b`, which does not
work against a non-ASCII script. Telugu has no case, so nothing is lost.

## Two rules learned from real items

**A place is not an institution.** `Tirupati` was seeded as a TTD alias and
attached an ISRO launch (Sriharikota sits in Tirupati district) and a university
land-norm Bill (Tirupati municipal corporation) to the temple trust. Removing it
took TTD from 4 items to 1 — the one that is actually about TTD.

**A topic named only in the body needs naming twice.** A topic in the *headline*
is what the item is about, and one hit is enough. Single-hit body matches were
almost all incidental: a generic phrase like `urban infrastructure` or `social
justice` brushing past in one clause. Requiring two hits for a body-only match
took `AP urban infrastructure` from 4 items to 1, correctly.

Together these took the first build from 73 matches to 59. Fewer, and right.

## Why matching is done with aliases and not a model

Because it has to be rebuildable and explainable. Rebuilding must be free, which
rules out a model call per item per topic. And "does this item mention APCRDA" is
a lookup, not a judgement — a lookup that records the exact alias it matched can
be corrected by editing one row, which a model verdict cannot.

The real limit: this cannot recognise a topic discussed without being named. The
answer is to add the alias, not to reach for a model.

## What it produces

**The cross-paper reuse map** — `reuseMap()`, and the point of the whole layer.
A topic inherits the paper units of every item that names it, weighted by how
many items support the pairing, so one item's stray tag and a genuine recurring
reuse do not look the same. On the first build, `AP Panchayati Raj and local
bodies` already spanned P1 through P5 off a single day's newspaper.

**Standing gaps** — `coldTopics()`: seeded topics that no item has yet touched.
AP ones are listed first because those are the expensive ones to be missing.

**Unmatched items** — reported every run. Each is either genuinely off-syllabus
or a missing alias, and the distinction is a judgement for a person. This is how
the `railways-infrastructure` topic came to exist: the linker reported a Cabinet
rail-multitracking item that matched nothing.

## Adding to the vocabulary

Edit `topic-data.js` and re-run. That is the whole workflow — topics upsert by
slug, aliases prune to match, derived tables rebuild.

Seed a topic *before* any item mentions it when the exam asks about it
repeatedly. Polavaram and the Reorganisation Act are seeded with no items
attached, because having somewhere for the next item to land is the entire point.
A topic table containing only what has already happened is a log, not a knowledge
map.

## Not built yet

- **No UI.** The layer is queryable from the CLI and from `lib/topics.js`, but no
  API route or React page exposes it. A topic page — dossier, reuse map, standing
  gaps — is the obvious next surface.
- **No PYQ linkage.** `topic_units` says which papers a topic serves according to
  *current affairs* items. It cannot yet say which papers have actually **asked**
  about it, because there is no PYQ table. That is the missing half of the tier
  rating: `tier` is currently a hand-assigned judgement rather than a measured
  recurrence.
- **Tiers are hand-assigned.** Once PYQs are parsed, tier should be derived from
  observed recurrence instead.
- **No Telugu aliases populated.** The matcher supports them; the vocabulary has
  none, because no Eenadu edition has been ingested yet.
