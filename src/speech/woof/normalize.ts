// Derived from Underdog Woof by Conway: Underdog Non-Commercial License 1.0. See LICENSE and README.md in this folder.
/** Underdog Woof's English text front end, ported rule for rule from normalize.py: numbers, dates, times, money, codes
 * and symbols are rewritten the way people read them aloud, since the model only reads letters well. NeMo is optional in
 * the reference and is not used here, so whatever digits remain go through the same light fallback verbalizer. */
import { capitalize, escape, findall, fullmatch, isAlpha, isDigit, isLower, isUpper, match, type Match, search, split, sub, words } from "./pyre";

type Groups = Array<string | undefined>;
const int = (text: string | undefined) => parseInt(text ?? "", 10);
const g = (m: Match, n: number) => m.group(n) ?? "";
const before = (m: Match) => m.string.slice(0, m.start());
const after = (m: Match) => m.string.slice(m.end());

const DIG = "zero one two three four five six seven eight nine".split(" ");

function digits(s: string) {
  return [...s].filter((c) => isDigit(c)).map((c) => DIG[int(c)]).join(" ");
}

function spell(s: string) {
  const out: string[] = [];
  for (const c of s) {
    if (isDigit(c)) out.push(DIG[int(c)]);
    else if (isAlpha(c)) out.push(c.toUpperCase());
  }
  return out.join(" ");
}

/** All-caps chunk that reads as a word (SAVE, WINTER, PROMO) rather than letters (ORD, XT, CS). */
function pronounceable(word: string) {
  const w = word.toLowerCase();
  if (w.length < 4 || !search("[aeiouy]", w)) return false;
  if (search("[^aeiouy]{3,}", w) && !search("(str|sch|thr|chr|spr|scr|ght|nds|nts)", w)) return false;
  return Boolean(fullmatch("(?:[^aeiouy]{0,3}[aeiouy]{1,2})+[^aeiouy]{0,3}", w));
}

function codeRead(s: string) {
  const out: string[] = [];
  for (const p of split("[-/]", s)) {
    if (!p) continue;
    if (isDigit(p)) out.push(p.length <= 2 && p[0] !== "0" ? p : digits(p));
    else if (isAlpha(p) && isLower(p) && p.length > 3 && pronounceable(p)) out.push(p);
    else if (isAlpha(p) && pronounceable(p)) out.push(capitalize(p));
    else out.push(spell(p));
  }
  return out.join(" ");
}

/** Identifier digits as people say room, flight and house numbers: 402 -> four oh two, 1600 -> sixteen hundred. */
function nread(s: string) {
  const n = int(s);
  if ((s[0] === "0" && s.length > 1) || s.length > 4) return digits(s);
  if (n < 100 || (n % 100 === 0 && s.length === 3) || n % 1000 === 0) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  return cardinal(hi) + (lo === 0 ? " hundred" : lo < 10 ? " oh " + ONES[lo] : " " + cardinal(lo));
}

/** getUserName -> get user name, user_id -> user id, OpenAI -> Open A I. */
function splitIdent(s: string) {
  const spaced = sub("(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", s.replaceAll("_", " "));
  return words(spaced).map((w) => (isUpper(w) && w.length <= 4 ? spell(w) : w)).join(" ");
}

const ROMAN_RE = "(?=[MDCLXVI]+\\b)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";
const ROMAN_CARD = new Set(`chapter chap ch part pt book volume vol act scene section sec phase stage level episode season article
    title class type grade war bowl apollo mark mk vatican rocky fantasy wars trek civilization gemini saturn soyuz annex
    appendix figure fig table plate tier round schedule unit division category series olympiad psalm
    canto lesson module form`.split(/\s+/).filter(Boolean));
for (const w of [...ROMAN_CARD]) ROMAN_CARD.add(w + "s");
ROMAN_CARD.add("through");
ROMAN_CARD.add("thru");
const ROMAN_LABEL = new Set("appendix annex table figure fig plate schedule unit category class type grade tier section form division series".split(" "));
const ROMAN_STOP = new Set("the a an in on of and for to at by from with my our his her their this that its".split(" "));
const REGNAL = new Set(`Henry Louis Elizabeth George Edward Richard Charles James William John Paul Benedict Pius Leo Gregory
    Innocent Clement Boniface Urban Alexander Peter Ivan Nicholas Frederick Wilhelm Ludwig Philip Felipe Carlos Gustav
    Gustaf Christian Olaf Haakon Harald Ramesses Ramses Thutmose Amenhotep Ptolemy Darius Xerxes Cyrus Constantine
    Justinian Mehmed Suleiman Selim Murad Napoleon Umberto Mary Anne Victoria Catherine Isabella Margaret Rama Abdullah
    Robert David Kenneth Duncan Alfonso Ferdinand Sancho Manuel Sebastian Stephen Matthias Sigismund Casimir Otto Conrad
    Rudolf Maximilian Leopold Joseph Francis Franz Karl Hugh Baldwin Basil Michael Theodore Edmund Harold Magnus Eric
    Erik Valdemar Frederik Albert Baudouin Philippe Rainier Hassan Faisal Fuad Pedro Afonso Jaime Sixtus Julius Adrian
    Hadrian Celestine Honorius Lothair Pepin Antiochus Seleucus Herod Cleopatra Wenceslaus Kamehameha Tewodros Menelik
    Nebuchadnezzar Shalmaneser Sargon Tiglath Artaxerxes Andronikos Romanos Leon Mohammed Muhammad Charlemagne`.split(/\s+/).filter(Boolean));
const TITLES = new Set(("King Queen Pope Emperor Empress Tsar Czar Tsarina Kaiser Pharaoh Sultan Shah Prince Princess Duke Duchess " +
  "Count Countess Lord Lady Saint St Archduke Elector Emir Caliph Khan King's Queen's").split(" "));

function roman(s: string) {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) total += s[i + 1] && v[s[i + 1]] > v[s[i]] ? -v[s[i]] : v[s[i]];
  return total;
}

function romanSub(m: Match) {
  const prev = g(m, 1);
  const num = g(m, 3);
  if (!num) return g(m, 0);
  const prior = words(before(m));
  const last = prior[prior.length - 1];
  const prev2 = last && !search("[.,;:!?)\"]$", last) ? last : "";
  const key = prev.toLowerCase().replace(/\.+$/, "");
  const n = roman(num);
  const title = (w: string) => Boolean(fullmatch("[A-Z][a-z]+", w));
  if (["through", "thru", "to", "and", "or"].includes(key) && !search("\\b(?:" + [...ROMAN_CARD].join("|") + ")\\s+\\S+\\s+$", before(m), "i")) {
    return g(m, 0);
  }
  if (ROMAN_CARD.has(key) && (num.length > 1 || (num === "I" && isUpper(prev.slice(0, 1))) || ("VX".includes(num) && !ROMAN_LABEL.has(key)))) {
    return `${prev}${g(m, 2)}${cardinal(n)}`;
  }
  if (!fullmatch("[IVXL]+", num)) return g(m, 0);
  if (REGNAL.has(prev) || (TITLES.has(prev2) && title(prev) && num !== "I")) return `${prev}${g(m, 2)}the ${ordinal(n)}`;
  if (num.length > 1 && title(prev) && !fullmatch("[IVXL]*L[IVXL]*", num)) {
    // John Smith III -> the third; Frozen II, Rocky IV -> two, four
    const full = title(prev2) && !ROMAN_STOP.has(prev2.toLowerCase());
    return `${prev}${g(m, 2)}` + (full ? `the ${ordinal(n)}` : cardinal(n));
  }
  return g(m, 0);
}

const CURCODE: Record<string, string> = {
  USD: "$", "US$": "$", EUR: "€", GBP: "£", JPY: "yen", "¥": "yen", CNY: "yuan", RMB: "yuan",
  INR: "rupees", "₹": "rupees", "Rs.": "rupees", Rs: "rupees", CAD: "Canadian dollars", C$: "Canadian dollars",
  AUD: "Australian dollars", A$: "Australian dollars", NZD: "New Zealand dollars", CHF: "Swiss francs",
  HKD: "Hong Kong dollars", HK$: "Hong Kong dollars", SGD: "Singapore dollars", KRW: "won", "₩": "won",
  MXN: "pesos", BRL: "reais", R$: "reais", RUB: "rubles", "₽": "rubles", SEK: "Swedish kronor",
  NOK: "Norwegian kroner", DKK: "Danish kroner", ZAR: "rand", "₦": "naira", NGN: "naira", "₺": "lira",
  "₱": "pesos", "₫": "dong", BTC: "bitcoin", ETH: "ether", "₿": "bitcoin"
};
const SCALE: Record<string, string> = {
  k: "thousand", K: "thousand", m: "million", M: "million", mn: "million", mm: "million",
  bn: "billion", b: "billion", B: "billion", tn: "trillion", T: "trillion", trn: "trillion",
  thousand: "thousand", million: "million", billion: "billion", trillion: "trillion"
};
const FRAC_DEN = new Set([2, 3, 4, 5, 6, 8, 10, 16, 32, 64, 100]);
const FRAC_AFTER = "\\s*(?:of\\b|an?\\b|cups?|c\\.|teaspoons?|tsp|tablespoons?|tbsp|inch|inches|in\\b|in\\.|\"|miles?|mi\\b|" +
  "pounds?|lbs?|ounces?|oz|hours?|hrs?|minutes?|mins?|seconds?|pints?|quarts?|gallons?|liters?|litres?|" +
  "kilos?|kg|feet|foot|ft|yards?|acres?|sticks?|pieces?|slices?|loaf|tons?|percent|points?|shares?|" +
  "the\\b|times\\b|marathon|price|full|empty|done|finished|complete)";
const DATE_BEFORE = "(?:\\b(?:on|by|until|till|from|since|before|after|due|dated?|deadline|through|thru|starting|effective|" +
  "expires?|expiry|born|died|week of|shipped|delivered|arrives?|arriving|ordered|paid|placed|scheduled|" +
  "filed|signed|posted|submitted|opens?|closes?|ends?|starts?|begins?|[Mm]onday|[Tt]uesday|[Ww]ednesday|[Tt]hursday|[Ff]riday|[Ss]aturday|" +
  "[Ss]unday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\.?[,:]?\\s*)$";

/** 3/4 -> three quarters; 1/2 -> one half; with lead (the 1 1/2 case): a half, a third. */
function fracWords(a: number, b: number, lead = false) {
  const name = b === 2 ? (a === 1 ? "half" : "halves") : (b === 4 ? "quarter" : ordinal(b)) + (a === 1 ? "" : "s");
  return (lead && a === 1 ? "a" : cardinal(a)) + " " + name;
}

const ABBR: Array<[string, string]> = [
  ["\\bDr\\.(?=\\s+[A-Z])", "Doctor"], ["\\bMr\\.", "Mister"], ["\\bMrs\\.", "Missus"], ["\\bMs\\.", "Miz"],
  ["\\bProf\\.(?=\\s+[A-Z])", "Professor"], ["\\bSt\\.(?=\\s+[A-Z])", "Saint"], ["(?<=[a-z] )St\\.", "Street"],
  ["\\bRd\\.", "Road"], ["\\bAve\\.", "Avenue"], ["\\bBlvd\\.", "Boulevard"], ["\\bApt\\.", "Apartment"],
  ["\\b[Aa]pprox\\.", "approximately"], ["\\betc\\.", "et cetera"], ["\\be\\.g\\.", "for example"], ["\\bi\\.e\\.", "that is"],
  ["\\bvs\\.?(?=\\s)", "versus"], ["\\b[Nn]o\\.(?=\\s*\\d)", "number"], ["\\bdept\\.", "department"], ["\\bext\\.", "extension"],
  ["(?<=\\d)\\s?min\\.", " minutes"], ["\\bmin\\.(?=\\s+[a-z])", "minimum"], ["\\bmin\\.", "minutes"],
  ["\\bhr?s?\\.(?=\\s)", "hours"], ["(?<![\\d\\s])\\s*\\b[Ss]ec\\.(?=\\s*\\d)", " section"], ["\\b([Ee])st\\.(?=\\s*\\d{4})", "\\1stablished"],
  ["\\bSgt\\.", "Sergeant"], ["\\bCapt\\.", "Captain"], ["\\bLt\\.", "Lieutenant"], ["\\bCol\\.", "Colonel"],
  ["\\bGen\\.(?=\\s+[A-Z])", "General"], ["\\bGov\\.", "Governor"], ["\\bSen\\.", "Senator"], ["\\bRep\\.(?=\\s+[A-Z])", "Representative"],
  ["\\bRev\\.", "Reverend"], ["\\bHon\\.", "Honorable"], ["\\bJr\\.", "Junior"], ["\\bSr\\.", "Senior"],
  ["\\bLn\\.", "Lane"], ["\\bDr\\.(?=[\\s,.]|$)", "Drive"], ["\\bCt\\.", "Court"], ["\\bPl\\.", "Place"], ["\\bSq\\.", "Square"],
  ["\\bHwy\\.", "Highway"], ["\\bPkwy\\.", "Parkway"], ["\\bMt\\.", "Mount"], ["\\bFt\\.(?=\\s+[A-Z])", "Fort"],
  ["\\bSte\\.", "Suite"], ["\\bBldg\\.", "Building"], ["\\bfl\\.", "floor"], ["\\bFl\\.", "Floor"], ["\\bRm\\.", "Room"],
  ["\\bEst\\.", "Estimated"], ["\\best\\.", "estimated"], ["\\bInc\\.", "Incorporated"], ["\\bLtd\\.", "Limited"],
  ["\\bCo\\.(?=\\s)", "Company"], ["\\bCorp\\.", "Corporation"], ["\\bDept\\.", "Department"], ["\\bAssn\\.", "Association"],
  ["\\bUniv\\.", "University"], ["\\bqty\\.?", "quantity"], ["\\bref\\.", "reference"], ["\\btel\\.", "telephone"],
  ["\\bTel\\.", "Telephone"], ["\\bfig\\.", "figure"], ["\\bvol\\.", "volume"], ["\\bpp\\.", "pages"], ["\\bp\\.(?=\\s*\\d)", "page"],
  ["\\bwk\\.", "week"], ["\\bmo\\.", "month"], ["\\byr\\.", "year"], ["\\bavg\\.", "average"], ["\\bmax\\.", "maximum"]
];
const DAYS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Tues: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Thur: "Thursday",
  Thurs: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday"
};
const MON_ABBR: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April", Jun: "June", Jul: "July",
  Aug: "August", Sep: "September", Sept: "September", Oct: "October", Nov: "November", Dec: "December"
};
const SYMBOLS: Array<[string, string]> = [
  ["\\s*±\\s*", " plus or minus "], ["\\s*≥\\s*", " greater than or equal to "], ["\\s*≤\\s*", " less than or equal to "],
  ["\\s*≠\\s*", " not equal to "], ["\\s*≈\\s*", " approximately "], ["\\s*÷\\s*", " divided by "],
  ["\\s*→\\s*", " to "], ["\\s*√\\s*", " square root of "], ["(?<=\\d)\\s*%", " percent"], ["\\s*‰", " per mille"],
  ["\\s+=\\s+", " equals "], ["(?<=\\d)\\s*<\\s*(?=\\d)", " less than "], ["(?<=\\d)\\s*>\\s*(?=\\d)", " greater than "],
  ["\\s*&\\s*", " and "]
];
const UNITS: Record<string, string> = {
  km: "kilometers", m: "meters", cm: "centimeters", mm: "millimeters", kg: "kilograms", g: "grams",
  mg: "milligrams", l: "liters", L: "liters", ml: "milliliters", mL: "milliliters", "km/h": "kilometers per hour",
  mph: "miles per hour", GB: "gigabytes", MB: "megabytes", TB: "terabytes", kB: "kilobytes", GHz: "gigahertz",
  MHz: "megahertz", kW: "kilowatts", kWh: "kilowatt hours", W: "watts", V: "volts", mAh: "milliamp hours",
  ft: "feet", in: "inches", lb: "pounds", lbs: "pounds", oz: "ounces", h: "hours", min: "minutes",
  s: "seconds", ms: "milliseconds", mi: "miles", yd: "yards", yds: "yards", Hz: "hertz", kHz: "kilohertz",
  dB: "decibels", mpg: "miles per gallon", kph: "kilometers per hour", tsp: "teaspoons", tbsp: "tablespoons",
  gal: "gallons", qt: "quarts", mcg: "micrograms", "µg": "micrograms", "μg": "micrograms", nm: "nanometers",
  "µm": "micrometers", "μm": "micrometers", ns: "nanoseconds", "µs": "microseconds", "μs": "microseconds",
  sec: "seconds", secs: "seconds", Mbps: "megabits per second", Gbps: "gigabits per second",
  kbps: "kilobits per second", kcal: "kilocalories", mmHg: "millimeters of mercury", dL: "deciliters",
  dl: "deciliters", PB: "petabytes", MW: "megawatts", GW: "gigawatts", GWh: "gigawatt hours",
  MWh: "megawatt hours", kPa: "kilopascals", hPa: "hectopascals", mmol: "millimoles", "fl oz": "fluid ounces",
  "sq ft": "square feet", "sq m": "square meters", km2: "square kilometers", m2: "square meters", cc: "C C",
  mA: "milliamps", ng: "nanograms", pg: "picograms", IU: "I U", mEq: "milliequivalents", kN: "kilonewtons", Nm: "newton meters", TFLOPS: "teraflops", rpm: "R P M", psi: "P S I"
};
const SING: Record<string, string> = {
  feet: "foot", inches: "inch", hertz: "hertz", kilohertz: "kilohertz", teaspoons: "teaspoon",
  "C C": "C C", "R P M": "R P M", "P S I": "P S I", teraflops: "teraflop", "I U": "I U"
};

function sing(w: string) {
  const at = w.indexOf(" per ");
  const head = at < 0 ? w : w.slice(0, at);
  const rest = at < 0 ? "" : w.slice(at);
  if (head.includes(" of ")) return w;
  const parts = head.split(" ");
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = SING[last] ?? (last.endsWith("s") ? last.slice(0, -1) : last);
  return parts.join(" ") + rest;
}

const unit = (k: string, n: string) => (n === "1" ? sing(UNITS[k]) : UNITS[k]);

const MON_RE = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const STREET: Record<string, string> = {
  St: "Street", Rd: "Road", Ave: "Avenue", Av: "Avenue", Blvd: "Boulevard", Ln: "Lane", Dr: "Drive",
  Ct: "Court", Pl: "Place", Sq: "Square", Hwy: "Highway", Pkwy: "Parkway", Cres: "Crescent",
  Ter: "Terrace", Terr: "Terrace", Cir: "Circle", Trl: "Trail", Pk: "Park"
};
const STREET_RE = "(Street|Road|Avenue|Boulevard|Lane|Drive|Court|Place|Square|Highway|Parkway|Crescent|Terrace|Circle|Way|" +
  "Close|Row|Walk|Alley|Plaza|Trail|Pike|Loop|" + Object.keys(STREET).join("|") + ")\\b(\\.?)";
const ID_WORDS = "[Rr]oom|[Rr]m\\.?|[Oo]ffice|[Ss]uite|[Ss]te\\.?|[Aa]partment|[Aa]pt\\.?|[Uu]nit|[Gg]ate|[Pp]latform|[Ff]light|" +
  "[Bb]us|[Rr]oute|[Hh]ighway|[Hh]wy\\.?|[Ii]nterstate|[Tt]erminal|[Bb]ay|[Dd]ock|[Pp]ier|[Ss]eat|[Cc]abin|" +
  "[Ww]ard|[Ll]ocker|[Bb]ooth|[Ss]tudio|[Bb]uilding|[Bb]ldg\\.?|[Ee]xit|[Pp]ort|[Ee]xt\\.?|[Ee]xtension|" +
  "[Mm]odel|[Bb]oeing|[Aa]irbus|[Cc]heckpoint|[Hh]angar|[Tt]rain|[Cc]oach|[Ff]erry|[Cc]ar";
const ELEMENTS = new Set(`H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y
    Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg
    Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr`.split(/\s+/).filter(Boolean));
// The reference scopes the case-insensitive flag to the keyword group; the rest of the pattern has no letters.
const CODE_CTX = "\\b(?:codes?|ref(?:erence)?|serial|PIN|password|passcode|quote|plate|registration|booking|confirmation|" +
  "tracking|order|voucher|coupon|promo|ticket|ID|key|token|account|policy|claim|case|invoice|SKU|part)\\b[^.;!?]*$";
const SCHEME_SAY: Record<string, string> = {
  http: "H T T P", https: "H T T P S", file: "file", git: "git", data: "data", blob: "blob",
  chrome: "chrome", spotify: "spotify", slack: "slack", zoom: "zoom", steam: "steam"
};
const UNIT_PRE = "(?<![\\w.])(?<!\\w-)(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)";

/** @openai -> open A I, @Jane_Doe -> Jane underscore Doe. */
function handle(h: string) {
  return h.split("_").map((p) => {
    const m = fullmatch("([a-z]{3,}[nlyex])(ai|hq)", p);
    return m ? g(m, 1) + " " + spell(g(m, 2)) : splitIdent(p);
  }).filter(Boolean).join(" underscore ");
}

const pl = (n: string, w: string) => `${n} ${w}${n === "1" ? "" : "s"}`;

/** Rules that must see the raw string before the general passes. */
function normTokens(input: string) {
  let t = input.replaceAll("−", "-").replaceAll("’", "'").replaceAll("‘", "'").replaceAll("“", "\"").replaceAll("”", "\"");
  t = sub("(?<=\\d)([½¼¾⅓⅔⅛])", " \\1", t);
  const vulgar: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };
  t = sub("[½¼¾⅓⅔⅛]", (m) => vulgar[g(m, 0)], t);
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹⁻";
  t = sub("[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+", (m) => "^" + [...g(m, 0)].map((c) => "0123456789-"[superscripts.indexOf(c)]).join(""), t);
  // tech tokens: .NET, C#, C++, getUserName()
  t = sub("(?<![\\w.])([A-Za-z]*)\\.NET\\b", (m) => (g(m, 1) ? spell(g(m, 1)) + " " : "") + "dot net", t);
  t = sub("\\b([A-Za-z])#(?!\\w)", "\\1 sharp", t);
  t = sub("\\b([A-Za-z])\\+\\+(?!\\w)", "\\1 plus plus", t);
  t = sub("\\b([A-Za-z_][A-Za-z0-9_]*)\\(\\)", (m) => splitIdent(g(m, 1)), t);
  t = sub("\\b[a-z]{2,}(?:[A-Z][a-z]+){2,}\\b", (m) => splitIdent(g(m, 0)), t);
  t = sub("\\bv(\\d+(?:\\.\\d+)+)\\b", (m) => "version " + g(m, 1).split(".").join(" point "), t);
  // hashtags and handles
  t = sub("(?<![\\w&#])#([A-Za-z][A-Za-z_]*)\\b(?![\\d-])", (m) => "hashtag " + splitIdent(g(m, 1)), t);
  t = sub("(?<![\\w.@])@([A-Za-z_][A-Za-z0-9_]{1,30})\\b", (m) => "at " + handle(g(m, 1)), t);
  // UK and Canadian postcodes: SW1A 1AA, M14 5TG, K1A 0B6
  t = sub("\\b([A-Z]{1,2}\\d[A-Z\\d]?|[A-Z]\\d[A-Z])\\s(\\d[A-Z]{2}|\\d[A-Z]\\d)\\b", (m) => spell(g(m, 1)) + ", " + spell(g(m, 2)), t);
  // digits that are read one by one: card ending in 4459, PIN 0420
  t = sub("\\b((?:ending|ends) in|last (?:four|4)(?: digits)?(?: of)?|PIN|[Pp]in|passcode|OTP|[Cc]ode)(\\s+)(\\d{3,8}(?:\\s\\d{2,4})*)\\b(?![.,]\\d|-\\w)",
    (m) => g(m, 1) + g(m, 2) + words(g(m, 3)).map(digits).join(", "), t);
  // paths and code: C:\Users, SELECT *, .env, API_KEY
  t = sub("\\b([A-Z]):\\\\", "\\1 colon backslash ", t);
  t = sub("\\\\", " backslash ", t);
  t = sub("(?<=\\s)\\*(?=\\s)(?!\\s*\\d)", "star", t);
  t = sub("(?<![\\w.])\\.(env|gitignore|bashrc|zshrc|npmrc|htaccess|dockerignore)\\b", "dot \\1", t);
  t = sub("\\b(?=\\w*_)(?![\\w]*\\.\\w)[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\\b", (m) => g(m, 0).split("_")
    .map((p) => (search("\\d", p) && search("[A-Za-z]", p) ? spell(p) : p)).join(" underscore "), t);
  // US toll-free and long-distance numbers: 1-800-829-1040
  t = sub("(?<![\\w+])1[-. ](\\d{3})[-. ](?:(\\d{3})[-. ](\\d{4})|([A-Z]{3,}(?:-[A-Z]+)*))\\b",
    (m) => "one " + (["800", "900"].includes(g(m, 1)) ? cardinal(int(m.group(1))) : digits(g(m, 1))) + ", "
      + (m.group(2) ? digits(g(m, 2)) + ", " + digits(g(m, 3)) : g(m, 4).split("-").map(capitalize).join(" ")), t);
  // money: currency codes and other symbols, ranges, scale words ($4.2 million, $50-75, EUR 12.99, ¥300)
  const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
  const SC = "(\\s?(?:thousand|million|billion|trillion)\\b|(?:k|K|mn|m|M|bn|b|B|tn|T)\\b)?";
  const codes = Object.keys(CURCODE).sort((a, b) => b.length - a.length).map(escape).join("|");
  const cur = (c: string, num: string, sc: string | undefined) => {
    const name = CURCODE[c];
    if (name.length === 1) return name + num + (sc ?? "");
    const dot = num.indexOf(".");
    const whole = dot < 0 ? num : num.slice(0, dot);
    const cents = dot < 0 ? "" : num.slice(dot + 1);
    if (!sc && cents.length === 2 && name.endsWith("dollars")) return `${whole} ${name}` + (int(cents) ? ` and ${int(cents)} cents` : "");
    return `${num}${sc ? " " + SCALE[sc.trim()] : ""} ${name}`;
  };
  t = sub("(?<![\\w$])(" + codes + ")\\s?" + NUM + SC, (m) => cur(g(m, 1), g(m, 2), m.group(3)), t);
  t = sub(NUM + SC + "\\s?(USD|EUR|GBP|JPY|CNY|INR|CAD|AUD|CHF|NZD|HKD|SGD|KRW|MXN|BRL|RUB|SEK|NOK|DKK|ZAR|BTC|ETH)\\b",
    (m) => cur(g(m, 3), g(m, 1), m.group(2)), t);
  t = sub("(?<!\\w)(\\d+)\\s?¢", "\\1 cents", t);
  const cw: Record<string, string> = { $: "dollars", "€": "euros", "£": "pounds" };
  t = sub("([$€£])" + NUM + SC + "\\s?[-–]\\s?[$€£]?" + NUM + SC, (m) => {
    const [c, a, s1, b, s2] = m.groups() as Groups;
    if (!(s1 || s2) && search("\\.\\d\\d\\b", a + " " + b)) return `${c}${a} to ${c}${b}`;
    const scale1 = s1 ? " " + SCALE[s1.trim()] : "";
    const scale2 = s2 ? " " + SCALE[s2.trim()] : "";
    return `${a}${scale1 !== scale2 ? scale1 : ""} to ${b}${scale2} ${cw[c ?? ""]}`;
  }, t);
  t = sub("([$€£])" + NUM + "(\\s?(?:thousand|million|billion|trillion)\\b|(?:k|K|mn|m|M|bn|b|B|tn|T)\\b)",
    (m) => `${g(m, 2)} ${SCALE[g(m, 3).trim()]} ${cw[g(m, 1)]}`, t);
  // durations: 2h 15m, 1h30, 6m 30s; a bare 45m after for/last/takes is minutes
  t = sub("\\b(\\d+)\\s?h(?:rs?)?\\s?(\\d{1,2})(?:\\s?m(?:ins?)?)?\\b", (m) => pl(g(m, 1), "hour") + " " + pl(g(m, 2), "minute"), t);
  t = sub("\\b(\\d+)\\s?m(?:ins?)?\\s?(\\d{1,2})\\s?s(?:ecs?)?\\b", (m) => pl(g(m, 1), "minute") + " " + pl(g(m, 2), "second"), t);
  t = sub("(\\b(?:for|last|lasts|lasted|lasting|takes?|took|taking|every|within|wait|waited|remaining|runtime|ETA|" +
    "blocked)\\s+(?:\\w+\\s+){0,2}?)(\\d{1,3})m\\b(?!\\s*(?:dash|sprint|race|swim|hurdles|pool|freestyle|relay))",
  (m) => g(m, 1) + pl(g(m, 2), "minute"), t);
  // decades: '80s, 1990s, the 2000s; '98 -> ninety eight
  t = sub("(?<![\\w$€£.,'])(')?(\\d{2}|1\\d{3}|20\\d{2})'?s\\b", (m) => {
    const s = g(m, 2);
    const n = int(s);
    if (n % 10) return g(m, 0);
    const w = s.length === 4 ? year(n) : n === 0 && m.group(1) ? "two thousand" : n ? cardinal(n) : "";
    if (!w) return g(m, 0);
    return w.endsWith("y") ? w.slice(0, -1) + "ies" : w + "s";
  }, t);
  t = sub("(?:(?<=\\s)|^)'(\\d{2})\\b(?!['\\w])", (m) => (g(m, 1)[0] === "0" ? "oh " + ONES[int(m.group(1))] : g(m, 1)), t);
  // Roman numerals by context: Henry VIII -> Henry the eighth, Chapter XIV -> Chapter fourteen
  t = sub("\\bWW\\s?(II|I|2|1)\\b", (m) => "World War " + (["II", "2"].includes(g(m, 1)) ? "Two" : "One"), t);
  t = sub("\\b([A-Za-z][A-Za-z']*\\.?)(\\s+)(" + ROMAN_RE + ")\\b(?!'\\w|-\\d)", romanSub, t);
  t = sub("(?<=[a-z])\\((I|II|III|IV|V|VI)\\)", (m) => " " + cardinal(roman(g(m, 1))), t);
  // powers: x^2 -> x squared, 10^23 -> 10 to the twenty third, 6.02 x 10^23 -> 6.02 times 10 to the ...
  t = sub("(\\d)\\s?[x×*]\\s?(?=10\\s?\\^)", "\\1 times ", t);
  t = sub(UNIT_PRE + "\\s?(km|m|cm|mm|ft|mi|yd|in)\\^([23])\\b",
    (m) => `${g(m, 1)} ${g(m, 3) === "2" ? "square" : "cubic"} ${UNITS[g(m, 2)]}`, t);
  t = sub("(\\b[A-Za-z]{1,3}|\\b\\d+(?:\\.\\d+)?|\\))\\s?\\^\\s?\\(?([+-]?(?:\\d+|[a-z]))\\)?", (m) => {
    let b = g(m, 1);
    let e = g(m, 2);
    const neg = e.startsWith("-");
    e = e.replace(/^[+-]+/, "");
    b = isAlpha(b) && b.length > 1 ? [...b].join(" ") : b;
    if (!isDigit(e)) return `${b} to the ${e}`;
    const n = int(e);
    return n === 2 && !neg ? `${b} squared` : n === 3 && !neg ? `${b} cubed` : `${b} to the ${neg ? "minus " : ""}${ordinal(n)}`;
  }, t);
  if (search("[=^+]|\\bsolve\\b|\\bequation", t)) { // 3x - 2 = 11 -> 3 x minus 2
    t = sub("(?<=[\\w)])\\s+[-–]\\s+(?=[\\w(])", " minus ", t);
    t = sub("\\b(\\d+)([a-fi-jn-rt-z])\\b", "\\1 \\2", t);
  }
  t = sub("\\b(\\d+(?:\\.\\d+)?)x(?=\\s+(?:faster|slower|more|less|larger|smaller|bigger|higher|lower|cheaper|better|" +
    "worse|longer|shorter|the|as|over|speed|zoom)\\b)", "\\1 times", t);
  t = sub("(\\d)\\s+[x×*]\\s+(\\d+(?:\\.\\d+)?)(?=\\s*=)", "\\1 times \\2", t);
  // bare scales: 4.5M visitors -> 4.5 million visitors (5K run stays)
  t = sub("(?<![\\w$€£.])(\\d+\\.\\d+|\\d+(?=\\s?\\w+\\s+[a-z]{3,}s\\b))\\s?(M|bn|mn|tn)\\b(?=\\s+[a-z]{3,})",
    (m) => `${g(m, 1)} ${SCALE[g(m, 2)]}`, t);
  return t;
}

const MN = "January February March April May June July August September October November December".split(" ");
const ordn = (n: number) => `${n}${10 <= n % 100 && n % 100 <= 20 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

function normPre(input: string) {
  let t = normTokens(input);
  // host ports: localhost:8080 -> localhost colon eighty eighty
  t = sub("\\b(localhost|(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,}):(\\d{2,5})\\b", (m) => `${g(m, 1)} colon ${nread(g(m, 2))}`, t);
  // URL schemes
  const say = (s: string) => SCHEME_SAY[s.toLowerCase()] ?? (pronounceable(s) ? s.toLowerCase() : spell(s));
  t = sub("(?<![\\w.+-])([A-Za-z][A-Za-z0-9+.-]{1,9})://(?=[\\s,.;:!?)\"']|$)", (m) => say(g(m, 1)) + " colon slash slash", t);
  t = sub("(?<![\\w.+-])(?!https?://)([A-Za-z][A-Za-z0-9+.-]{1,9})://(?=[\\w/@\\[])((?![\\w.-]*@)[A-Za-z][\\w-]*(?:\\.[\\w-]+)+\\b)?",
    (m) => say(g(m, 1)) + " colon slash slash " + g(m, 2).replaceAll(".", " dot ").replaceAll("-", " dash "), t);
  t = sub("\\bmailto:(?=[\\w.+-]+@)", "mail to ", t);
  // e-mail and web addresses
  t = sub("\\b([\\w.+-]+)@([\\w-]+(?:\\.[\\w-]+)+)\\b",
    (m) => g(m, 1).replaceAll(".", " dot ").replaceAll("_", " underscore ").replaceAll("-", " dash ")
      + " at " + g(m, 2).replaceAll(".", " dot ").replaceAll("-", " dash "), t);
  t = sub("\\bhttps?://(?![\\w.-]*[:@])([A-Za-z][\\w-]*(?:\\.[\\w-]+)+\\b)?", (m) => (m.group(1) && !search("\\.(?:com|org|net|io|ai|co|uk|dev|app|gov|edu|ly|me|tv|us|eu|de|fr|info|biz)$", g(m, 1))
    ? sub("^www ", "w w w ", g(m, 1).replaceAll(".", " dot ").replaceAll("-", " dash "))
    : g(m, 1)), t);
  t = sub("\\bwww\\.", "w w w dot ", t);
  t = sub("\\b((?:[\\w-]+\\.)+)(com|org|net|io|ai|co|uk|dev|app|gov|edu|ly|me|tv|us|eu|de|fr|info|biz)\\b",
    (m) => g(m, 1).replaceAll(".", " dot ").replaceAll("-", " dash ") + g(m, 2), t);
  // file names: name_with_parts.ext
  t = sub("\\b([\\w-]+)\\.(pdf|png|jpe?g|gif|docx?|xlsx?|csv|txt|zip|mp3|mp4|wav|json|py|js|html?|gradle|ipynb|rtf|pptx?|webm|bin|dat|bat|ps1|vue|jsx|kts|cs|dart|lua|r)\\b",
    (m) => sub("_", " underscore ", g(m, 1)) + " dot " + g(m, 2), t);
  t = sub("(?<![\\w@])((?:/?[\\w-]+/)*[\\w-]*[a-z_][\\w-]*)\\.(conf|log|cfg|ini|yaml|yml|toml|md|sh|ts|tsx|css|xml|sql|db|bak|tmp|exe|dmg|apk|iso|tar|gz|rar|7z|svg|webp|heic|mov|avi|mkv|flac|ogg|m4a|key|pem|crt|env|lock|rs|go|java|kt|swift|rb|php|c|cpp|h|git)\\b",
    (m) => sub("\\.", " dot ", g(m, 1).replaceAll("_", " underscore ").replaceAll("/", " slash ").replaceAll("-", " dash ")) + " dot " + g(m, 2), t);
  t = sub("(?<![\\w])/((?:[\\w.-]+/)*[\\w.-]+)", (m) => " slash " + g(m, 1).replaceAll("/", " slash "), t);
  // 12-25-1999 and 14.03.2027 are dates; give them the slashed form the date rules read
  t = sub("\\b(\\d{1,2})-(\\d{1,2})-((?:19|20)\\d\\d)\\b", "\\1/\\2/\\3", t);
  t = sub("\\b(\\d{1,2})\\.(\\d{1,2})\\.((?:19|20)\\d\\d)\\b",
    (m) => (1 <= int(m.group(1)) && int(m.group(1)) <= 31 && 1 <= int(m.group(2)) && int(m.group(2)) <= 12
      ? `the ${ordinal(int(m.group(1)))} of ${MONTHS[int(m.group(2)) - 1]} ${g(m, 3)}` : g(m, 0)), t);
  // day and month ranges / abbreviations
  const days = Object.keys(DAYS).join("|");
  const months = Object.keys(MON_ABBR).join("|");
  t = sub("\\b(" + days + ")\\.?\\s*[-–]\\s*(" + days + ")\\.?", (m) => DAYS[g(m, 1)] + " to " + DAYS[g(m, 2)], t);
  t = sub("(?<!\\bthe )(?<!\\bThe )\\b(" + days + ")\\.(?=[\\s,]|$)", (m) => DAYS[g(m, 1)] + (match("\\s*(?:$|[A-Z])", after(m)) ? "." : ""), t);
  t = sub("\\b(on|by|until|till|every|from|next|this|last) (" + days + ")\\b(?!')", (m) => g(m, 1) + " " + DAYS[g(m, 2)], t);
  t = sub("\\b(" + months + ")\\.(?=\\s*\\d)", (m) => MON_ABBR[g(m, 1)], t);
  t = sub("\\b(" + months + ")\\b(?=\\s+\\d{1,4}\\b(?!:))", (m) => MON_ABBR[g(m, 1)], t);
  t = sub("(?<=\\d )(" + months + ")\\b\\.?", (m) => MON_ABBR[g(m, 1)], t);
  // house numbers and street types: 742 Evergreen Terrace -> seven forty two, 4 Elm Rd -> Road
  t = sub("\\b(\\d{1,4})([A-Za-z]?)\\s+((?:(?:North|South|East|West|N\\.?|S\\.?|E\\.?|W\\.?)\\s+)?" +
    "(?:[A-Z][\\w']*|\\d+(?:st|nd|rd|th))(?:\\s+[A-Z][\\w']*){0,2})\\s+" + STREET_RE, (m) => {
    const [num, letter, name, kind, dot] = m.groups() as string[];
    const tail = dot && match("\\s*(?:$|[A-Z\\n])", after(m)) ? "." : "";
    return `${nread(num)}${letter ? " " + letter.toUpperCase() : ""} ${name} ${STREET[kind] ?? kind}${tail}`;
  }, t);
  t = sub("(?<!Mount )(?<!Port )(?<!Fort )(?<!Lake )(?<!Cape )\\b([A-Z][a-z]+|\\d+(?:st|nd|rd|th))\\s+" +
    "(St|Rd|Ave|Blvd|Ln|Hwy|Pkwy|Cres|Terr?)\\b(\\.?)",
  (m) => (ROMAN_STOP.has(g(m, 1).toLowerCase()) || ["on", "at", "visit", "see"].includes(g(m, 1).toLowerCase())
    || (g(m, 2) === "St" && match("\\s+[A-Z]", after(m))) ? g(m, 0) : `${g(m, 1)} ${STREET[g(m, 2)]}`
    + (g(m, 3) && match("\\s*(?:$|\\n)", after(m)) ? "." : "")), t);
  t = sub("\\b((?:I|US|SR|Route|Highway|Hwy|Interstate)[- ]\\d+)\\s([NSEW])\\b",
    (m) => g(m, 1) + " " + ({ N: "North", S: "South", E: "East", W: "West" } as Record<string, string>)[g(m, 2)], t);
  for (const [pattern, replacement] of ABBR) t = sub(pattern, replacement, t);
  // ISO dates 2026-10-21 -> October 21, 2026
  t = sub("\\b(\\d{4})-(\\d{2})-(\\d{2})\\b",
    (m) => (1 <= int(m.group(2)) && int(m.group(2)) <= 12 ? `${MN[int(m.group(2)) - 1]} ${int(m.group(3))}, ${g(m, 1)}` : g(m, 0)), t);
  // 14 March 2027 -> the fourteenth of March 2027; 3-17 November -> the third to the seventeenth of November
  t = sub("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MON_RE + "\\b",
    (m) => (int(m.group(1)) < int(m.group(2)) && int(m.group(2)) <= 31
      ? `the ${ordinal(int(m.group(1)))} to the ${ordinal(int(m.group(2)))} of ${g(m, 3)}` : g(m, 0)), t);
  t = sub("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?" + MON_RE + "\\b",
    (m) => (1 <= int(m.group(1)) && int(m.group(1)) <= 31
      ? (search("\\bthe\\s+$", before(m), "i") ? "" : "the ") + `${ordinal(int(m.group(1)))} of ${g(m, 2)}` : g(m, 0)), t);
  // year ranges 1968-2020, 1990-95
  t = sub("\\b(1[5-9]\\d\\d|20\\d\\d)\\s*[-–]\\s*(1[5-9]\\d\\d|20\\d\\d|\\d\\d)\\b(?![-/.]\\d)",
    (m) => (g(m, 2).length === 4 || int(m.group(2)) > int(g(m, 1).slice(2)) ? `${g(m, 1)} to ${g(m, 2)}` : g(m, 0)), t);
  // month/year 3/2027 -> March 2027; set phrases 24/7, 50/50, 9/11
  t = sub("(?<![\\d/])\\b(\\d{1,2})/((?:19|20)\\d\\d)\\b", (m) => (1 <= int(m.group(1)) && int(m.group(1)) <= 12 ? `${MN[int(m.group(1)) - 1]} ${g(m, 2)}` : g(m, 0)), t);
  t = sub("(?<![\\d/])\\b(24/7|50/50|9/11)\\b(?!/)", (m) => ({ "24/7": "24 7", "50/50": "fifty fifty", "9/11": "nine eleven" } as Record<string, string>)[g(m, 1)], t);
  // fractions: 1 1/2 -> 1 and a half
  t = sub("(?<![\\d/.,])\\b(\\d+)\\s+(\\d{1,2})/(\\d{1,2})\\b(?!/\\d)",
    (m) => (0 < int(m.group(2)) && int(m.group(2)) < int(m.group(3)) && FRAC_DEN.has(int(m.group(3)))
      ? `${g(m, 1)} and ${fracWords(int(m.group(2)), int(m.group(3)), true)}` : g(m, 0)), t);
  // day/month (or month/day) without a year: 14/03 -> the 14th of March, 03/14 -> March 14th; ambiguous -> day/month
  t = sub("(?<![\\d/])\\b(\\d{1,2})/(\\d{1,2})\\b(?!/\\d)", (m) => {
    const a = int(m.group(1));
    const b = int(m.group(2));
    const next = m.string.slice(m.end(), m.end() + 12).toLowerCase();
    const prior = m.string.slice(Math.max(0, m.start() - 16), m.start());
    if (match("\\s*(stars?|points?|marks?|votes?)\\b", next) || search("(rated|scored?|rating|got)\\s*$", prior.toLowerCase())) return `${a} out of ${b}`;
    if (0 < a && a < b && FRAC_DEN.has(b) && g(m, 1)[0] !== "0" && g(m, 2)[0] !== "0" && (
      !search(DATE_BEFORE, prior, "i") || match(FRAC_AFTER, next))) return fracWords(a, b);
    const the = search("\\bthe\\s+$", prior, "i") ? "" : "the ";
    if (1 <= b && b <= 12 && 1 <= a && a <= 31) return `${the}${ordn(a)} of ${MN[b - 1]}`;
    if (1 <= a && a <= 12 && 1 <= b && b <= 31) return `${MN[a - 1]} ${ordn(b)}`;
    return g(m, 0);
  }, t);
  // multi-dot versions 4.0.1(-beta)
  t = sub("\\b(\\d+(?:\\.\\d+){2,})(?:-(alpha|beta|rc\\d*|preview))?\\b",
    (m) => g(m, 1).split(".").join(" point ") + (m.group(2) ? " " + g(m, 2) : ""), t);
  // 2:03:45 -> two hours three minutes forty five seconds (a clock time after "at" keeps its seconds at the end)
  const plural = (n: string, w: string) => `${int(n)} ${w}${int(n) === 1 ? "" : "s"}`;
  t = sub("\\b(\\d{1,2}):(\\d{2}):(\\d{2})\\b(?!:)", (m) => (search("\\b(at|by|until|from)\\s+$", before(m))
    ? `${g(m, 1)}:${g(m, 2)} and ${plural(g(m, 3), "second")}`
    : (m.groups() as string[]).map((x, i) => [x, ["hour", "minute", "second"][i]] as const)
      .filter(([x, w]) => int(x) || w === "second").map(([x, w]) => plural(x, w)).join(", ")), t);
  // time ranges: 10:00-16:30, 8 AM-6 PM, 9am-5pm
  t = sub("\\b(\\d{1,2}(?::\\d{2})?\\s?(?:[AaPp]\\.?[Mm]\\.?)?)\\s?[-–]\\s?(\\d{1,2}(?::\\d{2})?\\s?[AaPp]\\.?[Mm]\\b\\.?)", "\\1 to \\2", t);
  t = sub("\\b(\\d{1,2}:\\d{2})\\s?[-–]\\s?(\\d{1,2}:\\d{2})\\b", "\\1 to \\2", t);
  // ratios / scores written with a colon where the right side is one digit: 3:2
  t = sub("\\b(\\d{1,2}):(\\d)\\b(?!\\d)", "\\1 to \\2", t);
  t = sub("(?<=[Rr]atio of |[Rr]atio is )(\\d{1,2}):(\\d{1,2})\\b", "\\1 to \\2", t);
  // letter-led codes with digit groups (CS-2026-0813, AB-4471-Z) before the phone rule can grab their digits
  t = sub("\\b[A-Z]{1,4}(?:-[A-Z0-9]{1,6})*-\\d[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\\b", (m) => codeRead(g(m, 0)), t);
  // phone numbers: optional +CC, then digit groups split by spaces/dashes/dots/parens, 7+ digits in total
  t = sub("(?<![\\w.,])\\+?\\(?\\d{2,4}\\)?(?:[\\s.-]\\(?\\d{2,4}\\)?){1,4}(?![\\w.,]*\\d)", (m) => {
    const s = g(m, 0);
    if ([...s].filter((c) => isDigit(c)).length < 7) return s;
    const lead = s.trim().startsWith("+") ? "plus " : "";
    return " " + lead + (findall("\\d+", s) as string[]).map(digits).join(", ") + " ";
  }, t);
  // short service numbers preceded by call/dial/text
  t = sub("\\b((?:[Cc]all|[Dd]ial|[Tt]ext|[Rr]ing)\\s+)(\\d{3,6})\\b", (m) => g(m, 1) + digits(g(m, 2)), t);
  // units after numbers (singular after exactly 1; 10 mg/kg -> milligrams per kilogram)
  t = sub("\\b(\\d+)\\s?ft\\.?\\s?(\\d{1,2})\\s?in\\b\\.?", (m) => `${g(m, 1)} ${g(m, 1) === "1" ? "foot" : "feet"} ` +
    `${g(m, 2)} ${g(m, 2) === "1" ? "inch" : "inches"}`, t);
  t = sub("\\b(\\d)'\\s?(\\d{1,2})(?:\"|'')", "\\1 foot \\2", t);
  const ukeys = Object.keys(UNITS).filter((k) => k !== "in" && k !== "s").sort((a, b) => b.length - a.length).map(escape).join("|");
  t = sub(UNIT_PRE + "\\s?(" + ukeys + ")/(" + ukeys + "|s|in)(?![\\w/])",
    (m) => (g(m, 3) !== "in" ? `${g(m, 1)} ${unit(g(m, 2), g(m, 1))} per ${sing(UNITS[g(m, 3)] ?? "seconds")}` : g(m, 0)), t);
  t = sub(UNIT_PRE + "\\s?(" + ukeys + ")(?![\\w/'])", (m) => `${g(m, 1)} ${unit(g(m, 2), g(m, 1))}`, t);
  t = sub("(\\b(?:squared|cubed|to the (?:minus )?(?:\\w+ )?\\w+(?:th|st|nd|rd))\\s)(" + ukeys + ")(?:/(" + ukeys + "|s))?(?![\\w/'])",
    (m) => g(m, 1) + UNITS[g(m, 2)] + (m.group(3) ? " per " + sing(UNITS[g(m, 3)] ?? "seconds") : ""), t);
  // identifiers read in pairs: room 402, gate 47B, flight UA 482, B12, AA229, A380 (5+ digits stay digit by digit)
  t = sub("\\b(" + ID_WORDS + ")(\\s+(?:No\\.?\\s*|#\\s*)?)([A-Z]{1,3}\\s?)?(\\d{2,4})([A-Z]{0,2})\\b(?![.,]\\d|\\s?[-–]\\s?\\d)",
    (m) => g(m, 1) + g(m, 2) + (m.group(3) ? spell(g(m, 3)) + " " : "") + nread(g(m, 4)) + (g(m, 5) ? " " + spell(g(m, 5)) : ""), t);
  t = sub("\\b([A-Z]{2,3})\\s(\\d{3,4})\\b(?![.,:]\\d|\\s\\d)", (m) => g(m, 1) + " " + nread(g(m, 2)), t);
  // codes after code/reference/serial words stay letter by letter and digit by digit (handled below)
  const pair = (m: Match) => !search(CODE_CTX, m.string.slice(Math.max(0, m.start() - 40), m.start()), "i");
  t = sub("(?<![-/.\\w])([A-Z]{1,3})(\\d{1,4})([A-Z]{0,2})(?![-/\\w])", (m) => (pair(m) && (g(m, 2).length <= 2 || (g(m, 1).length === 2 && !g(m, 3)))
    ? [spell(g(m, 1)), nread(g(m, 2)), spell(g(m, 3))].filter(Boolean).join(" ") : g(m, 0)), t);
  t = sub("(?<![-/.\\w])(\\d{1,4})([A-Z]{1,2})(?![-/\\w])", (m) => (pair(m) ? nread(g(m, 1)) + " " + spell(g(m, 2)) : g(m, 0)), t);
  // chemical formulas: C6H12O6 -> C six H twelve O six
  t = sub("(?<![-/.\\w])(?=[A-Za-z]*\\d)(?:[A-Z][a-z]?\\d{0,3}){2,}(?![-/\\w])", (m) => (
    (findall("[A-Z][a-z]?", g(m, 0)) as string[]).every((e) => ELEMENTS.has(e)) && pair(m)
      ? (findall("([A-Z][a-z]?)(\\d*)", g(m, 0)) as string[][]).map(([e, n]) => spell(e) + (n ? " " + cardinal(int(n)) : "")).join(" ")
      : g(m, 0)), t);
  // hash numbers: #1 -> number one, #4471 -> number four four seven one
  t = sub("#(\\d+(?:-\\d+)*)\\b", (m) => "number " + g(m, 1).split("-").map((part) => (part.length <= 3 ? part : digits(part))).join(", "), t);
  // codes: letter/digit mixes with or without dashes (AB-4471-Z, X7K9, ORD-9Q2-77L)
  t = sub("\\b(?=[A-Za-z0-9-]*\\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\\b", (m) => codeRead(g(m, 0)), t);
  t = sub("\\b(?=\\w*\\d)(?=\\w*[A-Z])[A-Z0-9]{3,}\\b", (m) => spell(g(m, 0)), t);
  // random mixed IDs (4hQx8Z, a9F2k), not ordinals / times / units like 3rd, 10am, 5kg
  t = sub("\\b(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,}\\b",
    (m) => (fullmatch("\\d+(?:st|nd|rd|th|am|pm|s|kg|km|mm|cm|ml|mg|gb|mb|tb|kb|ghz|mhz|kw|kwh|mah|hrs?|mins?|h|m|k|x|g|l|w|v)", g(m, 0), "i")
      ? g(m, 0) : spell(g(m, 0))), t);
  // long bare digit strings (order / account numbers): 5+ digits
  t = sub("(?<![\\d$€£.,])\\b(\\d{5,})\\b(?![.,]\\d)", (m) => digits(g(m, 1)), t);
  // ranges between small numbers: 9-5, 3-5 days, 0-2
  t = sub("(?<![\\d/:.-])\\b(\\d{1,4})\\s*[-–]\\s*(\\d{1,4})\\b(?![/:.-]\\d)", "\\1 to \\2", t);
  // durations: 2h 15, 1h30, 45min, 3hrs
  t = sub("\\b(\\d+)\\s*h\\s*(\\d{1,2})\\b", (m) => `${g(m, 1)} hour${g(m, 1) === "1" ? "" : "s"} ${g(m, 2)}`, t);
  t = sub("\\b(\\d+)\\s*hrs?\\b", (m) => `${g(m, 1)} hour${g(m, 1) === "1" ? "" : "s"}`, t);
  t = sub("\\b(\\d+)\\s*mins?\\b", (m) => `${g(m, 1)} minute${g(m, 1) === "1" ? "" : "s"}`, t);
  t = sub(UNIT_PRE + "\\s?(" + ukeys + ")(?![\\w/'])", (m) => `${g(m, 1)} ${unit(g(m, 2), g(m, 1))}`, t);
  // dimensions with ×
  t = sub("\\s*×\\s*", " by ", t);
  t = sub("(?<=\\d)\\s+x\\s+(?=\\d)", " by ", t);
  for (const [pattern, replacement] of SYMBOLS) t = sub(pattern, replacement, t);
  // pounds and pence: £7.50 -> 7 pounds 50
  t = sub("£(\\d[\\d,]*)\\.(\\d{2})\\b", (m) => (g(m, 2) !== "00" ? `${g(m, 1)} pounds ${int(m.group(2))}` : `${g(m, 1)} pounds`), t);
  // leftover en dashes are not in the model's alphabet
  t = sub("\\s+–\\s+", " — ", t).replaceAll("–", "-");
  return sub("\\s{2,}", " ", t).trim();
}

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const SCALES: Array<[number, string]> = [[10 ** 12, "trillion"], [10 ** 9, "billion"], [10 ** 6, "million"], [1000, "thousand"]];
const MONTHS = MN;
const ORD: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

export function cardinal(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 === 0 ? "" : " " + ONES[n % 10]);
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 === 0 ? "" : " and " + cardinal(n % 100));
  for (const [v, name] of SCALES) {
    if (n >= v) {
      const rest = n % v;
      const tail = rest === 0 ? "" : (rest < 100 ? " and " : " ") + cardinal(rest);
      return cardinal(Math.floor(n / v)) + " " + name + tail;
    }
  }
  return String(n);
}

function ordinal(n: number) {
  const w = cardinal(n).split(" ");
  const last = w[w.length - 1];
  w[w.length - 1] = ORD[last] ?? (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return w.join(" ");
}

function year(n: number) {
  if (2000 <= n && n <= 2009) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  return cardinal(hi) + (lo === 0 ? " hundred" : lo < 10 ? " oh " + ONES[lo] : " " + cardinal(lo));
}

function number(input: string) {
  const s = input.replaceAll(",", "");
  const dot = s.indexOf(".");
  if (dot >= 0) {
    const a = s.slice(0, dot);
    const b = s.slice(dot + 1);
    return (a ? cardinal(int(a)) : "zero") + " point " + [...b].map((c) => ONES[int(c)]).join(" ");
  }
  return cardinal(int(s));
}

/** Light verbalizer for numbers, money, times and ordinals (the reference's path without NeMo). */
function fallback(input: string) {
  const cur: Record<string, [string, string, string, string]> = {
    $: ["dollar", "dollars", "cent", "cents"], "€": ["euro", "euros", "cent", "cents"], "£": ["pound", "pounds", "penny", "pence"]
  };
  let t = sub("([$€£])(\\d[\\d,]*)(?:\\.(\\d+))?\\b", (m) => {
    const [one, many, c1, cn] = cur[g(m, 1)];
    const whole = int(g(m, 2).replaceAll(",", ""));
    const frac = m.group(3);
    if (frac && frac.length !== 2) return `${number(g(m, 2) + "." + frac)} ${many}`;
    const c = frac ? int(frac) : 0;
    if (whole === 0 && c) return `${cardinal(c)} ${c === 1 ? c1 : cn}`;
    const out = `${cardinal(whole)} ${whole === 1 ? one : many}`;
    return out + (c ? ` and ${cardinal(c)} ${c === 1 ? c1 : cn}` : "");
  }, input);
  t = sub("\\b(\\d{1,2}):(\\d{2})\\s*([aApP]\\.?[mM])?(?:\\.(?=\\s+[a-z]))?(?=\\W|$)", (m) => {
    const h = int(m.group(1));
    const mi = int(m.group(2));
    if (mi === 0 && !m.group(3) && match("\\s*(noon|midnight)", after(m))) return cardinal(h);
    if (mi === 0 && !m.group(3) && (h > 12 || h === 0)) return (h === 0 ? "zero" : cardinal(h)) + " hundred";
    let out = cardinal(h) + (mi === 0 ? (!m.group(3) ? " o'clock" : "") : mi < 10 ? " oh " + ONES[mi] : " " + cardinal(mi));
    if (m.group(3)) out += " " + g(m, 3).replaceAll(".", "").toUpperCase();
    return out;
  }, t);
  t = sub("\\b(\\d{1,2})\\s*([aApP])\\.?[mM](?:\\.(?=\\s+[a-z]))?(?=\\W|$)", (m) => `${cardinal(int(m.group(1)))} ${g(m, 2).toUpperCase()}M`, t);
  t = sub("\\b(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})\\b", (m) => {
    const mo = int(m.group(1));
    const d = int(m.group(2));
    const y = int(m.group(3)) + (g(m, 3).length === 2 ? 2000 : 0);
    if (12 < mo && mo <= 31 && 1 <= d && d <= 12) return `the ${ordinal(mo)} of ${MONTHS[d - 1]} ${year(y)}`;
    if (!(1 <= mo && mo <= 12 && 1 <= d && d <= 31)) return g(m, 0);
    return `${MONTHS[mo - 1]} ${ordinal(d)} ${year(y)}`;
  }, t);
  t = sub("\\b(" + MONTHS.join("|") + ")\\.? (\\d{1,2})\\b(?!:)", (m) => `${g(m, 1)} ${ordinal(int(m.group(2)))}`, t);
  t = sub("(\\d)\\s?°\\s?C\\b", "\\1 degrees Celsius", t);
  t = sub("(\\d)\\s?°\\s?F\\b", "\\1 degrees Fahrenheit", t);
  t = sub("(\\d)\\s?°", "\\1 degrees", t);
  t = sub("(?<=\\w)/(?=\\w)", " slash ", t);
  t = sub("\\b(\\d+)(st|nd|rd|th)\\b", (m) => ordinal(int(m.group(1))), t);
  t = sub("\\b(1[1-9]\\d\\d|20\\d\\d)\\b(?![.,]\\d)", (m) => year(int(m.group(1))), t);
  t = sub("(?<![\\w-])-(?=\\d)", "minus ", t);
  t = sub("(?<=[A-Za-z])(?=\\d)", " ", t);
  t = sub("(\\d+(?:\\.\\d+)?)\\s?%", (m) => number(g(m, 1)) + " percent", t);
  t = sub("\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b|\\b\\d+(?:\\.\\d+)?\\b", (m) => number(g(m, 0)), t);
  return t.replaceAll("&", " and ").replaceAll("+", " plus ").replaceAll("=", " equals ").replaceAll("@", " at ").replaceAll("#", " number ");
}

/** Raw text -> the spoken-form text the model reads; `respell` rewrites hard names last. */
export function normalize(text: string, respell?: (text: string) => string) {
  let t = normPre(text);
  if (search("[0-9#%$€£@&/_+=<>±≥≤×°]", t)) t = fallback(t);
  t = sub("\\s+([.,!?;:])", "\\1", t);
  t = sub("\\s{2,}", " ", t).trim();
  if (respell) t = respell(t);
  return isUpper(text.slice(0, 1)) ? t.slice(0, 1).toUpperCase() + t.slice(1) : t;
}
