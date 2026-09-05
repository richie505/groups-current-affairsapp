'use strict';

// THE GROUP-I PRELIMINARY SYLLABUS — Paper I, General Studies, 120 marks.
//
// WHY THIS IS A THIRD MAP AND NOT A COPY OF EITHER OTHER ONE
//
// The app knew two syllabi: Group-I MAINS (Papers I to V, `exam = 'g1'`) and
// Group-II (`exam = 'g2'`). Group-I PRELIMS is neither. It is broader than the
// Mains papers and shallower than them, it is a different paper with its own
// weighting, and — the part that matters most — it is OBJECTIVE.
//
// THE THING THAT CHANGES BECAUSE OF THIS FILE
//
// Of the four papers this app serves, THREE are answered by ticking a box:
//
//     Group-I Prelims      objective     120 questions
//     Group-I Mains        descriptive   five written papers
//     Group-II Screening   objective     150 questions
//     Group-II Mains       objective     two papers
//
// The app was built the other way round. Every item carries an eight-section
// descriptive template, a fact, an angle, bridges and a way forward — and four
// multiple-choice questions. That is a great deal of care for the one paper that
// is written and rather little for the three that are ticked.
//
// Recording the format on the unit is what makes that measurable instead of a
// feeling: `format` says whether feeding a unit means writing an answer or
// recognising an option, and the two need different material out of the same
// article.

// prettier-ignore
const G1P_UNITS = [
  // ---------------------------------------------------------------------
  // (A) HISTORY AND CULTURE
  // ---------------------------------------------------------------------
  {
    code: 'G1P-A1', paper: 'G1P-History',
    label: 'Ancient India — Indus Valley to the Guptas',
    syllabus:
      'Indus Valley Civilization: features, sites, society, cultural history, art and religion. Vedic age, ' +
      'Mahajanapadas, Jainism and Buddhism. The Magadhas, the Mauryas, foreign invasions and their impact, ' +
      'the Kushanas, the Satavahanas, the Sangam age, the Sungas and the Gupta empire — administration, ' +
      'social, religious and economic conditions, art, architecture, literature, science and technology.',
    aliases: [
      'Indus Valley', 'Harappan', 'Mohenjo', 'Vedic', 'Mahajanapada', 'Jainism', 'Buddhism', 'Magadha',
      'Mauryan', 'Ashoka', 'Kushana', 'Satavahana', 'Sangam age', 'Gupta empire', 'Nalanda',
      'archaeological', 'excavation', 'rock edict', 'inscription', 'stupa', 'Archaeological Survey',
    
      'Buddhist site', 'megalith', 'prehistoric',
    ],
  },
  {
    code: 'G1P-A2', paper: 'G1P-History',
    label: 'Early medieval India — Kanauj and the southern dynasties',
    syllabus:
      'Kanauj and its contributions. South Indian dynasties — the Badami Chalukyas, the Eastern Chalukyas, ' +
      'the Rashtrakutas, the Kalyani Chalukyas, the Cholas, the Hoysalas, the Yadavas, the Kakatiyas and ' +
      'the Reddis.',
    aliases: [
      'Kanauj', 'Badami Chalukya', 'Eastern Chalukya', 'Rashtrakuta', 'Kalyani Chalukya', 'Chola',
      'Hoysala', 'Yadava', 'Kakatiya', 'Reddi kingdom', 'Vengi', 'Warangal',
    ],
  },
  {
    code: 'G1P-A3', paper: 'G1P-History',
    label: 'Sultanate, Vijayanagara and Mughals — Bhakti and Sufism',
    syllabus:
      'The Delhi Sultanate, the Vijayanagara empire and the Mughal empire; the Bhakti movement and Sufism — ' +
      'administration, economy, society, religion, literature, arts and architecture.',
    aliases: [
      'Delhi Sultanate', 'Vijayanagara', 'Krishnadevaraya', 'Hampi', 'Mughal', 'Akbar', 'Aurangzeb',
      'Bhakti', 'Sufi', 'Qutb Shahi', 'Golconda', 'Charminar', 'Taj Mahal', 'medieval architecture',
    
      'temple architecture',
    ],
  },
  {
    code: 'G1P-A4', paper: 'G1P-History',
    label: 'European trading companies and colonial administration',
    syllabus:
      'The European trading companies in India and their struggle for supremacy, with special reference to ' +
      'Bengal, Bombay, Madras, Mysore, Andhra and the Nizam; Governors-General and Viceroys.',
    aliases: [
      'East India Company', 'Governor-General', 'Viceroy', 'Nizam', 'Mysore', 'Tipu Sultan',
      'Battle of Plassey', 'Carnatic', 'Machilipatnam', 'French settlement', 'Dutch settlement',
      'colonial administration', 'Company rule',
    ],
  },
  {
    code: 'G1P-A5', paper: 'G1P-History',
    label: '1857, reform movements and the freedom struggle',
    syllabus:
      'The Indian War of Independence of 1857 — origin, nature, causes, consequences and significance, with ' +
      'special reference to the State; religious and social reform movements of the 19th century; India’s ' +
      'freedom movement; revolutionaries in India and abroad.',
    aliases: [
      '1857 Revolt', 'sepoy mutiny', 'freedom movement', 'freedom struggle', 'Quit India',
      'Non-Cooperation', 'Civil Disobedience', 'Swadeshi', 'Home Rule', 'revolutionary',
      'social reform', 'Brahmo Samaj', 'Arya Samaj', 'Veeresalingam', 'Alluri Sitarama Raju',
      'Rampa rebellion', 'Indian National Congress', 'partition of Bengal',
    
      'Justice Party', 'Self-Respect Movement', 'Library Movement',
    ],
  },
  {
    code: 'G1P-A6', paper: 'G1P-History',
    label: 'Gandhi, Ambedkar, Patel, Bose and post-Independence consolidation',
    syllabus:
      'Mahatma Gandhi — his thoughts, principles and philosophy; important satyagrahas; the role of Sardar ' +
      'Patel and Subhas Chandra Bose in the freedom movement and post-Independence consolidation. ' +
      'Dr. B.R. Ambedkar — his life and contribution to the making of the Indian Constitution. India after ' +
      'Independence — reorganisation of the States.',
    aliases: [
      'Mahatma Gandhi', 'satyagraha', 'Sardar Patel', 'Subhas Chandra Bose', 'Netaji',
      'B.R. Ambedkar', 'Ambedkar', 'Constituent Assembly', 'States Reorganisation',
      'linguistic state', 'Potti Sriramulu', 'integration of princely', 'Gandhi Jayanti',
    
      'States Reorganisation Commission', 'Fazal Ali',
    ],
  },

  // ---------------------------------------------------------------------
  // (B) CONSTITUTION, POLITY, SOCIAL JUSTICE AND INTERNATIONAL RELATIONS
  // ---------------------------------------------------------------------
  {
    code: 'G1P-B1', paper: 'G1P-Polity',
    label: 'The Constitution — evolution, Rights, Duties, DPSP, amendments, basic structure',
    syllabus:
      'Indian Constitution: evolution, features, Preamble, Fundamental Rights, Fundamental Duties, ' +
      'Directive Principles of State Policy, amendments, significant provisions and the basic structure.',
    aliases: [
      'Fundamental Right', 'Fundamental Duties', 'Directive Principle', 'Preamble', 'basic structure',
      'Kesavananda', 'constitutional amendment', 'Article 14', 'Article 19', 'Article 21',
      'Article 32', 'Article 226', 'writ petition', 'constitutional bench', 'constitutional validity',
    
      'rule of law',
    ],
  },
  {
    code: 'G1P-B2', paper: 'G1P-Polity',
    label: 'Union and States — Parliament, legislatures, federal structure, devolution',
    syllabus:
      'Functions and responsibilities of the Union and the States; Parliament and State legislatures — ' +
      'structure, function, power and privileges; issues and challenges of the federal structure; ' +
      'devolution of power and finances to local levels and the challenges therein.',
    aliases: [
      'Lok Sabha', 'Rajya Sabha', 'Legislative Assembly', 'Legislative Council', 'Parliament',
      'Assembly session', 'Bills passed', 'Bill passed', 'money bill', 'privilege motion',
      'Centre-State', 'federal structure', 'Union List', 'State List', 'concurrent list',
      'Finance Commission', 'devolution', 'divisible pool',
    
      'Zonal Council', 'Inter-State Council', 'Gorkhaland',
    
      'Reorganisation Act', 'Reorganization Act', 'bifurcation', 'successor State', 'river water sharing',
    ],
  },
  {
    code: 'G1P-B3', paper: 'G1P-Polity',
    label: 'Constitutional authorities, panchayati raj, public policy and governance',
    syllabus:
      'Constitutional authorities — powers, functions and responsibilities; panchayati raj; public policy ' +
      'and governance.',
    aliases: [
      'Election Commission', 'UPSC', 'Public Service Commission', 'CAG',
      'Comptroller and Auditor General', 'Attorney General', 'Advocate General', 'Governor',
      'panchayat', 'Panchayati Raj', 'Zilla Parishad', 'Mandal Parishad', 'gram sabha',
      'municipal corporation', 'urban local bod', '73rd Amendment', '74th Amendment',
      'good governance', 'public policy',
    
      'APPSC', 'Mega DSC',
    ],
  },
  {
    code: 'G1P-B4', paper: 'G1P-Polity',
    label: 'Liberalisation and governance — statutory, regulatory and quasi-judicial bodies',
    syllabus:
      'Impact of liberalisation, privatisation and globalisation on governance; statutory, regulatory and ' +
      'quasi-judicial bodies.',
    aliases: [
      'regulator', 'regulatory authority', 'SEBI', 'TRAI', 'IRDAI', 'CCI',
      'Competition Commission', 'National Green Tribunal', 'tribunal', 'quasi-judicial',
      'statutory body', 'privatisation', 'disinvestment', 'globalisation', 'public sector undertaking',
    
      'FSSAI', 'Drugs Technical Advisory Board',
    ],
  },
  {
    code: 'G1P-B5', paper: 'G1P-Polity',
    label: 'Rights issues — human, women, SC/ST and child rights',
    syllabus:
      'Rights issues — human rights, women’s rights, SC and ST rights, child rights and related matters.',
    aliases: [
      'human rights', 'NHRC', 'Human Rights Commission', 'crime against women',
      'National Commission for Women', 'Scheduled Caste', 'Scheduled Tribe', 'atrocities Act',
      'child rights', 'POCSO', 'child labour', 'juvenile justice', 'Right to Education',
      'reservation', 'transgender', 'manual scavenging',
    
      'Scheduled Areas', 'disability',
    
      'Integrated Tribal Development Agency',
    ],
  },
  {
    code: 'G1P-B6', paper: 'G1P-Polity',
    label: 'Foreign policy, international relations, institutions and government programmes',
    syllabus:
      'India’s foreign policy and international relations; important institutions, agencies and fora, their ' +
      'structure and mandate; important policies and programmes of the Central and State governments.',
    aliases: [
      'foreign policy', 'bilateral', 'summit', 'joint statement', 'United Nations', 'UNSC',
      'World Health Organization', 'World Bank', 'IMF', 'WTO', 'BRICS', 'G20', 'SCO', 'QUAD',
      'ASEAN', 'SAARC', 'Ministry of External Affairs', 'diplomatic', 'strategic partnership',
      'defence cooperation', 'maritime security', 'free trade agreement',
    
      'fuel supply agreement',
    
      'ADB loan', 'AIIB',
    ],
  },

  // ---------------------------------------------------------------------
  // (C) INDIAN AND ANDHRA PRADESH ECONOMY AND PLANNING
  // ---------------------------------------------------------------------
  {
    code: 'G1P-C1', paper: 'G1P-Economy',
    label: 'Development, planning, NITI Aayog, HDI and sustainable development',
    syllabus:
      'Basic characteristics of the Indian economy as a developing economy; economic development since ' +
      'Independence — objectives and achievements of planning; NITI Aayog and its approach; growth and ' +
      'distributive justice; the Human Development Index and India’s rank; environmental degradation and ' +
      'challenges; sustainable development; environmental policy.',
    aliases: [
      'NITI Aayog', 'Five Year Plan', 'economic development', 'Human Development Index',
      'sustainable development', 'SDG', 'inclusive growth', 'developing economy',
      'economic survey', 'distributive justice',
    ],
  },
  {
    code: 'G1P-C2', paper: 'G1P-Economy',
    label: 'National income, demography, poverty, unemployment, rural and urban development',
    syllabus:
      'National income — concepts and components; India’s national accounts; demographic issues; poverty ' +
      'and inequalities; occupational structure and unemployment; schemes for employment and poverty ' +
      'eradication; issues of rural and urban development.',
    aliases: [
      'national income', 'GDP', 'per capita income', 'census', 'demographic', 'poverty line',
      'unemployment', 'employment scheme', 'MGNREGA', 'skill development', 'rural development',
      'urban development', 'AMRUT', 'smart city', 'PMAY', 'inequality',
    
      'Sample Registration System',
    
      'GSDP',
    ],
  },
  {
    code: 'G1P-C3', paper: 'G1P-Economy',
    label: 'Agriculture and industry — MSP, land reform, Make in India, corridors, energy',
    syllabus:
      'Indian agriculture — irrigation and water, inputs, agricultural strategy and policy, agrarian crisis ' +
      'and land reforms, agricultural credit, minimum support prices, malnutrition and food security. ' +
      'Indian industry — industrial policy, Make in India, Start-up and Stand-up programmes, SEZs and ' +
      'industrial corridors, energy and power policies, economic reforms, liberalisation, privatisation and ' +
      'globalisation, international trade, balance of payments, India and the WTO.',
    aliases: [
      'agriculture', 'irrigation project', 'minimum support price', 'MSP', 'land reform',
      'agricultural credit', 'food security', 'malnutrition', 'crop', 'kharif', 'rabi',
      'industrial policy', 'Make in India', 'start-up', 'special economic zone', 'SEZ',
      'industrial corridor', 'energy policy', 'power policy', 'balance of payments', 'WTO',
      'exports', 'imports', 'production linked',
    
      'MMDR',
    
      'MSME',
    
      'cooperative bank', 'assigned land', 'land acquisition', 'industrial park', 'BHAVYA', 'Bharat Audyogik Vikas Yojana',
    ],
  },
  {
    code: 'G1P-C4', paper: 'G1P-Economy',
    label: 'RBI, banking, financial markets, taxation, GST, devolution and the Budget',
    syllabus:
      'Financial institutions; the RBI and monetary policy; banking and financial sector reforms; commercial ' +
      'banks and NPAs; financial markets and instabilities; stock exchanges and SEBI; the Indian tax system ' +
      'and recent changes; GST and its impact; Centre-State financial relations; Finance Commissions; ' +
      'sharing of resources and devolution; public debt and expenditure; fiscal policy and the Budget.',
    aliases: [
      'Reserve Bank', 'RBI', 'repo rate', 'monetary policy', 'inflation', 'commercial bank', 'NPA',
      'stock exchange', 'SEBI', 'GST', 'tax revenue', 'direct tax', 'income tax', 'cess',
      'Finance Commission', 'devolution', 'public debt', 'fiscal deficit', 'fiscal policy',
      'Union Budget', 'FRBM', 'banking reform',
    
      'Tariff Rate Quota',
    
      'State budget', 'borrowing limit', 'Finance Commission grant', 'revenue deficit grant', 'special status', 'central assistance',
    ],
  },
  {
    code: 'G1P-C5', paper: 'G1P-Economy',
    label: 'AP after bifurcation — Reorganisation Act 2014, special status, capital, assurances',
    syllabus:
      'Characteristics of the Andhra Pradesh economy after bifurcation in 2014; impact on natural resources ' +
      'and State revenue; river water sharing disputes and irrigation; challenges to industry and commerce; ' +
      'infrastructure, power and transport; IT and e-governance; initiatives in agriculture, industry and ' +
      'the social sector; urbanisation and smart cities; skill development and employment; social welfare. ' +
      'The A.P. Reorganisation Act 2014 — economic issues arising from bifurcation, assistance for the new ' +
      'capital, compensation for revenue loss, backward districts, the Vizag railway zone, Kadapa steel, ' +
      'Dugarajapatnam, expressways and corridors, special status and special assistance.',
    aliases: [
      'Reorganisation Act', 'Reorganization Act', 'bifurcation', 'successor State', 'special status',
      'special assistance', 'Polavaram', 'Krishna water', 'Godavari water', 'river water sharing',
      'Amaravati', 'capital region', 'CRDA', 'Vizag railway zone', 'Kadapa steel',
      'Dugarajapatnam', 'backward district', 'revenue deficit grant', 'e-governance',
    
      'Visakhapatnam Steel Plant', 'Rashtriya Ispat Nigam',
    ],
  },

  // ---------------------------------------------------------------------
  // (D) GEOGRAPHY
  // ---------------------------------------------------------------------
  {
    code: 'G1P-D1', paper: 'G1P-Geography',
    label: 'General geography — earth, atmosphere, oceans, climate change, hazards',
    syllabus:
      'Earth in the solar system, motion of the earth, concept of time, seasons, internal structure of the ' +
      'earth, major landforms. Atmosphere — structure and composition, elements and factors of climate, ' +
      'air masses and fronts, atmospheric disturbances, climate change. Oceans — physical, chemical and ' +
      'biological characteristics; hydrological disasters; marine and continental resources.',
    aliases: [
      'solar system', 'atmosphere', 'climate change', 'global warming', 'ocean current', 'tsunami',
      'cyclone', 'depression', 'landform', 'tectonic', 'volcano', 'sea level rise',
      'marine resource', 'hydrological', 'El Nino', 'La Nina',
    
      'Geological Survey of India',
    ],
  },
  {
    code: 'G1P-D2', paper: 'G1P-Geography',
    label: 'Physical geography of India and AP — drainage, monsoon, soils, parks, minerals',
    syllabus:
      'Major physical divisions of the world, India and the State; earthquakes, landslides, natural ' +
      'drainage, climatic changes and regions, the monsoon, natural vegetation, parks and sanctuaries, ' +
      'major soil types, rocks and minerals.',
    aliases: [
      'monsoon', 'rainfall', 'drainage', 'river basin', 'earthquake', 'landslide', 'flood', 'drought',
      'Eastern Ghats', 'Western Ghats', 'national park', 'sanctuary', 'tiger reserve',
      'biosphere reserve', 'soil', 'mineral', 'bauxite', 'coal reserve', 'groundwater',
    
      'Jal Shakti',
    
      'Krishna water', 'Godavari water',
    ],
  },
  {
    code: 'G1P-D3', paper: 'G1P-Geography',
    label: 'Social geography — population, literacy, tribes, urbanisation, migration',
    syllabus:
      'Distribution, density, growth, sex ratio, literacy, occupational structure, SC and ST population, ' +
      'rural-urban components, racial, tribal, religious and linguistic groups, urbanisation, migration ' +
      'and metropolitan regions.',
    aliases: [
      'census', 'population density', 'sex ratio', 'literacy rate', 'urbanisation', 'migration',
      'metropolitan', 'tribal population', 'linguistic group', 'rural-urban', 'demographic dividend',
    
      'crude death rate',
    ],
  },
  {
    code: 'G1P-D4', paper: 'G1P-Geography',
    label: 'Economic geography — sectors, industries, transport and trade',
    syllabus:
      'Major sectors of the economy — agriculture, industry and services and their salient features; basic ' +
      'industries — agro, mineral, forest, fuel and manpower based; transport and trade, patterns and issues.',
    aliases: [
      'agro-based', 'mineral-based', 'industrial region', 'transport', 'railway', 'port',
      'highway', 'logistics', 'trade route', 'services sector', 'manufacturing hub',
    
      'national highway', 'Indian Roads Congress', 'South Coast Railway', 'mining sector', 'road safety',
    ],
  },

  // ---------------------------------------------------------------------
  // SCIENCE AND TECHNOLOGY (items 18-22)
  // ---------------------------------------------------------------------
  {
    code: 'G1P-S1', paper: 'G1P-Science',
    label: 'Science and technology — policy, institutions, Indian scientists',
    syllabus:
      'Nature and scope of science and technology; relevance to daily life; the National Policy on Science, ' +
      'Technology and Innovation; institutes and organisations in India promoting science, technology and ' +
      'innovation, their activities and contribution; contribution of prominent Indian scientists.',
    aliases: [
      'science policy', 'innovation policy', 'CSIR', 'ICMR', 'IISc', 'research institute',
      'Indian scientist', 'patent', 'research and development', 'technology mission',
    
      'research integrity',
    ],
  },
  {
    code: 'G1P-S2', paper: 'G1P-Science',
    label: 'ICT, e-governance, Digital India and cyber security',
    syllabus:
      'Nature and scope of ICT; ICT in daily life, industry and governance; government schemes promoting ' +
      'ICT; e-governance programmes and services; netiquette; cyber security concerns; the National Cyber ' +
      'Crime Policy.',
    aliases: [
      'Digital India', 'e-governance', 'cyber security', 'cybersecurity', 'cyber crime',
      'data protection', 'artificial intelligence', 'data centre', 'data center', 'UPI',
      'Aadhaar', 'digital payment', 'broadband', '5G', 'semiconductor',
    
      'IT policy',
    ],
  },
  {
    code: 'G1P-S3', paper: 'G1P-Science',
    label: 'Space and defence technology — ISRO, satellites, DRDO',
    syllabus:
      'Evolution of the Indian space programme; ISRO’s activities and achievements; satellite programmes — ' +
      'telecommunication, IRNSS, IRS; satellites for defence and academic purposes; DRDO — vision, mission ' +
      'and activities.',
    aliases: [
      'ISRO', 'satellite launch', 'launch vehicle', 'PSLV', 'GSLV', 'Gaganyaan', 'Chandrayaan',
      'Aditya-L1', 'IRNSS', 'NavIC', 'remote sensing', 'DRDO', 'BrahMos', 'Agni missile',
      'defence acquisition', 'space mission',
    ],
  },
  {
    code: 'G1P-S4', paper: 'G1P-Science',
    label: 'Energy — requirement, efficiency, solar, wind and nuclear',
    syllabus:
      'India’s energy needs and deficit; energy resources and dependence; the energy policy of India; ' +
      'government policies and programmes; solar, wind and nuclear energy.',
    aliases: [
      'renewable energy', 'solar power', 'wind power', 'nuclear power', 'nuclear reactor',
      'green hydrogen', 'energy efficiency', 'installed capacity', 'thermal power', 'biofuel',
      'ethanol', 'battery storage', 'pumped storage',
    
      'energy security',
    ],
  },
  {
    code: 'G1P-S5', paper: 'G1P-Science',
    label: 'Environment, biodiversity, climate commitments, biotech and health',
    syllabus:
      'Issues and concerns related to the environment; legal aspects, policies and treaties at national and ' +
      'international level; biodiversity, its importance and concerns; climate change, international ' +
      'initiatives and India’s commitment; forests and wildlife and the legal framework for their ' +
      'conservation; environmental hazards, pollution, carbon emission, global warming; national action ' +
      'plans on climate change and disaster management; biotechnology and nanotechnology — nature, scope, ' +
      'applications and ethical, social and legal issues; genetic engineering; health and environment.',
    aliases: [
      'biodiversity', 'wildlife', 'forest cover', 'environmental clearance', 'EIA',
      'Pollution Control Board', 'air quality', 'carbon emission', 'net zero', 'Paris Agreement',
      'COP', 'climate commitment', 'disaster management', 'NDMA', 'biotechnology',
      'nanotechnology', 'genetic engineering', 'GM crop', 'public health', 'epidemic', 'vaccine',
    
      'National AYUSH Mission', 'AYUSH', 'fixed-dose combination', 'nursing personnel', 'cardiovascular',
    ],
  },

  // ---------------------------------------------------------------------
  {
    code: 'G1P-CE', paper: 'G1P-Current',
    label: 'Current events of regional, national and international importance',
    syllabus: 'Current events of regional, national and international importance.',
    aliases: [],
    // Same reasoning as the Group-II current-affairs paper: it contains every
    // article ever printed, so it is evidence of nothing. See g2-syllabus.js.
    broad: true,
  },
];

module.exports = { G1P_UNITS };
