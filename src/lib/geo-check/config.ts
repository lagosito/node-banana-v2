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

/**
 * Resolve vertical: if "Other", infer from title. Otherwise return as-is.
 */
export function resolveVertical(vertical: string, title?: string): ValidVertical {
  if (vertical === "Other" && title) {
    return inferVerticalFromTitle(title);
  }
  return normalizeVertical(vertical);
}
