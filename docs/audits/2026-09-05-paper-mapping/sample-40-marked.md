# Paper-mapping audit — 40 random tags

Sample drawn 5 Sep 2026 from the 283 unit tags on published items, seeded
(`random.seed(20260905)`) so it can be re-pulled exactly. Marked by hand.

Judged against the **article** headline and body — the text the matcher actually
reads — not the model-written item headline. The two differ, and judging against
the item headline gives the wrong answer on at least three of these.

**Precision: 29/40 = 72.5%**

| # | Item | Unit | Paper | Matched | Head | Verdict | Note |
|---|------|------|-------|---------|------|---------|------|
| 01 | 148 | `G1P-B2` | G1P-Polity | `Rajya Sabha` | - | **RIGHT** | Gorkhaland statehood is federal structure; Rajya Sabha is where it was announced |
| 02 | 79 | `G1P-S4` | G1P-Science | `renewable energy` | - | **WRONG** | one park of six is a renewables zone — the story is industrial policy |
| 03 | 228 | `G2-P2-U5` | G2-P2A | `dairy` | Y | **WRONG** | the "article" is an ADVERTISEMENT; `dairy` is in its ad copy |
| 04 | 188 | `G2-P2-U1` | G2-P2A | `growth rate` | - | **RIGHT** | core-sector growth is macro-economic structure |
| 05 | 222 | `G1P-B3` | G1P-Polity | `Public Service Commission` | - | **RIGHT** | story turns on PSC recruitment credibility |
| 06 | 85 | `G2-P1-U7` | G2-P1B | `Supreme Court` | Y | **RIGHT** | Supreme Court judgment — judiciary, in the headline |
| 07 | 135 | `G1P-B3` | G1P-Polity | `Public Service Commission` | - | **RIGHT** | recruitment through the PSC, a constitutional authority |
| 08 | 67 | `G2-P2-U8` | G2-P2B | `wildlife` | Y | **RIGHT** | forest and wildlife protection, in the headline |
| 09 | 155 | `G1P-B5` | G1P-Polity | `human rights` | - | **WRONG** | `human rights` from a quote about Hasina's extradition; unit is Indian rights issues |
| 10 | 119 | `G1P-B3` | G1P-Polity | `good governance` | - | **WRONG** | `good governance` is generic; SEBI belongs to B4 (regulatory bodies), not B3 |
| 11 | 91 | `G2-P1-U6` | G2-P1B | `Fundamental Right, Article 21, right to life` | Y | **RIGHT** | MGNREGA and Article 21 — three terms, in the headline |
| 12 | 70 | `G1P-S2` | G1P-Science | `artificial intelligence` | - | **WRONG** | a robotic dog is robotics, not ICT / e-governance / Digital India |
| 13 | 134 | `G1P-B3` | G1P-Polity | `Election Commission` | - | **RIGHT** | electoral rolls and the Election Commission |
| 14 | 66 | `G2-S3` | G2-Screening | `Right to Education, RTE` | Y | **RIGHT** | Right to Education, two terms, in the headline |
| 15 | 60 | `G2-P2-U5` | G2-P2A | `capital region` | Y | **RIGHT** | roads in the capital region — AP corridors |
| 16 | 123 | `G1P-B4` | G1P-Polity | `statutory body` | - | **RIGHT** | the Bar Council of India is a statutory body |
| 17 | 101 | `G1P-A6` | G1P-History | `Mahatma Gandhi, Subhas Chandra Bose` | - | **WRONG** | both names sit inside one quoted sentence about the freedom struggle |
| 18 | 119 | `G1P-C4` | G1P-Economy | `SEBI` | Y | **RIGHT** | SEBI in the headline — financial markets regulator |
| 19 | 192 | `G2-P1-U7` | G2-P1B | `Legislative Assembly` | - | **WRONG** | `Legislative Assembly` is only where the fertiliser figure was stated |
| 20 | 82 | `G1P-S3` | G1P-Science | `ISRO, launch vehicle, Gaganyaan` | - | **WRONG** | SEGMENTATION BLEED — an ISRO/Gaganyaan op-ed merged into a Vimal Elaichi story |
| 21 | 210 | `G1P-B3` | G1P-Polity | `Governor` | Y | **RIGHT** | the Governor, a constitutional authority, in the headline |
| 22 | 69 | `G1P-S5` | G1P-Science | `Pollution Control Board, air quality` | - | **RIGHT** | Pollution Control Board and air quality, two terms |
| 23 | 154 | `G1P-C4` | G1P-Economy | `stock exchange` | Y | **WRONG** | `stock exchange` from "New York Stock Exchange" in passing |
| 24 | 91 | `G1P-B1` | G1P-Polity | `Fundamental Right, Article 21` | Y | **RIGHT** | Article 21 and Fundamental Right, in the headline |
| 25 | 214 | `G2-P1-U6` | G2-P1B | `constitutional amendment` | - | **RIGHT** | delimitation and women's reservation are constitutional amendment matters |
| 26 | 65 | `G2-P2-U5` | G2-P2A | `capital region` | - | **RIGHT** | APCRDA plots in the capital region |
| 27 | 233 | `G1P-B1` | G1P-Polity | `Article 19` | - | **RIGHT** | Article 19 — the op-ed argues speech and assembly |
| 28 | 207 | `G2-P2-U3` | G2-P2A | `agriculture, crop` | Y | **RIGHT** | agriculture and crop loans, two terms, in the headline |
| 29 | 69 | `G2-P2-U9` | G2-P2B | `air pollution, air quality, Pollution Control Board` | - | **RIGHT** | air pollution, four terms |
| 30 | 102 | `G2-P2-U9` | G2-P2B | `solid waste, waste management` | - | **RIGHT** | the article does cover solid-waste backlogs and waste-to-energy |
| 31 | 116 | `G1P-S5` | G1P-Science | `public health` | - | **RIGHT** | health sits inside this unit |
| 32 | 81 | `G1P-D3` | G1P-Geography | `population density` | - | **WRONG** | `population density` in passing; the story is land acquisition for a highway |
| 33 | 214 | `G2-P1-U7` | G2-P1B | `Lok Sabha, Parliament` | - | **RIGHT** | seat reallocation is Parliament composition, two terms |
| 34 | 116 | `G2-P2-U10` | G2-P2B | `public health, nutrition` | - | **RIGHT** | public health and nutrition, two terms |
| 35 | 72 | `G2-P1-U7` | G2-P1B | `Supreme Court, Chief Justice, Constitution Bench` | - | **RIGHT** | Supreme Court, Chief Justice, Constitution Bench — three terms |
| 36 | 67 | `G1P-S5` | G1P-Science | `wildlife` | Y | **RIGHT** | wildlife and forests, in the headline |
| 37 | 135 | `G2-P1-U8` | G2-P1B | `Public Service Commission` | - | **RIGHT** | the Public Service Commission is a constitutional body |
| 38 | 211 | `G2-P1-U7` | G2-P1B | `High Court` | - | **RIGHT** | High Court directions — judiciary |
| 39 | 238 | `G2-S2` | G2-Screening | `cyclone, flood, drinking water, water supply` | - | **RIGHT** | floods and cyclones — hazards sit in geography, four terms |
| 40 | 190 | `G2-P2-U3` | G2-P2A | `procurement` | Y | **WRONG** | `procurement` of school goods is not economics of agriculture/industry/services |

## Article headlines, for reference

- **01** item 148 — Govt. promises permanent solution to Gorkha issue, sets up committee
- **02** item 79 — Six industrial parks proposed under Central scheme
- **03** item 228 — 22 Product Categories* Retail Touchpoints 22 States & 5 UTs*
- **04** item 188 — Core sector growth slows to 5.4% in July as fertilizer, oil output falls
- **05** item 222 — Govt. job a way past barriers for Adivasi youth
- **06** item 85 — Trade unions sound the alarm over Supreme Court judgment on the definition of industry
- **07** item 135 — State govt. issues G.O. to fill over 10,000 posts
- **08** item 67 — Exclusive unit planned to protect forests, wildlife
- **09** item 155 — The former BNP general secretary who steered the party through the difficult years of the Hasina [...]
- **10** item 119 — 'SEBI reviewing framework for disclosure of issue proceeds utilisation'
- **11** item 91 — SC lauds scrapped MGNREGA as a 'good, effective scheme'
- **12** item 70 — TTD tests robotic dog for wildlife monitoring, safety of devotees
- **13** item 134 — Cong. alleges bulk voter purge bid in Uttarakhand
- **14** item 66 — RTE admissions surged in unaided pvt. schools under NDA govt.: Lokesh
- **15** item 60 — Four additional roads to boost connectivity to Amaravati capital region
- **16** item 123 — Pressure mounts on BCI chief amid demands for resignation
- **17** item 101 — Keralam to approach Centre against Railway bifurcation
- **18** item 119 — 'SEBI reviewing framework for disclosure of issue proceeds utilisation'
- **19** item 192 — 'Enough stock of fertilizer'
- **20** item 82 — The 'Vimal Elaichi' promotion question
- **21** item 210 — CBI seeks Governor's nod to prosecute Karnataka Minister
- **22** item 69 — Choking on air they breathe
- **23** item 154 — Trade scam or supply chain play? Profit in transit
- **24** item 91 — SC lauds scrapped MGNREGA as a 'good, effective scheme'
- **25** item 214 — The stakes in India's delimitation debate
- **26** item 65 — Returnable plots allotted to 23 Undavalli farmers
- **27** item 233 — Either culpable or incompetent
- **28** item 207 — Tenant farmers seek ₹2 lakh unsecured crop loan
- **29** item 69 — Choking on air they breathe
- **30** item 102 — Govt. allocates ₹10,200 crore to set up safe drinking water facilities in Urban Local Bodies
- **31** item 116 — New studies pursue 'perfect' blend for coffee and health
- **32** item 81 — Keralam to move SC on prohibition of construction at NH
- **33** item 214 — The stakes in India's delimitation debate
- **34** item 116 — New studies pursue 'perfect' blend for coffee and health
- **35** item 72 — 1978 'industry' definition void under new code: SC
- **36** item 67 — Exclusive unit planned to protect forests, wildlife
- **37** item 135 — State govt. issues G.O. to fill over 10,000 posts
- **38** item 211 — Noise annoys India must enforce noise pollution regulations uniformly and consistently
- **39** item 238 — Water purifiers developed during Rajasthan deluge delivered to Assam
- **40** item 190 — CPI leader alleges lapses in KGBV procurement tenders
