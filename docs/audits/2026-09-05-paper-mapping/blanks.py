"""How many of the blank items would stop being blank if the third clause of
the evidence filter used an explicit `standalone` flag instead of "contains a
space"?

Approximates `standalone` as: an acronym (all-caps, 3+ chars) or a proper-noun
phrase. Reports what each blank item's text already matches, so the split
between "vocabulary gap" and "filter dropped it" is measured rather than
assumed.
"""
import re
import sqlite3
import sys

c = sqlite3.connect(sys.argv[1])
q = lambda s, *a: list(c.execute(s, a))

# Reads the real `standalone` column now that one exists.
#
# The first run of this script approximated it with a regex over the alias
# text, and the approximation over-counted: it treated `CPI` as an unambiguous
# acronym and so credited two blank items (125, 130) to a recovery that will
# not happen, because in this corpus CPI is usually the Communist Party of
# India rather than the Consumer Price Index. Reading the column means the
# script and the matcher cannot disagree about what counts as specific.
aliases = q(
    """SELECT a.alias, a.unit_code, COALESCE(a.standalone, 0) FROM ref_unit_aliases a
         JOIN ref_units u ON u.unit_code = a.unit_code
        WHERE u.broad = 0 AND u.unfeedable = 0"""
)
STANDALONE = {(al, uc) for al, uc, sa in aliases if sa}
compiled = [(al, uc, re.compile(r'\b' + re.escape(al) + r'\b', re.I)) for al, uc, _ in aliases]


def standalone(alias, unit):
    """Does one mention of this alias carry this unit?"""
    return (alias, unit) in STANDALONE


blanks = q(
    """SELECT i.id, a.id, a.headline, a.standfirst, a.body
         FROM ca_items i JOIN np_articles a ON a.item_id = i.id
        WHERE i.status = 'published'
          AND NOT EXISTS (SELECT 1 FROM ca_item_units u WHERE u.item_id = i.id)
        ORDER BY i.id"""
)

recovered, gap, nothing = [], [], []
for item, aid, head, sf, body in blanks:
    headtext = f"{head or ''} {sf or ''}"
    text = f"{headtext} {body or ''}"
    hits = {}
    for al, uc, rx in compiled:
        if rx.search(text):
            hits.setdefault(uc, []).append(al)
    if not hits:
        nothing.append((item, head))
        continue
    # Would the proposed rule keep any unit? (in headline, or 2+ terms, or one
    # standalone alias)
    kept = {
        uc: terms
        for uc, terms in hits.items()
        if len(terms) >= 2
        or any(rx.search(headtext) for al, u2, rx in compiled if u2 == uc)
        or any(standalone(t, uc) for t in terms)
    }
    if kept:
        recovered.append((item, head, kept))
    else:
        gap.append((item, head, hits))

print('BLANK PUBLISHED ITEMS: %d\n' % len(blanks))
print('A. would gain a unit under a `standalone` rule (alias ALREADY exists): %d' % len(recovered))
for item, head, kept in recovered:
    first = list(kept.items())[:2]
    print('   item %-4s %-58s %s' % (item, (head or '')[:58],
                                     '; '.join('%s<-%s' % (u, ','.join(t[:2])) for u, t in first)))
print('\nB. text matches an alias but too weakly even then: %d' % len(gap))
for item, head, hits in gap:
    print('   item %-4s %-58s %s' % (item, (head or '')[:58],
                                     list(hits.items())[:1]))
print('\nC. matches no alias at all (true vocabulary gap, or not examinable): %d' % len(nothing))
for item, head in nothing:
    print('   item %-4s %s' % (item, (head or '')[:70]))
