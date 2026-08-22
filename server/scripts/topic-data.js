'use strict';

// The curated topic vocabulary.
//
// HOW THIS LIST WAS CHOSEN
//
// Mostly from evidence rather than imagination: every topic below either appears
// in items already in the database, or is an Andhra Pradesh master topic that
// the exam asks about repeatedly and which is therefore certain to appear. Those
// second ones are seeded deliberately *before* any item mentions them, because
// the entire value of this layer is that there is somewhere for the next item to
// land. A topic table that only contains what has already happened is a log, not
// a knowledge map.
//
// ALIASES ARE THE LOAD-BEARING PART
//
// A paper writes "APCRDA", "CRDA" and "Capital Region Development Authority" for
// one body across three paragraphs. A topic that knows only its own formal name
// matches none of them, so the aliases are what make this work at all.
//
// `strict: true` marks an alias short enough to collide with ordinary words or
// with other acronyms. Those are matched case-sensitively and on word
// boundaries. 'HAM' is the clearest example: lowercased and loose it would match
// inside dozens of words, so it is only ever matched as printed.
//
// tier: 1 = asked repeatedly and across papers, 2 = asked, 3 = peripheral.

const TOPICS = [
  // ---- Andhra Pradesh: the master topics ---------------------------------
  {
    slug: 'polavaram', name: 'Polavaram Irrigation Project', kind: 'project',
    ap: 1, tier: 1,
    summary: 'National project on the Godavari; irrigation, displacement and rehabilitation, ' +
      'inter-State objections, and a recurring test of Centre-State obligations under bifurcation.',
    aliases: ['Polavaram', 'Polavaram project', 'Polavaram Irrigation Project', 'Indira Sagar Polavaram'],
  },
  {
    slug: 'amaravati', name: 'Amaravati Capital Region', kind: 'project',
    ap: 1, tier: 1,
    summary: 'The capital city project: land pooling, phased construction, financing, and the ' +
      'question of one capital versus three.',
    aliases: ['Amaravati', 'capital region', 'Amaravati capital', 'Seed Access Road'],
  },
  {
    slug: 'apcrda', name: 'AP Capital Region Development Authority (APCRDA)', kind: 'institution',
    ap: 1, tier: 1,
    summary: 'The statutory authority for the capital region; land pooling, returnable plots, ' +
      'and master planning.',
    aliases: [
      { alias: 'APCRDA', strict: true }, { alias: 'CRDA', strict: true },
      'Capital Region Development Authority', 'land pooling', 'returnable plot', 'Undavalli',
    ],
  },
  {
    slug: 'ap-bifurcation', name: 'AP Reorganisation Act, 2014', kind: 'law',
    ap: 1, tier: 1,
    summary: 'The bifurcation settlement: assurances, special category status, Schedule IX and X ' +
      'institutions, and the unfinished obligations that recur across Papers II, III and IV.',
    aliases: [
      'AP Reorganisation Act', 'Andhra Pradesh Reorganisation Act', 'bifurcation',
      'Reorganisation Act, 2014', 'special category status',
      { alias: 'SCS', strict: true },
    ],
  },
  {
    slug: 'ap-panchayati-raj', name: 'AP Panchayati Raj and local bodies', kind: 'law',
    ap: 1, tier: 1,
    summary: 'Three-tier local government in AP: MPPs and ZPPs, office-bearer structure, ' +
      'reservation, direct versus indirect election of mayors, and 73rd/74th Amendment questions.',
    aliases: [
      'Panchayat Raj', 'Panchayati Raj', 'Mandal Parishad', 'Zilla Parishad',
      'local body election', 'local bodies', 'municipal corporation', 'mayor',
      { alias: 'MPP', strict: true }, { alias: 'ZPP', strict: true },
      { alias: 'MPTC', strict: true }, { alias: 'ZPTC', strict: true },
    ],
  },
  {
    slug: 'ttd-tirumala', name: 'Tirumala Tirupati Devasthanams (TTD)', kind: 'institution',
    ap: 1, tier: 2,
    summary: 'Governance of the temple trust: endowments law, forest and wildlife interface on ' +
      'the hills, crowd management, and the Act under which it operates.',
    aliases: [
      { alias: 'TTD', strict: true }, 'Tirumala Tirupati Devasthanam', 'Tirumala',
      'Brahmotsavam', 'Alipiri', 'Srivari',
      // NOT 'Tirupati': it is a city and a district, so it appears in items about
      // Sriharikota and about municipal land norms that have nothing to do with
      // the trust. Verified as a false-positive source on real items.
    ],
  },
  {
    slug: 'vizag-economic-region', name: 'Visakhapatnam Economic Region', kind: 'project',
    ap: 1, tier: 2,
    summary: 'Industrial and port-led development around Visakhapatnam, including the ' +
      'Visakhapatnam-Chennai Industrial Corridor and investment targets.',
    aliases: [
      'Visakhapatnam Economic Region', 'Visakhapatnam-Chennai Industrial Corridor',
      { alias: 'VER', strict: true }, { alias: 'VCIC', strict: true }, 'Vizag',
    ],
  },
  {
    slug: 'ap-industrial-parks', name: 'AP industrial parks and BHAVYA', kind: 'scheme',
    ap: 1, tier: 2,
    summary: 'Sector-specific industrial parks proposed under the Centre\'s Bharat Audyogik Vikas ' +
      'Yojana; industrial policy, land and cluster development.',
    aliases: [
      { alias: 'BHAVYA', strict: true }, 'Bharat Audyogik Vikas Yojana',
      'industrial park', 'industrial corridor',
    ],
  },
  {
    slug: 'ap-higher-education', name: 'AP higher education regulation', kind: 'law',
    ap: 1, tier: 2,
    summary: 'The regulatory and monitoring commission, private and skill universities, fee ' +
      'regulation and faculty recruitment.',
    aliases: [
      'Higher Education Regulatory and Monitoring Commission', 'higher education Bill',
      'private university', 'skill university', { alias: 'APSCHE', strict: true },
      'Vishnu Women', 'Higher Education Commissioner',
    ],
  },
  {
    slug: 'ap-school-education', name: 'AP school education, RTE and KGBV', kind: 'scheme',
    ap: 1, tier: 2,
    summary: 'Right to Education implementation in AP, residential schooling for girls, ' +
      'teacher recruitment and the DSC.',
    aliases: [
      { alias: 'KGBV', strict: true }, 'Kasturba Gandhi Balika Vidyalaya',
      'Right to Education', { alias: 'RTE', strict: true }, { alias: 'DSC', strict: true },
      { alias: 'TET', strict: true },
    ],
  },
  {
    slug: 'ap-urban-infrastructure', name: 'AP urban infrastructure and ULBs', kind: 'project',
    ap: 1, tier: 2,
    summary: 'Urban local body infrastructure financing, including the Hybrid Annuity Model, ' +
      'and municipal service delivery.',
    aliases: [
      'urban local bod', { alias: 'ULB', strict: true }, 'Hybrid Annuity Model',
      { alias: 'HAM', strict: true }, 'urban infrastructure',
    ],
  },
  {
    slug: 'krishna-godavari-waters', name: 'Krishna and Godavari river disputes', kind: 'concept',
    ap: 1, tier: 1,
    summary: 'Inter-State river water sharing involving AP, Telangana and Karnataka: tribunal ' +
      'awards, board jurisdiction, and the federal machinery for resolving them.',
    aliases: [
      'Krishna water', 'Godavari water', 'Krishna River Management Board',
      'Godavari River Management Board', 'inter-State river', 'water dispute',
      { alias: 'KRMB', strict: true }, { alias: 'GRMB', strict: true },
      'Srisailam', 'Nagarjuna Sagar', 'Banakacherla',
    ],
  },
  {
    slug: 'ap-ports-airports', name: 'AP ports and airports', kind: 'project',
    ap: 1, tier: 2,
    summary: 'Port-led growth and greenfield airports: Bhogapuram, Ramayapatnam, Machilipatnam, ' +
      'Krishnapatnam and Gangavaram.',
    aliases: ['Bhogapuram', 'Ramayapatnam', 'Krishnapatnam', 'Gangavaram', 'Machilipatnam port', 'Sagarmala'],
  },
  {
    slug: 'ap-agriculture', name: 'AP agriculture and natural farming', kind: 'scheme',
    ap: 1, tier: 2,
    summary: 'Community-managed natural farming, fertiliser and input supply, MSP procurement ' +
      'and Rythu Bharosa support.',
    aliases: [
      { alias: 'APCNF', strict: true }, 'natural farming', 'Rythu Bharosa',
      'fertiliser stock', 'fertilizer stock', 'Rythu Seva',
    ],
  },
  {
    slug: 'appsc', name: 'APPSC and State recruitment', kind: 'institution',
    ap: 1, tier: 3,
    summary: 'The State public service commission, recruitment notifications, and the ' +
      'constitutional position of public service commissions under Article 315.',
    aliases: [{ alias: 'APPSC', strict: true }, 'Public Service Commission', 'Group-I', 'mega DSC'],
  },

  // ---- national: institutions -------------------------------------------
  {
    slug: 'rbi-monetary-policy', name: 'RBI and monetary policy', kind: 'institution',
    ap: 0, tier: 1,
    summary: 'Repo rate and the monetary policy committee, inflation targeting, and the RBI\'s ' +
      'statutory mandate.',
    aliases: [
      { alias: 'RBI', strict: true }, 'Reserve Bank of India', 'repo rate',
      'monetary policy committee', { alias: 'MPC', strict: true }, 'inflation targeting',
    ],
  },
  {
    slug: 'supreme-court', name: 'Supreme Court and judicial review', kind: 'institution',
    ap: 0, tier: 1,
    summary: 'Constitutional adjudication: judicial review, PIL, benches and appointments, and ' +
      'the Court\'s role in federal and rights questions.',
    aliases: [
      'Supreme Court', { alias: 'SC bench', strict: false }, 'Chief Justice of India',
      'constitution bench', { alias: 'CJI', strict: true }, 'judicial review',
    ],
  },
  {
    slug: 'high-courts', name: 'High Courts and judicial infrastructure', kind: 'institution',
    ap: 0, tier: 2,
    summary: 'High Court jurisdiction, new benches, pendency and the machinery of judicial ' +
      'appointments.',
    aliases: ['High Court', 'High Court Bench', 'Article 214', 'Article 226'],
  },
  {
    slug: 'isro', name: 'ISRO and the space programme', kind: 'institution',
    ap: 0, tier: 2,
    summary: 'Launch vehicles and missions, Sriharikota, and the opening of the space sector to ' +
      'private participation.',
    aliases: [
      { alias: 'ISRO', strict: true }, 'Sriharikota', { alias: 'GSLV', strict: true },
      { alias: 'PSLV', strict: true }, { alias: 'GISAT', strict: true }, 'Gaganyaan',
      { alias: 'IN-SPACe', strict: true },
    ],
  },
  {
    slug: 'finance-commission', name: 'Finance Commission and fiscal federalism', kind: 'body',
    ap: 0, tier: 1,
    summary: 'Tax devolution, grants-in-aid and the horizontal formula; the recurring vehicle for ' +
      'every fiscal-federalism question, and where AP\'s claims are pressed.',
    aliases: [
      'Finance Commission', 'tax devolution', 'grants-in-aid', 'Article 280',
      'fiscal federalism', 'vertical devolution', 'horizontal devolution',
    ],
  },
  {
    slug: 'inter-state-council', name: 'Inter-State Council and zonal councils', kind: 'body',
    ap: 0, tier: 2,
    summary: 'Article 263 machinery for Centre-State and State-State coordination, including the ' +
      'zonal councils.',
    aliases: ['Inter-State Council', 'Zonal Council', 'Southern Zonal Council', 'Article 263'],
  },
  {
    slug: 'irdai', name: 'IRDAI and insurance regulation', kind: 'institution',
    ap: 0, tier: 3,
    summary: 'Insurance regulation and enforcement: expense limits, policyholder protection and ' +
      'the regulator\'s statutory powers.',
    aliases: [{ alias: 'IRDAI', strict: true }, 'Insurance Regulatory and Development Authority'],
  },
  {
    slug: 'cbse-school-policy', name: 'CBSE and national school policy', kind: 'institution',
    ap: 0, tier: 3,
    summary: 'Central school board policy, the three-language formula and NEP implementation.',
    aliases: [{ alias: 'CBSE', strict: true }, 'three-language', 'three language', 'National Education Policy', { alias: 'NEP', strict: true }],
  },

  // ---- national: laws and schemes ---------------------------------------
  {
    slug: 'caa-citizenship', name: 'Citizenship Amendment Act and citizenship law', kind: 'law',
    ap: 0, tier: 1,
    summary: 'Citizenship by naturalisation and registration, the 2019 amendment, and the ' +
      'administrative machinery for processing applications.',
    aliases: [
      { alias: 'CAA', strict: true }, 'Citizenship Amendment Act', 'Citizenship Act',
      'citizenship application', 'naturalisation',
    ],
  },
  {
    slug: 'labour-codes', name: 'Labour codes and industrial relations', kind: 'law',
    ap: 0, tier: 1,
    summary: 'The four labour codes, the meaning of "industry", industrial disputes machinery and ' +
      'the shift from the 1947 Act.',
    aliases: [
      'Industrial Relations Code', 'labour code', 'Industrial Disputes Act',
      'definition of industry', 'Bangalore Water Supply',
    ],
  },
  {
    slug: 'mmdr-mining', name: 'MMDR Act and mineral governance', kind: 'law',
    ap: 0, tier: 2,
    summary: 'Mines and Minerals (Development and Regulation) Act: auctions, royalty, district ' +
      'mineral foundations and the States\' taxing power over minerals.',
    aliases: [
      { alias: 'MMDR', strict: true }, 'Mines and Minerals', 'mineral royalty',
      'District Mineral Foundation', { alias: 'DMF', strict: true }, 'mining lease',
    ],
  },
  {
    slug: 'namaste-sanitation', name: 'NAMASTE and sanitation workers', kind: 'scheme',
    ap: 0, tier: 2,
    summary: 'Mechanised sanitation and the rehabilitation of sanitation workers; manual ' +
      'scavenging prohibition and the dignity-of-labour argument.',
    aliases: [
      { alias: 'NAMASTE', strict: true }, 'manual scavenging', 'sanitation worker',
      'mechanised sanitation', { alias: 'NCSK', strict: true },
    ],
  },
  {
    slug: 'gobardhan-biogas', name: 'GOBARdhan and compressed biogas', kind: 'scheme',
    ap: 0, tier: 3,
    summary: 'Compressed biogas from agricultural and organic waste; energy security and the ' +
      'waste-to-wealth argument.',
    aliases: [{ alias: 'GOBARdhan', strict: false }, 'compressed biogas', { alias: 'CBG', strict: true }],
  },
  {
    slug: 'niif-infrastructure-finance', name: 'NIIF and infrastructure financing', kind: 'institution',
    ap: 0, tier: 3,
    summary: 'The National Investment and Infrastructure Fund and the wider question of how ' +
      'long-gestation infrastructure is financed.',
    aliases: [{ alias: 'NIIF', strict: true }, 'National Investment and Infrastructure Fund'],
  },
  {
    slug: 'railways-infrastructure', name: 'Railways and multimodal transport', kind: 'project',
    ap: 0, tier: 2,
    summary: 'Rail capacity works, multitracking, dedicated freight corridors and the shift of ' +
      'freight to rail; added after the linker reported a Cabinet rail-multitracking item that ' +
      'matched no seeded topic.',
    aliases: [
      'multitracking', 'multi-tracking', 'railway line', 'Indian Railways',
      'dedicated freight corridor', { alias: 'DFC', strict: true }, 'Vande Bharat',
      'railway project', 'rail project', 'doubling',
    ],
  },
  {
    slug: 'national-highways', name: 'National Highways and land use', kind: 'project',
    ap: 0, tier: 3,
    summary: 'Highway development, construction restrictions along alignments, and the balance ' +
      'between infrastructure and local land use.',
    aliases: ['National Highway', { alias: 'NHAI', strict: true }, 'Bharatmala'],
  },
  {
    slug: 'core-sector-data', name: 'Core sector and industrial output data', kind: 'report',
    ap: 0, tier: 2,
    summary: 'Index of eight core industries and IIP: the official series by which industrial ' +
      'momentum is read.',
    aliases: ['core sector', 'eight core industries', { alias: 'IIP', strict: true }, 'index of industrial production'],
  },
  {
    slug: 'trade-remedies-tariffs', name: 'Tariffs, quotas and trade remedies', kind: 'concept',
    ap: 0, tier: 3,
    summary: 'Tariff rate quotas, duty-free imports and the use of trade instruments to manage ' +
      'domestic supply and prices.',
    aliases: ['Tariff Rate Quota', { alias: 'TRQ', strict: true }, 'duty-free import', 'import duty'],
  },
  {
    slug: 'neet-exam-integrity', name: 'NEET and examination integrity', kind: 'event',
    ap: 0, tier: 3,
    summary: 'Entrance examination integrity, the National Testing Agency, and equality of ' +
      'opportunity in access to professional education.',
    aliases: [{ alias: 'NEET', strict: true }, { alias: 'NTA', strict: true }, 'National Testing Agency'],
  },
  {
    slug: 'public-service-commissions', name: 'Public service commissions and recruitment law', kind: 'institution',
    ap: 0, tier: 3,
    summary: 'Constitutional position of public service commissions, recruitment irregularities ' +
      'and judicial intervention in appointments.',
    aliases: [{ alias: 'JPSC', strict: true }, { alias: 'UPSC', strict: true }, 'Article 315', 'Article 320'],
  },

  // ---- international -----------------------------------------------------
  {
    slug: 'india-eu-relations', name: 'India-EU relations and the FTA', kind: 'event',
    ap: 0, tier: 2,
    summary: 'The free trade agreement and the wider security and connectivity partnership.',
    aliases: ['India-EU', 'India–EU', 'EU-India', 'EU–India', 'Free Trade Agreement', { alias: 'FTA', strict: true }],
  },
  {
    slug: 'india-japan-relations', name: 'India-Japan relations', kind: 'event',
    ap: 0, tier: 2,
    summary: 'Defence and maritime security cooperation, and Japanese participation in Indian ' +
      'infrastructure.',
    // 'maritime security' deliberately omitted: it is a policy concept rather
    // than a bilateral relationship, and it matched the India-EU security
    // arrangement on a real item.
    aliases: ['India-Japan', 'India–Japan', 'Japan'],
  },
  {
    slug: 'indian-ocean-energy-diplomacy', name: 'Energy diplomacy in the Indian Ocean', kind: 'concept',
    ap: 0, tier: 3,
    summary: 'Petroleum supply arrangements and India\'s role as an energy partner to Indian ' +
      'Ocean neighbours.',
    aliases: ['Mauritius', 'IndianOil', 'Indian Oil Corporation', { alias: 'ATF', strict: true }],
  },

  // ---- cross-cutting concepts -------------------------------------------
  {
    slug: 'reservation-social-justice', name: 'Reservation and social justice', kind: 'concept',
    ap: 0, tier: 1,
    summary: 'Reservation in education, employment and local bodies; the backward classes ' +
      'question and the constitutional limits on quotas.',
    aliases: [
      'reservation', 'Backward Classes', { alias: 'BC reservation', strict: false },
      { alias: 'OBC', strict: true }, { alias: 'SC/ST', strict: true }, 'social justice',
    ],
  },
  {
    slug: 'environment-clearance', name: 'Environmental clearance and green jurisprudence', kind: 'concept',
    ap: 0, tier: 1,
    summary: 'Environmental impact assessment, post-facto clearance, the NGT and the courts\' ' +
      'development-versus-environment balancing.',
    aliases: [
      'environmental clearance', 'Vanashakti', { alias: 'NGT', strict: true },
      'National Green Tribunal', 'environmental impact assessment', { alias: 'EIA', strict: true },
      'post-facto',
    ],
  },
  {
    slug: 'air-pollution', name: 'Air pollution and urban environmental health', kind: 'concept',
    ap: 0, tier: 2,
    summary: 'Ambient air quality, monitoring and the CPCB framework; industrial and vehicular ' +
      'emissions in cities.',
    aliases: ['air pollution', 'air quality', { alias: 'CPCB', strict: true }, { alias: 'AQI', strict: true }, 'particulate matter'],
  },
  {
    slug: 'free-speech-religious-offence', name: 'Free speech and religious-offence law', kind: 'concept',
    ap: 0, tier: 2,
    summary: 'Section 295A and cognate provisions, reasonable restrictions under Article 19(2), ' +
      'and the effect of offence law on social reform.',
    aliases: ['295A', 'blasphemy', 'religious offence', 'Article 19', 'free speech', 'hate speech'],
  },
  {
    slug: 'wildlife-forest-governance', name: 'Wildlife and forest governance', kind: 'concept',
    ap: 0, tier: 2,
    summary: 'Protected area management, human-wildlife interface, and the use of technology in ' +
      'forest surveillance.',
    aliases: ['wildlife', 'forest department', 'Wildlife Protection Act', 'tiger reserve', 'eco-sensitive'],
  },
];

// Curated relations. Only the ones item overlap cannot express.
const LINKS = [
  ['polavaram', 'ap-bifurcation', 'parent'],
  ['polavaram', 'krishna-godavari-waters', 'related'],
  ['polavaram', 'environment-clearance', 'related'],
  ['amaravati', 'apcrda', 'related'],
  ['apcrda', 'ap-urban-infrastructure', 'related'],
  ['ap-panchayati-raj', 'reservation-social-justice', 'related'],
  ['ap-panchayati-raj', 'ap-urban-infrastructure', 'related'],
  ['krishna-godavari-waters', 'inter-state-council', 'related'],
  ['krishna-godavari-waters', 'ap-bifurcation', 'parent'],
  ['ap-bifurcation', 'finance-commission', 'related'],
  ['ttd-tirumala', 'wildlife-forest-governance', 'related'],
  ['vizag-economic-region', 'ap-ports-airports', 'related'],
  ['ap-industrial-parks', 'vizag-economic-region', 'related'],
  ['ap-higher-education', 'ap-school-education', 'related'],
  ['labour-codes', 'supreme-court', 'related'],
  ['caa-citizenship', 'supreme-court', 'related'],
  ['environment-clearance', 'national-highways', 'related'],
  ['air-pollution', 'environment-clearance', 'related'],
  ['appsc', 'public-service-commissions', 'parent'],
  ['high-courts', 'supreme-court', 'parent'],
];

module.exports = { TOPICS, LINKS };
