'use strict';

// The source registry.
//
// Every entry here was probed and confirmed to return items. Feeds that 404 or
// return an empty channel are recorded in DEAD below rather than deleted,
// because the next person to wonder "why isn't Deccan Herald in here" deserves
// an answer other than silence.
//
// Two kinds:
//   'pib-index'  the PIB release listing, parsed out of HTML
//   'rss'        a standard RSS 2.0 channel
//
// Flags that change how an item is treated downstream:
//   primary   an official source — the government saying what it did, not a
//             paper's account of it. Weighted heavily in the review queue.
//   ap        the feed is Andhra Pradesh-focused, so every item from it is
//             AP-relevant regardless of what the headline says.
//   opinion   editorials and analysis. These are the *quotation* source. The Q
//             bank lags almost universally because nothing in a news cycle
//             hands you a quotable line unless you are looking for one, and an
//             editorial is where the lines are.

const SOURCES = [
  // ---- Official / primary -------------------------------------------------
  {
    id: 'pib',
    name: 'PIB',
    kind: 'pib-index',
    url: 'https://www.pib.gov.in/allrelease.aspx?reg=3&lang=1',
    primary: true,
    note: 'Cabinet decisions, scheme launches, official figures. The single most valuable source.',
  },

  // ---- National news ------------------------------------------------------
  {
    id: 'hindu-national',
    name: 'The Hindu — National',
    kind: 'rss',
    url: 'https://www.thehindu.com/news/national/feeder/default.rss',
  },
  {
    id: 'ie-india',
    name: 'Indian Express — India',
    kind: 'rss',
    url: 'https://indianexpress.com/section/india/feed/',
  },
  {
    // Explained pieces are written to answer "why does this matter", which is
    // the same question THE ANGLE asks. Disproportionately useful per item.
    id: 'ie-explained',
    name: 'Indian Express — Explained',
    kind: 'rss',
    url: 'https://indianexpress.com/section/explained/feed/',
    note: 'Highest signal-to-noise feed here for Group-I angles.',
  },
  {
    id: 'toi-india',
    name: 'Times of India — India',
    kind: 'rss',
    url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
  },
  {
    id: 'toi-top',
    name: 'Times of India — Top stories',
    kind: 'rss',
    url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
  },

  // ---- Economy ------------------------------------------------------------
  {
    id: 'hindu-economy',
    name: 'The Hindu — Economy',
    kind: 'rss',
    url: 'https://www.thehindu.com/business/economy/feeder/default.rss',
  },
  {
    id: 'hindu-business',
    name: 'The Hindu — Business',
    kind: 'rss',
    url: 'https://www.thehindu.com/business/feeder/default.rss',
  },
  {
    id: 'bl-economy',
    name: 'BusinessLine — Economy',
    kind: 'rss',
    url: 'https://www.thehindubusinessline.com/economy/feeder/default.rss',
  },
  {
    id: 'ie-economy',
    name: 'Indian Express — Economy',
    kind: 'rss',
    url: 'https://indianexpress.com/section/business/economy/feed/',
  },

  // ---- Science, technology, environment -----------------------------------
  {
    id: 'hindu-scitech',
    name: 'The Hindu — Science & Technology',
    kind: 'rss',
    url: 'https://www.thehindu.com/sci-tech/feeder/default.rss',
  },
  {
    id: 'hindu-environment',
    name: 'The Hindu — Energy & Environment',
    kind: 'rss',
    url: 'https://www.thehindu.com/sci-tech/energy-and-environment/feeder/default.rss',
  },
  {
    id: 'toi-science',
    name: 'Times of India — Science',
    kind: 'rss',
    url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128672765.cms',
  },

  // ---- Opinion — the quotation source -------------------------------------
  {
    id: 'hindu-editorial',
    name: 'The Hindu — Editorial',
    kind: 'rss',
    url: 'https://www.thehindu.com/opinion/editorial/feeder/default.rss',
    opinion: true,
    note: 'Where quotable lines live. The Q bank lags without a source like this.',
  },

  // ---- Andhra Pradesh -----------------------------------------------------
  // AP is roughly half of Papers II and IV, a fifth of Paper V, and present in
  // every Paper I essay — and no national source covers it at the depth this
  // exam demands. Hence four dedicated feeds rather than relying on AP stories
  // surfacing in the national ones.
  {
    id: 'hindu-ap',
    name: 'The Hindu — Andhra Pradesh',
    kind: 'rss',
    url: 'https://www.thehindu.com/news/national/andhra-pradesh/feeder/default.rss',
    ap: true,
  },
  {
    id: 'hindu-vizag',
    name: 'The Hindu — Visakhapatnam',
    kind: 'rss',
    url: 'https://www.thehindu.com/news/cities/Visakhapatnam/feeder/default.rss',
    ap: true,
  },
  {
    id: 'hindu-vijayawada',
    name: 'The Hindu — Vijayawada',
    kind: 'rss',
    url: 'https://www.thehindu.com/news/cities/Vijayawada/feeder/default.rss',
    ap: true,
  },
  {
    id: 'hans-ap',
    name: 'The Hans India — Andhra Pradesh',
    kind: 'rss',
    url: 'https://www.thehansindia.com/rss/andhra-pradesh',
    ap: true,
  },
  {
    id: 'sakshi',
    name: 'Sakshi',
    kind: 'rss',
    url: 'https://www.sakshi.com/rss.xml',
    ap: true,
    note: 'Telugu daily. Small feed, but state coverage the English press skips.',
  },
  {
    // Telangana rather than AP, but the two states share water disputes,
    // bifurcation questions and a labour market, and Hyderabad datelines carry
    // AP stories often enough to be worth reading.
    id: 'ie-hyderabad',
    name: 'Indian Express — Hyderabad',
    kind: 'rss',
    url: 'https://indianexpress.com/section/cities/hyderabad/feed/',
  },
  {
    id: 'hindu-telangana',
    name: 'The Hindu — Telangana',
    kind: 'rss',
    url: 'https://www.thehindu.com/news/national/telangana/feeder/default.rss',
  },
];

// Probed and found not to work. Kept so nobody re-derives this.
const DEAD = [
  { url: 'https://prsindia.org/rss.xml', why: '404. No feed found; PRS needs the manual route.' },
  { url: 'https://www.downtoearth.org.in/rss/*', why: '404 on every variant tried.' },
  { url: 'https://www.deccanherald.com/rss/*', why: '404 / 500 on every variant tried.' },
  { url: 'https://www.newindianexpress.com/*andhra-pradesh*', why: '404, including the feedburner mirror.' },
  { url: 'https://www.deccanchronicle.com/rss/andhra-pradesh.xml', why: '404.' },
  { url: 'https://www.eenadu.net/rss/andhra-pradesh', why: '200 but an empty channel.' },
  { url: 'https://www.isro.gov.in/rss*', why: '404. ISRO needs the manual route.' },
  {
    url: 'https://rbidocs.rbi.org.in/**',
    why: 'CAPTCHA-gated to automated clients. Open RBI documents in a browser — do not try to work around it.',
  },
];

// Headline patterns that are never examinable. A deterministic pre-filter, run
// before the model sees anything, purely to keep the shortlist prompt small and
// cheap — around 1,400 items arrive across these feeds and most of a general
// news feed is sport, entertainment and crime blotter.
//
// Deliberately conservative. Passing junk to the shortlist costs a few tokens;
// dropping a real item costs an item, so anything ambiguous is left in.
const NOISE = [
  /\b(vs\.?|beat|beats|thrash|innings|wicket|wickets|goal|goals|century|half-century)\b/i,
  /\b(IPL|ODI|T20|Test match|Ranji|Premier League|La Liga|Grand Slam|Olympics medal tally)\b/i,
  /\b(box office|trailer|teaser|first look|movie review|film review|web series|OTT release)\b/i,
  /\b(horoscope|zodiac|numerology|rashi|panchang)\b/i,
  /\b(recipe|skincare|weight loss|beauty tips|fashion)\b/i,
  /\b(obituary|passes away|condoles|condolence|mourns|tributes paid)\b/i,
  /\b(birthday|anniversary greetings|wishes on)\b/i,
  /^\s*(text of|full text of)\b/i,
  /\b(interacts with|felicitat|inaugurates the exhibition|addresses the gathering)\b/i,
  // PIB posts several of these a day. They are devotional or ceremonial and
  // carry no fact, figure or instrument, so they are pure shortlist noise.
  /\b(subhashitam|shares.*quote|greets the nation|extends greetings|conveys greetings)\b/i,
  /\b(pays homage|pays tribute|garlands|floral tributes|remembers)\b/i,
  /\b(monthly summary|daily bulletin|media advisory|press conference schedule)\b/i,
  // Local crime and accident reporting. Occasionally a case becomes a legal
  // landmark, but at that point the story is a judgment and reads differently —
  // it will come through the courts coverage rather than the blotter.
  /\b(found dead|murder case|arrested for|held for|booked for|robbery|chain snatch)\b/i,
  /\b(road accident|dies in|killed in|injured in|drowned|electrocuted)\b/i,
  /\b(gold rate|silver rate|petrol price today|share to buy|stocks to watch|multibagger)\b/i,
  /\b(viral video|watch:|photos:|in pics|pics:)/i,
];

function isNoise(headline) {
  return NOISE.some((re) => re.test(headline));
}

module.exports = { SOURCES, DEAD, NOISE, isNoise };
