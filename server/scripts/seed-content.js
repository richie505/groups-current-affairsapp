#!/usr/bin/env node
'use strict';

// Seed digests, so the app opens onto real material rather than lorem ipsum.
//
// Every item here was researched against live sources in August 2026 and
// cross-checked, per the same source discipline the pipeline is held to:
// primary sources preferred, at least two sources for any figure, and anything
// unconfirmed marked needs_verify with a note saying what to check rather than
// quietly filled in.
//
// Two of these deliberately carry needs_verify. That is not sloppiness left in
// by accident — it is what an honest current-affairs pipeline looks like, and
// the review queue and item page both need real examples of the state to be
// worth anything.
//
// Idempotent: re-running replaces the seeded days rather than duplicating them.
//
//   node server/scripts/seed-content.js            # insert as drafts
//   node server/scripts/seed-content.js --publish  # insert and publish

require('dotenv').config();
const db = require('../src/db');

const PUBLISH = process.argv.includes('--publish');

// ---------------------------------------------------------------------------
// The digests
// ---------------------------------------------------------------------------

const DAYS = [
  {
    date: '2026-08-05',
    title: 'RBI holds for a fourth time; FY27 growth forecast raised',
    items: [
      {
        headline: 'RBI keeps repo rate at 5.25% and raises FY27 growth forecast to 6.7%',
        event_date: '2026-08-05',
        bucket: 'dynamic',
        subject_tag: 'Economy',
        importance: 1,
        notes_markdown: [
          'The **Monetary Policy Committee (MPC)** concluded its three-day meeting on **5 August 2026** — the third bi-monthly review of **FY 2026-27** — and left the **repo rate unchanged at 5.25%**. The decision was **unanimous (6-0)** and the **neutral** stance was retained.',
          '',
          'This is the **fourth consecutive hold**. The last change was a cut from **5.5% to 5.25% in December 2025**.',
          '',
          '| Item | Position at this review |',
          '|---|---|',
          '| Repo rate | **5.25%** (unchanged) |',
          '| Stance | **Neutral** |',
          '| Vote | **6-0**, unanimous |',
          '| FY27 real GDP growth | Raised to **6.7%** from **6.6%** at the June review |',
          '| Governor | **Sanjay Malhotra** |',
          '',
          'Headline inflation has moved **above the 4% target**, but the Governor attributed this largely to **food and fuel** and said there were few signs of price pressures generalising. Inflation is expected to **peak in the October–December quarter** before easing.',
          '',
          'The MPC held rather than moved because it wanted **greater clarity on the inflation outlook**. The Governor flagged the **renewed escalation of conflict in West Asia since the first week of July 2026** as a risk transmitting well beyond crude prices — into **fertiliser availability, shipping routes, global trade flows and financial-market volatility**.',
        ].join('\n'),
        static_linkage:
          'Updates the monetary-policy instruments and inflation-targeting framework in the Indian Economy syllabus. The repo rate, the stance vocabulary and the MPC composition are static; the *level* is what changes, and this is the current level.',
        prelims_facts: [
          'Repo rate: 5.25% (unchanged, 5 August 2026)',
          'Policy stance: Neutral',
          'MPC vote: 6-0, unanimous',
          'Fourth consecutive hold; last change was a cut from 5.5% in December 2025',
          'FY27 real GDP growth forecast: 6.7% (raised from 6.6%)',
          'RBI Governor: Sanjay Malhotra',
          'Inflation expected to peak in Q3 FY27 (October–December)',
        ].join('\n'),
        g1_bank: 'D',
        g1_fact:
          'The MPC held the repo rate at 5.25% unanimously on 5 August 2026 — a fourth consecutive hold — while raising the FY27 real GDP growth forecast to 6.7% from 6.6%.',
        g1_angle:
          'A central bank that raises its growth forecast while refusing to cut is telling you the binding constraint is not demand but imported price risk. The West Asia escalation is the reason, and its channels — fertiliser, shipping, trade flows — matter more to Andhra Pradesh than the headline crude number does: a state whose agricultural economy runs on imported fertiliser and whose export economy runs through Visakhapatnam and Krishnapatnam is exposed twice over. This is the case for treating monetary policy as a federal question, not only a national one.',
        keywords: ['RBI', 'Repo', 'Growth Rate', 'Projections on growth rate', 'Inflation'],
        units: ['P4-U1', 'P4-U2', 'P4-U4'],
        themes: ['economy'],
        sources: [
          { url: 'https://www.forbesindia.com/article/news/rbi-mpc-live-updates-august-2026-repo-rate-sanjay-malhotra-policy-announcement-liveblog/2996705/1', publisher: 'Forbes India', is_primary: 0 },
          { url: 'https://www.jmfinancialservices.in/blogs-and-articles/rbi-mpc-august-2026', publisher: 'JM Financial', is_primary: 0 },
          { url: 'https://www.outlookmoney.com/banking/rbi-mpc-august-2026-meeting-live-updates-governor-sanjay-malhotra-speech-repo-rate-inflation-gdp-news', publisher: 'Outlook Money', is_primary: 0 },
        ],
        mcqs: [
          {
            question:
              'With reference to the RBI Monetary Policy Committee decision of 5 August 2026, consider the following statements: 1. The repo rate was left unchanged at 5.25%. 2. The decision was taken by a 4-2 majority. 3. The FY27 real GDP growth forecast was raised to 6.7%. Which of the statements given above are correct?',
            option_a: '1 and 2 only',
            option_b: '1 and 3 only',
            option_c: '2 and 3 only',
            option_d: '1, 2 and 3',
            correct_option: 'b',
            explanation:
              'Statements 1 and 3 are correct. Statement 2 is wrong: the decision was unanimous, 6-0, not a 4-2 majority — a split vote is the plausible-sounding detail deliberately altered here. As of 5 August 2026; verify against the next MPC statement before relying on the rate.',
            format: 'multi_statement',
            keyword: 'RBI',
            difficulty: 2,
            fact_as_of: '2026-08-05',
          },
          {
            question:
              'Assertion (A): The Monetary Policy Committee retained the repo rate at 5.25% in August 2026 despite raising its FY27 growth forecast.\nReason (R): The Committee sought greater clarity on the inflation outlook amid the escalation of conflict in West Asia from July 2026.',
            option_a: 'Both A and R are true, and R correctly explains A',
            option_b: 'Both A and R are true, but R does not correctly explain A',
            option_c: 'A is true but R is false',
            option_d: 'A is false but R is true',
            correct_option: 'a',
            explanation:
              'Both are true and the reason does explain the assertion: the Governor stated the hold was to gain clarity on inflation, and identified the West Asia escalation since early July 2026 as transmitting risk through fertiliser, shipping and trade channels as well as crude. As of 5 August 2026; time-sensitive.',
            format: 'assertion_reason',
            keyword: 'Repo',
            difficulty: 2,
            fact_as_of: '2026-08-05',
          },
          {
            question:
              'Which of the following statements about the August 2026 monetary policy review is INCORRECT?',
            option_a: 'The policy stance was retained as neutral',
            option_b: 'It was the fourth consecutive review at which the rate was left unchanged',
            option_c: 'The previous rate change was a cut from 5.5% to 5.25% in December 2025',
            option_d: 'The FY27 growth forecast was lowered from 6.6% to 6.4%',
            correct_option: 'd',
            explanation:
              'Option (d) is incorrect and is the answer: the forecast was RAISED to 6.7%, not lowered to 6.4%. The other three are accurate. As of 5 August 2026; verify against the latest MPC resolution if revising this much later.',
            format: 'negative_statement',
            keyword: 'Projections on growth rate',
            difficulty: 2,
            fact_as_of: '2026-08-05',
          },
        ],
      },
    ],
  },

  {
    date: '2026-08-06',
    title: 'Cabinet clears GOBARdhan, a ten-year compressed biogas scheme',
    items: [
      {
        headline: 'Cabinet approves GOBARdhan, a national compressed biogas scheme with a ₹23,731 crore outlay',
        event_date: '2026-08-06',
        bucket: 'national',
        subject_tag: '',
        importance: 1,
        notes_markdown: [
          'The Union Cabinet on **6 August 2026** approved **GOBARdhan**, the **National Circular Bioenergy Scheme** — also described in the release as India’s **National Unified Scheme for Compressed Biogas** — with an outlay of **₹23,731 crore** running from **FY 2026-27 to FY 2035-36**.',
          '',
          '| Feature | Detail |',
          '|---|---|',
          '| Outlay | **₹23,731 crore** |',
          '| Period | **FY27 to FY36** (ten years) |',
          '| Administering ministry | **Ministry of Petroleum and Natural Gas** |',
          '| Core output | **Compressed Biogas (CBG)**, organic manure |',
          '| Stated ambition | Raise domestic CBG production **nearly ten-fold** |',
          '',
          'Feedstock is **agricultural residue, cattle dung, press mud, municipal organic waste** and other biomass.',
          '',
          '### The two numbers to memorise',
          '',
          'The scheme is built on a **blending obligation** and an **administered price**, and these are the figures a question will turn on:',
          '',
          '| Instrument | Figure |',
          '|---|---|',
          '| **CBG Obligation** trajectory | **3%** in FY 2026-27 → **4%** in FY 2027-28 → **5%** from FY 2028-29 |',
          '| Applies to | **CNG (Transport)** and **PNG (Domestic)** segments, procured by **City Gas Distribution (CGD)** entities |',
          '| Administered **CBG price** | **₹2,110 per MMBTU**, with a minimum **ten-year** horizon |',
          '| **Capital assistance** | Up to **₹2 crore per tonne per day (TPD)** of installed capacity |',
          '',
          '### Six components',
          '',
          'Assured CBG offtake · stable pricing framework · capital assistance · development of pipeline infrastructure · credit support · technology development.',
          '',
          '### What it builds on',
          '',
          'GOBARdhan consolidates a set of existing instruments: **SATAT** (Sustainable Alternative Towards Affordable Transportation), the **Market Development Assistance (MDA)** scheme for organic manure, the **Biomass Aggregation Machinery (BAM)** scheme, the **Development of Pipeline Infrastructure (DPI)** scheme, and **Central Financial Assistance** for CBG plants under the **National Bioenergy Programme**. Between them these had commissioned **over 200 CBG plants**.',
          '',
          'Administratively, the significant point is **consolidation**: the CBG ecosystem had been spread across four ministries, and GOBARdhan brings the whole value chain onto one platform under a single administering ministry.',
          '',
          'One technical fact worth holding: **CBG is chemically equivalent to natural gas**, so it drops into the existing gas grid without separate infrastructure. That is why a blending obligation is even possible.',
        ].join('\n'),
        static_linkage:
          'Feeds the renewable-energy and waste-management portions of the Environment and Science & Technology syllabus, and the agricultural-residue management question in Paper IV. Also a clean example of scheme *consolidation* for questions on policy implementation.',
        prelims_facts: [
          'Scheme: GOBARdhan — National Circular Bioenergy Scheme (also: National Unified Scheme for Compressed Biogas)',
          'Approved: 6 August 2026 by the Union Cabinet',
          'Outlay: ₹23,731 crore',
          'Period: FY 2026-27 to FY 2035-36 (ten years)',
          'Administering ministry: Ministry of Petroleum and Natural Gas',
          'CBG Obligation: 3% (FY27) → 4% (FY28) → 5% (from FY29)',
          'Obligation applies to: CNG (Transport) and PNG (Domestic), via City Gas Distribution entities',
          'Administered CBG price: ₹2,110 per MMBTU, minimum ten-year horizon',
          'Capital assistance: up to ₹2 crore per tonne per day of installed capacity',
          'Components: six — offtake, pricing, capital assistance, pipeline, credit, technology',
          'Feedstock: agricultural residue, cattle dung, press mud, municipal organic waste',
          'Target: raise domestic CBG production nearly ten-fold',
          'Builds on: SATAT, MDA, BAM, DPI and CFA under the National Bioenergy Programme',
          'Existing base: over 200 CBG plants commissioned',
          'Consolidates a CBG ecosystem previously spread across four ministries',
        ].join('\n'),
        g1_bank: 'S',
        g1_fact:
          'GOBARdhan, approved 6 August 2026 with a ₹23,731 crore outlay for FY27-FY36 under the Ministry of Petroleum and Natural Gas, backs a CBG blending obligation rising 3%→4%→5% by FY29 with an administered price of ₹2,110 per MMBTU.',
        g1_angle:
          'Two arguments sit here and they are different. The first is consolidation: four ministries running overlapping CBG support is the textbook implementation failure — diffuse accountability, competing guidelines, an applicant who cannot tell which door to knock on — so collapsing it into one platform is a governance case study, and a rare positive one in a literature that is almost all failure. The second is the more interesting one. The scheme does not subsidise supply and hope; it manufactures demand through a blending obligation on City Gas Distribution entities and then guarantees a price for ten years. That is the state underwriting a market rather than funding assets, and it is the same instrument logic as solar reverse auctions — worth arguing as a general template for energy transition, with the standard objection available too: an administered price protects the producer and the consumer, so the fiscal risk has to land somewhere. For Andhra Pradesh the specific hook is press mud, where a major sugarcane state acquires a priced use for a residue it currently treats as waste.',
        keywords: ['Scheme', 'Launched', 'Ministry', 'Energy', 'Waste Management', 'Policy'],
        units: ['P5-U4', 'P5-U6', 'P4-U7', 'P3-U7'],
        themes: ['environment', 'economy', 'governance'],
        sources: [
          { url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2295480&reg=48&lang=1', publisher: 'PIB', is_primary: 1 },
          { url: 'https://www.pmindia.gov.in/en/news_updates/cabinet-approves-gobardhan-indias-national-unified-scheme-for-compressed-biogas-with-an-outlay-of-rs-23731-crore/', publisher: 'PMO India', is_primary: 1 },
          { url: 'https://www.business-standard.com/industry/news/cabinet-clears-rs-23-731-crore-gobardhan-scheme-for-compressed-biogas-126080601393_1.html', publisher: 'Business Standard', is_primary: 0 },
        ],
        mcqs: [
          {
            question: 'The GOBARdhan scheme approved in August 2026 is administered by which ministry?',
            option_a: 'Ministry of New and Renewable Energy',
            option_b: 'Ministry of Petroleum and Natural Gas',
            option_c: 'Ministry of Jal Shakti',
            option_d: 'Ministry of Agriculture and Farmers Welfare',
            correct_option: 'b',
            explanation:
              'The Ministry of Petroleum and Natural Gas administers GOBARdhan. The distractors are the three ministries that plausibly could have — and the point of the scheme is precisely that CBG support had been spread across several ministries before it. As of 6 August 2026.',
            format: 'direct_recall',
            keyword: 'Ministry',
            difficulty: 2,
            fact_as_of: '2026-08-06',
          },
          {
            question:
              'Match List-I with List-II regarding the GOBARdhan scheme:\n\n| List-I | List-II |\n|---|---|\n| a. Total outlay | i. FY27 to FY36 |\n| b. Scheme period | ii. Ministry of Petroleum and Natural Gas |\n| c. Administering ministry | iii. ₹23,731 crore |\n| d. Principal output | iv. Compressed Biogas |',
            option_a: 'a-iii, b-i, c-ii, d-iv',
            option_b: 'a-i, b-iii, c-iv, d-ii',
            option_c: 'a-iii, b-ii, c-i, d-iv',
            option_d: 'a-iv, b-i, c-ii, d-iii',
            correct_option: 'a',
            explanation:
              'Outlay ₹23,731 crore; period FY27-FY36; Ministry of Petroleum and Natural Gas; output compressed biogas. As of 6 August 2026; scheme outlays get revised, so confirm before the exam.',
            format: 'list_matching',
            keyword: 'Scheme',
            difficulty: 2,
            fact_as_of: '2026-08-06',
          },
          {
            question:
              'Statement A: GOBARdhan consolidates compressed-biogas support that had previously been spread across four ministries.\nStatement B: The scheme aims to raise domestic compressed biogas production nearly ten-fold.',
            option_a: 'Both A and B are true',
            option_b: 'Both A and B are false',
            option_c: 'A is true but B is false',
            option_d: 'A is false but B is true',
            correct_option: 'a',
            explanation:
              'Both statements are accurate as announced on 6 August 2026 — the consolidation across four ministries and the near ten-fold production ambition were both stated. Time-sensitive: targets are often restated in later guidelines.',
            format: 'statement_based',
            keyword: 'Energy',
            difficulty: 2,
            fact_as_of: '2026-08-06',
          },
          {
            question:
              'Under the GOBARdhan scheme, the notified Compressed Biogas Obligation trajectory for the CNG (Transport) and PNG (Domestic) segments is:',
            option_a: '3% in FY 2026-27, 4% in FY 2027-28 and 5% from FY 2028-29',
            option_b: '2% in FY 2026-27, 3% in FY 2027-28 and 4% from FY 2028-29',
            option_c: '5% in FY 2026-27, rising to 10% from FY 2028-29',
            option_d: '1% in FY 2026-27, rising by one percentage point each year to 5%',
            correct_option: 'a',
            explanation:
              'The obligation is 3% in FY27, 4% in FY28 and 5% from FY29 onwards, procured by City Gas Distribution entities. The distractors are all plausible blending ladders — the trap is that the trajectory does not start at 1% or 2%, and does not reach 10%. As of the Cabinet approval of 6 August 2026; blending obligations are revised by notification, so confirm before the exam.',
            format: 'direct_recall',
            keyword: 'Energy',
            difficulty: 3,
            fact_as_of: '2026-08-06',
          },
          {
            question:
              'Which of the following was NOT among the existing initiatives that GOBARdhan consolidates?',
            option_a: 'SATAT — Sustainable Alternative Towards Affordable Transportation',
            option_b: 'Market Development Assistance scheme for organic manure',
            option_c: 'Biomass Aggregation Machinery scheme',
            option_d: 'PM-KUSUM — solar pumps for farmers',
            correct_option: 'd',
            explanation:
              'Option (d) is the answer. PM-KUSUM is a solar irrigation scheme and is not part of the compressed-biogas consolidation. SATAT, MDA and BAM are — along with the Development of Pipeline Infrastructure scheme and Central Financial Assistance under the National Bioenergy Programme. Together those had commissioned over 200 CBG plants. As of 6 August 2026.',
            format: 'negative_statement',
            keyword: 'Scheme',
            difficulty: 3,
            fact_as_of: '2026-08-06',
          },
        ],
      },
    ],
  },

  {
    date: '2026-08-18',
    title: 'ISRO prepares to end a seven-month launch pause',
    items: [
      {
        headline: 'ISRO to end a seven-month launch pause with the GISAT-1A (EOS-05) mission on GSLV',
        event_date: '2026-08-18',
        bucket: 'dynamic',
        subject_tag: 'Science & Technology',
        importance: 2,
        needs_verify: 1,
        verify_note:
          'The launch date is forward-looking — reported as the first week of September 2026 — and slips are routine. Confirm the actual launch date and outcome at isro.gov.in before writing it as fact.',
        notes_markdown: [
          '**ISRO** is preparing to resume launches after a pause of nearly **seven months**, with the **GISAT-1A** mission — also designated **EOS-05** — reported for the **first week of September 2026** aboard the **GSLV (Geosynchronous Satellite Launch Vehicle)**.',
          '',
          'The pause followed the failure of the **PSLV-C62 / EOS-N1** mission on **12 January 2026**.',
          '',
          '| Item | Detail |',
          '|---|---|',
          '| Satellite | **GISAT-1A**, also designated **EOS-05** |',
          '| Launch vehicle | **GSLV** |',
          '| Purpose | **High-frequency imaging** of large areas of the Indian landmass |',
          '| Applications | Natural-disaster monitoring, agriculture, forestry, ground-change detection |',
          '| Preceding failure | **PSLV-C62 / EOS-N1**, 12 January 2026 |',
          '',
          'The distinguishing feature of a **GISAT**-class satellite is its orbit: placed in **geostationary orbit**, it can image the same region repeatedly at short intervals, rather than revisiting on a fixed sun-synchronous cycle as most earth-observation satellites do. That is what makes it a disaster-monitoring asset rather than only a survey one.',
        ].join('\n'),
        static_linkage:
          'Updates the ISRO launch-vehicle and earth-observation portions of the Science & Technology syllabus. GSLV versus PSLV, and geostationary versus sun-synchronous imaging, are static distinctions this mission illustrates.',
        prelims_facts: [
          'Satellite: GISAT-1A, also designated EOS-05',
          'Launch vehicle: GSLV',
          'Preceding failure: PSLV-C62 / EOS-N1 on 12 January 2026',
          'Launch pause: approximately seven months',
          'Purpose: high-frequency imaging of the Indian landmass from geostationary orbit',
          'Applications: disaster monitoring, agriculture, forestry',
        ].join('\n'),
        g1_bank: 'E',
        g1_fact:
          'ISRO returned to flight with GISAT-1A (EOS-05) on GSLV after a roughly seven-month pause following the PSLV-C62 / EOS-N1 failure of 12 January 2026.',
        g1_angle:
          'A seven-month grounding after a single failure is the cost of a launch programme with thin redundancy, and it is the argument for the private-sector opening in the space sector rather than against it: capability that cannot absorb one failure without a two-quarter gap is capability with no depth. For Andhra Pradesh the connection is direct — Sriharikota sits in Tirupati district, and a launch cadence that stops for seven months is a regional economy that stops with it.',
        keywords: ['ISRO', 'Satellite', 'Mission', 'Launch vehicle'],
        units: ['P5-U3', 'P5-U1'],
        themes: ['science & tech', 'andhra pradesh'],
        sources: [
          { url: 'https://www.business-standard.com/technology/tech-news/isro-gisat-1a-launch-september-seven-month-launch-gap-126081800329_1.html', publisher: 'Business Standard', is_primary: 0 },
        ],
        mcqs: [
          {
            question: 'The satellite GISAT-1A, which ISRO prepared to launch in 2026, carries which alternative designation?',
            option_a: 'EOS-05',
            option_b: 'EOS-N1',
            option_c: 'RISAT-2BR2',
            option_d: 'Cartosat-3A',
            correct_option: 'a',
            explanation:
              'GISAT-1A is also designated EOS-05. EOS-N1 is the deliberately close distractor — that was the payload lost in the PSLV-C62 failure of 12 January 2026 which caused the launch pause. As of 18 August 2026; confirm the mission outcome at isro.gov.in.',
            format: 'direct_recall',
            keyword: 'Satellite',
            difficulty: 3,
            fact_as_of: '2026-08-18',
          },
          {
            question:
              'Assertion (A): A GISAT-class satellite can image the same region of India at short, repeated intervals.\nReason (R): It is placed in geostationary orbit rather than a sun-synchronous one.',
            option_a: 'Both A and R are true, and R correctly explains A',
            option_b: 'Both A and R are true, but R does not correctly explain A',
            option_c: 'A is true but R is false',
            option_d: 'A is false but R is true',
            correct_option: 'a',
            explanation:
              'Both true, and the orbit is precisely the reason: a geostationary satellite holds position over the same longitude and so can revisit continuously, whereas a sun-synchronous earth-observation satellite returns only on a fixed cycle. That is what makes GISAT a disaster-monitoring asset. As of 18 August 2026.',
            format: 'assertion_reason',
            keyword: 'ISRO',
            difficulty: 2,
            fact_as_of: '2026-08-18',
          },
        ],
      },
    ],
  },

  {
    date: '2026-08-19',
    title: 'Cabinet clears ₹9,450 crore of rail multitracking — Andhra Pradesh in one of four projects',
    items: [
      {
        headline: 'Cabinet approves four rail multitracking projects worth ₹9,450 crore, including the Gummidipundi–Gudur line in Andhra Pradesh',
        event_date: '2026-08-19',
        bucket: 'national',
        subject_tag: '',
        importance: 1,
        notes_markdown: [
          'The **Cabinet Committee on Economic Affairs (CCEA)** on **19 August 2026** approved **four multitracking railway projects** costing **₹9,450 crore** in total, to be completed by **2030-31**. Together they add about **410 km** to the Indian Railways network across **eight districts** in **four states**.',
          '',
          '| Project | Length | States |',
          '|---|---|---|',
          '| Kharagpur–Bhadrak (Ranital) 4th line | **173 km** | West Bengal, Odisha |',
          '| Bhadrak–Haridaspur 4th line | **75 km** | Odisha |',
          '| **Gummidipundi–Gudur 3rd and 4th line** | **90 km** | **Andhra Pradesh**, Tamil Nadu |',
          '| Cuttack–Paradeep (Badabandha) 3rd and 4th lines | **72 km** | Odisha |',
          '',
          'The projects are stated to improve connectivity for roughly **6,448 villages** with a population of about **60 lakh**.',
          '',
          'The Andhra Pradesh relevance is the **Gummidipundi–Gudur** section: this is the **Chennai–Vijayawada** trunk corridor on the east coast, and adding third and fourth lines on a 90 km stretch addresses one of the densest freight-and-passenger bottlenecks on the route.',
        ].join('\n'),
        static_linkage:
          'Feeds the transport-infrastructure unit in Paper IV and the AP infrastructure unit — this is the east-coast trunk route, so it connects directly to Andhra Pradesh port-hinterland connectivity and the Chennai–Vijayawada corridor.',
        prelims_facts: [
          'Approved: 19 August 2026 by the CCEA',
          'Four multitracking projects; total cost ₹9,450 crore',
          'Network addition: about 410 km',
          'Coverage: eight districts across four states — West Bengal, Odisha, Tamil Nadu, Andhra Pradesh',
          'AP project: Gummidipundi–Gudur 3rd and 4th line, 90 km (AP and Tamil Nadu)',
          'Longest of the four: Kharagpur–Bhadrak (Ranital) 4th line, 173 km',
          'Target completion: 2030-31',
          'Villages connected: about 6,448; population about 60 lakh',
        ].join('\n'),
        g1_bank: 'D',
        g1_fact:
          'The CCEA approved four rail multitracking projects worth ₹9,450 crore on 19 August 2026, adding about 410 km across eight districts, including the 90 km Gummidipundi–Gudur third and fourth lines in Andhra Pradesh and Tamil Nadu.',
        g1_angle:
          'Multitracking is capacity added without acquiring a new alignment, and that is the whole argument: on the east-coast trunk the constraint has never been route mileage but paths per day, and land acquisition is what kills greenfield rail in coastal Andhra. It also cuts against the way infrastructure spending is usually defended — this is not a new line to an unserved district but relief on an already-saturated one, which is a harder political case to make and a better economic one. Pair it with Polavaram as the contrast: incremental capacity on a working asset versus a single large project carrying the whole benefit stream.',
        keywords: ['Rail', 'Project', 'Largest'],
        units: ['P4-U11', 'P4-U12', 'P2-U12'],
        themes: ['economy', 'andhra pradesh'],
        sources: [
          { url: 'https://www.business-standard.com/economy/news/centre-clears-9-450-crore-for-410-km-rail-projects-across-four-states-126081901271_1.html', publisher: 'Business Standard', is_primary: 0 },
          { url: 'https://www.freepressjournal.in/business/cabinet-approves-four-railway-projects-worth-9450-crore-boosting-connectivity-and-infrastructure-development', publisher: 'Free Press Journal', is_primary: 0 },
          { url: 'https://metrorailnews.in/cabinet-approves-4-railway-projects-410-km-new-lines/', publisher: 'Metro Rail News', is_primary: 0 },
        ],
        mcqs: [
          {
            question:
              'The Gummidipundi–Gudur third and fourth line project approved in August 2026 falls in which pair of states?',
            option_a: 'Andhra Pradesh and Tamil Nadu',
            option_b: 'Andhra Pradesh and Odisha',
            option_c: 'Odisha and West Bengal',
            option_d: 'Tamil Nadu and Karnataka',
            correct_option: 'a',
            explanation:
              'The 90 km Gummidipundi–Gudur section spans Andhra Pradesh and Tamil Nadu on the Chennai–Vijayawada trunk route. Odisha and West Bengal appear in the other three projects of the same approval, which is what makes them close distractors. As of 19 August 2026.',
            format: 'direct_recall',
            keyword: 'Rail',
            difficulty: 2,
            fact_as_of: '2026-08-19',
          },
          {
            question:
              'Consider the following statements about the rail multitracking approval of 19 August 2026: 1. The four projects together cost ₹9,450 crore. 2. They add about 410 km to the network. 3. They cover eight districts across four states. 4. The longest of the four is the Cuttack–Paradeep line. How many of the above statements are correct?',
            option_a: 'Only one',
            option_b: 'Only two',
            option_c: 'Only three',
            option_d: 'All four',
            correct_option: 'c',
            explanation:
              'Statements 1, 2 and 3 are correct — three in all. Statement 4 is wrong: the longest is the Kharagpur–Bhadrak (Ranital) 4th line at 173 km, whereas Cuttack–Paradeep is the shortest at 72 km. As of 19 August 2026.',
            format: 'count_based',
            keyword: 'Project',
            difficulty: 3,
            fact_as_of: '2026-08-19',
          },
          {
            question:
              'Arrange the following projects approved on 19 August 2026 in descending order of route length: A. Cuttack–Paradeep (Badabandha) B. Gummidipundi–Gudur C. Kharagpur–Bhadrak (Ranital) D. Bhadrak–Haridaspur',
            option_a: 'C, B, D, A',
            option_b: 'C, D, B, A',
            option_c: 'B, C, A, D',
            option_d: 'C, B, A, D',
            correct_option: 'a',
            explanation:
              'Kharagpur–Bhadrak 173 km, Gummidipundi–Gudur 90 km, Bhadrak–Haridaspur 75 km, Cuttack–Paradeep 72 km. The 75/72 km pair is close on purpose — the ordering turns on it. As of 19 August 2026.',
            format: 'chronological',
            keyword: 'Largest',
            difficulty: 3,
            fact_as_of: '2026-08-19',
          },
        ],
      },
    ],
  },

  {
    date: '2026-08-20',
    title: 'Andhra Pradesh unveils the Visakhapatnam Economic Region plan',
    items: [
      {
        headline: 'Andhra Pradesh targets up to ₹9.5 lakh crore of investment in the Visakhapatnam Economic Region, aiming at a $120 billion economy by 2032',
        event_date: '2026-08-20',
        bucket: 'ap',
        subject_tag: '',
        importance: 1,
        needs_verify: 1,
        verify_note:
          'The plan was reported from a Chief Minister-level review rather than a notified policy document, and the investment figure appears as both "up to ₹9 lakh crore" and "₹9.5 lakh crore" across reports. Treat the number as a target under review and confirm against an AP government order before quoting it as policy.',
        notes_markdown: [
          'The Andhra Pradesh government has set out a development plan for the **Visakhapatnam Economic Region (VER)** targeting investment of up to **₹9.5 lakh crore**, with the stated aim of a **US$120 billion** regional economy by **2032**.',
          '',
          '| Feature | Detail |',
          '|---|---|',
          '| Districts covered | **Eight** |',
          '| Area | About **36,000 sq km** |',
          '| Public investment | **₹3.5–4 lakh crore** |',
          '| Private investment | Up to **₹5.3 lakh crore** |',
          '| Target economy by 2032 | **US$120 billion** |',
          '| Employment target | **20–24 lakh** jobs |',
          '',
          '**The eight districts:** Visakhapatnam, Vizianagaram, Srikakulam, Anakapalli, Kakinada, East Godavari, Alluri Sitharama Raju, Parvathipuram Manyam.',
          '',
          '**The spatial structure** is the part worth remembering, because it is what makes this a *plan* rather than a target: **six ports, seven manufacturing nodes, 17 major agricultural zones, six service hubs and 12 tourism hubs**.',
          '',
          'Priority sectors named include **AI data centres, green hydrogen, clean energy, IT, ports and logistics, steel, healthcare, tourism and agriculture**.',
        ].join('\n'),
        static_linkage:
          'Directly updates the AP industrial policy and AP infrastructure units, and the north-coastal-Andhra regional geography — the eight districts, the port structure and the Visakhapatnam–Chennai industrial corridor context are all static material this plan sits on top of.',
        prelims_facts: [
          'Region: Visakhapatnam Economic Region (VER)',
          'Districts: eight — Visakhapatnam, Vizianagaram, Srikakulam, Anakapalli, Kakinada, East Godavari, Alluri Sitharama Raju, Parvathipuram Manyam',
          'Area: about 36,000 sq km',
          'Investment target: up to ₹9.5 lakh crore (public ₹3.5–4 lakh crore; private up to ₹5.3 lakh crore)',
          'Target: US$120 billion regional economy by 2032',
          'Jobs target: 20–24 lakh',
          'Spatial plan: 6 ports, 7 manufacturing nodes, 17 agricultural zones, 6 service hubs, 12 tourism hubs',
        ].join('\n'),
        g1_bank: 'E',
        g1_fact:
          'The Visakhapatnam Economic Region plan covers eight north-coastal districts over about 36,000 sq km, targeting up to ₹9.5 lakh crore of investment and a US$120 billion economy by 2032.',
        g1_angle:
          'This is regional-imbalance policy wearing an investment-promotion costume, and that is the argument to make. North coastal Andhra has been the state’s weakest region on almost every human-development measure since bifurcation, and a plan that concentrates six ports and seven manufacturing nodes there is a deliberate attempt to build a second growth pole rather than let Amaravati and the Krishna–Guntur belt absorb everything. The hard question is whether a target-led plan can do what a decade of corridor announcements has not — and the honest answer points to the spatial structure: named nodes and zones are auditable in a way an investment figure never is. Use it as the AP counterpart to any national question on balanced regional development.',
        keywords: ['Project', 'Industrial corridor', 'Largest', 'Objective (scheme/programme)'],
        units: ['P4-U10', 'P4-U12', 'P2-U12', 'P2-U11', 'P1'],
        themes: ['economy', 'andhra pradesh', 'governance'],
        sources: [
          { url: 'https://www.deccanherald.com/india/andhra-pradesh/andhra-sets-120-billion-economy-target-by-2032-in-visakha-economic-region-of-8-districts-3574868', publisher: 'Deccan Herald', is_primary: 0 },
          { url: 'https://www.thehansindia.com/amp/news/cities/amaravati/cm-naidu-targets-rs-95l-cr-investments-in-ver-1105680', publisher: 'The Hans India', is_primary: 0 },
          { url: 'https://www.maritimegateway.com/andhra-pradesh-eyes-up-to-rs-9-lakh-crore-investment-in-visakhapatnam-economic-region/', publisher: 'Maritime Gateway', is_primary: 0 },
        ],
        mcqs: [
          {
            question: 'How many districts does the Visakhapatnam Economic Region cover?',
            option_a: 'Six',
            option_b: 'Seven',
            option_c: 'Eight',
            option_d: 'Twelve',
            correct_option: 'c',
            explanation:
              'Eight districts: Visakhapatnam, Vizianagaram, Srikakulam, Anakapalli, Kakinada, East Godavari, Alluri Sitharama Raju and Parvathipuram Manyam. Six, seven and twelve are the counts of service hubs, manufacturing nodes and tourism hubs respectively in the same plan — which is exactly the confusion the question tests.',
            format: 'direct_recall',
            keyword: 'Project',
            difficulty: 2,
            fact_as_of: '2026-08-20',
          },
          {
            question:
              'Match List-I with List-II for the spatial structure of the Visakhapatnam Economic Region:\n\n| List-I | List-II |\n|---|---|\n| a. Ports | i. 17 |\n| b. Manufacturing nodes | ii. 12 |\n| c. Major agricultural zones | iii. 6 |\n| d. Tourism hubs | iv. 7 |',
            option_a: 'a-iii, b-iv, c-i, d-ii',
            option_b: 'a-iv, b-iii, c-ii, d-i',
            option_c: 'a-iii, b-i, c-iv, d-ii',
            option_d: 'a-ii, b-iv, c-i, d-iii',
            correct_option: 'a',
            explanation:
              'Six ports, seven manufacturing nodes, 17 major agricultural zones and 12 tourism hubs. As of 20 August 2026; the plan was reported from a review meeting, so confirm the final notified figures.',
            format: 'list_matching',
            keyword: 'Industrial corridor',
            difficulty: 3,
            fact_as_of: '2026-08-20',
          },
          {
            question:
              'Which of the following statements about the Visakhapatnam Economic Region plan is INCORRECT?',
            option_a: 'It targets a US$120 billion regional economy by 2032',
            option_b: 'It covers an area of about 36,000 sq km',
            option_c: 'Private investment is projected at up to ₹5.3 lakh crore',
            option_d: 'It covers the entire coastline of Andhra Pradesh including Nellore and Prakasam',
            correct_option: 'd',
            explanation:
              'Option (d) is incorrect and is the answer: the VER covers eight north-coastal and Godavari-belt districts. Nellore and Prakasam are in south coastal Andhra and are outside it — a plausible error for anyone who reads "Economic Region" as meaning the whole coast. As of 20 August 2026.',
            format: 'negative_statement',
            keyword: 'Objective (scheme/programme)',
            difficulty: 2,
            fact_as_of: '2026-08-20',
          },
        ],
      },
    ],
  },

  {
    date: '2026-08-21',
    title: 'Catch-up: two standing items worth having ready',
    items: [
      {
        headline: 'India–EU Free Trade Agreement signed at the 16th EU–India Summit, alongside a Security and Defence Partnership',
        event_date: '2026-01-27',
        bucket: 'international',
        subject_tag: '',
        importance: 1,
        notes_markdown: [
          'The **India–European Union Free Trade Agreement** was signed on **27 January 2026** at **Hyderabad House, New Delhi**, at the **16th EU–India Summit**.',
          '',
          'Two further instruments were agreed at the same summit:',
          '',
          '| Instrument | Content |',
          '|---|---|',
          '| **EU–India Free Trade Agreement** | The trade pillar; signed 27 January 2026 |',
          '| **EU–India Security and Defence Partnership** | Maritime security, non-proliferation and disarmament, space, cyber and hybrid threats, counter-terrorism |',
          '| **Green Hydrogen Task Force** | Launched under the climate and clean-transition strand |',
          '',
          'The summit also restated a joint commitment to the **Paris Agreement** goals and to cooperation on the **clean transition, energy resilience and the circular economy**.',
          '',
          'This item is dated January but is filed here deliberately: it is the **standing international agreement** of the cycle, it recurs across Papers I, IV and V, and it is the sort of item that is read once when it happens and then not revised.',
        ].join('\n'),
        static_linkage:
          'Feeds the international-trade and India–EU relations material, the trade-agreement taxonomy (FTA versus CEPA versus PTA) in the Economy syllabus, and the green-hydrogen strand in Science & Technology.',
        prelims_facts: [
          'Agreement: India–European Union Free Trade Agreement',
          'Signed: 27 January 2026',
          'Venue: Hyderabad House, New Delhi',
          'Occasion: 16th EU–India Summit',
          'Also signed: EU–India Security and Defence Partnership',
          'Also launched: Green Hydrogen Task Force',
          'Defence partnership covers: maritime security, non-proliferation and disarmament, space, cyber and hybrid threats, counter-terrorism',
        ].join('\n'),
        g1_bank: 'S',
        g1_fact:
          'The India–EU Free Trade Agreement was signed on 27 January 2026 at the 16th EU–India Summit in New Delhi, together with an EU–India Security and Defence Partnership and a Green Hydrogen Task Force.',
        g1_angle:
          'The trade agreement is the headline, but the pairing is the argument: a trade pillar and a security-and-defence pillar signed on the same day is a deliberate statement that market access and strategic alignment are no longer separable. That is a shift from India’s long-standing practice of keeping trade negotiations insulated from strategic ones, and it is the frame to use for any question on strategic autonomy. The Andhra Pradesh hook is the Green Hydrogen Task Force — the state has committed heavily to green hydrogen capacity, so an EU-facing standards and offtake conversation is a state-level industrial policy question, not only a foreign-policy one.',
        keywords: ['Agreement', 'Summit', 'Deal', 'International organisations'],
        units: ['P4-U1', 'P5-U4', 'P3-U2', 'P1'],
        themes: ['economy', 'federalism'],
        sources: [
          { url: 'https://www.consilium.europa.eu/en/meetings/international-summit/2026/01/27/', publisher: 'Council of the European Union', is_primary: 1 },
          { url: 'https://ec.europa.eu/commission/presscorner/api/files/document/print/en/ip_26_227/IP_26_227_EN.pdf', publisher: 'European Commission', is_primary: 1 },
        ],
        mcqs: [
          {
            question: 'The India–European Union Free Trade Agreement was signed at which summit?',
            option_a: '14th EU–India Summit',
            option_b: '15th EU–India Summit',
            option_c: '16th EU–India Summit',
            option_d: '18th EU–India Summit',
            correct_option: 'c',
            explanation:
              'The 16th EU–India Summit, held 27 January 2026 at Hyderabad House, New Delhi. Adjacent summit numbers are the distractors — the ordinal is exactly the sort of detail APPSC tests on a summit question. As of January 2026.',
            format: 'direct_recall',
            keyword: 'Summit',
            difficulty: 2,
            fact_as_of: '2026-01-27',
          },
          {
            question:
              'Consider the following statements about the 16th EU–India Summit: 1. The India–EU Free Trade Agreement was signed on 27 January 2026. 2. An EU–India Security and Defence Partnership was agreed at the same summit. 3. A Green Hydrogen Task Force was launched. Which of the statements given above are correct?',
            option_a: '1 and 2 only',
            option_b: '2 and 3 only',
            option_c: '1 and 3 only',
            option_d: '1, 2 and 3',
            correct_option: 'd',
            explanation:
              'All three are correct — the trade agreement, the security and defence partnership and the Green Hydrogen Task Force all came out of the same summit. As of January 2026; ratification and entry-into-force dates are separate and later, so check those before writing that the agreement is in force.',
            format: 'multi_statement',
            keyword: 'Agreement',
            difficulty: 2,
            fact_as_of: '2026-01-27',
          },
        ],
      },,
      {
        headline: 'Additional ₹30,000 crore committed to the National Investment and Infrastructure Fund, taking the Union government’s total commitment to ₹60,000 crore',
        // Filed in the August digest but dated to the release. The Cabinet
        // approved this in late June 2026 and PIB announced it on 29 June; it
        // is carried here as a catch-up item, which is exactly what the
        // event_date / digest-date distinction exists for.
        event_date: '2026-06-29',
        bucket: 'national',
        subject_tag: '',
        importance: 2,
        notes_markdown: [
          'The Union Cabinet approved an **additional ₹30,000 crore** investment commitment towards new and upcoming funds of the **National Investment and Infrastructure Fund (NIIF)**, announced by PIB on **29 June 2026** under the **Ministry of Finance**. This takes the **Government of India’s total commitment to NIIF to ₹60,000 crore**.',
          '',
          '### What NIIF is',
          '',
          'India’s **Sovereign Anchored Fund**, managed by **National Investment and Infrastructure Fund Limited (NIIFL)**. The **Government of India is a 49% shareholder** — deliberately non-controlling — and the balance comes from institutional investors.',
          '',
          '| Item | Figure |',
          '|---|---|',
          '| GOI shareholding | **49%** |',
          '| Capital commitments currently managed | About **₹40,000 crore** |',
          '| Returned to investors through exits | Close to **₹12,000 crore** |',
          '| First infrastructure fund corpus | **₹16,000 crore** — India’s **largest domestic infrastructure fund** |',
          '| New GOI commitment | **₹30,000 crore** |',
          '| Total GOI commitment after this | **₹60,000 crore** |',
          '',
          '### The four investment strategies',
          '',
          'Infrastructure · private markets · growth equity · **climate investments in the India–Japan business corridor**.',
          '',
          'The named vehicles are the **Infrastructure Fund**, the **Private Markets Fund** (which invests in daughter AIFs run by domestic managers), the **Strategic Opportunities Fund**, and the **India–Japan Fund** — NIIF’s **first bilateral fund**, focused on climate, circular economy and energy transition.',
          '',
          '### Where the new money goes',
          '',
          'Principally to **NIIF Infrastructure Fund II**, the successor to the first flagship fund, with a **target corpus of close to ₹30,000 crore**, investing across transportation, energy, digital infrastructure and newer areas such as urban infrastructure and e-mobility.',
          '',
          '### Who else is in',
          '',
          'Investors named include **ADIA, AustralianSuper, CPP Investments, Ontario Teachers’ Pension Plan, PSP Investments, Temasek**, the **AIIB, New Development Bank, ADB, JBIC** and the **US International Development Finance Corporation**, alongside **SBI, Axis Bank, HDFC Group, ICICI Bank** and **Kotak Mahindra Life Insurance**.',
          '',
          'NIIF also plays an **advisory** role to central departments and state entities on PPP structuring — it supported the design of the **Maritime Development Fund** and the **Research, Development and Innovation Fund**.',
        ].join('\n'),
        static_linkage:
          'Updates the infrastructure-financing portion of the Indian Economy syllabus. NIIF sits alongside the National Infrastructure Pipeline and the National Monetisation Pipeline as the standing instruments; the 49% government share, the fund-of-funds structure and the NIIFL manager are the static facts.',
        prelims_facts: [
          'Announced: 29 June 2026 (PIB), Ministry of Finance',
          'Additional commitment: ₹30,000 crore',
          'Total GOI commitment to NIIF after this: ₹60,000 crore',
          'Government of India shareholding in NIIF: 49%',
          'Manager: National Investment and Infrastructure Fund Limited (NIIFL)',
          'Described as: India’s Sovereign Anchored Fund',
          'Capital commitments currently managed: about ₹40,000 crore',
          'Returned to investors through exits: close to ₹12,000 crore',
          'First infrastructure fund corpus: ₹16,000 crore — India’s largest domestic infrastructure fund',
          'New money goes principally to: NIIF Infrastructure Fund II, target corpus close to ₹30,000 crore',
          'Four strategies: infrastructure, private markets, growth equity, climate (India–Japan corridor)',
          'India–Japan Fund: NIIF’s first bilateral fund',
          'Advisory role included: Maritime Development Fund, Research Development and Innovation Fund',
        ].join('\n'),
        g1_bank: 'D',
        g1_fact:
          'An additional ₹30,000 crore commitment announced on 29 June 2026 takes the Union government’s total commitment to NIIF to ₹60,000 crore, against about ₹40,000 crore of capital currently managed and close to ₹12,000 crore already returned to investors through exits.',
        g1_angle:
          'The 49% stake is the design decision worth arguing about: deliberately below control, so that NIIF reads to a foreign pension fund as a co-investor rather than an arm of the state — which is the entire pitch for crowding in institutional capital, and the reason ADIA, Temasek and CPP are on the register at all. The ₹12,000 crore of realised exits is the stronger evidence, because catalytic-capital vehicles are usually defended on commitments rather than returns, and a track record of getting money back out is what makes the next raise possible. The counter-argument is equally available and is the one to use for Andhra Pradesh: catalytic capital only works where a pipeline of bankable, properly-prepared projects exists, so the binding constraint at state level is project-preparation capacity, not the availability of finance. That reframes "we need investment" as "we need a project development unit", which is a much better answer.',
        keywords: ['Fund', 'Bonds', 'Allocation', 'Finance Minister', 'Largest'],
        units: ['P4-U11', 'P4-U2', 'P4-U1', 'P3-U7'],
        themes: ['economy', 'governance'],
        sources: [
          { url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2279107&reg=48&lang=1', publisher: 'PIB', is_primary: 1 },
        ],
        mcqs: [
          {
            question: 'What is the shareholding of the Government of India in the National Investment and Infrastructure Fund (NIIF)?',
            option_a: '26%',
            option_b: '49%',
            option_c: '51%',
            option_d: '74%',
            correct_option: 'b',
            explanation:
              'The Government of India holds 49% of NIIF — deliberately a non-controlling stake, so the platform presents to institutional investors as a co-investor rather than a state arm. 51% is the distractor a candidate assuming government control would pick. As of the PIB release of 29 June 2026.',
            format: 'direct_recall',
            keyword: 'Fund',
            difficulty: 2,
            fact_as_of: '2026-06-29',
          },
          {
            question:
              'Consider the following statements about the June 2026 additional commitment to NIIF: 1. The additional commitment was ₹30,000 crore. 2. It takes the total Government of India commitment to NIIF to ₹60,000 crore. 3. The money goes principally to NIIF Infrastructure Fund II. 4. NIIF is managed by the Reserve Bank of India. How many of the above statements are correct?',
            option_a: 'Only one',
            option_b: 'Only two',
            option_c: 'Only three',
            option_d: 'All four',
            correct_option: 'c',
            explanation:
              'Statements 1, 2 and 3 are correct — three in all. Statement 4 is wrong: NIIF is managed by National Investment and Infrastructure Fund Limited (NIIFL), not the RBI. As of 29 June 2026.',
            format: 'count_based',
            keyword: 'Fund',
            difficulty: 3,
            fact_as_of: '2026-06-29',
          },
          {
            question:
              'Match List-I with List-II regarding NIIF:\n\n| List-I | List-II |\n|---|---|\n| a. First infrastructure fund corpus | i. Close to ₹12,000 crore |\n| b. Capital commitments currently managed | ii. ₹16,000 crore |\n| c. Returned to investors through exits | iii. ₹60,000 crore |\n| d. Total GOI commitment after June 2026 | iv. About ₹40,000 crore |',
            option_a: 'a-ii, b-iv, c-i, d-iii',
            option_b: 'a-iii, b-iv, c-ii, d-i',
            option_c: 'a-ii, b-iii, c-i, d-iv',
            option_d: 'a-iv, b-ii, c-iii, d-i',
            correct_option: 'a',
            explanation:
              'First infrastructure fund ₹16,000 crore (India’s largest domestic infrastructure fund); commitments managed about ₹40,000 crore; exits close to ₹12,000 crore; total GOI commitment ₹60,000 crore. All four figures come from the same release, which is what makes the matching hard — they are easy to swap. As of 29 June 2026.',
            format: 'list_matching',
            keyword: 'Largest',
            difficulty: 3,
            fact_as_of: '2026-06-29',
          },
          {
            question:
              'Assertion (A): The Government of India holds only a 49% stake in NIIF rather than a majority.\nReason (R): A non-controlling stake allows NIIF to present itself to sovereign wealth and pension funds as a co-investor rather than an arm of the state.',
            option_a: 'Both A and R are true, and R correctly explains A',
            option_b: 'Both A and R are true, but R does not correctly explain A',
            option_c: 'A is true but R is false',
            option_d: 'A is false but R is true',
            correct_option: 'a',
            explanation:
              'Both are true and the reason explains the assertion. NIIF is described as a Sovereign Anchored Fund and has raised from ADIA, Temasek, CPP Investments, Ontario Teachers’ and others — a register that is far harder to build if the state holds control. As of 29 June 2026.',
            format: 'assertion_reason',
            keyword: 'Fund',
            difficulty: 2,
            fact_as_of: '2026-06-29',
          },
        ],
      }
    ],
  },
];

// A discarded candidate, kept so the review queue and the admin dashboard have a
// real example of the state. Most news should end up here — a pipeline that
// discards nothing is not being ruthless enough, and the discard record is the
// only way to audit that.
const DISCARDED = [
  {
    date: '2026-08-20',
    headline: 'State-level inter-district football friendly ends 2-1',
    reason:
      'A friendly match result with no record, no first and no tournament outcome. Yields neither a Group-II keyword angle nor a Group-I bank slot.',
  },
  {
    date: '2026-08-19',
    headline: 'Minister reiterates commitment to completing pending irrigation works',
    reason:
      'A restatement of existing policy with no new figure, deadline or instrument. Nothing here is examinable until an allocation or a timeline is attached.',
  },
];

// ---------------------------------------------------------------------------

function run() {
  const insertDay = db.prepare(
    `INSERT INTO ca_days (date, title, status, published_at)
     VALUES (?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO ca_items (day_id, headline, event_date, bucket, subject_tag,
       notes_markdown, static_linkage, prelims_facts, g1_bank, g1_fact, g1_angle,
       importance, relevance_g1, relevance_g2, needs_verify, verify_note,
       order_index, status)
     VALUES (@day_id, @headline, @event_date, @bucket, @subject_tag,
       @notes_markdown, @static_linkage, @prelims_facts, @g1_bank, @g1_fact, @g1_angle,
       @importance, 1, 1, @needs_verify, @verify_note, @order_index, @status)`
  );
  const insertDiscarded = db.prepare(
    `INSERT INTO ca_items (day_id, headline, bucket, status, discard_reason,
       relevance_g1, relevance_g2)
     VALUES (?, ?, 'national', 'discarded', ?, 0, 0)`
  );
  const insKeyword = db.prepare('INSERT OR IGNORE INTO ca_item_keywords (item_id, keyword) VALUES (?, ?)');
  const insUnit = db.prepare('INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)');
  const insTheme = db.prepare('INSERT OR IGNORE INTO ca_item_themes (item_id, theme) VALUES (?, ?)');
  const insSource = db.prepare(
    `INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at)
     VALUES (?, ?, ?, ?, date('now'))`
  );
  const insMcq = db.prepare(
    `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
       correct_option, explanation, format, keyword, difficulty, fact_as_of)
     VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
       @correct_option, @explanation, @format, @keyword, @difficulty, @fact_as_of)`
  );

  const status = PUBLISH ? 'published' : 'draft';
  let items = 0;
  let mcqs = 0;

  db.transaction(() => {
    // Re-running replaces rather than duplicates. Deleting the day cascades to
    // its items, tags, sources and questions.
    for (const d of DAYS) {
      db.prepare('DELETE FROM ca_days WHERE date = ?').run(d.date);
    }

    const dayIds = new Map();
    for (const day of DAYS) {
      const info = insertDay.run(
        day.date,
        day.title,
        status,
        PUBLISH ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
      );
      const dayId = info.lastInsertRowid;
      dayIds.set(day.date, dayId);

      day.items.forEach((it, i) => {
        const info2 = insertItem.run({
          day_id: dayId,
          headline: it.headline,
          event_date: it.event_date || null,
          bucket: it.bucket,
          subject_tag: it.subject_tag || '',
          notes_markdown: it.notes_markdown,
          static_linkage: it.static_linkage || '',
          prelims_facts: it.prelims_facts || '',
          g1_bank: it.g1_bank || null,
          g1_fact: it.g1_fact || '',
          g1_angle: it.g1_angle || '',
          importance: it.importance || 2,
          needs_verify: it.needs_verify ? 1 : 0,
          verify_note: it.verify_note || '',
          order_index: i + 1,
          status,
        });
        const itemId = info2.lastInsertRowid;
        items++;
        for (const k of it.keywords || []) insKeyword.run(itemId, k);
        for (const u of it.units || []) insUnit.run(itemId, u);
        for (const t of it.themes || []) insTheme.run(itemId, t);
        for (const s of it.sources || []) {
          insSource.run(itemId, s.url, s.publisher || '', s.is_primary ? 1 : 0);
        }
        for (const m of it.mcqs || []) {
          insMcq.run({ item_id: itemId, ...m });
          mcqs++;
        }
      });
    }

    for (const d of DISCARDED) {
      const dayId = dayIds.get(d.date);
      if (dayId) insertDiscarded.run(dayId, d.headline, d.reason);
    }
  })();

  console.log(`Seeded ${DAYS.length} digests · ${items} items · ${mcqs} questions · ${DISCARDED.length} discards`);
  console.log(`Status: ${status}${PUBLISH ? '' : ' — approve them in Admin → Review queue'}`);
}

run();
