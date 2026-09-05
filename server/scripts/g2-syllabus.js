'use strict';

// THE GROUP-II SYLLABUS, as APPSC publishes it.
//
// WHY THIS FILE EXISTS
//
// `ref_units` held Papers I to V — the Group-I Mains map — and nothing else. So
// "is this article on the syllabus?" was only ever asked of Group I, and Group-II
// relevance was inferred from keyword angles. An article could match no Group-II
// unit at all and still be drafted, which is why filler kept arriving.
//
// THE ONE THING TO UNDERSTAND ABOUT THIS SYLLABUS
//
// The screening test has a 30-mark CURRENT AFFAIRS paper: "Major Current Events
// and Issues pertaining to International, National and State of Andhra Pradesh."
// Every newspaper article in the country is inside that.
//
// Which means it is worth nothing as a filter, and treating it as evidence would
// mark the entire paper as relevant. G2-S5 is therefore flagged `broad` and
// scores zero. What makes a current-affairs item examinable is not that it is
// current — it is that it ALSO attaches to a substantive unit: a constitutional
// provision, an economic instrument, a technology mission, an AP dynasty. An
// item that touches only "current affairs" is an item with nothing under it.
//
// ABOUT THE ALIASES
//
// They are the words a NEWSPAPER uses, not the words the syllabus uses. The
// syllabus says "Distribution of Legislative and Executive Powers between the
// Union and the States"; the paper says "Centre-State", "concurrent list",
// "Article 246". Matching the syllabus's own phrasing would match almost
// nothing, which is the trap this file exists to avoid.
//
// ALIASES REMOVED AFTER MEASUREMENT, so nobody re-adds them:
//
//   'Gandhi'     matched "Rahul Gandhi" in a political sniping story and filed
//                it under ancient-to-modern Indian history. Now 'Mahatma Gandhi'.
//   'Aditya'     matched "Aditya Birla Capital enters gold loans" and filed it
//                under space technology. Now 'Aditya-L1'.
//   'missile'    matched a Ukraine war report and filed it under Indian defence
//                technology. Now 'Agni missile', 'BrahMos'.
//   'hospital'   matched "Woman dies in lift accident at apartment". Now
//                'public hospital'.
//   'women'      matched a cricket report. Now 'crime against women'.
//   'caste'      fires inside 'broadcast'. Kept only as 'casteism' and the
//                specific constitutional categories.
//   'tribal'     too common in ordinary reporting to carry a geography unit.
//
// The pattern is the same every time: a word that is a syllabus TOPIC in the
// abstract but an ordinary noun in a newspaper. The test is not "is this word in
// the syllabus" but "does this word appearing in a story mean the story is about
// that unit".
//
// `strict: true` means case-sensitive — for aliases that are also ordinary words
// ("Mission", "Bench") or acronyms that collide with common text.

// prettier-ignore
const G2_UNITS = [
  // ---------------------------------------------------------------------
  // SCREENING TEST — General Studies and Mental Ability, 150 marks
  // ---------------------------------------------------------------------
  {
    code: 'G2-S1', paper: 'G2-Screening', marks: 30,
    label: 'Indian History — ancient, medieval and modern',
    syllabus:
      'Indus Valley and Vedic age; Buddhism and Jainism; Mauryan and Gupta empires; Harshavardhana. ' +
      'Cholas; Delhi Sultanate; Mughals; Bhakti and Sufi movements; Shivaji and the Marathas; advent of Europeans. ' +
      '1857 Revolt; consolidation of British power; social and religious reform movements; the national movement; ' +
      'post-Independence consolidation and reorganisation.',
    aliases: [
      'Indus Valley', 'Harappan', 'Vedic', 'Buddhism', 'Jainism', 'Mauryan', 'Ashoka', 'Gupta empire',
      'Harshavardhana', 'Chola', 'Delhi Sultanate', 'Mughal', 'Bhakti', 'Sufi', 'Shivaji', 'Maratha',
      '1857 Revolt', 'sepoy mutiny', 'freedom struggle', 'national movement', 'Quit India',
      'Mahatma Gandhi', 'Ambedkar', 'Jawaharlal Nehru', 'Sardar Patel', 'princely state',
      'archaeological', 'excavation', 'inscription', 'ASI', 'monument', 'heritage site',
    ],
  },
  {
    code: 'G2-S2', paper: 'G2-Screening', marks: 30,
    label: 'Geography — physical, economic and human, India and AP',
    syllabus:
      'Earth in the solar system; interior of the earth; landforms; atmosphere; ocean tides, waves and currents. ' +
      'India and AP: physiography, climate, drainage, soils, vegetation; natural hazards and disaster management. ' +
      'Natural resources; agriculture; industrial regions; transport, communication, tourism and trade. ' +
      'Human development; demographics; urbanisation and migration; racial, tribal, religious and linguistic groups.',
    aliases: [
      'monsoon', 'rainfall', 'cyclone', 'flood', 'drought', 'earthquake', 'landslide', 'tsunami',
      'disaster management', 'NDMA', 'river basin', 'drainage', 'groundwater', 'aquifer',
      'soil', 'coastline', 'Eastern Ghats', 'Western Ghats', 'delta', 'reservoir',
      'irrigation project', 'lift irrigation', 'drinking water', 'water supply', 'canal',
      'port', 'highway', 'corridor', 'tourism', 'census', 'command area', 'ayacut',
      'urbanisation', 'migration', 'demographic', 'literacy rate', 'sex ratio',
    
      'Jal Shakti',
    
      'Sample Registration System',
    ],
  },
  {
    code: 'G2-S3', paper: 'G2-Screening', marks: 30,
    label: 'Indian Society — structure, social issues and welfare',
    syllabus:
      'Family, marriage, kinship, caste, tribe, ethnicity, religion and women. ' +
      'Casteism, communalism, regionalism, crime against women, child abuse and child labour, youth unrest. ' +
      'Public policies and welfare programmes; constitutional and statutory provisions for SCs, STs, ' +
      'minorities, BCs, women, the disabled and children.',
    aliases: [
      'Scheduled Caste', 'Scheduled Tribe', 'Backward Class', 'reservation', 'casteism',
      'communal', 'crime against women', 'gender gap', 'domestic violence', 'child labour', 'child marriage',
      'POCSO', 'trafficking', 'welfare scheme', 'pension', 'ration', 'PDS', 'Anganwadi',
      'self-help group', 'SHG', 'differently abled', 'transgender', 'manual scavenging',
      'social justice', 'NCSK', 'National Commission for Women',
      'Right to Education', 'RTE', 'school education', 'National Education Policy',
      'mid-day meal', 'scholarship', 'residential school', 'dropout rate', 'gross enrolment',
    
      'Scheduled Areas',
    
      'disability',
    
      'Integrated Tribal Development Agency',
    ],
  },
  {
    code: 'G2-S4', paper: 'G2-Screening', marks: 30,
    label: 'Mental ability, reasoning and numeracy',
    syllabus: 'Reasoning, data interpretation and numeracy. Not fed by current affairs.',
    aliases: [],
    // Nothing in a newspaper feeds this. Present so the map is the whole
    // syllabus and its absence is a fact rather than an oversight.
    unfeedable: true,
  },
  {
    code: 'G2-S5', paper: 'G2-Screening', marks: 30,
    label: 'Current affairs — international, national and Andhra Pradesh',
    syllabus:
      'Major current events and issues pertaining to International, National and the State of Andhra Pradesh.',
    aliases: [],
    // Matches everything, so it is evidence of nothing. See the header.
    broad: true,
  },

  // ---------------------------------------------------------------------
  // MAINS PAPER I, SECTION A — Social and Cultural History of AP, 75 marks
  // ---------------------------------------------------------------------
  {
    code: 'G2-P1-U1', paper: 'G2-P1A', marks: 15,
    label: 'AP history — Satavahanas, Ikshvakus, Vishnukundins, Eastern Chalukyas',
    syllabus:
      'Pre-historic cultures; the Satavahanas and Ikshvakus — socio-economic and religious conditions, ' +
      'literature, art and architecture; the Vishnukundins, the Eastern Chalukyas of Vengi and the Andhra Cholas — ' +
      'society, religion, Telugu language, art and architecture.',
    aliases: [
      'Satavahana', 'Ikshvaku', 'Vishnukundin', 'Eastern Chalukya', 'Vengi', 'Amaravati stupa',
      'Nagarjunakonda', 'Dharanikota', 'Buddhist site', 'Andhra Chola', 'prehistoric', 'megalith',
    ],
  },
  {
    code: 'G2-P1-U2', paper: 'G2-P1A', marks: 15,
    label: 'AP history — dynasties of the 11th to 16th centuries, Telugu language and art',
    syllabus:
      'Major and minor dynasties ruling Andhradesa between the 11th and 16th centuries; socio-religious and ' +
      'economic conditions; growth of Telugu language and literature; art and architecture.',
    aliases: [
      'Kakatiya', 'Warangal', 'Vijayanagara', 'Krishnadevaraya', 'Hampi', 'Qutb Shahi', 'Reddi kingdom',
      'Telugu literature', 'Telugu language', 'Nannaya', 'Tikkana', 'Palnadu', 'temple architecture',
      'Lepakshi', 'Srisailam', 'Simhachalam', 'Tirumala', 'Ahobilam',
    ],
  },
  {
    code: 'G2-P1-U3', paper: 'G2-P1A', marks: 15,
    label: 'AP under colonial rule — 1857, nationalism, Justice Party, Kisan movements',
    syllabus:
      'Advent of Europeans; trade centres; Andhra under the Company; 1857 and its impact on Andhra; ' +
      'establishment of British rule; socio-cultural awakening; Justice Party and the Self-Respect Movement; ' +
      'the nationalist movement in Andhra 1885-1947; socialists, communists, anti-Zamindari and Kisan movements; ' +
      'nationalist poetry, revolutionary literature, Nataka Samasthalu and women’s participation.',
    aliases: [
      'Justice Party', 'Self-Respect Movement', 'Zamindari', 'Kisan', 'Rayalaseema famine',
      'Alluri Sitarama Raju', 'Rampa rebellion', 'Machilipatnam', 'Masulipatnam', 'Company rule',
      'Nataka Samstha', 'Gurajada', 'Kandukuri', 'Veeresalingam', 'social reform',
    ],
  },
  {
    code: 'G2-P1-U4', paper: 'G2-P1A', marks: 15,
    label: 'The Andhra Movement and the formation of Andhra State, 1953',
    syllabus:
      'Origin and growth of the Andhra Movement; Andhra Mahasabhas; prominent leaders; events leading to the ' +
      'formation of Andhra State in 1953; the press and newspapers in the Andhra Movement; the Library Movement; ' +
      'folk and tribal culture.',
    aliases: [
      'Andhra Mahasabha', 'Potti Sriramulu', 'Andhra State', 'Library Movement', 'Andhra Patrika',
      'folk culture', 'tribal culture', 'Kuchipudi', 'Burrakatha', 'linguistic state',
    ],
  },
  {
    code: 'G2-P1-U5', paper: 'G2-P1A', marks: 15,
    label: 'Formation of Andhra Pradesh, 1956-2014 — Visalandhra to bifurcation',
    syllabus:
      'Events leading to the formation of Andhra Pradesh State; Visalandhra Mahasabha; the States Reorganisation ' +
      'Commission and its recommendations; the Gentlemen’s Agreement; important social and cultural events ' +
      'between 1956 and 2014.',
    aliases: [
      // One spelling only. Aliases are matched against normalised text, and
      // norm() folds curly quotes to straight ones — so both spellings became
      // the SAME matcher, and an article naming the agreement once collected
      // two entries in `matched`. That satisfied the two-distinct-terms clause
      // of the evidence filter on what is really one term.
      'Visalandhra', 'States Reorganisation Commission', "Gentlemen's Agreement",
      'Fazal Ali', 'bifurcation', 'Reorganisation Act', 'Reorganization Act', 'successor State',
      'Telangana movement', 'Jai Andhra',
    ],
  },

  // ---------------------------------------------------------------------
  // MAINS PAPER I, SECTION B — Indian Constitution, 75 marks
  // ---------------------------------------------------------------------
  {
    code: 'G2-P1-U6', paper: 'G2-P1B', marks: 15,
    label: 'Constitution — nature, Preamble, Rights, DPSP, Duties, amendment, basic structure',
    syllabus:
      'Nature of the Indian Constitution; constitutional development; salient features; the Preamble; ' +
      'Fundamental Rights, Directive Principles and their relationship; Fundamental Duties; amendment of the ' +
      'Constitution; the basic structure doctrine.',
    aliases: [
      'Fundamental Right', 'Directive Principle', 'Fundamental Duties', 'Preamble', 'basic structure',
      'Kesavananda', 'constitutional amendment', 'Article 14', 'Article 19', 'Article 21', 'Article 32',
      'Article 226', 'writ petition', 'constitutional validity', 'ultra vires', 'right to life',
      'right to equality', 'freedom of speech',
    
      'rule of law',
    ],
  },
  {
    code: 'G2-P1-U7', paper: 'G2-P1B', marks: 15,
    label: 'Union and State government — legislature, executive, judiciary, judicial review',
    syllabus:
      'Structure and functions of Indian government — legislative, executive and judiciary; unicameral and ' +
      'bicameral legislatures; the parliamentary executive; the judiciary; judicial review; judicial activism.',
    aliases: [
      'Lok Sabha', 'Rajya Sabha', 'Legislative Assembly', 'Legislative Council', 'Parliament',
      'Supreme Court', 'High Court', 'Chief Justice', 'Constitution Bench', 'judicial review',
      'judicial activism', 'Governor', 'President of India', 'Council of Ministers', 'Speaker',
      'ordinance', 'money bill', 'no-confidence', 'collegium',
      'Bill passed', 'Bills passed', 'Bill was passed', 'Assembly passed', 'Assembly session',
      'Question Hour', 'Governor’s assent', 'Presidential assent', 'Select Committee',
    ],
  },
  {
    code: 'G2-P1-U8', paper: 'G2-P1B', marks: 15,
    label: 'Union-State powers, constitutional bodies, Human Rights Commission, RTI, Lokpal',
    syllabus:
      'Distribution of legislative and executive powers between the Union and the States; legislative, ' +
      'administrative and financial relations; powers and functions of constitutional bodies; the Human Rights ' +
      'Commission; the Right to Information; the Lokpal and Lok Ayukta.',
    aliases: [
      'Centre-State', 'Union List', 'State List', 'concurrent list', 'Article 246', 'Finance Commission',
      'devolution', 'CAG', 'Comptroller and Auditor General', 'Election Commission', 'UPSC',
      'Public Service Commission', 'Human Rights Commission', 'NHRC', 'Right to Information',
      'RTI', 'Lokpal', 'Lok Ayukta', 'Attorney General', 'Advocate General',
    
      'APPSC', 'Inter-State Council',
    ],
  },
  {
    code: 'G2-P1-U9', paper: 'G2-P1B', marks: 15,
    label: 'Centre-State relations, federalism, parties, elections and electoral reform',
    syllabus:
      'Centre-State relations and the need for reform; the Rajamannar Committee, Sarkaria Commission and ' +
      'M.M. Punchhi Commission; unitary and federal features; Indian political parties and the party system; ' +
      'recognition of national and State parties; elections and electoral reforms; the anti-defection law.',
    aliases: [
      'Sarkaria', 'Punchhi', 'Rajamannar', 'federalism', 'federal structure', 'anti-defection',
      'Tenth Schedule', 'disqualification', 'electoral reform', 'electoral bond', 'EVM', 'VVPAT',
      'model code of conduct', 'delimitation', 'national party', 'State party', 'by-election',
      'Assembly election', 'local body election',
    
      'Zonal Council', 'Gorkhaland',
    ],
  },
  {
    code: 'G2-P1-U10', paper: 'G2-P1B', marks: 15,
    label: 'Decentralisation — panchayati raj, 73rd and 74th Amendments, urban local bodies',
    syllabus:
      'Centralisation versus decentralisation; the Community Development Programme; the Balwant Rai Mehta and ' +
      'Ashok Mehta Committees; the 73rd and 74th Constitutional Amendment Acts and their implementation.',
    aliases: [
      'panchayat', 'Panchayati Raj', 'Zilla Parishad', 'Zilla Praja Parishad', 'Mandal Parishad',
      'Mandal Praja Parishad', 'gram sabha', 'sarpanch', 'municipal corporation', 'municipality',
      '73rd Amendment', '74th Amendment', 'Balwant Rai Mehta', 'Ashok Mehta', 'urban local bod',
      'ULB', 'mayor', 'ward member', 'local self-government',
    
      'decentralisation',
    ],
  },

  // ---------------------------------------------------------------------
  // MAINS PAPER II, SECTION A — Indian and AP Economy, 75 marks
  // ---------------------------------------------------------------------
  {
    code: 'G2-P2-U1', paper: 'G2-P2A', marks: 15,
    label: 'Structure of the Indian economy, planning, 1991 reforms, NITI Aayog',
    syllabus:
      'National income: concept and measurement; occupational pattern and sectoral distribution of income; ' +
      'economic growth and economic development; the strategy of planning in India; the New Economic Reforms of ' +
      '1991; decentralisation of financial resources; NITI Aayog.',
    aliases: [
      'GDP', 'gross domestic product', 'national income', 'per capita income', 'economic growth',
      'economic survey', 'NITI Aayog', 'Five Year Plan', 'liberalisation', 'liberalization',
      'economic reform', 'sectoral', 'nominal GDP', 'real GDP', 'growth rate',
    ],
  },
  {
    code: 'G2-P2-U2', paper: 'G2-P2A', marks: 15,
    label: 'Money, banking, public finance, taxation, GST, budget, BOP and FDI',
    syllabus:
      'Money supply; the Reserve Bank of India, monetary policy and credit control; Indian banking structure, ' +
      'development and reforms; inflation; fiscal policy, fiscal imbalance, deficit finance and fiscal ' +
      'responsibility; the Indian tax structure; GST; the recent Union Budget; balance of payments; FDI.',
    aliases: [
      'Reserve Bank', 'RBI', 'repo rate', 'monetary policy', 'inflation', 'CPI', 'WPI',
      'fiscal deficit', 'revenue deficit', 'FRBM', 'Union Budget', 'tax revenue', 'direct tax',
      'income tax', 'GST', 'excise', 'customs duty', 'cess', 'balance of payments', 'FDI',
      'foreign direct investment', 'bank credit', 'NPA', 'SEBI', 'IRDAI', 'insurance', 'IPO',
      'disinvestment proceeds', 'dividend', 'Finance Ministry', 'CGA',
    
      'Tariff Rate Quota',
    ],
  },
  {
    code: 'G2-P2-U3', paper: 'G2-P2A', marks: 15,
    label: 'Agriculture, industry and services in the Indian economy',
    syllabus:
      'Cropping pattern, agricultural production and productivity; agricultural finance and marketing; ' +
      'agricultural pricing — MSP, procurement, issue price and distribution; industrial development, patterns ' +
      'and problems; the New Industrial Policy 1991; disinvestment; ease of doing business; industrial sickness; ' +
      'the services sector; IT and ITES.',
    aliases: [
      'agriculture', 'crop', 'kharif', 'rabi', 'MSP', 'minimum support price', 'procurement',
      'farmer', 'fertilizer', 'fertiliser', 'irrigation', 'horticulture', 'food grain',
      'industrial policy', 'manufacturing', 'ease of doing business', 'disinvestment',
      'services sector', 'IT industry', 'ITES', 'exports', 'imports', 'PLI', 'production linked',
    
      'stockholding limit', 'MMDR',
    
      'MSME',
    ],
  },
  {
    code: 'G2-P2-U4', paper: 'G2-P2A', marks: 15,
    label: 'Andhra Pradesh economy and public finance — GSDP, revenue, debt, budget',
    syllabus:
      'Structure and growth of the AP economy; Gross State Domestic Product and sectoral contribution; ' +
      'per capita income; State tax and non-tax revenue; State expenditure, debt and interest payments; ' +
      'central assistance; externally assisted projects; the recent AP Budget.',
    aliases: [
      'GSDP', 'State budget', 'AP budget', 'State revenue', 'State expenditure', 'State debt',
      'central assistance', 'externally aided', 'AIIB', 'World Bank', 'ADB loan',
      'Finance Commission grant', 'special assistance', 'FRBM limit', 'borrowing limit',
    ],
  },
  {
    code: 'G2-P2-U5', paper: 'G2-P2A', marks: 15,
    label: 'AP agriculture, industry, MSMEs, corridors, services and IT policy',
    syllabus:
      'Production trends in agriculture and allied sectors; cropping pattern; rural credit cooperatives; ' +
      'agricultural marketing; strategies and schemes in AP including horticulture, animal husbandry, fisheries ' +
      'and forests; growth and structure of industries; the recent AP Industrial Development Policy; single ' +
      'window mechanism; industrial incentives; MSMEs; industrial corridors; the services sector; IT, ' +
      'electronics and communications; the recent AP IT Policy.',
    aliases: [
      'industrial park', 'industrial corridor', 'single window', 'industrial incentive',
      'AP Industrial', 'IT policy', 'electronics manufacturing', 'data centre', 'data center',
      'fisheries', 'aqua', 'animal husbandry', 'dairy', 'horticulture', 'agricultural marketing',
      'rythu', 'cooperative bank', 'APIIC', 'Sunrise', 'investment MoU', 'MoU signed',
      'land pooling', 'land acquisition', 'assigned land', 'capital region', 'CRDA',
    
      'Bharat Audyogik Vikas Yojana', 'BHAVYA', 'South Coast Railway',
    
      'Visakhapatnam Steel Plant',
      // `MSME` alone is gone from this unit. Across 411 articles it earned two
      // tags and both were national stories — a White House report on Indian
      // pump exports and a piece on India's industrial heat. It never once
      // caught an AP MSME story, because a newspaper writing about AP MSMEs
      // says so. These do.
      'AP MSME', 'Andhra Pradesh MSME', 'MSME in Andhra Pradesh',
    ],
  },

  // ---------------------------------------------------------------------
  // MAINS PAPER II, SECTION B — Science and Technology, 75 marks
  // ---------------------------------------------------------------------
  {
    code: 'G2-P2-U6', paper: 'G2-P2B', marks: 15,
    label: 'Technology missions — space, defence, ICT, Digital India, cyber, nuclear',
    syllabus:
      'National Science, Technology and Innovation Policy; national strategies and missions; emerging technology ' +
      'frontiers; space technology — launch vehicles, recent satellite launches and applications, space science ' +
      'missions; defence technology — DRDO and the IGMDP; ICT — the National Policy on IT, Digital India, ' +
      'e-governance, cyber security and the National Cyber Security Policy; nuclear technology — reactors, ' +
      'power plants, radioisotopes and India’s nuclear programme.',
    aliases: [
      'ISRO', 'satellite launch', 'launch vehicle', 'PSLV', 'GSLV', 'Gaganyaan', 'Chandrayaan', 'Aditya-L1',
      'space mission', 'DRDO', 'IGMDP', 'BrahMos', 'defence technology', 'Agni missile',
      'Digital India', 'e-governance', 'cyber security', 'cybersecurity', 'data protection',
      'artificial intelligence', 'semiconductor', '5G', '6G', 'quantum', 'nuclear reactor',
      'nuclear power', 'radioisotope', 'DAE', 'ISRO chairman', 'science policy',
    ],
  },
  {
    code: 'G2-P2-U7', paper: 'G2-P2B', marks: 15,
    label: 'Energy — policy, renewables, biofuels, Bharat Stage norms',
    syllabus:
      'Installed energy capacity and demand in India; the National Energy Policy; the National Policy on ' +
      'Biofuels; Bharat Stage norms; non-renewable and renewable energy sources and installed capacities; ' +
      'recent programmes, schemes and achievements in the renewable energy sector.',
    aliases: [
      'renewable energy', 'solar power', 'wind power', 'green hydrogen', 'biofuel', 'ethanol',
      'Bharat Stage', 'thermal power', 'coal', 'installed capacity', 'megawatt', 'gigawatt',
      'power purchase', 'discom', 'electricity', 'energy policy', 'pumped storage', 'battery storage',
      'polysilicon', 'solar module',
    
      'energy security',
    ],
  },
  {
    code: 'G2-P2-U8', paper: 'G2-P2B', marks: 15,
    label: 'Ecosystem and biodiversity — conservation, wildlife, biosphere reserves',
    syllabus:
      'Basic concepts of ecology; ecosystem components and types; biodiversity, hotspots, loss and ' +
      'conservation; recent plans, targets, conventions and protocols; wildlife conservation, CITES and ' +
      'endangered species in India; biosphere reserves; Indian wildlife conservation efforts, projects, ' +
      'acts and initiatives.',
    aliases: [
      'biodiversity', 'ecosystem', 'wildlife', 'tiger reserve', 'sanctuary', 'national park',
      'biosphere reserve', 'CITES', 'endangered', 'Ramsar', 'wetland', 'mangrove', 'forest cover',
      'Project Tiger', 'Project Elephant', 'poaching', 'conservation', 'flamingo', 'olive ridley',
      'Wildlife Protection Act', 'Forest Rights Act', 'compensatory afforestation',
    ],
  },
  {
    code: 'G2-P2-U9', paper: 'G2-P2B', marks: 15,
    label: 'Waste management and pollution control',
    syllabus:
      'Solid wastes and their classification; methods of disposal and management in India; types of ' +
      'environmental pollution, sources and impacts; pollution control, regulation and alternatives; recent ' +
      'projects, acts and initiatives; the impact of transgenics and their regulation; eco-friendly ' +
      'technologies in agriculture; bioremediation.',
    aliases: [
      'solid waste', 'waste management', 'plastic waste', 'e-waste', 'landfill', 'sewage',
      'air pollution', 'water pollution', 'noise pollution', 'air quality', 'AQI', 'effluent',
      'contaminated water', 'industrial effluent', 'toxic', 'groundwater contamination',
      'Pollution Control Board', 'CPCB', 'environmental clearance', 'EIA', 'National Green Tribunal',
      'NGT', 'transgenic', 'GM crop', 'bioremediation', 'emission norm',
    ],
  },
  {
    code: 'G2-P2-U10', paper: 'G2-P2B', marks: 15,
    label: 'Environment and health — climate change, sustainable development, public health',
    syllabus:
      'Global warming, climate change, acid rain, ozone depletion, ocean acidification; recent international ' +
      'initiatives, protocols and conventions with reference to India’s role; sustainable development — ' +
      'meaning, scope, components and goals; recent trends in disease burden; epidemic and pandemic challenges ' +
      'in India; healthcare delivery and outcomes; recent public health initiatives and programmes.',
    aliases: [
      'climate change', 'global warming', 'greenhouse gas', 'carbon emission', 'net zero', 'COP',
      'Paris Agreement', 'ozone', 'ocean acidification', 'sustainable development', 'SDG',
      'public health', 'epidemic', 'pandemic', 'vaccine', 'immunisation', 'immunization',
      'disease burden', 'malaria', 'tuberculosis', 'influenza', 'H1N1', 'Ayushman', 'primary health',
      'health insurance', 'public hospital', 'nutrition', 'malnutrition',
    
      'National AYUSH Mission', 'AYUSH', 'nursing personnel', 'Nurses Registration and Tracking System', 'cardiovascular', 'fixed-dose combination', 'FSSAI',
    ],
  },
];

module.exports = { G2_UNITS };
