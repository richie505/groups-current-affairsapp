"""Pulls the audit sample: 40 random published unit tags, and 15 of the items
that carry no unit at all. Seeded, so the same sample can be re-pulled."""
import random
import sqlite3
import sys
import textwrap

DB = sys.argv[1]
c = sqlite3.connect(DB)
q = lambda s, *a: list(c.execute(s, a))

random.seed(20260905)

tags = q(
    """SELECT i.id, a.headline, au.unit_code, ru.paper, ru.label,
              au.in_headline, COALESCE(au.in_standfirst, 0), au.hits, au.matched
         FROM ca_items i
         JOIN np_articles a ON a.item_id = i.id
         JOIN np_article_units au ON au.article_id = a.id
         JOIN ref_units ru ON ru.unit_code = au.unit_code
                          AND ru.broad = 0 AND ru.unfeedable = 0
        WHERE i.status = 'published'
        ORDER BY i.id, au.unit_code"""
)
sample = random.sample(tags, 40)

print("=" * 100)
print("A. FORTY RANDOM UNIT TAGS ON PUBLISHED ITEMS  (population: %d)" % len(tags))
print("=" * 100)
for n, (iid, head, unit, paper, label, inhead, instand, hits, matched) in enumerate(sample, 1):
    print("\n[%02d] item %s   %s  (%s)" % (n, iid, unit, paper))
    print("     ARTICLE:  %s" % textwrap.shorten(head, 92))
    print("     UNIT:     %s" % textwrap.shorten(label, 92))
    # in_headline means the headline ALONE from 5 Sep 2026. Before that it also
    # covered the standfirst, which on this paper is often a whole paragraph —
    # so a tag showing in_headline=1 in an older database may only have been a
    # standfirst hit. The two are reported separately now.
    print("     EVIDENCE: matched=%r  in_headline=%s  in_standfirst=%s  hits=%s"
          % (matched, inhead, instand, hits))

blanks = q(
    """SELECT i.id, i.headline, i.bucket, substr(i.notes_markdown, 1, 260)
         FROM ca_items i
        WHERE i.status = 'published'
          AND NOT EXISTS (SELECT 1 FROM ca_item_units u WHERE u.item_id = i.id)
        ORDER BY i.id"""
)
print("\n\n" + "=" * 100)
print("B. FIFTEEN OF THE %d ITEMS WITH NO UNIT AT ALL" % len(blanks))
print("=" * 100)
for n, (iid, head, bucket, notes) in enumerate(random.sample(blanks, min(15, len(blanks))), 1):
    print("\n[B%02d] item %s  (%s)" % (n, iid, bucket))
    print("      HEADLINE: %s" % textwrap.shorten(head, 92))
    print("      OPENS:    %s" % textwrap.shorten(' '.join((notes or '').split()), 200))
