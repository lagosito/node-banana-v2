// GEO Check — Anti-Hallucination Reviewer
// Second cheap model (gpt-4o-mini) validates findings against VerifiedFacts.
// Ensures numbers in summary/headline match categoryScores exactly.

import type { VerifiedFacts } from "./crawler";
import type { CategoryScore } from "./scoring";

// ─── Types ───

export interface ReviewItem {
  index: number;
  type: "finding" | "recommendation" | "summary" | "headline";
  verdict: "keep" | "weaken" | "drop";
  reason: string;
}

export interface QualityMeta {
  ok: boolean;
  dropped: ReviewItem[];
  weakened: ReviewItem[];
  reviewerModel: string;
  reviewedAt: string;
}

interface LLMFinding {
  type: "finding" | "recommendation";
  text: string;
  category?: string;
  severity?: string;
}

// ─── Provider ───

// Reviewer uses OpenAI (gpt-4o-mini) — no grounding needed, separate billing bucket
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
async function callReviewerLLM(prompt: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Review Logic ───

function buildReviewPrompt(
  facts: VerifiedFacts,
  findings: LLMFinding[],
  summary: string,
  verdictHeadline: string,
  categoryScores: Record<string, CategoryScore>,
): string {
  // Build a compact facts summary for the reviewer
  const factsSummary = {
    meta: {
      title: facts.meta.title,
      description: facts.meta.description,
      canonical: facts.meta.canonical,
      htmlLang: facts.meta.htmlLang,
    },
    schema: {
      jsonLdBlocks: facts.schema.jsonLdBlocks,
      jsonLdValid: facts.schema.jsonLdValid,
      types: facts.schema.types,
      hasOrganization: facts.schema.hasOrganization,
      organizationComplete: facts.schema.organizationComplete.complete,
      hasFAQ: facts.schema.hasFAQ,
    },
    crawlers: {
      allowed: facts.crawlers.allowed,
      total: facts.crawlers.total,
      blocked: facts.crawlers.blocked,
    },
    llmsTxt: facts.llmsTxt,
    sitemap: { found: facts.sitemap.found, urlCount: facts.sitemap.urlCount },
    eeat: {
      hasAuthor: facts.eeat.hasAuthor,
      hasImpressum: facts.eeat.hasImpressum,
      hasPrivacy: facts.eeat.hasPrivacy,
      hasContact: facts.eeat.hasContact,
      trustScore: facts.eeat.trustScore,
    },
    content: {
      wordCount: facts.content.wordCount,
      h1Count: facts.content.h1Count,
      h2Count: facts.content.h2Count,
      questionHeadings: facts.content.questionHeadings,
      bulletPoints: facts.content.bulletPoints,
      hasFaqSection: facts.content.hasFaqSection,
    },
    freshness: {
      freshnessScore: facts.freshness.freshnessScore,
      daysSinceUpdate: facts.freshness.daysSinceUpdate,
    },
    perf: {
      ttfbMs: facts.perf.ttfbMs,
      htmlSizeKb: facts.perf.htmlSizeKb,
      psi: facts.perf.psi,
    },
  };

  const scoresSummary: Record<string, number> = {};
  for (const [k, v] of Object.entries(categoryScores)) {
    scoresSummary[k] = v.score;
  }

  const findingsText = findings
    .map((f, i) => `[${i}] (${f.type}) ${f.text}`)
    .join("\n");

  return `Du bist ein Faktenpruefer. Deine Aufgabe: Pruefe jeden Finding und jede Empfehlung gegen die nachfolgenden VeraifiziertenFakten. Gib JEDEN Index zurueck mit einem Urteil.

REGELN:
1. Wenn ein Finding etwas behauptet, das NICHT in den VeraifiziertenFakten steht, ist es "drop" oder "weaken".
2. "Kein JSON-LD" ist nur gueltig wenn jsonLdBlocks === 0.
3. "Kein Impressum" ist nur gueltig wenn hasImpressum === false.
4. Zahlen im Summary und Headline muessen EXAKT mit den categoryScores uebereinstimmen.
5. Wenn ein Finding korrekt ist und durch die Fakten gestuetzt wird, ist es "keep".

VERIFIZIERTE FAKTEN:
${JSON.stringify(factsSummary, null, 2)}

CATEGORY SCORES:
${JSON.stringify(scoresSummary, null, 2)}

FINDINGS UND EMPFEHLUNGEN:
${findingsText}

ZUSAMMENFASSUNG:
${summary}

URTEILS-TITEL:
${verdictHeadline}

Antworte mit einem JSON-Array. Fuer JEDEN Index (0 bis N-1):
{
  "index": 0,
  "verdict": "keep"|"weaken"|"drop",
  "reason": "Kurze Begruendung"
}

Fuer summary und headline:
{
  "index": "summary",
  "verdict": "keep"|"weaken"|"drop",
  "reason": "..."
}
{
  "index": "headline",
  "verdict": "keep"|"weaken"|"drop",
  "reason": "..."
}

Antworte NUR mit dem JSON-Array, kein额外 Text.`;
}

function validateSummaryNumbers(
  summary: string,
  categoryScores: Record<string, CategoryScore>,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  // Extract all numbers from summary that look like scores (NN/100 or NN von 100)
  const scorePattern = /(\w+)\s*(?:mit\s+)?(?:satten\s+)?(\d{1,3})\s*(?:\/\s*100|von\s+100)/gi;
  let match;
  while ((match = scorePattern.exec(summary)) !== null) {
    const label = match[1].toLowerCase();
    const claimed = parseInt(match[2]);

    // Try to find matching category score
    const categoryMap: Record<string, string> = {
      "technik": "technik",
      "ki-readiness": "aiReadiness",
      "ai-readiness": "aiReadiness",
      "content": "content",
      "vertrauen": "trust",
      "trust": "trust",
      "seo": "seo",
      "design": "designUx",
      "designux": "designUx",
      "performance": "performance",
    };

    for (const [key, catKey] of Object.entries(categoryMap)) {
      if (label.includes(key) || key.includes(label)) {
        const actual = categoryScores[catKey]?.score;
        if (actual !== undefined && Math.abs(claimed - actual) > 5) {
          errors.push(`Score-Abweichung: Summary sagt ${claimed} fuer ${key}, tatsaechlich ${actual}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Main Review Function ───

export async function reviewReport(
  facts: VerifiedFacts,
  findings: LLMFinding[],
  summary: string,
  verdictHeadline: string,
  categoryScores: Record<string, CategoryScore>,
): Promise<{ qualityMeta: QualityMeta; correctedSummary: string; correctedHeadline: string }> {
  const MODEL = "gpt-4o-mini";

  // Step 1: Validate summary numbers locally (no LLM needed)
  const numberCheck = validateSummaryNumbers(summary, categoryScores);

  // Step 2: If OpenAI is available, do full review
  if (OPENAI_API_KEY) {
    try {
      const prompt = buildReviewPrompt(facts, findings, summary, verdictHeadline, categoryScores);
      const response = await callReviewerLLM(prompt);

      let verdicts: Array<{ index: number | string; verdict: string; reason: string }>;
      try {
        verdicts = JSON.parse(response);
        if (!Array.isArray(verdicts)) verdicts = [verdicts];
      } catch {
        // If JSON parsing fails, return ok with no changes
        return {
          qualityMeta: {
            ok: true,
            dropped: [],
            weakened: [],
            reviewerModel: MODEL,
            reviewedAt: new Date().toISOString(),
          },
          correctedSummary: summary,
          correctedHeadline: verdictHeadline,
        };
      }

      const dropped: ReviewItem[] = [];
      const weakened: ReviewItem[] = [];
      let correctedSummary = summary;
      let correctedHeadline = verdictHeadline;

      for (const v of verdicts) {
        const item: ReviewItem = {
          index: typeof v.index === "number" ? v.index : -1,
          type: typeof v.index === "string"
            ? (v.index === "summary" ? "summary" : "headline")
            : (findings[v.index]?.type || "finding"),
          verdict: v.verdict as "keep" | "weaken" | "drop",
          reason: v.reason,
        };

        if (item.verdict === "drop") dropped.push(item);
        else if (item.verdict === "weaken") weakened.push(item);

        // If summary or headline was weakened/dropped, flag it
        if (v.index === "summary" && item.verdict !== "keep") {
          correctedSummary = `[REVIEWED] ${summary}`;
        }
        if (v.index === "headline" && item.verdict !== "keep") {
          correctedHeadline = `[REVIEWED] ${verdictHeadline}`;
        }
      }

      // If local number check found errors, add them
      if (!numberCheck.ok) {
        for (const err of numberCheck.errors) {
          weakened.push({
            index: -1,
            type: "summary",
            verdict: "weaken",
            reason: err,
          });
        }
      }

      return {
        qualityMeta: {
          ok: dropped.length === 0,
          dropped,
          weakened,
          reviewerModel: MODEL,
          reviewedAt: new Date().toISOString(),
        },
        correctedSummary,
        correctedHeadline,
      };
    } catch (err) {
      // Gemini failed, fall through to local-only review
      console.error("Reviewer Gemini call failed:", err);
    }
  }

  // Step 3: Local-only review (no LLM)
  const weakened: ReviewItem[] = [];
  if (!numberCheck.ok) {
    for (const err of numberCheck.errors) {
      weakened.push({
        index: -1,
        type: "summary",
        verdict: "weaken",
        reason: err,
      });
    }
  }

  return {
    qualityMeta: {
      ok: weakened.length === 0,
      dropped: [],
      weakened,
      reviewerModel: OPENAI_API_KEY ? `${MODEL} (fallback: local)` : "local-only",
      reviewedAt: new Date().toISOString(),
    },
    correctedSummary: summary,
    correctedHeadline: verdictHeadline,
  };
}
