'use strict';

// Reference data seeded into ref_keywords / ref_units / ref_corrections.
//
// Kept in one module because the pipeline needs the same lists the admin UI
// offers — if the tagger's vocabulary and the editor's dropdown drift apart,
// items get tagged with keywords nothing can filter on.

// ---------------------------------------------------------------------------
// Blueprint keyword angles
// ---------------------------------------------------------------------------
// These are *question angles*, not facts: a single keyword ("Appointed",
// "GI tag") gets applied to dozens of different actual events. Current Affairs
// is the primary list, but the other subject lists matter because a large
// share of current-affairs questions are really dynamic updates to another
// subject — a newly notified tiger reserve is tested through the Environment
// blueprint's "Tiger Reserve" angle, not through a generic CA angle.

const KEYWORDS = {
  'Current Affairs': [
    'First', 'Committee', 'Reports', 'Index', 'Launched', 'Appointed', 'Inaugurated',
    'Celebrated', 'Developed', 'Elected', 'Visited', 'Declared', 'Ministry', 'Minister',
    'Project', 'Satellite', 'Ambassador', 'DRDO', 'GI tag', 'App', 'Website', 'Portal',
    'Platform', 'Defence', 'Scheme', 'Yojana', 'Energy', 'Book', 'Author', 'Festival',
    'Vaccine', 'UN', 'Bank', 'RBI', 'Missile', 'Prime Minister', 'President', 'Chairman',
    'Summit', 'Conference', 'NBFC', 'Amendment', 'Programme', 'Agreement', 'IPL',
    'Football', 'Tennis', 'Badminton', 'CWG', 'Golf', 'Cricket', 'Boxing', 'Hockey',
    'Initiative', 'Largest', 'Smallest', 'Anniversary', 'OSCAR', 'Rail', 'Campaign',
    'Days', 'Awards', 'Prizes', 'Rockets', 'Elections', 'Places in news',
    'Persons in news', 'Policy', 'International organisations',
    'New developments in S&T', 'Deal', 'Forbes', 'Date and year', 'Judgements',
    'Defence exercises', 'New species', 'New discoveries', 'Bills', 'Acts',
    'Tiger reserve', 'Chief guest', 'Person in news (designation)',
    'Projections on growth rate', 'Governor', 'SAARC', 'Disputed areas', 'AIIMS',
    'Supreme court', 'High court', 'Chairperson', 'Chief justice', 'National parks',
    'Biosphere reserve', 'Protected area', 'Projects and dams', 'New terms',
    'Headquarters', 'Virus in news', 'Objective (scheme/programme)', 'Congress',
    'Refugees', 'University', 'Institution', 'Institute', 'Trophy', 'Championship',
    'Diseases', 'Drug controller general', 'Miss universe/world/India', 'WHO',
    'Commission', 'Commissioner', 'Change in names of cities', 'IIT', 'UNESCO',
    'ISRO', 'Ranking', 'Recent study', 'Helpline', 'Mission', 'Temples in news',
    'Flood', 'Cyclones in news', 'Slogan', 'Vice president', 'Highest',
    'Abbreviations', 'Operation', 'Tribes in news',
  ],
  Polity: [
    'FIRST', 'Articles – NUMBER GAME', 'Constituent Assembly',
    'Borrowed Features of Indian Constitution', 'Schedules – Number Game + Subject',
    'Parts', 'Prime Minister', 'President', 'Vice President', 'Chief Minister',
    'Governor', 'Rajyasabha – Members', 'Loksabha – Members', 'Preamble – Text',
    'Fundamental rights – NUMBER GAME', 'Fundamental duties – NUMBER GAME',
    'DPSP – Number Game', 'Bills', 'Acts', 'Amendments', 'Cases',
    'Election Commission', 'Finance Commission', 'National Human Rights Commission',
    'Punchhi Commission', 'Chief Justice', 'Attorney General', 'Advocate General',
    'Committee', 'Election', 'Elected', 'Local Self Government', 'State assembly',
    'Landmark judgements', 'Writs', 'Council', 'Union Minister', 'Collegium',
    'Scheduled Area', 'Emergency', 'Judicial Review', 'Chairman', 'Party',
    'Speaker', 'Legislative council', 'Legislative assembly', 'Consolidated fund',
    'Sessions of Parliament', 'Constitutional body', 'Doctrine', 'Supreme court',
    'High Court', 'Judge', 'Tribunal', 'Ordinance', 'Anti-defection law', 'CAG',
    'Women representation',
  ],
  Economy: [
    'First', 'GDP', 'GSDP', 'MSP', 'RBI', 'SEBI', 'WTO', 'NSO', 'GST', 'NABARD',
    'NPCI', 'MUDRA', 'SEZ', 'FDI', 'FII', 'FRBM', 'Five Year Plans', 'NITI Aayog',
    'Balance of Payments', 'GVA', 'GNP', 'IMF', 'RRB', 'Budget', 'Unemployment',
    'Poverty', 'Basel III', 'Growth Rate', 'Agro Climatic Zone', 'Economic growth',
    'Economic development', 'Subsidies', 'Policy', 'Repo', 'Reverse Repo', 'SLR',
    'CRR', 'MSF', 'SDR', 'Bank Merger', 'Tax', 'Population', 'Census', 'Revenue',
    'Expenditure', 'Finance Commission', 'Inflation', 'Index', 'CAD', 'Exports',
    'Imports', 'Stock exchange', 'Literacy rate', 'Sex ratio', 'Financial Inclusion',
    'Fund', 'Bonds', 'DEBT (Internal and External)',
    'Publications and Publishers of Reports', 'MAHARATNA', 'NAVARATNA', 'Scheme',
    'Yojana', 'Committee', 'Economist', 'Act', 'Largest', 'Highest', 'Lowest',
    'Aim', 'Objective', 'Chairperson', 'Chairman', 'Irrigation', 'Rank',
    'Industrial corridor', 'Human development', 'Inclusive growth',
    'Demographic dividend', 'Migration', 'Allocation', 'Finance Minister',
    'New terms (e.g. Gig Economy)', 'Land reforms',
  ],
  Geography: [
    'FIRST', 'Borders', 'Rivers → State/District/Town [LOCATION]', 'River → Tributary',
    'Tribes → District [LOCATION]', 'Mineral Resources → Location',
    'Dam/Reservoir → Location', 'Canal', 'Mountains → Location', 'Mountain Passes',
    'Mountain peak', 'Mountain range', 'Sea', 'Rainfall', 'Revolution',
    'National Park → District [LOCATION]', 'Soils', 'Project → District [LOCATION]',
    '2011 census data', 'Institute/Organisation → Location',
    'Biosphere Reserve → District [LOCATION]', 'Forests', 'Forest cover',
    'Major Crops', 'Waterfalls → Location', 'Tiger Reserve → Location',
    'Hills → Location', 'Industry → Location', 'Irrigation Project → Location',
    'GI Tag → Location', 'Islands', 'Wildlife sanctuary → Location', 'Largest',
    'Highest', 'Longest', 'Lake → Location', 'Ports', 'Plateau', 'Line',
    'Bird sanctuary → Location', 'Mangrove', 'Power station → Location', 'Railways',
    'Waterways', 'Highways', 'Coastline',
  ],
  Environment: [
    'Days', 'Forest Policy', 'UN', 'Environment Protection',
    'Climate Change/Conference', 'Forest Survey', 'SDG', 'Pollution', 'Location',
    'Tiger Reserve', 'Index', 'NGT', 'Wildlife Protection Act',
    'Wildlife Sanctuary', 'National Park', 'Convention/Conference',
    'Animal/Bird/New Species/New Discovery', 'Traditional Water Conservation System',
    'Pollution/Air Quality/CPCB', 'Wetlands', 'Persons in News', 'Organisations',
    'Important Programmes', 'Biosphere Reserve/Location', 'Terminology', 'Policy',
    'Waste Management', 'Ozone', 'Environmental Movements', 'Biodiversity',
    'Mangrove', 'Forest Act', 'Act', 'Coral Reefs',
  ],
  'Science & Technology': [
    'First', 'ISRO', 'NASA', 'DRDO', 'Missile', 'IIT', 'Institute', 'Satellite',
    'Rocket', 'Mission', 'Launched', 'Developed by', 'Organisation', 'Report',
    'Index', 'Indigenous', 'Research', 'Programme', 'Scheme',
    'Artificial Intelligence', 'e-Governance', '3D printing', 'Blockchain technology',
    'Launch vehicle', 'Department of Science and Technology', 'Ministry',
    'Initiative', 'Device', 'MoU', 'Full form', 'Laboratory', 'Platform',
    'Terms', 'Digital technologies', 'GPS technology', 'Project', 'Hydrogen',
    'Robotics', 'Big data', 'IoT', 'Cyber security', 'Cloud computing', 'Web 3.0',
    'Objectives', 'Applications',
  ],
  Society: [
    'FIRST', 'Books and Authors', 'Social Welfare Schemes', 'Women',
    'Ministry of welfare', 'Institution', 'Articles', 'Acts', 'Committee',
    'Gender Development Index', 'Scheduled Tribe', 'National Population Policy',
    'Gender mainstreaming', 'Universal Declaration of Human Rights', 'POSH Act',
    'Dowry Prohibition Act', 'Juvenile Justice', 'Social security', 'Social Policy',
    'Social Justice', 'Scheduled Caste', 'Migrant labour', 'Informal labour',
    'Land Acquisition Act', "Women's rights", 'NREGA', 'Domestic Violence',
    'NFHS', 'Beti Bachao', 'RTI Act', 'POCSO Act', 'ICDS', 'Human Rights',
    'National Youth Policy', 'Women Self Help Groups',
    'National Commission for Women', 'SC/ST (Prevention of Atrocities) Act',
    'Right to Education', 'Notified minority community',
  ],
  'AP History': [
    'FIRST', 'LAST', 'Inscription', 'Site', 'Temple', 'Festival', 'Port',
    'Founder/founded', 'Established', 'Known as – Other Name', 'President',
    'Agreement', 'Committee', 'University', 'Built', 'Movement', 'Art',
    'Discovered', 'Rebellion', 'Tribe', 'Published', 'Award', 'Fort',
    'Event – month/date/year', 'Chief Minister', 'Person – Political Party',
    'RULER – period – contribution', 'PERSON – Called as/Known as',
    'PERSON – Associated with', 'Commission', 'Author', 'Literary work',
  ],
  'Indian History': [
    'FIRST', 'LAST', 'Founder – Dynasty', 'Book', 'Author', 'Inscription',
    'Capital', 'Battle', 'War', 'Treaty', 'Act', 'Bill', 'Movement – Started by',
    'Movement – Imp Personalities', 'PERSON – Called as/Known as', 'Pact',
    'Commission', 'Viceroy', 'Session', 'Excavation', 'Built – City/Town',
    'Historical Event – Year', 'Anniversary', 'Monuments', 'ASI',
  ],
};

// ---------------------------------------------------------------------------
// Group-I paper units
// ---------------------------------------------------------------------------
// Tag format is [P4-U4]. Papers II–V are the subject papers; P1 is the essay
// paper, which is fed as a by-product of the other four — hence the single
// catch-all P1 entry rather than numbered units.

const UNITS = [
  // THE TWO LANGUAGE PAPERS, RECORDED AND MARKED UNFEEDABLE.
  //
  // 300 marks of the Group-I Mains total, and they were absent from this list
  // entirely — so the syllabus this app showed a candidate was missing two
  // whole papers and gave no sign of it.
  //
  // A newspaper cannot feed them: they test precis, translation, grammar and
  // letter writing, which are skills rather than content. That makes them
  // exactly like G2-S4 mental ability — excluded from scoring, and recorded so
  // the exclusion is a decision on the page rather than an omission.
  ['LANG-EN', 'LANG', 'English — essay, letter, press release, report, precis, grammar, translation'],
  ['LANG-TE', 'LANG', 'Telugu — essay, poetic elaboration, precis, debate, dialogue, grammar, translation'],

  ['P1', 'P1', 'Essay — general essay, AP-focused essay, statement-based essay'],

  // PAPER II, CORRECTED AGAINST THE COMMISSION'S OWN SYLLABUS COPY.
  //
  // The previous numbering was wrong in a way that mattered. It ran units 1–9
  // as ANDHRA PRADESH history; the published syllabus runs 1–5 as the history
  // and culture of INDIA and only 6–10 as Andhra Pradesh, with 11–15 as
  // geography of India AND Andhra Pradesh rather than of AP alone.
  //
  // That is not a cosmetic difference. A unit code is the one thing a candidate
  // can carry between this app and the syllabus in front of them, and a
  // "P2-U3" that means Vishnukundins here and Mughals to the commission is
  // worse than no code at all — it is a confident wrong answer to "where does
  // this sit". Only two stored tags used the affected range; both were remapped
  // (see server/scripts/fix-g1-units.js).
  //
  // A. History and Culture of India
  ['P2-U1', 'P2', 'Pre-history to the Guptas — Indus Valley, Vedic, Mauryas, Satavahanas, Sangam'],
  ['P2-U2', 'P2', 'Pallavas to Vijayanagara — Cholas, Delhi Sultanate, Bhakti and Sufi, Kakatiyas'],
  ['P2-U3', 'P2', 'Mughals, Marathas, advent of Europeans and the East India Company'],
  ['P2-U4', 'P2', 'British rule 1757–1856, land revenue, 1857, socio-religious reform, nationalism'],
  ['P2-U5', 'P2', 'Freedom struggle 1885–1947, Partition, integration, linguistic reorganisation'],
  // B. History and Culture of Andhra Pradesh
  ['P2-U6', 'P2', 'Ancient AP — Satavahanas, Ikshvakus, Salankayanas, Vishnukundins, Eastern Chalukyas'],
  ['P2-U7', 'P2', 'Medieval AP 1000–1565 — Kakatiyas, Reddis, Gajapatis, Vijayanagara, Qutub Shahis'],
  ['P2-U8', 'P2', 'Modern AP — Company rule, missionaries, zamindari, reformers, library movement'],
  ['P2-U9', 'P2', 'Nationalist movement in Andhra — Andhra Mahasabhas, Potti Sreeramulu, statehood'],
  ['P2-U10', 'P2', 'Bifurcation of AP and its impact — APRA 2014, capital, river water sharing'],
  // C. Geography of India and Andhra Pradesh
  ['P2-U11', 'P2', 'Physical features and resources — landforms, climate, soils, rivers, minerals'],
  ['P2-U12', 'P2', 'Economic geography — agriculture, fisheries, mining, industry, trade, transport'],
  ['P2-U13', 'P2', 'Social geography — population, density, migration, urbanisation, caste and language'],
  ['P2-U14', 'P2', 'Fauna and floral geography — wildlife, birds, forests, trees and plants'],
  ['P2-U15', 'P2', 'Environmental geography — sustainable development, hazards, disaster management'],

  ['P3-U1', 'P3', 'Constitution — features, Preamble, rights, duties, emergency'],
  ['P3-U2', 'P3', 'Federalism, Governor, Centre–State relations, legislative powers'],
  ['P3-U3', 'P3', 'Panchayats, municipalities, EC/CAG/UPSC, Finance Commission'],
  ['P3-U4', 'P3', 'Parliament and State Legislature, Bills, motions, privileges'],
  ['P3-U5', 'P3', 'Judiciary — Supreme Court, High Courts, PIL, appointments'],
  ['P3-U6', 'P3', 'Public administration — civil service reform, British legacy'],
  ['P3-U7', 'P3', 'Policy process, implementation, scheme design and failure'],
  ['P3-U8', 'P3', 'Civil society, NGOs, RTI activism, social movements'],
  ['P3-U9', 'P3', 'Regulators, tribunals, commissions (NCW, NHRC), civil services'],
  ['P3-U10', 'P3', 'e-governance, Digital India, DPI, transparency, social audit'],
  ['P3-U11', 'P3', 'Ethics and human interface — determinants, dimensions, public vs private'],
  // U12 and U13 were simply missing: the list jumped from 11 to 14, so two of
  // the five ethics units in the published syllabus had no code at all and
  // nothing could ever be routed to them.
  ['P3-U12', 'P3', 'Human values — harmony, gender equity, family, society, lives of reformers'],
  ['P3-U13', 'P3', 'Attitude and emotional intelligence — moral and political attitudes, persuasion'],
  ['P3-U14', 'P3', 'Public service ethics — codes of conduct, corruption, Lokpal, Lokayukta'],
  ['P3-U15', 'P3', 'Basic knowledge of law — civil, criminal, labour, cyber and tax law'],

  ['P4-U1', 'P4', 'Indian economy — GDP, inflation, unemployment, growth, CAD'],
  ['P4-U2', 'P4', 'Taxes, GST, borrowing, public debt, disinvestment'],
  ['P4-U3', 'P4', 'AP economy — budget, debt, central transfers, fiscal position'],
  ['P4-U4', 'P4', 'Public finance — Union budget, deficits, FRBM, Finance Commission'],
  ['P4-U5', 'P4', 'Centre–State fiscal relations and AP transfers'],
  ['P4-U6', 'P4', 'Poverty, women, health, education, welfare, inclusive growth'],
  ['P4-U7', 'P4', 'Agriculture — MSP, APMC, e-NAM, natural farming, fisheries'],
  ['P4-U8', 'P4', 'AP agriculture — Polavaram, aquaculture, APCNF, irrigation'],
  ['P4-U9', 'P4', 'Industry — PLI, startups, MSMEs, DPIIT, Industry 4.0'],
  ['P4-U10', 'P4', 'AP industrial policy, SEZs, VCIC, Sri City'],
  ['P4-U11', 'P4', 'Infrastructure — roads, rail, ports, power, PPP, urban'],
  ['P4-U12', 'P4', 'AP infrastructure — Bhogapuram, Sagarmala, DISCOMs'],

  ['P5-U1', 'P5', 'Research institutions, science policy, ANRF, AP institutions'],
  ['P5-U2', 'P5', 'AI, cybercrime, IT policy, deepfakes, blockchain'],
  ['P5-U3', 'P5', 'ISRO, launches, satellites, DRDO, space policy'],
  ['P5-U4', 'P5', 'Energy — solar, wind, nuclear, capacity and transition'],
  ['P5-U5', 'P5', 'Environment vs development, EIA, forests, mining, disasters'],
  ['P5-U6', 'P5', 'Pollution, solid waste, e-waste, climate, COP, green law'],
  ['P5-U7', 'P5', 'Biotechnology, GM crops, nanotech, BioE3'],
  ['P5-U8', 'P5', 'Diseases, vaccines, AMR, genetic engineering, health tech'],
  ['P5-U9', 'P5', 'Patents, GI tags, copyright, IPR policy'],
];

// Themes used by the Group-I bank review. Andhra Pradesh is listed alongside
// the seven but behaves differently: it cuts across all of them, and the
// review checks that every theme carries at least three AP examples, because a
// bank that is nationally rich and AP-thin fails in exactly the papers where
// AP is half the content.
const THEMES = [
  'governance',
  'ethics',
  'science & tech',
  'environment',
  'economy',
  'society & education',
  'federalism',
  'andhra pradesh',
];

// ---------------------------------------------------------------------------
// Known corrections
// ---------------------------------------------------------------------------
// A verification pass over the user's own blueprint found four of nine checked
// facts had gone stale in fifteen months — three of them on Tier-1 topics.
// These are the four. The pipeline checks every draft against match_terms so a
// model working from older training data cannot re-file a superseded position.

const CORRECTIONS = [
  {
    topic: 'Labour Codes',
    superseded_claim: 'The four labour codes are passed but not yet in force.',
    correct_position:
      'The four labour codes came into force on 21 November 2025, repealing 29 central labour laws. Final rules were notified on 8 May 2026.',
    effective_date: '2025-11-21',
    match_terms: 'labour code,labour codes,wage code,industrial relations code,social security code,occupational safety code',
  },
  {
    topic: 'Amaravati / AP capital',
    superseded_claim:
      'Andhra Pradesh has three capitals — Amaravati (legislative), Visakhapatnam (executive), Kurnool (judicial).',
    correct_position:
      'The AP Reorganisation (Amendment) Act 2026, assented 7 April 2026, makes Amaravati the sole statutory capital. The three-capitals arrangement has ended.',
    effective_date: '2026-04-07',
    match_terms: 'amaravati,three capitals,three-capital,executive capital,judicial capital,ap capital,capital of andhra',
  },
  {
    topic: 'Finance Commission',
    superseded_claim: 'The 15th Finance Commission award (2021-26) is the operative one.',
    correct_position:
      'The 16th Finance Commission (chaired by Arvind Panagariya) was tabled on 1 February 2026 for the 2026-31 award period. Vertical devolution stays at 41%, revenue deficit grants are discontinued, and "Contribution to GDP" enters as a new criterion.',
    effective_date: '2026-02-01',
    match_terms: 'finance commission,16th fc,fifteenth finance commission,devolution,revenue deficit grant,vertical devolution',
  },
  {
    topic: 'Census',
    superseded_claim: 'The next census is unscheduled / Census 2021 figures are available.',
    correct_position:
      'Census 2011 remains the latest available data. Census 2027 has been notified with caste enumeration, reference date 1 March 2027.',
    effective_date: '2027-03-01',
    match_terms: 'census,caste enumeration,census 2021,census 2027,decennial census',
  },
];

module.exports = { KEYWORDS, UNITS, THEMES, CORRECTIONS };
