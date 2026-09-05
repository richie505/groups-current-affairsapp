"""The standalone proposal, second pass. Nothing is written.

The first pass took "two capitalised words" as proof of specificity. Checked
against the eleven errors the audit found, that rule re-admits two of them:
`Mahatma Gandhi, Subhas Chandra Bose` (error 17, both names inside one quoted
sentence) and the venue-not-subject shape of `Legislative Assembly` (error 19),
whose siblings Legislative Council, Lok Sabha and Rajya Sabha it would have
promoted.

So the proper-noun set is split. A named BODY, SCHEME, ACT, EVENT or PLACE
carries its unit on one mention. A COURT, a CHAMBER, a FREEDOM-MOVEMENT NAME or
a demographic descriptor does not — those are cited in passing across every
beat, which is the failure the audit measured.
"""
import re
import sqlite3
import sys
from collections import defaultdict

c = sqlite3.connect(sys.argv[1])
rows = sorted(
    set(
        c.execute(
            """SELECT a.alias, a.unit_code, u.paper FROM ref_unit_aliases a
                 JOIN ref_units u ON u.unit_code = a.unit_code"""
        )
    )
)

AMBIGUOUS = {'CPI': 'Consumer Price Index vs Communist Party of India'}

FORCED_FALSE = {
    'human rights', 'good governance', 'stock exchange', 'population density',
    'renewable energy', 'artificial intelligence', 'legislative assembly',
}

# Cited in passing across every beat: the venue or the authority, not the
# subject. They still qualify through the headline clause or two distinct
# terms — they simply do not carry a unit on one body mention.
VENUE_OR_PASSING = {
    'supreme court', 'high court', 'chief justice', 'constitution bench',
    'lok sabha', 'rajya sabha', 'legislative council', 'question hour',
    'select committee', 'council of ministers', 'president of india',
    'advocate general', 'attorney general',
    'mahatma gandhi', 'sardar patel', 'subhas chandra bose', 'jawaharlal nehru',
    'b.r. ambedkar',
    'scheduled caste', 'scheduled tribe', 'backward class',
}

ACRONYM = re.compile(r'^[A-Z][A-Z0-9&.\-]{2,}$')

true_acr, true_proper, flag_amb, flag_venue, forced, rest = [], [], [], [], [], []

for alias, unit, paper in rows:
    low = alias.lower()
    words = alias.split()
    if low in FORCED_FALSE:
        forced.append((alias, unit, paper))
    elif low in VENUE_OR_PASSING:
        flag_venue.append((alias, unit, paper))
    elif alias.upper() in AMBIGUOUS and len(words) == 1:
        flag_amb.append((alias, unit, paper, AMBIGUOUS[alias.upper()]))
    elif len(words) == 1 and ACRONYM.match(alias):
        true_acr.append((alias, unit, paper))
    elif len(words) >= 2 and sum(1 for w in words if w[:1].isupper()) >= 2:
        true_proper.append((alias, unit, paper))
    else:
        rest.append((alias, unit, paper))

def group(items):
    by = defaultdict(list)
    for a, u, p in items:
        by[a].append(u)
    return by

print('# `standalone` proposal — %d distinct alias/unit rows\n' % len(rows))
print('| Bucket | Rows | standalone |')
print('|---|---|---|')
print('| A. Unambiguous acronyms | %d | **true** |' % len(true_acr))
print('| B. Named bodies, schemes, acts, events, places | %d | **true** |' % len(true_proper))
print('| C. Ambiguous acronym (CPI) | %d | false — flagged |' % len(flag_amb))
print('| D. Courts, chambers, freedom-movement names, SC/ST/BC | %d | false — flagged |' % len(flag_venue))
print('| E. The seven from the error table | %d | false |' % len(forced))
print('| F. Everything else (generic words and phrases) | %d | false |' % len(rest))
print('| **Total set true** | **%d** | |' % (len(true_acr) + len(true_proper)))

for title, items in (('A. ACRONYMS', true_acr), ('B. NAMED BODIES / SCHEMES / ACTS / EVENTS / PLACES', true_proper)):
    print('\n\n## %s\n' % title)
    by = group(items)
    for a in sorted(by, key=str.lower):
        print('- `%s` — %s' % (a, ', '.join(sorted(set(by[a])))))

print('\n\n## C. AMBIGUOUS — left false, needs your call\n')
for a, u, p, why in flag_amb:
    print('- `%s` → **%s** (%s) — %s' % (a, u, p, why))

print('\n\n## D. LEFT FALSE ON PURPOSE — cited in passing, not the subject\n')
by = group(flag_venue)
for a in sorted(by, key=str.lower):
    print('- `%s` — %s' % (a, ', '.join(sorted(set(by[a])))))

print('\n\n## E. THE SEVEN FROM THE ERROR TABLE — false\n')
by = group(forced)
for a in sorted(by, key=str.lower):
    print('- `%s` — %s' % (a, ', '.join(sorted(set(by[a])))))
