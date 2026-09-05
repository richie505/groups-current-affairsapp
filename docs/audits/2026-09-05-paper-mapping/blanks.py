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

aliases = q(
    """SELECT a.alias, a.unit_code FROM ref_unit_aliases a
         JOIN ref_units u ON u.unit_code = a.unit_code
        WHERE u.broad = 0 AND u.unfeedable = 0"""
)
compiled = [(al, uc, re.compile(r'\b' + re.escape(al) + r'\b', re.I)) for al, uc in aliases]

ACRONYM = re.compile(r'^[A-Z][A-Z0-9&.-]{2,}$')


def standalone(alias):
    """An alias specific enough to carry a unit on one mention."""
    if ACRONYM.match(alias):
        return True
    return ' ' in alias and len(alias.split()) >= 2 and any(w[:1].isupper() for w in alias.split())


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
        or any(standalone(t) for t in terms)
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
