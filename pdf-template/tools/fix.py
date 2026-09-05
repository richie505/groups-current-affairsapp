"""Post-process topics_raw.json -> data.json (template input). Adds hooks/recaps and manual corrections."""
import json, re

T = json.load(open("topics_raw.json"))
by = {t["n"]: t for t in T}

def dehyph(s):
    if not isinstance(s, str): return s
    s = re.sub(r"(\w)- (\w)", r"\1-\2", s)
    s = re.sub(r"(\w)– (\w)", r"\1–\2", s)
    s = re.sub(r"\*\*- (\w)", r"**-\1", s)
    s = re.sub(r"^\*\* +", "**", s)
    return s

def walk(o):
    if isinstance(o, dict): return {k: walk(v) for k, v in o.items()}
    if isinstance(o, list): return [walk(v) for v in o]
    return dehyph(o)

# ---- re-parse options robustly ----
def reparse(q):
    text = q.pop("raw")
    idxs = [m.start() for m in re.finditer(r"\(a\)\s", text)]
    start = None
    for i in reversed(idxs):
        rest = text[i:]
        if re.search(r"\(a\).*\(b\).*\(c\).*\(d\)", rest):
            start = i; break
    if start is None:
        return q
    stem = re.sub(r"\(a\)$", "", text[:start].strip()).strip()
    block = text[start:]
    parts = re.split(r"\s?\(([a-d])\)\s", " " + block)
    opts = {}
    for i in range(1, len(parts) - 1, 2):
        letter, val = parts[i], parts[i + 1].strip()
        if letter not in opts or not opts[letter]:
            if val: opts[letter] = val
    options = [opts.get(l, "") for l in "abcd"]
    # stem line breaks
    stem = re.sub(r"\s(?=(?:I|II|III|IV|V)\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=[A-D]\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=[1-4]\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=\((?:i|ii|iii|iv|a|b|c|d)\)\s)", "\n", stem)
    stem = re.sub(r"\s(?=List-I(?:\s*\([^)]*\))?\s+(?:A\.|\(a\)|1\.))", "\n", stem)
    stem = re.sub(r"\s(?=List-II(?:\s*\([^)]*\))?\s+(?:1\.|I\.|\(i\)|A\.))", "\n", stem)
    stem = re.sub(r"\s(?=Codes:|Which of the|Which one of|Select the correct|Choose the correct|Statement [AB]:|Reason \(R\):)", "\n", stem)
    stem = re.sub(r"\s(?=Statement A:|Statement B:)", "\n", stem)
    q["stem"] = stem.strip(); q["options"] = options
    return q

for t in T:
    t["questions"] = [reparse(q) for q in t["questions"]]

# ---- manual corrections ----
# topic 4 / 5 static summary spill
by[4]["static_linkage"]["summary"] = ("This updates the static topics of State Public Service Commissions, merit-based civil-service recruitment, "
    "administrative accountability and judicial review. It also connects with public administration ethics and the credibility of constitutional recruitment institutions.")
by[5]["static_linkage"]["summary"] = ("This updates the static topics of the definition of “industry”, judicial interpretation of labour legislation, "
    "industrial relations and the role of the Supreme Court in settling precedent.")
# topic 8: first paragraph is really 'why in news' body; bold subtitle stays as lead
kd = by[8]["key_details"]
by[8]["why_in_news"] = [kd[0]["text"]]
by[8]["key_details"] = kd[1:]
# topic 9: markdown table leak -> proper table
w = by[9]["why_in_news"][0]
pre = w.split(" The CJI argued")[0]
by[9]["why_in_news"] = [pre]
by[9]["key_details"] = [
    {"type": "p", "text": "The CJI argued that an effective justice-delivery system promotes economic growth by creating three conditions:"},
    {"type": "table", "header": ["Institutional quality", "Economic significance"], "rows": [
        ["Trust", "Encourages citizens and investors to rely on legal institutions"],
        ["Predictability", "Makes outcomes, contracts and regulations more dependable"],
        ["Stability", "Reduces uncertainty and supports sustained economic activity"]]},
    {"type": "p", "text": "He emphasised that institutions are not merely safeguards added after growth begins; they constitute the architecture on which durable growth rests. Consistency in judicial interpretation, therefore, has economic value because it strengthens confidence in India as a destination for capital. The statement is useful for linking **judicial independence**, **rule of law**, **ease of doing business** and ethical public institutions."}]
# topic 10: split table row
kd = by[10]["key_details"]
kd[0]["rows"].append(["Donald Trump, President of the United States", "Said that Washington was watching developments in the conflict and claimed that Iran wanted a deal but was not prepared to accept what he considered the correct terms."])
by[10]["key_details"] = [kd[0], kd[2]]
# topic 18: why in news lost to column order
by[18]["why_in_news"] = ["**Vignan's University**, **Vadlamudi**, **Guntur district**, inaugurated a **Centre of Excellence on Blue Economy** under the theme **“Sustainable Ocean–Thriving Future.”** **Dr. Shailesh Nayak**, Director of the **National Institute of Advanced Studies (NIAS)**, Bengaluru, inaugurated the centre. Its work will cover coastal conservation, ocean technologies, blue growth, research, innovation, policy and skill development. The initiative treats the blue economy as a balance between economic use of marine resources and protection of ecological systems, climate resilience, livelihoods and human safety."]
q68 = [q for q in by[17]["questions"] if q["q"] == 68][0]
q68["options"][3] = "I, II and III"
q65 = [q for q in by[17]["questions"] if q["q"] == 65][0]
q65["options"][3] = "(a-ii), (b-iv), (c-i), (d-iii)"
# topic 11 tags (missing in source) -> infer from index page: none listed; keep empty but give a sensible paper map
by[11]["tags"] = ["GROUP-I PRELIMS — SCIENCE & TECHNOLOGY", "GROUP-I PRELIMS — GEOGRAPHY"]
# topic 7 'What it is' none; fine.
# Q10 stem was garbled in source (overlapping text on page 5): restore
q10 = [q for q in by[3]["questions"] if q["q"] == 10][0]
q10["stem"] = "Which of the following was the education-related theme covered by the Joint Statement adopted at the BRICS Youth Ministers' Meeting?"

# ---- hooks + recaps ----
HOOKS = {
1: ("3 hubs on one map: Vizag = network · Amaravati = sports city · Nellore = equipment factory",
    ["CM N. Chandrababu Naidu proposed a BRICS Youth and Sports Innovation Network centred on Visakhapatnam at the BRICS Youth & Sports Ministers' Meeting 2026 (22 Aug 2026, 11 BRICS countries).",
     "Purpose: exchange of athletes and coaches among BRICS members; sports framed as cooperation across language, culture and geography.",
     "Amaravati Sports City = full sports ecosystem; Nellore = manufacturing centre for sports equipment, apparel and technology."]),
2: ("“One Culture, Many Faiths, One Humanity” — Tarangam (Kuchipudi) opened the night",
    ["Gala dinner of the BRICS Youth & Sports Ministers' Meeting 2026, Visakhapatnam, 22 Aug 2026; attended by CM Naidu, Union Minister Mansukh Mandaviya and MoS Raksha Nikhil Khadse.",
     "Opening item Tarangam = Kuchipudi; “Kuchipudi Andhra Vaibhavam” = Andhra Pradesh traditions.",
     "Other regions on stage: Gujarat, Kerala, Manipur (“Land of Culture, Courage and Colours”), Assam (“Land of Heritage, Nature and Culture”) — example of cultural diplomacy / soft power."]),
3: ("MY Bharat 2.5 crore → 1,00,000 young leaders · bilaterals with South Africa + UAE",
    ["BRICS Youth Ministers' Meeting concluded at Visakhapatnam on 22 Aug 2026 with a Joint Statement; presided by Mansukh Mandaviya (MoS Khadse, Secretary Sunil Paliwal).",
     "Themes: education & skills, entrepreneurship, S&T, poverty alleviation, health & sports, environment, interfaith dialogue, youth inclusion — youth as active partners, not beneficiaries.",
     "MY Bharat has 2.5 crore+ registered youth; call to build 1,00,000 young leaders without political backgrounds."]),
4: ("Arts 315–323 (PSCs) · Art 320 (functions) · Art 226 (High Court review)",
    ["I&PR Minister Kolusu Parthasarathy (TDP Central office, near Mangalagiri, 22 Aug 2026) accused ex-CM Y.S. Jagan Mohan Reddy of false claims on APPSC Group-I recruitment.",
     "He cited an A.P. High Court finding of lapses under the YSRCP government and an SIT finding that unqualified persons evaluated answer sheets.",
     "Exam angle: institutional integrity of a State PSC, administrative accountability, judicial review."]),
5: ("1978 Rajappa ‘Triple Test’ → 2026 Jai Bir Singh adds ‘commercial character’ · Nagarathna dissents",
    ["SC majority in State of Uttar Pradesh v. Jai Bir Singh (20 Aug 2026) narrowed “industry”, revisiting Bangalore Water Supply v. A. Rajappa (1978).",
     "Triple Test = systematic activity + employer–employee cooperation + production/distribution of goods or services; profit motive not decisive. Sovereign functions (judiciary, law & order, defence) excluded.",
     "Definitions: Sec 2(j) Industrial Disputes Act 1947 vs Sec 2(p) Industrial Relations Code 2020; ruling does not disturb pending IDA cases; Jairam Ramesh (Congress) criticised."]),
6: ("SC (22 Aug 2026) sets aside NGT (Dec 2017) · DDA refunds ₹5 crore within 4 weeks",
    ["SC set aside the NGT order holding Art of Living Foundation liable for Yamuna floodplain damage during the World Culture Festival 2016; appeal by Vyakti Vikas Kendra India; bench Satish Chandra Sharma & N.K. Singh.",
     "DDA criticised for permitting the event on an active floodplain — against the precautionary principle and public trust doctrine; floodplain already damaged before hand-over.",
     "Static: NGT Act 2010 (Secs 14, 15, 16, 20, 22 — appeal to SC within 90 days); Art 21, 48A, 51A(g); remedies under Arts 32, 136, 226."]),
7: ("1 Oct 2026: Mangaluru leaves Palakkad (Southern Rly) → joins Mysuru (South Western Rly)",
    ["Railway Board decision to detach the Mangaluru region (incl. Ullal–Mangaluru section) from Palakkad division and merge it with Mysuru division.",
     "Kerala opposition (V.D. Satheesan) fears revenue and service loss; coastal Karnataka welcomes the move.",
     "Mangaluru region (esp. New Mangalore Port) gives >half of Palakkad division's ~₹800 crore annual revenue — Centre–State coordination issue."]),
8: ("DGHC 1988 → GTA 2011 → 2026 committee (chair Pankaj Kumar Singh, interlocutor since Oct 2025)",
    ["Union govt (meeting at Siliguri, 22 Aug 2026, chaired by Amit Shah) formed a committee to finalise a “permanent political solution” for the Gorkha community of the Darjeeling hills.",
     "Present: WB CM Suvendu Adhikari, Darjeeling MP Raju Bista; demand = separate Gorkhaland State.",
     "Earlier arrangements: Darjeeling Gorkha Hill Council (1988), Gorkhaland Territorial Administration (2011); Article 3 governs State alteration."]),
9: ("T-P-S: Trust · Predictability · Stability = ‘Nyaya-nomics’ (CJI Surya Kant)",
    ["CJI Surya Kant coined “Nyaya-nomics” (economics of justice) at the 11th BRICS+ Legal Forum, organised by the Bar Association of India, New Delhi.",
     "Effective justice delivery promotes growth through three conditions: trust, predictability, stability.",
     "Institutions are the architecture of growth, not safeguards added later — links rule of law, judicial independence and ease of doing business."]),
10: ("22 Aug statements → 24 Aug sanctions · Iran: ‘secondary sanctions have no basis in law’ · China = key partner",
    ["US and Iran exchanged defiant statements on 22 Aug 2026 ahead of Washington's fresh sanctions announcement due 24 Aug 2026.",
     "Esmaeil Baqaei (Iranian Foreign Ministry spokesperson): sanctions = extraterritorial authority; secondary sanctions lack basis in international law.",
     "Donald Trump: Iran wanted a deal but not on the correct terms. Final package not yet announced; China named as Tehran's key economic partner."]),
11: ("3,497 Ma chert at Bhitardari (Singhbhum Craton) · 4 of 8 zircons · PNAS",
    ["Evidence of microbial life ≥3.5 billion years old in a carbon-bearing banded chert from Bhitardari, Singhbhum Craton (Jharkhand–Odisha).",
     "Uranium–lead dating of zircons (4 of 8 gave 3,497 million years); carbon isotope pattern resembles living cells; chert preserves organics but cannot itself be dated.",
     "Context: Earth formed ~4.54 Ga; older Greenland claims (3.7–3.8 Ga) disputed. Researchers Trisrota Chaudhuri & Mark Harrison (UCLA); GSI Kolkata."]),
12: ("Veligonda = Krishna water (Srisailam) via Nallamala tunnels → Prakasam · Nellore · Kadapa · Markapuram — 31 Aug 2026",
    ["CM Naidu: Phase-I of Veligonda (Poola Subbaiah Veligonda) project inaugurated, water released 31 Aug 2026 — 1.19 lakh acres irrigation, ~4 lakh people drinking water.",
     "₹2,250 crore spent in two years; ₹250 crore third instalment to oustees; foundation laid by Naidu in 1996; Ramayapatnam Port for horticultural exports.",
     "Static: Entry 17 State List vs Entry 56 Union List; Art 262; Inter-State River Water Disputes Act 1956; Polavaram = Godavari, Veligonda = Krishna."]),
13: ("₹10,200 cr water (123 ULBs) · ₹5,500 cr roads · ₹4,200 cr drainage (Urban Challenge Fund)",
    ["AP allocated ₹10,200 crore for safe drinking water in 123 municipalities (pipelines + treated water, under AMRUT and other schemes) — Minister P. Narayana.",
     "Wider package: ₹5,500 crore roads and repairs; ₹4,200 crore underground drainage under the Urban Challenge Fund; solid-waste backlog and waste-to-energy revival.",
     "Review meeting at VMRDA hall, Visakhapatnam; target to complete upgrades within 2026."]),
14: ("A. Koduru (Anakapalli), 22 Aug: ‘Google DC isn't drinking your water’ + Swarna Andhra–Swachch Andhra + Skill University",
    ["CM Naidu at A. Koduru village, K. Kotapadu mandal, Anakapalli district, rejected claims that the Visakhapatnam Google data centre causes water shortage (construction not yet begun in earnest).",
     "Announced Skill University, Polavaram water for Anakapalli, and Swarna Andhra–Swachch Andhra (one Saturday a month for sanitation; zero-waste panchayats).",
     "Ambition: Anakapalli as AP's leading district within 25 years; MLA Bandaru Satyanarayana Murthy (Madugula) requested the projects."]),
15: ("$72.85 bn = FCNR(B) 64.40 + OFCB 4.86 + ECB 2.59 (as at 21 Aug 2026)",
    ["RBI: $72.85 billion forex generated under its swap facility via FCNR(B) deposits, Overseas Foreign Currency Borrowings and External Commercial Borrowings; reported by Authorised Dealer Banks.",
     "FCNR(B) = foreign-currency deposits from NRIs; ECB = borrowings by Indian entities from recognised overseas lenders; OFCB = foreign-currency borrowings by eligible banks.",
     "Exam pattern: dominant channel (FCNR(B)), reporting mechanism (AD banks), reference date (21 Aug 2026)."]),
16: ("HS 8413 (pumps) & 8414 (air/vacuum pumps, compressors) · Section 301 · 10% vs 10–35% tariff",
    ["Aug 2026 White House report (“Great Transshipment Scam”) alleges Chinese pumps routed through the Pune–Gujarat–Chennai belt to the US with little value addition, dodging Section 301 tariffs.",
     "Indian pump exports to US ~₹4,000 crore; many exporters are US/multinational firms; SMEs import Chinese components duty-free under the Advance Authorisation scheme.",
     "Comparison data: Canada ~85% and Mexico >11% of US HS 8413 imports, India a little over 2%; NYSE was the stock-exchange reference."]),
17: ("1982 DTAA → 2016 Protocol (shares from 1 Apr 2017) → 2024 PPT → Jul 2026 ratified, notification pending",
    ["Mauritius Minister Jyoti Jeetun: India stays attractive; amended India–Mauritius DTAA ratified by Mauritian Cabinet in July 2026 but needs notification by both countries.",
     "2016 Protocol brought source-based capital-gains taxation on shares acquired on/after 1 April 2017; 2024 amendment added the Principal Purpose Test (anti-treaty-shopping).",
     "Mauritius FDI: ~$6.6 bn = 11.2% of India's FDI in 2025–26; $186 bn cumulative Apr 2000–Mar 2026 (DPIIT data)."]),
18: ("Vignan's (Vadlamudi, Guntur) + INCOIS MoU · ‘Sustainable Ocean–Thriving Future’ · inaugurated by Shailesh Nayak (NIAS)",
    ["Vignan's University, Vadlamudi, Guntur district, opened a Centre of Excellence on Blue Economy; inaugurated by Dr. Shailesh Nayak, Director NIAS Bengaluru.",
     "MoU with INCOIS (Indian National Centre for Ocean Information Services) on ocean observation, information systems, research, tech transfer and skills.",
     "Dr. Srinivasa Kumar Tummala (Secretary, MoES) flagged fisheries, shipping, offshore & wave energy, tourism, logistics; Dr. T.M. Balakrishnan Nair = Director INCOIS."]),
19: ("Asia University (Taiwan) × Vignan, Guntur: 4-member team, circular economy for e-waste",
    ["Prof. Lin Chun-Wei (Chair Professor & Dean, Asia University, Taiwan) led a four-member delegation to Vignan University, Guntur, for an MoU (week before 23 Aug 2026).",
     "Pitch: circular-economy model for India's e-waste — modular design, easy repair, longer lifecycles, gold/silver recovery, take-back programmes and consumer refunds.",
     "Partnership logic: India's physics/chemistry strengths + Taiwan's e-waste processing experience."]),
20: ("Rania (Kanpur Dehat) since 1976 · 62,225 MT chromium waste · 73–96% blood samples over limit · NGT",
    ["Hexavalent chromium has contaminated groundwater and soil across villages in three Uttar Pradesh districts from decades of industrial-waste dumping.",
     "Earliest/largest dump at Rania, Kanpur Dehat (~1976); NGT reports: 62,225 metric tonnes; waste removed a year before the report, boundary wall ordered.",
     "2025 government report: 73%–96% of blood samples exceeded safe limits; yellow handpump water and yellow-green soil are the field indicators; NGT Act 2010."]),
21: ("Khalingduar RF (Dhansiri Div, Udalguri, BTR) · 2 ha · Lantana + Chromolaena + Mikania · Aaranyak + IEF · biochar",
    ["Assam Forest Department is managing invasive alien plants in Khalingduar Reserve Forest (Dhansiri Forest Division, Udalguri district, adjoining Bhutan) — a 2-hectare site in the Bodoland Territorial Region.",
     "Targets: Lantana camara, Chromolaena odorata, Mikania micrantha — they crowd out native forage for elephants and herbivores.",
     "Implemented by Aaranyak (Guwahati) with the International Elephant Foundation: manual removal, seed-ball regeneration, biochar from cleared biomass, periodic monitoring."]),
}
for n, (hook, recap) in HOOKS.items():
    by[n]["hook"] = hook
    by[n]["recap"] = recap

T = walk(T)

# ---- assemble document ----
sections = []
for t in T:
    name = t.pop("section")
    if not sections or sections[-1]["_raw"] != name:
        m = re.match(r"SECTION (\w+) — (.*)", name)
        sections.append({"_raw": name, "label": "Section " + m.group(1), "title": m.group(2).title().replace(" And ", " and "), "topics": []})
    sections[-1]["topics"].append(t)

for s in sections:
    s.pop("_raw")

doc = {
    "meta": {
        "title": "Andhra Pradesh Current Affairs",
        "subtitle": "Daily Compendium",
        "date": "23 August 2026",
        "weekday": "Sunday",
        "exams": ["APPSC Group-I Prelims", "APPSC Group-II Screening", "APPSC Group-II Mains"],
        "source": "The Hindu",
        "reading_time": "About 33 minutes",
        "disclaimer": "A revision resource. Current-affairs facts are correct as at the dates shown and are superseded by later events.",
        "footer": "APPSC Current Affairs · Sunday, 23 August 2026",
    },
    "sections": sections,
}
json.dump(doc, open("data.json", "w"), indent=1, ensure_ascii=False)
print("sections", [(s["label"], s["title"], len(s["topics"])) for s in sections])
bad = [(q["q"], q["options"]) for s in sections for t in s["topics"] for q in t["questions"] if len(q["options"]) != 4 or not all(q["options"])]
print("bad options:", bad)
