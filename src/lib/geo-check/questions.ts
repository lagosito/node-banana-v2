// GEO Check — Question generation from crawled page content
// Single LLM call produces 6 questions + brand tokens to avoid.

import { deUmlaut, reUmlaut } from "./index";

// ─── Types ───

export interface GeneratedQuestionsResult {
  questions: string[];
  brandTokens: string[];
  source: "generated" | "curated" | "descriptor";
  _rawGemini?: string; // debug: raw Gemini response
}

// ─── Generation prompt ───

const GENERATION_PROMPT = `Du analysierst die Website eines Unternehmens, um dessen Sichtbarkeit in KI-Antworten zu messen.

WEBSITE-DATEN
Titel: {title}
Beschreibung: {meta_description}

MARKE: {brand}
MARKT: {region}

AUFGABE
Schreibe genau 6 Fragen, die ein potenzieller Kunde einer KI stellen würde,
um ein Unternehmen wie dieses zu finden.

REGELN
• Fehlerfreies Deutsch, Substantive gross geschrieben.
• Die Marke "{brand}" darf in KEINER Frage vorkommen, auch nicht in Teilen.
• Frage nach der Kategorie, nicht nach der Firma.
• Passende Granularität: bei einer Marke nach Marken fragen, bei einem
    Laden nach Anbietern, bei einem Hersteller nach Herstellern.
• Der Markt "{region}" muss in jeder Frage vorkommen.
• Variiere die Absicht: Empfehlung, Vergleich, Kauf, Information.

Antworte NUR mit JSON:
{"fragen": [6 Strings], "markentoken": [Tokens der Marke, die in keiner Frage vorkommen dürfen, ohne Gattungsbegriffe wie 'Brauerei' oder 'Pilsner']}`;

// ─── LLM call (Gemini Flash, JSON mode) ───

async function callGeminiFlashJSON(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
          },
        }),
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Gemini timeout");
    throw err;
  }
}

// ─── Brand guard: normalize and check tokens ───

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
 * Check if a question contains any brand token.
 * Tokens are normalized (lowercase, umlauts folded both ways).
 */
function questionContainsBrandToken(
  question: string,
  brandTokens: string[],
): boolean {
  const qNorm = normalizeForGuard(question);
  return brandTokens.some((token) => {
    const tNorm = normalizeForGuard(token);
    return tNorm.length >= 2 && qNorm.includes(tNorm);
  });
}

/**
 * Filter questions through brand guard.
 * Returns only questions that don't contain any brand token.
 */
function filterQuestions(
  questions: string[],
  brandTokens: string[],
): string[] {
  return questions.filter((q) => !questionContainsBrandToken(q, brandTokens));
}

// ─── Public API ───

export interface GenerateQuestionsParams {
  title: string;
  metaDescription: string | null;
  bodyText1500: string;
  brand: string;
  region: string;
}

/**
 * Generate 6 questions for GEO-Check from crawled page content.
 * Returns filtered questions (brand-guarded) and the brand tokens used.
 * Returns null on failure (caller should fall back).
 */
export async function generateQuestions(
  params: GenerateQuestionsParams,
): Promise<GeneratedQuestionsResult | null> {
  const { title, metaDescription, bodyText1500, brand, region } = params;

  // Build prompt
  const prompt = GENERATION_PROMPT
    .replace("{title}", title)
    .replace("{meta_description}", metaDescription || "(keine)")
    .replace(/{brand}/g, brand)
    .replace(/{region}/g, region);

  let rawResponse = "";
  try {
    rawResponse = await callGeminiFlashJSON(prompt);

    // Parse JSON response — extract JSON object, ignore everything else
    let parsed: { fragen?: string[]; markentoken?: string[] };
    try {
      // Find the first { and last } to extract JSON
      const firstBrace = rawResponse.indexOf("{");
      const lastBrace = rawResponse.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const jsonStr = rawResponse.substring(firstBrace, lastBrace + 1);
        parsed = JSON.parse(jsonStr);
      } else {
        throw new Error("No JSON object found in response");
      }
    } catch {
      console.error("[GEO-Check] Question generation: invalid JSON response:", rawResponse.slice(0, 300));
      // Return with raw for debugging instead of null
      return { questions: [], brandTokens: [], source: "generated", _rawGemini: rawResponse.slice(0, 500) };
    }

    const questions = parsed.fragen;
    const brandTokens = parsed.markentoken || [];

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.error("[GEO-Check] Question generation: no questions in response. parsed:", JSON.stringify(parsed).slice(0, 300));
      return { questions: [], brandTokens: [], source: "generated", _rawGemini: rawResponse.slice(0, 500) };
    }

    // Normalize brand tokens: add both umlaut directions
    const normalizedTokens = new Set<string>();
    for (const token of brandTokens) {
      normalizedTokens.add(token);
      normalizedTokens.add(deUmlaut(token));
      normalizedTokens.add(reUmlaut(token));
    }

    // Also add the full brand name as a token (normalized)
    const brandNorm = deUmlaut(brand.toLowerCase());
    normalizedTokens.add(brandNorm);
    normalizedTokens.add(reUmlaut(brandNorm));

    // CRITICAL: Remove tokens that match the region — the prompt requires
    // the region name in every question, so filtering it would reject all questions.
    // e.g. brand "Landgang Brauerei Hamburg" region "Hamburg" → remove "hamburg"
    const regionNorm = normalizeForGuard(region);
    const tokenList = [...normalizedTokens].filter((t) => {
      const tNorm = normalizeForGuard(t);
      // Skip tokens ≤3 chars (too generic: "dm", "ag") — except if they're
      // distinctive brand tokens from the LLM
      if (tNorm.length <= 3 && !brandTokens.includes(t)) return false;
      // Skip tokens that match the region
      if (tNorm === regionNorm || regionNorm.includes(tNorm) || tNorm.includes(regionNorm)) return false;
      return true;
    });

    // Filter questions through brand guard
    const filtered = filterQuestions(questions, tokenList);

    if (filtered.length >= 6) {
      return {
        questions: filtered.slice(0, 6),
        brandTokens: tokenList,
        source: "generated",
      };
    }

    // Less than 6 clean questions — log and return what we have
    // The caller will fall back if needed
    console.warn(
      `[GEO-Check] Question generation: only ${filtered.length}/${questions.length} questions passed brand guard`,
    );
    return {
      questions: filtered,
      brandTokens: tokenList,
      source: "generated",
    };
  } catch (err) {
    console.error("[GEO-Check] Question generation failed:", err);
    // Return error info instead of null so caller can debug
    return { questions: [], brandTokens: [], source: "generated", _rawGemini: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
  }
}
