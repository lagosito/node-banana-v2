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
// Old reports in Supabase have verticals in German. Map them to the new
// English tokens so they don't break. Reverse-map kept for display.

const DE_TO_EN: Record<string, ValidVertical> = {
  Wein: "Wine",
  Feinkost: "Gourmet Food",
  "Craft Beer": "Craft Beer",
  Fitness: "Fitness",
  Gastro: "Restaurants",
};

export function normalizeVertical(raw: string): ValidVertical {
  // Already English valid token
  if ((VALID_VERTICALS as readonly string[]).includes(raw)) {
    return raw as ValidVertical;
  }
  // German legacy token → English
  const mapped = DE_TO_EN[raw];
  if (mapped) return mapped;
  // Unknown → Other
  return "Other";
}

export function isValidVertical(vertical: string): boolean {
  // Accept both English and German legacy tokens
  return (
    (VALID_VERTICALS as readonly string[]).includes(vertical) ||
    vertical in DE_TO_EN
  );
}

// ─── Prompts (shared between quick, full, and llm endpoints) ───

export const QUICK_PROMPTS = [
  "Which {vertical} in {region} would you recommend?",
  "What are the best {vertical} in {region}?",
  "Which {vertical} in {region} are particularly popular?",
  "What are top-rated {vertical} options in {region}?",
  "Can you suggest reliable {vertical} in {region}?",
  "Which {vertical} in {region} have the best reputation?",
];

export const FULL_PROMPTS = [
  "Which {vertical} in {region} would you recommend?",
  "What are the best {vertical} in {region}?",
  "Which {vertical} in {region} are particularly popular?",
];

export function buildPrompt(template: string, vertical: string, region: string): string {
  return template.replace(/{vertical}/g, vertical).replace(/{region}/g, region);
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

/**
 * Infer a real vertical from page title when user selected "Other".
 */
export function inferVerticalFromTitle(title: string): ValidVertical {
  const lower = title.toLowerCase();
  for (const [keyword, vertical] of VERTICAL_KEYWORDS) {
    if (lower.includes(keyword)) return vertical;
  }
  return "Other";
}

/** Resolve vertical: if "Other", infer from title. Otherwise return as-is. */
export function resolveVertical(vertical: string, title?: string): ValidVertical {
  if (vertical === "Other" && title) {
    return inferVerticalFromTitle(title);
  }
  return normalizeVertical(vertical);
}

// ─── Other: Descriptor-based prompts ───

/** 6 German templates for "Other" vertical — uses "Anbieter für" to avoid pluralization issues */
export const OTHER_TEMPLATES = [
  "Welche Anbieter für {descriptor} in {region} kannst du empfehlen?",
  "Ich suche {descriptor} in {region}. Was empfiehlst du?",
  "Vergleiche die besten Anbieter für {descriptor} in {region}.",
  "Wo kann ich {descriptor} in {region} finden?",
  "Welcher Anbieter für {descriptor} in {region} hat die besten Bewertungen?",
  "Gibt es in {region} Anbieter für {descriptor} mit eigenem Online-Shop?",
];

/** Build prompts for "Other" vertical using descriptor extracted from crawl */
export function buildOtherPrompts(descriptor: string, region: string): string[] {
  return OTHER_TEMPLATES.map((t) =>
    t.replace(/{descriptor}/g, descriptor).replace(/{region}/g, region),
  );
}

/**
 * Extract a business descriptor (German noun phrase) from page title and meta description.
 * Returns { descriptor, confidence } where confidence is 0-1.
 * Returns null descriptor when extraction fails.
 */
export function extractBusinessDescriptor(
  title: string,
  description: string | null,
): { descriptor: string | null; confidence: number } {
  // Generic words to strip (brand-like, navigation, boilerplate)
  const STRIP = new Set([
    "home", "startseite", "willkommen", "willkommen bei",
    "offizielle website", "offizieller", "online shop", "online-shop",
    "ihre", "deine", "mein", "unser", "unsere",
    "gmbh", "ug", "kg", "ag", "ohg", "ec", "ev",
    "hamburg", "berlin", "münchen", "köln", "frankfurt", "deutschland",
    "de", "at", "ch", "com", "de", "shop", "portal",
    "seite", "site", "webseite", "website",
  ]);

  // Combine title and description
  const text = `${title} ${description || ""}`.toLowerCase();

  // Remove brand-like segments (before " - ", " | ", " – ", " — ")
  const segments = text.split(/\s*[-–—|]\s*/);
  // Use the last segment (often the business descriptor) or the longest one
  const candidates = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  // Try each segment for descriptor extraction
  for (const segment of candidates) {
    // Split into words
    const words = segment.split(/\s+/).filter((w) => w.length > 1);

    // Remove generic/boilerplate words
    const meaningful = words.filter((w) => {
      const clean = w.replace(/[^a-zäöüß]/g, "");
      return clean.length > 1 && !STRIP.has(clean);
    });

    if (meaningful.length === 0) continue;

    // Take the meaningful words as descriptor (max 4 words to keep it concise)
    const descriptor = meaningful.slice(0, 4).join(" ");

    // Confidence scoring
    let confidence = 0;
    if (meaningful.length >= 2) confidence = 0.7;
    if (meaningful.length >= 3) confidence = 0.85;
    if (meaningful.length >= 4) confidence = 0.9;

    // Boost confidence if German business words are present
    const businessWords = [
      "anbieter", "dienstleistung", "laden", "geschäft", "studio",
      "werkstatt", "betrieb", "firma", "hersteller", "produkt",
      "beratung", "service", "kurse", "behandlung", "pflege",
      "montage", "reparatur", "planung", "beratung",
    ];
    if (meaningful.some((w) => businessWords.some((bw) => w.includes(bw)))) {
      confidence = Math.min(confidence + 0.1, 1);
    }

    return { descriptor, confidence };
  }

  return { descriptor: null, confidence: 0 };
}
