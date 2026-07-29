// GEO Check — Shared configuration for prompts and verticals
// Single source of truth: import from here, not from route files.

// ─── Verticals (matches Lovable frontend dropdown exactly) ───

export const VALID_VERTICALS = [
  "Wine",
  "Gourmet Food",
  "Craft Beer",
  "Fitness",
  "Restaurants",
  "Beauty & Wellness",
  "Legal",
  "Finance",
  "Healthcare",
  "Real Estate",
  "Home Services",
  "AI & SaaS",
  "Other",
] as const;

export type ValidVertical = (typeof VALID_VERTICALS)[number];

// ─── German→English backward compat map ───

const DE_TO_EN: Record<string, ValidVertical> = {
  Wein: "Wine",
  Feinkost: "Gourmet Food",
  "Craft Beer": "Craft Beer",
  Fitness: "Fitness",
  Gastro: "Restaurants",
};

export function normalizeVertical(raw: string): ValidVertical {
  if ((VALID_VERTICALS as readonly string[]).includes(raw)) {
    return raw as ValidVertical;
  }
  const mapped = DE_TO_EN[raw];
  if (mapped) return mapped;
  return "Other";
}

export function isValidVertical(vertical: string): boolean {
  return (
    (VALID_VERTICALS as readonly string[]).includes(vertical) ||
    vertical in DE_TO_EN
  );
}

// ─── Prompt Library (migrated from Airtable 2026-07-28) ───
// 12 verticals × 12 prompts each, 4 intents: Empfehlung, Kauf, Vergleich, Info
// Variables: {region} (standardized from [REGION])

export const PROMPTS_BY_VERTICAL: Record<string, {text: string; intent: string; language: string}[]> = {
  "AI & SaaS": [
    { text: "What features should a modern CRM tool have in {region}?", intent: "Info", language: "EN" },
    { text: "Compare the best AI tools for content creation in {region}.", intent: "Vergleich", language: "EN" },
    { text: "What makes a good AI marketing tool in {region}?", intent: "Info", language: "EN" },
    { text: "Where can I sign up for a CRM tool with a free trial in {region}?", intent: "Kauf", language: "EN" },
    { text: "Which CRM tool would you recommend for small businesses in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "What's the best AI software for marketing automation in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "How do I easily switch from an old CRM to a new SaaS tool in {region}?", intent: "Kauf", language: "EN" },
    { text: "What sets the leading CRM providers in {region} apart?", intent: "Vergleich", language: "EN" },
    { text: "Which SaaS tool offers the best value for startups in {region}?", intent: "Vergleich", language: "EN" },
    { text: "What does an AI-powered marketing tool cost per month in {region}?", intent: "Kauf", language: "EN" },
    { text: "What should I look for when choosing a SaaS solution in {region}?", intent: "Info", language: "EN" },
    { text: "Can you recommend a good SaaS tool for project management in {region}?", intent: "Empfehlung", language: "EN" },
  ],
  "Beauty & Wellness": [
    { text: "Welche Anbieter für Kosmetik und Wellness in {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Kosmetik- und Pflegeangebote in {region} haben die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Vergleiche die besten Beauty- und Wellness-Anbieter in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Gibt es in {region} Anbieter für Kosmetik und Wellness mit Online-Terminbuchung?", intent: "Info", language: "DE" },
    { text: "Wo kann ich hochwertige Kosmetik- und Pflegeprodukte in {region} online bestellen?", intent: "Kauf", language: "DE" },
    { text: "Welche Anbieter für Hair und Beauty in {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Wellness- und Spacentren in {region} sind empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Anbieter für Hautpflege und Kosmetik in {region} haben die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Gibt es in {region} Anbieter für Beauty und Wellness mit eigenem Online-Shop?", intent: "Info", language: "DE" },
    { text: "Vergleiche die besten Friseur- und Beauty-Salons in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Welche Anbieter für Körperpflege und Wellness in {region} gibt es?", intent: "Info", language: "DE" },
    { text: "Wo gibt es in {region} gute Angebote für Kosmetik und Wellness?", intent: "Kauf", language: "DE" },
  ],
  "Craft Beer": [
    { text: "Ich suche ein gutes Craft Beer aus {region}. Was empfiehlst du?", intent: "Empfehlung", language: "DE" },
    { text: "Vergleiche die bekanntesten Craft-Beer-Marken aus {region}.", intent: "Vergleich", language: "DE" },
    { text: "Was sind die besten kleinen Brauereien in {region}?", intent: "Empfehlung", language: "DE" },
    { text: "Welche neuen Brauereien aus {region} sollte man 2026 kennen?", intent: "Info", language: "DE" },
    { text: "Welche Craft-Beer-Brauereien aus {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Brauerei aus {region} hat die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Welche Craft-Brauereien in {region} liefern direkt an Endkunden?", intent: "Kauf", language: "DE" },
    { text: "Welche Craft-Beer-Brauereien aus {region} sind auf Social Media aktiv?", intent: "Info", language: "DE" },
    { text: "Craft Beer als Geschenk in {region}: welche Brauereien bieten Probierpakete an?", intent: "Kauf", language: "DE" },
    { text: "Gibt es Brauereien in {region} mit Taproom oder Brauereiführung?", intent: "Info", language: "DE" },
    { text: "Wo finde ich alkoholfreies Craft Beer von Brauereien in {region}?", intent: "Kauf", language: "DE" },
    { text: "Wo kann ich Craft Beer aus {region} online kaufen?", intent: "Kauf", language: "DE" },
  ],
  "Finance": [
    { text: "What sets the leading financial advisory firms in {region} apart?", intent: "Vergleich", language: "EN" },
    { text: "Which financial advisor in {region} has the best client reviews?", intent: "Vergleich", language: "EN" },
    { text: "What services does a typical financial advisory firm in {region} offer?", intent: "Info", language: "EN" },
    { text: "Who is the best independent wealth manager in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "What should I look for when choosing a financial advisor in {region}?", intent: "Info", language: "EN" },
    { text: "Where can I find a short-notice appointment for financial planning in {region}?", intent: "Kauf", language: "EN" },
    { text: "Compare the best wealth management providers in {region}.", intent: "Vergleich", language: "EN" },
    { text: "How do I book an appointment with a financial advisor in {region}?", intent: "Kauf", language: "EN" },
    { text: "What does independent financial advice cost in {region}?", intent: "Kauf", language: "EN" },
    { text: "Which financial advisor in {region} would you recommend for retirement planning?", intent: "Empfehlung", language: "EN" },
    { text: "Can you recommend a good tax advisor in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "What makes a good wealth management firm in {region}?", intent: "Info", language: "EN" },
  ],
  "Fitness": [
    { text: "Vergleiche die besten Supplement-Marken für Fitness und Training in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Wo gibt es in {region} gute Kurse für Fitness und Training?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Supplements für Fitness und Training in {region} sind empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Wo kann ich in {region} hochwertige Supplements von deutschen Marken kaufen?", intent: "Kauf", language: "DE" },
    { text: "Welche Fitness-Marken in {region} sollte man kennen?", intent: "Info", language: "DE" },
    { text: "Was ist das beste Fitnessstudio in {region} für Anfänger?", intent: "Empfehlung", language: "DE" },
    { text: "Welches Fitnessstudio in {region} hat die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Welche Fitnessstudios in {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Gibt es in {region} Boutique-Studios oder CrossFit-Boxen?", intent: "Info", language: "DE" },
    { text: "Ich suche ein Gym mit Personal Training in {region}. Was empfiehlst du?", intent: "Empfehlung", language: "DE" },
    { text: "Vergleiche die Fitnessstudios in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Was kostet eine Mitgliedschaft im Fitnessstudio in {region}?", intent: "Info", language: "DE" },
  ],
  "Gourmet Food": [
    { text: "Welche Food-Startups aus {region} sollte man kennen?", intent: "Info", language: "DE" },
    { text: "Gibt es Feinkost-Manufakturen in {region} mit eigenem Online-Shop?", intent: "Info", language: "DE" },
    { text: "Ich suche ein besonderes Feinkost-Geschenk aus {region}. Was empfiehlst du?", intent: "Kauf", language: "DE" },
    { text: "Was sind in {region} gute Alternativen zu Supermarkt-Feinkost?", intent: "Vergleich", language: "DE" },
    { text: "Wo bekomme ich in {region} Feinkost in Premium-Qualität, direkt vom Erzeuger?", intent: "Kauf", language: "DE" },
    { text: "Vergleiche die bekanntesten Anbieter für Feinkost in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Welcher Feinkost-Händler aus {region} hat die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Welche Delikatessen-Shops in {region} liefern deutschlandweit?", intent: "Kauf", language: "DE" },
    { text: "Was sind die besten kleinen Manufakturen für Feinkost in {region}?", intent: "Empfehlung", language: "DE" },
    { text: "Bio-Feinkost in {region}: welche Hersteller sind empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Wo kann ich in {region} hochwertige Feinkost online bestellen?", intent: "Kauf", language: "DE" },
    { text: "Welche Feinkost-Anbieter aus {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
  ],
  "Healthcare": [
    { text: "Which dentist in {region} would you recommend?", intent: "Empfehlung", language: "EN" },
    { text: "What should I look for when choosing a medical practice in {region}?", intent: "Info", language: "EN" },
    { text: "How do I get a short-notice appointment with a doctor in {region}?", intent: "Kauf", language: "EN" },
    { text: "What does a check-up cost in {region}?", intent: "Kauf", language: "EN" },
    { text: "What sets the leading medical practices in {region} apart?", intent: "Vergleich", language: "EN" },
    { text: "What services does a typical dermatology practice in {region} offer?", intent: "Info", language: "EN" },
    { text: "Where can I find a practice in {region} that also bills private insurance?", intent: "Kauf", language: "EN" },
    { text: "Who is the best dermatologist in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Can you recommend a good physiotherapy practice in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Compare the top-rated dentists in {region}.", intent: "Vergleich", language: "EN" },
    { text: "What makes a good dental practice in {region}?", intent: "Info", language: "EN" },
    { text: "Which practice in {region} has the shortest wait times?", intent: "Vergleich", language: "EN" },
  ],
  "Home Services": [
    { text: "Where can I find a home service company in {region} that's available right away?", intent: "Kauf", language: "EN" },
    { text: "What should I look for when choosing a home service company in {region}?", intent: "Info", language: "EN" },
    { text: "Who is the best electrician in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Which company in {region} has the fastest emergency response time?", intent: "Vergleich", language: "EN" },
    { text: "What services does a typical electrical company in {region} offer?", intent: "Info", language: "EN" },
    { text: "Compare the top-rated electricians in {region}.", intent: "Vergleich", language: "EN" },
    { text: "What does an emergency electrician cost in {region}?", intent: "Kauf", language: "EN" },
    { text: "How do I get a contractor on short notice in {region}?", intent: "Kauf", language: "EN" },
    { text: "Can you recommend a good plumbing company in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "What makes a good plumbing company in {region}?", intent: "Info", language: "EN" },
    { text: "Which contractor in {region} would you recommend for a bathroom renovation?", intent: "Empfehlung", language: "EN" },
    { text: "What sets the leading home service companies in {region} apart?", intent: "Vergleich", language: "EN" },
  ],
  "Legal": [
    { text: "What practice areas does a typical law firm in {region} cover?", intent: "Info", language: "EN" },
    { text: "Which law firm in {region} would you recommend for estate planning?", intent: "Empfehlung", language: "EN" },
    { text: "How do I book an initial consultation with a lawyer in {region}?", intent: "Kauf", language: "EN" },
    { text: "What should I look for when choosing a lawyer in {region}?", intent: "Info", language: "EN" },
    { text: "Where can I find a lawyer in {region} who is available right away?", intent: "Kauf", language: "EN" },
    { text: "What makes a good law firm in {region}?", intent: "Info", language: "EN" },
    { text: "Which law firm in {region} has the best reviews for traffic law?", intent: "Vergleich", language: "EN" },
    { text: "What does a legal consultation cost in {region}?", intent: "Kauf", language: "EN" },
    { text: "Compare the most well-known firms for tenant law in {region}.", intent: "Vergleich", language: "EN" },
    { text: "Can you recommend a good family law firm in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Who is the best employment lawyer in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "What are the differences between the leading law firms in {region}?", intent: "Vergleich", language: "EN" },
  ],
  "Real Estate": [
    { text: "What makes a good real estate agent in {region}?", intent: "Info", language: "EN" },
    { text: "What should I look for when choosing a real estate agent in {region}?", intent: "Info", language: "EN" },
    { text: "What services does a typical agent in {region} offer?", intent: "Info", language: "EN" },
    { text: "Where can I find an agent in {region} for a quick property valuation?", intent: "Kauf", language: "EN" },
    { text: "What does a real estate agent cost in {region}?", intent: "Kauf", language: "EN" },
    { text: "Which agent in {region} sells properties the fastest?", intent: "Vergleich", language: "EN" },
    { text: "Can you recommend a good commercial real estate agent in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Who is the best agent for selling apartments in {region}?", intent: "Empfehlung", language: "EN" },
    { text: "Which real estate agent in {region} would you recommend?", intent: "Empfehlung", language: "EN" },
    { text: "Compare the top-rated agents in {region}.", intent: "Vergleich", language: "EN" },
    { text: "What sets the leading real estate agents in {region} apart?", intent: "Vergleich", language: "EN" },
    { text: "How do I hire an agent to sell my house in {region}?", intent: "Kauf", language: "EN" },
  ],
  "Restaurants": [
    { text: "Wo gibt es in {region} gutes Frühstück oder Brunch?", intent: "Empfehlung", language: "DE" },
    { text: "Welches Café in {region} hat die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Gibt es in {region} Restaurants mit regionaler Küche und eigener Website?", intent: "Info", language: "DE" },
    { text: "Was ist das beste Restaurant für Feinschmecker in {region}?", intent: "Empfehlung", language: "DE" },
    { text: "Vergleiche die besten Restaurants für regionale Küche in {region}.", intent: "Vergleich", language: "DE" },
    { text: "Welche neuen Restaurants in {region} sollte man 2026 ausprobieren?", intent: "Info", language: "DE" },
    { text: "Welche Bäckerei in {region} ist empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Wo kann ich in {region} einen Tisch für eine Gruppe reservieren?", intent: "Info", language: "DE" },
    { text: "Ich suche ein Restaurant in {region} für ein besonderes Abendessen. Ideen?", intent: "Empfehlung", language: "DE" },
    { text: "Catering in {region}: welche Anbieter sind empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Restaurants in {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Restaurants in {region} bieten Lieferung oder Abholung an?", intent: "Kauf", language: "DE" },
  ],
  "Wine": [
    { text: "Welche Weingüter aus {region} sind auf Instagram aktiv und einen Blick wert?", intent: "Info", language: "DE" },
    { text: "Ich möchte Wein als Geschenk kaufen, regional aus {region}. Ideen?", intent: "Kauf", language: "DE" },
    { text: "Vergleiche die bekanntesten Weingüter aus {region}.", intent: "Vergleich", language: "DE" },
    { text: "Welche Weingüter in {region} liefern direkt an Endkunden?", intent: "Kauf", language: "DE" },
    { text: "Welcher Winzer aus {region} hat die besten Bewertungen?", intent: "Vergleich", language: "DE" },
    { text: "Ich suche ein Weingut in {region} für eine Weinprobe. Was empfiehlst du?", intent: "Empfehlung", language: "DE" },
    { text: "Welche Weingüter aus {region} kannst du empfehlen?", intent: "Empfehlung", language: "DE" },
    { text: "Bio-Wein aus {region}: welche Erzeuger sind empfehlenswert?", intent: "Empfehlung", language: "DE" },
    { text: "Was ist ein gutes Weingut für Wein unter 20 Euro in {region}?", intent: "Kauf", language: "DE" },
    { text: "Wo kann ich guten Wein aus {region} online kaufen?", intent: "Kauf", language: "DE" },
    { text: "Was sind die besten kleinen Weingüter in {region}?", intent: "Empfehlung", language: "DE" },
    { text: "Gibt es Weingüter in {region} mit eigenem Online-Shop?", intent: "Info", language: "DE" },
  ],
};

/**
 * Select 6 prompts from the vertical for a GEO-Check run.
 * Priority:
 * 1. Empfehlung or Vergleich with {region} placeholder
 * 2. Any intent with {region} placeholder
 * 3. Remaining prompts (no placeholder) to fill up to 6
 * Never pick prompts without any placeholder as first priority.
 */
export function selectCheckPrompts(vertical: string, count = 6): {text: string; intent: string; language: string}[] {
  const prompts = PROMPTS_BY_VERTICAL[vertical];
  if (!prompts || prompts.length === 0) return [];

  // Tier 1: Empfehlung/Vergleich with {region}
  const tier1 = prompts.filter(p =>
    (p.intent === "Empfehlung" || p.intent === "Vergleich") &&
    p.text.includes("{region}")
  );

  // Tier 2: Any intent with {region}
  const tier2 = prompts.filter(p =>
    p.text.includes("{region}") &&
    !tier1.includes(p)
  );

  // Tier 3: Rest (no {region})
  const tier3 = prompts.filter(p =>
    !tier1.includes(p) && !tier2.includes(p)
  );

  const selected = [...tier1, ...tier2, ...tier3].slice(0, count);
  return selected;
}

/** Build a prompt string by replacing placeholders */
export function buildPrompt(template: string, vertical: string, region: string): string {
  return template
    .replace(/{vertical}/g, vertical)
    .replace(/{region}/g, region);
}

/** Build prompts for the Check from selected prompts */
export function buildCheckPrompts(vertical: string, region: string): string[] {
  const selected = selectCheckPrompts(vertical);
  return selected.map(p => buildPrompt(p.text, vertical, region));
}

// ─── Vertical inference for "Other" ───

const VERTICAL_KEYWORDS: [string, ValidVertical][] = [
  ["wein", "Wine"], ["wine", "Wine"], ["weingut", "Wine"], ["keller", "Wine"],
  ["feinkost", "Gourmet Food"], ["gourmet", "Gourmet Food"], ["delikatessen", "Gourmet Food"],
  ["brau", "Craft Beer"], ["bier", "Craft Beer"], ["beer", "Craft Beer"],
  ["fitness", "Fitness"], ["gym", "Fitness"], ["training", "Fitness"], ["crossfit", "Fitness"],
  ["restaurant", "Restaurants"], ["gastro", "Restaurants"], ["cuisine", "Restaurants"], ["pizzeria", "Restaurants"],
  ["beauty", "Beauty & Wellness"], ["wellness", "Beauty & Wellness"], ["spa", "Beauty & Wellness"], ["kosmetik", "Beauty & Wellness"],
  ["anwalt", "Legal"], ["kanzlei", "Legal"], ["law", "Legal"], ["recht", "Legal"],
  ["bank", "Finance"], ["finanz", "Finance"], ["versicherung", "Finance"], ["finance", "Finance"],
  ["arzt", "Healthcare"], ["klinik", "Healthcare"], ["medical", "Healthcare"], ["praxis", "Healthcare"],
  ["immobilien", "Real Estate"], ["makler", "Real Estate"], ["property", "Real Estate"],
  ["reinigung", "Home Services"], ["handwerk", "Home Services"], ["dienstleistung", "Home Services"],
  ["software", "AI & SaaS"], ["saas", "AI & SaaS"],
];

export function inferVerticalFromTitle(title: string): ValidVertical {
  const lower = title.toLowerCase();
  for (const [keyword, vertical] of VERTICAL_KEYWORDS) {
    if (lower.includes(keyword)) return vertical;
  }
  return "Other";
}

export function resolveVertical(vertical: string, title?: string): ValidVertical {
  if (vertical === "Other" && title) {
    return inferVerticalFromTitle(title);
  }
  return normalizeVertical(vertical);
}

// ─── Other: Descriptor-based prompts ───

/** 6 German templates for "Other" vertical */
export const OTHER_TEMPLATES = [
  "Welche Anbieter für {descriptor} in {region} kannst du empfehlen?",
  "Ich suche {descriptor} in {region}. Was empfiehlst du?",
  "Vergleiche die besten Anbieter für {descriptor} in {region}.",
  "Wo kann ich {descriptor} in {region} finden?",
  "Welcher Anbieter für {descriptor} in {region} hat die besten Bewertungen?",
  "Gibt es in {region} Anbieter für {descriptor} mit eigenem Online-Shop?",
];

export function buildOtherPrompts(descriptor: string, region: string): string[] {
  return OTHER_TEMPLATES.map((t) =>
    t.replace(/{descriptor}/g, descriptor).replace(/{region}/g, region),
  );
}

/**
 * Normalize text for comparison: lowercase, fold diacritics, strip spaces/signs.
 */
function normalizeForGuard(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/ss/g, "s")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Longest common subsequence length between two strings.
 */
function lcsLength(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  // Optimize: only need two rows
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

/**
 * Extract a business descriptor (German noun phrase) from page title and meta description.
 * Returns { descriptor, confidence } where confidence is 0-1.
 * Returns null descriptor when extraction fails (triggers C2 fallback).
 *
 * CRITICAL: The descriptor must be the TYPE OF BUSINESS, never the brand name.
 * Brand guard is mandatory — see references/other-vertical-spec.md.
 */
export function extractBusinessDescriptor(
  title: string,
  description: string | null,
  domain?: string,
  brandName?: string,
): { descriptor: string | null; confidence: number } {
  // ─── Generic/boilerplate words to strip ───
  const STRIP = new Set([
    "home", "startseite", "willkommen", "willkommen bei",
    "offizielle website", "offizieller", "online shop", "online-shop",
    "ihre", "deine", "mein", "unser", "unsere",
    "wir", "bei", "der", "die", "das", "den", "dem", "des",
    "ein", "eine", "einer", "eines", "einem", "einen",
    "gmbh", "ug", "kg", "ag", "ohg", "ec", "ev",
    "hamburg", "berlin", "münchen", "köln", "frankfurt", "deutschland",
    "de", "at", "ch", "com", "shop", "portal",
    "seite", "site", "webseite", "website",
  ]);

  // ─── Empty noun rejection list (also triggers C2) ───
  // These describe no business type — brand guard won't catch them
  const EMPTY_NOUNS = new Set([
    "webseite", "website", "startseite", "home", "willkommen",
    "unternehmen", "firma", "geschäft", "online-shop", "portal",
    "seite", "shop", "dienstleistung", "anbieter", "service",
  ]);

  // ─── Build brand/domain guard tokens ───
  const guardTokens: string[] = [];
  if (brandName) {
    const core = normalizeForGuard(brandName);
    if (core.length >= 4) guardTokens.push(core);
    // Also add individual tokens of 4+ chars
    for (const t of core.split(/[^a-z0-9]+/)) {
      if (t.length >= 4) guardTokens.push(t);
    }
  }
  if (domain) {
    const domainCore = normalizeForGuard(domain.split(".")[0]);
    if (domainCore.length >= 4) guardTokens.push(domainCore);
    for (const t of domainCore.split(/[^a-z0-9]+/)) {
      if (t.length >= 4) guardTokens.push(t);
    }
  }

  // ─── Combine title and description ───
  const text = `${title} ${description || ""}`.toLowerCase();

  // Split on separators — prefer segments AFTER separator (usually the description, not the brand)
  const segments = text.split(/\s*[-–—|·]\s*/);
  const candidates = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  // Reorder: try segments after the first one FIRST (description usually comes after brand)
  const ordered = candidates.length > 1
    ? [...candidates.slice(1), candidates[0]]
    : candidates;

  // ─── Try each segment for descriptor extraction ───
  for (const segment of ordered) {
    const words = segment.split(/\s+/).filter((w) => w.length > 1);

    // Remove generic/boilerplate words
    const meaningful = words.filter((w) => {
      const clean = w.replace(/[^a-zäöüß]/g, "");
      return clean.length > 1 && !STRIP.has(clean);
    });

    if (meaningful.length === 0) continue;

    const descriptor = meaningful.slice(0, 4).join(" ");
    const descriptorNorm = normalizeForGuard(descriptor);

    // ─── Brand guard: reject if descriptor matches brand/domain ───
    // Uses word-level matching (not character LCS) to avoid false positives
    // like "handmade jewelry" being rejected against "konterfey"
    if (guardTokens.length > 0) {
      const descWords = descriptorNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
      const isRejected = guardTokens.some((token) => {
        // Word-level: exact match or word contains/is contained by token
        if (descWords.some((dw) => dw === token || token.includes(dw) || dw.includes(token))) {
          return true;
        }
        // Substring: full descriptor contains brand/domain or vice versa
        if (descriptorNorm.includes(token) || token.includes(descriptorNorm)) {
          return true;
        }
        return false;
      });
      if (isRejected) continue; // Skip this candidate, try next segment
    }

    // ─── Empty noun rejection ───
    const allMeaningfulNorm = meaningful.map((w) => normalizeForGuard(w));
    const allEmpty = allMeaningfulNorm.every((w) => EMPTY_NOUNS.has(w));
    if (allEmpty) continue;

    // ─── Confidence scoring (note: word-count based, part of the bug — see spec) ───
    let confidence = 0;
    if (meaningful.length >= 2) confidence = 0.7;
    if (meaningful.length >= 3) confidence = 0.85;
    if (meaningful.length >= 4) confidence = 0.9;
    const businessWords = [
      "anbieter", "dienstleistung", "laden", "geschäft", "studio",
      "werkstatt", "betrieb", "firma", "hersteller", "produkt",
      "beratung", "service", "kurse", "behandlung", "pflege",
      "montage", "reparatur", "planung",
    ];
    if (meaningful.some((w) => businessWords.some((bw) => w.includes(bw)))) {
      confidence = Math.min(confidence + 0.1, 1);
    }

    return { descriptor, confidence };
  }

  // All candidates rejected or no meaningful content → C2 fallback
  return { descriptor: null, confidence: 0 };
}
