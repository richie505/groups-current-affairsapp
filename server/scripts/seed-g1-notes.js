'use strict';

// The eight-section Group-I note for each seeded item.
//
// Kept separate from seed-content.js because the two are different kinds of
// writing. That file holds the facts — what happened, sourced and cross-checked.
// This one holds the argument: dimensions, the AP angle, the essay bridges, the
// way forward. Facts get corrected when a source is re-read; arguments get
// sharpened when the exam pattern is better understood. Splitting them means
// either can be revised without touching the other.
//
// `match` is a substring of the item's headline, which is how each note finds
// its item. Matched rather than keyed by id because ids change every time the
// content is reseeded.

const G1_NOTES = [
  // -------------------------------------------------------------------------
  {
    match: 'RBI keeps repo rate',
    theme: 'ECONOMY',
    sub_theme: 'Monetary policy and inflation targeting',
    why_news:
      'On 5 August 2026 the Monetary Policy Committee held the repo rate at 5.25% for a fourth consecutive review while raising its FY27 growth forecast to 6.7%.',
    background:
      'India has operated a **flexible inflation targeting** framework since 2016: a statutory 4% CPI target with a ±2% band, set by the Centre in consultation with the RBI, and delivered by a six-member **Monetary Policy Committee** of three RBI and three external members. The MPC has two levers — the **policy rate** and the **stance** — and the stance is the more informative of the two, because it signals the likely direction of the next move. A *neutral* stance means the Committee has reserved its options in both directions.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'Raising a growth forecast while refusing to cut says the binding constraint is imported price risk, not weak demand.',
      },
      {
        dimension: 'political',
        note: 'A held rate in an easing cycle invites pressure from growth constituencies; the MPC’s statutory insulation is what makes the hold possible.',
      },
      {
        dimension: 'international',
        note: 'The West Asia escalation from July 2026 transmits through fertiliser, shipping and trade flows, not crude alone — imported inflation is a foreign-policy variable.',
      },
      {
        dimension: 'social',
        note: 'Food and fuel drove the overshoot, so the incidence falls hardest on the poorest quintile, whose consumption basket is food-heavy.',
      },
      {
        dimension: 'legal',
        note: 'The 4% ± 2% target and the MPC’s composition are statutory under the amended RBI Act — the framework is law, not policy discretion.',
      },
    ],
    ap_angle:
      'Andhra Pradesh is exposed twice over to exactly the channels the Governor named. Its agricultural economy runs on **imported fertiliser**, and its export economy runs through **Visakhapatnam, Krishnapatnam and Gangavaram** — so a shipping-and-fertiliser shock hits both the input cost of the farm sector and the freight cost of the export sector at once. A revenue-deficit state since bifurcation also carries a higher **market-borrowing cost** than the Union, so a held policy rate keeps AP’s own debt service elevated for longer than the national conversation about rate cuts suggests.',
    linked: [
      '- **RBI Act, 1934** (as amended 2016) — the statutory basis of the MPC and the inflation target',
      '- **Urjit Patel Committee (2014)** — recommended the shift to inflation targeting',
      '- **Monetary Policy Framework Agreement, 2015** — the 4% ± 2% target',
      '- **16th Finance Commission** award 2026-31 — state fiscal space, which interacts with borrowing costs',
      '- Key figures: repo **5.25%**, FY27 growth **6.7%**, target **4% ± 2%**',
    ].join('\n'),
    bridges: [
      'This raises the broader question of whether an economy as exposed to imported energy and fertiliser as India’s can achieve price stability through domestic monetary policy alone.',
      'It also illustrates the deeper tension in a federal polity where the costs of a national monetary decision fall unevenly across states with very different debt and trade profiles.',
    ].join('\n\n'),
    way_forward:
      'The durable answer to imported price shocks lies less in the policy rate than in reducing the exposure itself — domestic fertiliser and energy capacity, diversified shipping routes, and buffer stocks sized for supply shocks rather than for procurement targets.',
    essays: [
      { question: 'Flexible inflation targeting has served India well, but its limits are being tested by imported inflation. Examine.', kind: 'direct' },
      { question: 'Monetary policy is national, but its costs are federal. Discuss with reference to Indian states.', kind: 'direct' },
      { question: 'Globalisation and the loss of policy autonomy', kind: 'indirect', note: 'Use the imported-inflation channels as the concrete example.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'GOBARdhan',
    theme: 'ENVIRONMENT',
    sub_theme: 'Energy transition and the circular economy',
    why_news:
      'On 6 August 2026 the Union Cabinet approved GOBARdhan, a ₹23,731 crore national compressed biogas scheme running from FY27 to FY36.',
    background:
      'Compressed biogas is produced by anaerobic digestion of organic waste — crop residue, cattle dung, press mud, municipal organic waste — and upgraded until it is **chemically equivalent to natural gas**, which is why it can enter the existing gas grid without separate infrastructure. India has supported CBG since **SATAT (2018)** but through instruments spread across four ministries, which produced roughly **200 plants** and no national market. GOBARdhan replaces that with a single platform built on two things a producer actually needs: **guaranteed demand** (a blending obligation on City Gas Distribution entities, rising 3%→4%→5% by FY29) and **a guaranteed price** (₹2,110 per MMBTU, for at least ten years).',
    dimensions: [
      {
        dimension: 'economic',
        note: 'The state is underwriting a market rather than funding assets — the same instrument logic as solar reverse auctions, and the fiscal risk of a guaranteed price has to land somewhere.',
      },
      {
        dimension: 'environmental',
        note: 'Diverts crop residue from burning and organic waste from landfill, addressing an air-quality problem and a methane problem with one instrument.',
      },
      {
        dimension: 'social',
        note: 'Gives farmers a priced use for residue they currently burn, converting a disposal cost into an income stream.',
      },
      {
        dimension: 'political',
        note: 'Consolidating four ministries into one scheme is a rare reversal of the usual direction of travel in Indian programme design.',
      },
      {
        dimension: 'legal',
        note: 'The CBG Obligation is a notified mandate on CGD entities, so it is enforceable rather than aspirational.',
      },
      {
        dimension: 'ethical',
        note: 'An administered price protects both producer and consumer, which means the subsidy is borne by the general taxpayer — including those who use no gas at all.',
      },
    ],
    ap_angle:
      'Andhra Pradesh is unusually well placed on feedstock. It is a major **sugarcane** state, so **press mud** — explicitly named in the scheme — becomes a priced input rather than a mill waste problem; it has a large **paddy** belt generating residue, and one of India’s larger **cattle** populations. The state also already runs **APCNF (Andhra Pradesh Community-managed Natural Farming)**, the world’s largest agroecology programme, for which the scheme’s organic-manure output is a direct input — so GOBARdhan and APCNF are complementary rather than parallel. The constraint is CGD network density: the blending obligation only creates demand where a city gas network exists to carry it.',
    linked: [
      '- **SATAT (2018)** — Sustainable Alternative Towards Affordable Transportation, the predecessor',
      '- **Market Development Assistance** scheme for organic manure',
      '- **Biomass Aggregation Machinery** and **Development of Pipeline Infrastructure** schemes',
      '- **National Bioenergy Programme** — Central Financial Assistance for CBG plants',
      '- **APCNF** — Andhra Pradesh Community-managed Natural Farming, an offtaker for organic manure',
      '- Key figures: outlay **₹23,731 crore**; obligation **3%→4%→5%** by FY29; price **₹2,110/MMBTU**; over **200** existing plants',
    ].join('\n'),
    bridges: [
      'This illustrates a broader shift in Indian industrial policy from subsidising supply to manufacturing demand — the state as market-maker rather than financier.',
      'It also raises the wider question of whether waste should be understood as a disposal problem or as a mispriced resource, which is the central claim of the circular economy.',
    ].join('\n\n'),
    way_forward:
      'The test of GOBARdhan will not be plants commissioned but whether the blending obligation is actually enforced on City Gas Distribution entities year after year — a guaranteed market is only as good as its weakest compliance year.',
    essays: [
      { question: 'India’s waste can fuel India’s growth. Critically examine the circular bioeconomy as a development strategy.', kind: 'direct' },
      { question: 'Assess the shift in Indian policy from supply-side subsidy to demand-side mandate, with examples.', kind: 'direct' },
      { question: 'Energy security and the rural economy', kind: 'indirect', note: 'CBG is the strongest available example of the two being solved together.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'ISRO to end a seven-month launch pause',
    theme: 'SCIENCE & TECHNOLOGY',
    sub_theme: 'Space programme and earth observation',
    why_news:
      'ISRO prepared in August 2026 to end a launch pause of nearly seven months with the GISAT-1A (EOS-05) mission, following the PSLV-C62 failure of 12 January 2026.',
    background:
      'A **GISAT**-class satellite is distinguished by its orbit rather than its sensor. Placed in **geostationary orbit**, it holds position over the same longitude and can therefore image the same region repeatedly at short intervals — unlike a conventional earth-observation satellite in a sun-synchronous orbit, which revisits only on a fixed multi-day cycle. That difference is what makes it a **disaster-monitoring** asset rather than only a survey one. The geostationary altitude also requires the heavier **GSLV** rather than the PSLV.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'A seven-month grounding after one failure is the cost of a launch programme with thin redundancy — capability without depth.',
      },
      {
        dimension: 'political',
        note: 'Makes the case for the private-sector opening in space rather than against it: more launch providers means a single failure grounds less.',
      },
      {
        dimension: 'environmental',
        note: 'High-frequency imaging is a climate-adaptation instrument — cyclone tracking and flood mapping on the timescale events actually move.',
      },
      {
        dimension: 'social',
        note: 'Disaster warning is a public good whose benefit is concentrated among the coastal poor, who have the least capacity to evacuate late.',
      },
      {
        dimension: 'international',
        note: 'Earth-observation capacity is a diplomatic asset — India shares imagery with neighbours through regional disaster mechanisms.',
      },
    ],
    ap_angle:
      'The connection is unusually direct. **Sriharikota (SDSC-SHAR)** sits in **Tirupati district**, so a launch cadence that stops for seven months is a regional economy that stops with it — contractors, transport, hospitality. More importantly, Andhra Pradesh has a **974 km coastline** and is among India’s most **cyclone-exposed** states: a geostationary imaging satellite is a direct capability gain for AP’s disaster management, and the state is therefore both the host of the launch site and one of the largest domestic beneficiaries of the payload.',
    linked: [
      '- **Indian Space Policy 2023** — opened launch and satellite services to private participation',
      '- **IN-SPACe** and **NSIL** — the regulator and the commercial arm',
      '- **NDMA** and state disaster management authorities — the users of the imagery',
      '- **PSLV-C62 / EOS-N1** failure, 12 January 2026 — the cause of the pause',
      '- Key facts: **GSLV** launch vehicle; **geostationary** orbit; AP coastline **974 km**',
    ].join('\n'),
    bridges: [
      'This raises the broader question of how a strategic capability should be structured for resilience — whether national champions or a competitive ecosystem better survive a single failure.',
      'It also shows technology arriving as adaptation rather than mitigation, which is the less discussed half of the climate response.',
    ].join('\n\n'),
    way_forward:
      'Redundancy, not reliability, is what turns a launch capability into a launch industry — and the private participation opened in 2023 is the mechanism by which a single failure stops costing two quarters.',
    essays: [
      { question: 'India’s space programme has capability but limited redundancy. Examine the implications.', kind: 'direct' },
      { question: 'Technology as climate adaptation: discuss with reference to India’s coastal states.', kind: 'direct' },
      { question: 'Science, the State and the market', kind: 'indirect', note: 'Use the launch monopoly and its opening as the case.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'four rail multitracking projects',
    theme: 'ECONOMY',
    sub_theme: 'Transport infrastructure and capacity',
    why_news:
      'On 19 August 2026 the CCEA approved four rail multitracking projects worth ₹9,450 crore, adding about 410 km across eight districts, including the 90 km Gummidipundi–Gudur third and fourth lines in Andhra Pradesh and Tamil Nadu.',
    background:
      '**Multitracking** adds lines along an existing alignment rather than building a new route. The distinction matters because the binding constraint on Indian trunk rail is rarely route mileage — it is **paths per day**: how many trains a saturated section can carry. Adding a third and fourth line relieves that without the land acquisition, resettlement and clearance timelines that make greenfield rail slow. The Gummidipundi–Gudur section sits on the **Chennai–Vijayawada** trunk corridor on the east coast, one of the densest mixed freight-and-passenger stretches in the country.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'Capacity relief on a working asset, not a new line to an unserved district — a harder political case and a better economic one.',
      },
      {
        dimension: 'environmental',
        note: 'Shifting freight from road to rail cuts emissions per tonne-kilometre; multitracking is the enabling condition for that shift.',
      },
      {
        dimension: 'social',
        note: 'Stated to improve connectivity for about 6,448 villages and 60 lakh people — but relief on a trunk route benefits through-traffic first.',
      },
      {
        dimension: 'political',
        note: 'Four states in one approval is a familiar distributive pattern; the AP section serves interstate freight more than local demand.',
      },
      {
        dimension: 'legal',
        note: 'Along an existing alignment, so the Land Acquisition Act 2013 burden is minimal — which is precisely why this route was chosen.',
      },
    ],
    ap_angle:
      'The **Gummidipundi–Gudur** stretch is the southern gateway of the **Chennai–Vijayawada** corridor, and it is the bottleneck through which Andhra Pradesh’s port hinterland traffic passes. AP has committed heavily to port-led industrialisation — **Krishnapatnam, Gangavaram, Bhogapuram** and the Visakhapatnam–Chennai Industrial Corridor — and every one of those investments assumes rail evacuation capacity that this section currently limits. Contrast it with **Polavaram**: one large project carrying the entire benefit stream, versus incremental capacity on an asset already earning. The second model is less visible politically and more reliable economically.',
    linked: [
      '- **PM Gati Shakti** National Master Plan — multimodal infrastructure coordination',
      '- **National Rail Plan 2030** — the trunk capacity augmentation framework',
      '- **Dedicated Freight Corridors** — the same problem addressed by separation rather than addition',
      '- **Visakhapatnam–Chennai Industrial Corridor (VCIC)** — the AP demand this capacity serves',
      '- **Sagarmala** — port-led development, which depends on hinterland rail',
      '- Key figures: **₹9,450 crore**, **410 km**, **8 districts**, completion **2030-31**',
    ].join('\n'),
    bridges: [
      'This raises the broader question of whether infrastructure policy should favour visible new assets or unglamorous capacity relief on assets already in use.',
      'It also illustrates how land acquisition constraints silently shape what infrastructure gets built, independently of what would be most useful.',
    ].join('\n\n'),
    way_forward:
      'The gain from multitracking is realised only if freight actually shifts onto the freed paths, which makes tariff policy and terminal capacity — not track kilometres — the thing to watch next.',
    essays: [
      { question: 'Infrastructure policy in India favours new assets over capacity relief. Critically examine.', kind: 'direct' },
      { question: 'Port-led development requires hinterland connectivity. Discuss with reference to Andhra Pradesh.', kind: 'direct' },
      { question: 'The invisible constraints on development', kind: 'indirect', note: 'Land acquisition as the constraint that decides what gets built.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'Visakhapatnam Economic Region',
    theme: 'ECONOMY',
    sub_theme: 'Regional development and balanced growth',
    why_news:
      'In August 2026 Andhra Pradesh set out a development plan for the Visakhapatnam Economic Region targeting up to ₹9.5 lakh crore of investment and a US$120 billion regional economy by 2032.',
    background:
      'The **Visakhapatnam Economic Region** covers **eight districts** across roughly **36,000 sq km** of north coastal Andhra Pradesh. What distinguishes it from a headline investment target is the **spatial structure**: six ports, seven manufacturing nodes, 17 major agricultural zones, six service hubs and 12 tourism hubs. Named nodes are auditable in a way an investment figure is not. The region has been the state’s weakest on most human-development measures since bifurcation, so concentrating capacity there is an attempt to build a **second growth pole** rather than let the Krishna–Guntur belt and Amaravati absorb everything.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'Public investment of ₹3.5–4 lakh crore is positioned to crowd in up to ₹5.3 lakh crore private — the anchor-investor logic at state scale.',
      },
      {
        dimension: 'social',
        note: 'North coastal AP has the state’s weakest human-development indicators; 20–24 lakh jobs would be transformative if they materialise locally.',
      },
      {
        dimension: 'political',
        note: 'Regional-imbalance policy in the language of investment promotion — a second growth pole is also a political settlement between regions.',
      },
      {
        dimension: 'environmental',
        note: 'Six ports and steel on a cyclone-exposed coast with significant mangrove cover: the plan is a coastal-zone management question as much as an industrial one.',
      },
      {
        dimension: 'international',
        note: 'AI data centres and green hydrogen are both export-facing bets exposed to global standards and offtake, not just domestic demand.',
      },
      {
        dimension: 'ethical',
        note: 'Tribal districts — Alluri Sitharama Raju, Parvathipuram Manyam — are inside the region, so displacement and Fifth Schedule consent are live questions.',
      },
    ],
    ap_angle:
      'This *is* the AP item, so the angle is internal: the plan is a bet that **north coastal Andhra** can be developed without cannibalising Amaravati. The eight districts include two **Scheduled Area** districts — **Alluri Sitharama Raju** and **Parvathipuram Manyam** — which brings the **Fifth Schedule**, PESA and land-transfer restrictions directly into an industrial plan. The honest test is not the ₹9.5 lakh crore but whether the seven named manufacturing nodes acquire tenants, because a decade of corridor announcements has produced more memoranda than factories.',
    linked: [
      '- **AP Reorganisation Act 2014** and the **Amendment Act 2026** — the bifurcation context and Amaravati as sole statutory capital',
      '- **Visakhapatnam–Chennai Industrial Corridor (VCIC)** — the ADB-supported predecessor framework',
      '- **Sagarmala** — port-led development',
      '- **National Green Hydrogen Mission** — the policy behind the hydrogen component',
      '- **Fifth Schedule** and **PESA 1996** — applicable in two of the eight districts',
      '- Key figures: **8 districts**, **36,000 sq km**, **US$120 bn** by 2032, **20–24 lakh** jobs, **6 ports / 7 nodes / 17 agri zones / 6 service hubs / 12 tourism hubs**',
    ].join('\n'),
    bridges: [
      'This raises the broader tension between concentrating investment where returns are highest and dispersing it where need is greatest — the central dilemma of balanced regional development.',
      'It also illustrates how sub-national industrial policy has become the main arena of Indian development strategy, with states competing on capacity rather than waiting for central allocation.',
    ].join('\n\n'),
    way_forward:
      'Announced targets are cheap and named nodes are not — so the plan should be judged annually on tenancy at the seven manufacturing nodes and on consent processes in the two Scheduled Area districts, rather than on cumulative investment memoranda.',
    essays: [
      { question: 'Balanced regional development requires more than investment targets. Critically examine with reference to Andhra Pradesh.', kind: 'direct' },
      { question: 'States, not the Centre, are now the主 arena of Indian industrial policy. Discuss.', kind: 'direct' },
      { question: 'Growth, displacement and consent', kind: 'indirect', note: 'The Fifth Schedule districts inside the region make this concrete.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'India–EU Free Trade Agreement',
    theme: 'INTERNATIONAL RELATIONS',
    sub_theme: 'Trade agreements and strategic autonomy',
    why_news:
      'The India–EU Free Trade Agreement was signed on 27 January 2026 at the 16th EU–India Summit in New Delhi, alongside an EU–India Security and Defence Partnership.',
    background:
      'India’s trade negotiating practice has long kept **commercial** and **strategic** tracks separate, partly as a deliberate expression of non-alignment. Signing a free trade agreement and a security and defence partnership on the same day at the same summit reverses that: it treats market access and strategic alignment as a single package. The defence partnership covers **maritime security, non-proliferation, space, cyber and hybrid threats and counter-terrorism**, and a **Green Hydrogen Task Force** was launched under the climate strand.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'Market access to the EU matters most for labour-intensive exports — textiles, leather, marine products — which is where employment elasticity is highest.',
      },
      {
        dimension: 'political',
        note: 'Pairing trade with defence is a departure from keeping the two tracks separate, and reopens the strategic-autonomy debate on new terms.',
      },
      {
        dimension: 'international',
        note: 'Signals a hedge in a multipolar order — deeper EU alignment without a treaty alliance.',
      },
      {
        dimension: 'environmental',
        note: 'The Green Hydrogen Task Force ties Indian production to EU standards; CBAM makes EU carbon rules a de facto constraint on Indian exporters.',
      },
      {
        dimension: 'legal',
        note: 'Signature is not entry into force — ratification, and in the EU’s case member-state assent for mixed agreements, comes later.',
      },
      {
        dimension: 'social',
        note: 'Tariff liberalisation redistributes: gains to exporters, adjustment costs to import-competing sectors including dairy and small manufacturing.',
      },
    ],
    ap_angle:
      'Three concrete exposures. **Marine products** — Andhra Pradesh is India’s largest aquaculture and shrimp-producing state, and the EU is a high-value but standards-heavy market where **sanitary and phytosanitary** compliance decides access more than tariffs do. **Green hydrogen** — AP has committed large capacity, so an EU-facing standards and offtake conversation is a state industrial-policy question, not only a foreign-policy one. **Textiles and leather** — labour-intensive units that gain from tariff reduction. The state-level implication is that AP needs testing and certification infrastructure, because an FTA transfers the binding constraint from tariffs to standards.',
    linked: [
      '- **EU–India Security and Defence Partnership**, signed the same day',
      '- **Green Hydrogen Task Force** — launched at the summit',
      '- **EU Carbon Border Adjustment Mechanism (CBAM)** — the parallel constraint on exporters',
      '- **Paris Agreement** — commitment reaffirmed at the summit',
      '- **MPEDA** — the authority for marine-product export standards, directly relevant to AP',
      '- Key facts: signed **27 January 2026**, **16th** EU–India Summit, Hyderabad House, New Delhi',
    ].join('\n'),
    bridges: [
      'This raises the broader question of whether strategic autonomy in a multipolar world is preserved by keeping trade and security separate, or by holding several deep partnerships at once.',
      'It also illustrates how trade agreements have shifted from tariff instruments to regulatory ones, where the binding constraint is standards compliance rather than duty rates.',
    ].join('\n\n'),
    way_forward:
      'The gains will accrue to whichever states build testing, certification and traceability capacity fastest, so the useful national response to an FTA is now regulatory infrastructure rather than further negotiation.',
    essays: [
      { question: 'Strategic autonomy is better preserved by many deep partnerships than by distance from all. Critically examine.', kind: 'direct' },
      { question: 'Modern trade agreements are regulatory, not tariff, instruments. Discuss the implications for India.', kind: 'direct' },
      { question: 'India in a multipolar world', kind: 'indirect', note: 'The simultaneous trade-and-defence signature is the sharpest available example.' },
    ],
  },

  // -------------------------------------------------------------------------
  {
    match: 'National Investment and Infrastructure Fund',
    theme: 'ECONOMY',
    sub_theme: 'Infrastructure financing and catalytic capital',
    why_news:
      'An additional ₹30,000 crore commitment announced on 29 June 2026 took the Union government’s total commitment to the National Investment and Infrastructure Fund to ₹60,000 crore.',
    background:
      '**NIIF** is India’s sovereign-anchored infrastructure investment platform, managed by **NIIFL**, in which the **Government of India holds 49%** — deliberately below control. The structure exists to solve a specific problem: global pension and sovereign wealth funds want Indian infrastructure exposure but will not underwrite single projects in an unfamiliar jurisdiction. A co-investment vehicle with government participation but not government control is the instrument that makes that possible. It currently manages about **₹40,000 crore** and has returned close to **₹12,000 crore** to investors through exits.',
    dimensions: [
      {
        dimension: 'economic',
        note: 'Catalytic capital: the commitment is an anchor to crowd in institutional money, not a fund for the assets themselves.',
      },
      {
        dimension: 'political',
        note: 'The 49% stake is a deliberate constraint on state control, chosen to make the platform legible to foreign investors.',
      },
      {
        dimension: 'international',
        note: 'ADIA, Temasek, CPP Investments, Ontario Teachers’, JBIC and the US DFC on the register make this an instrument of economic diplomacy as much as finance.',
      },
      {
        dimension: 'legal',
        note: 'An AIF structure under SEBI regulations, which is what allows the fund-of-funds design and the daughter-AIF layer.',
      },
      {
        dimension: 'ethical',
        note: 'Public capital de-risking private returns raises the standard question of who bears the downside if an asset fails.',
      },
    ],
    ap_angle:
      'Andhra Pradesh has the pipeline ambition — Bhogapuram airport, port expansion, industrial corridors, green hydrogen — but catalytic capital only deploys where projects are **bankable and properly prepared**. The binding constraint at state level is therefore **project-preparation capacity**, not the availability of finance: feasibility studies, risk allocation, concession design. That reframes the familiar state demand "we need investment" into "we need a project development unit", which is a much stronger answer and one very few candidates will give. AP’s revenue-deficit position since bifurcation also limits its ability to fund preparation from its own budget, so the constraint compounds.',
    linked: [
      '- **National Infrastructure Pipeline** and **National Monetisation Pipeline** — the companion instruments',
      '- **PM Gati Shakti** — planning coordination',
      '- **NIIF India–Japan Fund** — its first bilateral fund, focused on climate and energy transition',
      '- **Maritime Development Fund** and **Research, Development and Innovation Fund** — structured with NIIF advisory support',
      '- Key figures: GOI shareholding **49%**; total commitment **₹60,000 crore**; managed **~₹40,000 crore**; exits **~₹12,000 crore**; first infrastructure fund **₹16,000 crore**, India’s largest domestic infrastructure fund',
    ].join('\n'),
    bridges: [
      'This raises the broader question of whether India’s infrastructure gap is a financing problem at all, or a project-preparation problem wearing a financing costume.',
      'It also shows the state acting as a co-investor rather than a provider, which is a substantially different theory of the developmental state.',
    ].join('\n\n'),
    way_forward:
      'Catalytic capital rewards states that can present bankable, well-prepared projects, so the highest-return investment for a state like Andhra Pradesh is in project development capacity rather than in further investment promotion.',
    essays: [
      { question: 'India’s infrastructure deficit is a project-preparation problem, not a financing one. Critically examine.', kind: 'direct' },
      { question: 'Assess the state as co-investor rather than provider in India’s infrastructure strategy.', kind: 'direct' },
      { question: 'Capacity, not capital', kind: 'indirect', note: 'Applies well beyond infrastructure — use NIIF as the anchoring example.' },
    ],
  },
];

module.exports = { G1_NOTES };
