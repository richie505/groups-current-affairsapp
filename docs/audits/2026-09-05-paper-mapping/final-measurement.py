"""The closing measurement for the paper-mapping work.

Two populations, reported together and apart:

  A. every tag from the three hand-judged samples that SURVIVES in production
  B. every tag resting on a batch-1 or batch-2 alias, judged fresh

A is read from the audit file rather than re-drawn from a seed, because the
snapshot the seed indexed into no longer exists and a re-draw against a
different population would silently mis-assign the verdicts.
"""
import re
import sqlite3
import sys

DB = sys.argv[1]
MARKED = 'docs/audits/2026-09-05-paper-mapping/sample-40-marked.md'

# ---- sample 1, parsed from the table it was recorded in ---------------------
S1 = {}
deferred1 = set()
row = re.compile(r'^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*`([A-Z0-9P\-]+)`\s*\|.*?\*\*(RIGHT|WRONG)\*\*\s*\|(.*)$')
for line in open(MARKED, encoding='utf-8'):
    m = row.match(line.strip())
    if not m:
        continue
    _n, item, unit, verdict, note = m.groups()
    S1[(int(item), unit)] = verdict == 'RIGHT'
    # the two error classes the reviewer deferred: an advertisement admitted as
    # an article, and an op-ed merged into a news story by the segmenter
    if 'ADVERTISEMENT' in note.upper() or 'SEGMENTATION BLEED' in note.upper():
        deferred1.add((int(item), unit))

# ---- samples 2 and 3, listed explicitly (item, unit, right, deferred) -------
S2 = [
    (154,'G2-P2-U3',1,0),(142,'G1P-C2',0,0),(196,'G1P-C3',1,0),(216,'G1P-B2',1,0),
    (77,'G2-S3',1,0),(63,'G2-P2-U5',0,1),(216,'G1P-D2',0,0),(206,'G1P-A3',1,0),
    (112,'G2-S2',0,0),(217,'G1P-C5',1,0),(216,'G2-P1-U7',1,0),(60,'G2-S2',1,0),
    (65,'G1P-C5',1,0),(100,'G1P-D1',1,0),(234,'G1P-B2',1,0),(228,'G2-P2-U2',0,1),
    (141,'G2-P2-U10',1,0),(97,'G1P-S5',1,0),(84,'G2-P2-U5',1,0),(82,'G2-P2-U6',0,1),
    (225,'G2-P1-U8',1,0),(230,'G2-P1-U3',0,0),(103,'G1P-B6',1,0),(105,'G2-P2-U2',1,0),
    (188,'G2-P2-U3',1,0),(154,'G2-P2-U5',0,1),(98,'G2-S3',1,0),(74,'G2-P1-U10',1,0),
    (152,'G2-P2-U8',1,0),(194,'G2-P1-U7',1,0),(225,'G1P-B3',1,0),(205,'G1P-S5',0,0),
    (119,'G1P-B4',1,0),(219,'G1P-C2',1,0),(66,'G1P-B5',1,0),(208,'G2-P1-U8',1,0),
    (222,'G2-S2',0,0),(193,'G2-P2-U4',0,0),(99,'G2-P1-U8',1,0),(150,'G1P-B6',0,0),
]
S3 = [
    (139,'G1P-C2',0,0),(111,'G1P-B6',1,0),(211,'G1P-S5',1,0),(138,'G1P-C2',0,0),
    (144,'G2-P2-U5',1,0),(214,'G2-P1-U9',1,0),(147,'G1P-S5',1,0),(223,'G2-P1-U7',1,0),
    (97,'G2-P1-U7',1,0),(144,'G1P-B3',0,1),(102,'G2-S2',1,0),(199,'G2-S3',1,0),
    (226,'G1P-C1',0,0),(155,'G1P-C2',0,0),(203,'G2-P2-U2',1,0),(61,'G2-P1-U10',1,0),
    (144,'G1P-S2',1,0),(227,'G1P-D4',1,0),(73,'G1P-B3',1,0),(93,'G2-P1-U7',0,0),
    (63,'G2-P1-U7',1,0),(73,'G2-P1-U8',1,0),(60,'G1P-C5',1,0),(106,'G1P-C4',1,0),
    (91,'G2-P1-U7',1,0),(207,'G1P-C3',1,0),(237,'G2-P1-U7',1,0),(226,'G1P-C4',0,0),
    (226,'G2-P2-U4',0,0),(158,'G1P-B4',1,0),(98,'G2-S2',0,0),(222,'G2-P1-U8',1,0),
    (158,'G1P-D2',1,0),(70,'G1P-S5',1,0),(154,'G2-P2-U2',1,0),(70,'G2-P2-U8',1,0),
    (223,'G1P-B2',1,0),(103,'G2-S2',1,0),(203,'G1P-C4',1,0),(80,'G1P-D3',1,0),
]

judged = {}
for k, ok in S1.items():
    judged[k] = (ok, k in deferred1)
for item, unit, ok, dfr in S2 + S3:
    judged[(item, unit)] = (bool(ok), bool(dfr))

# ---- population B: the new-alias tags, judged 5 Sep against article text ----
# 55 of 56 right. The one WRONG is item 213: a district road-safety awareness
# drive is not economic geography, and it cleared the filter on `transport`
# (weak) plus `road safety` (non-standalone) together.
NEW_WRONG = {(213, 'G1P-D4')}

t = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
alive = {
    (r[0], r[1])
    for r in t.execute(
        """SELECT u.item_id, u.unit_code FROM ca_item_units u
             JOIN ca_items i ON i.id = u.item_id WHERE i.status = 'published'"""
    )
}

NEW_ALIASES = {a.lower() for a in [
    'APPSC','Mega DSC','Bharat Audyogik Vikas Yojana','BHAVYA','national highway',
    'Indian Roads Congress','South Coast Railway','rule of law','Zonal Council',
    'Inter-State Council','Jal Shakti','Scheduled Areas','energy security',
    'Tariff Rate Quota','stockholding limit','MMDR','mining sector','road safety',
    'Gorkhaland','disability','decentralisation','National AYUSH Mission','AYUSH',
    'Visakhapatnam Steel Plant','Rashtriya Ispat Nigam','nursing personnel',
    'Nurses Registration and Tracking System','Integrated Tribal Development Agency',
    'Geological Survey of India','research integrity','cardiovascular',
    'Sample Registration System','crude death rate','FSSAI','fixed-dose combination',
    'Drugs Technical Advisory Board','fuel supply agreement']}

newtags = set()
for item, unit, matched in t.execute(
    """SELECT i.id, au.unit_code, au.matched FROM ca_items i
         JOIN np_articles a ON a.item_id = i.id
         JOIN np_article_units au ON au.article_id = a.id
         JOIN ref_units ru ON ru.unit_code = au.unit_code AND ru.broad = 0 AND ru.unfeedable = 0
        WHERE i.status = 'published'"""):
    terms = [x.strip().lower() for x in str(matched or '').split(',') if x.strip()]
    if any(x in NEW_ALIASES for x in terms):
        newtags.add((item, unit))
newtags &= alive

for k in newtags:
    judged[k] = (k not in NEW_WRONG, False)

pool = [(k, v) for k, v in judged.items() if k in alive]
right = sum(1 for _, (r, _d) in pool if r)
nd = [(k, v) for k, v in pool if not v[1]]
nd_right = sum(1 for _, (r, _d) in nd if r)

tags = len(alive)
blanks = t.execute(
    """SELECT COUNT(*) FROM ca_items i WHERE i.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM ca_item_units u WHERE u.item_id = i.id)"""
).fetchone()[0]
published = t.execute("SELECT COUNT(*) FROM ca_items WHERE status='published'").fetchone()[0]

print(f'published items      {published}')
print(f'tags                 {tags}')
print(f'blank items          {blanks}   ({100*blanks/published:.1f}% of published)')
print()
print(f'judged tags total    {len(judged)}   of which alive: {len(pool)}')
print(f'  new-alias tags     {len(newtags)}')
print()
print(f'POOLED PRECISION           {right}/{len(pool)} = {100*right/max(1,len(pool)):.1f}%')
print(f'  excluding deferred       {nd_right}/{len(nd)} = {100*nd_right/max(1,len(nd)):.1f}%')
print()
old = [(k, v) for k, v in pool if k not in newtags]
old_right = sum(1 for _, (r, _d) in old if r)
new_right = sum(1 for k in newtags if k not in NEW_WRONG)
print(f'  surviving sample tags    {old_right}/{len(old)} = {100*old_right/max(1,len(old)):.1f}%')
print(f'  new-alias tags           {new_right}/{len(newtags)} = {100*new_right/max(1,len(newtags)):.1f}%')
print()
print('surviving tags still judged WRONG:')
for (item, unit), (r, d) in sorted(pool):
    if not r:
        print(f'   item {item:<4} {unit}{"   [deferred class]" if d else ""}')
