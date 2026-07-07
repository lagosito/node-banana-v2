// GEO Audit — Fase 4: Findings generator (Claude via OpenRouter)

import type { ScoreBreakdown } from "./runner";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const RECOMMENDATION_MENU = [
  "llms.txt anlegen",
  "Schema.org LocalBusiness/Product implementieren",
  "FAQ-Seiten mit direkten Antworten (BLUF) erstellen",
  "Einträge in zitierten Verzeichnissen/Presseportalen anlegen",
  "Google Business Profile optimieren",
  "Produktseiten mit klaren Fakten statt Marketing-Text gestalten",
  "Wikipedia/Wikidata Präsenz prüfen und aufbauen",
];

export interface Finding {
  category: string;
  finding: string;
  recommendation: string;
  priority: number;
}

export async function generateFindings(
  brandName: string,
  vertical: string,
  region: string,
  score: ScoreBreakdown,
  topCompetitors: string[],
  citedDomains: string[],
  totalRuns: number,
  mentions: number,
): Promise<Finding[]> {
  const systemPrompt = `Du bist ein GEO-Audit Experte. Du analysierst die Ergebnisse eines Markensichtbarkeits-Audits und generierst genau 5 konkrete Empfehlungen auf Deutsch.

REGELN:
1. Genau 5 Findings, jedes mit Category, Finding, Recommendation und Priority (1=highest, 5=lowest).
2. Jede Empfehlung muss aus dem erlaubten Menú stammen (oder eine logische Ableitung davon sein).
3. Kategorien: Sichtbarkeit, Zitate, Wettbewerb, Content, Technik.
4. Prioritäten: 1 = dringend, 5 = nice-to-have. Mindestens eine Priority 1 oder 2.
5. Keine Marketing-Floskeln. Jede Empfehlung muss spezifisch und umsetzbar sein.
6. Antworte NUR mit einem gültigen JSON-Array.

ERLAUBTES MENÜ FÜR EMPFEHLUNGEN:
${RECOMMENDATION_MENU.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

  const userPrompt = `GEO-Audit Ergebnisse für ${brandName} (${vertical}, ${region}):

GEO Score: ${score.total}/100
- Mention Rate: ${score.mentionRate}% (gewichtet: ${score.mentionWeighted})
- Position: ${score.positionAvg} (gewichtet: ${score.positionWeighted})
- Citation Rate: ${score.citationRate}% (gewichtet: ${score.citationWeighted})
- Sentiment: ${score.sentimentRate}% (gewichtet: ${score.sentimentWeighted})
- Share of Voice: ${score.sov}% (gewichtet: ${score.sovWeighted})

Runs: ${mentions} Erwähnungen von ${totalRuns} Runs
Top-Konkurrenten: ${topCompetitors.join(", ")}
Zitierte Domains: ${citedDomains.length > 0 ? citedDomains.join(", ") : "Keine"}

Generiere genau 5 Empfehlungen als JSON-Array.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://elkiosk.ai",
      "X-Title": "GEO Audit Findings",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Findings generator ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "[]";

  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse findings JSON: ${cleaned.substring(0, 200)}`);
  }

  // Handle both array and object-with-key shapes
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Find the array inside the object
    const arrKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    items = arrKey ? (obj[arrKey] as unknown[]) : [];
  } else {
    items = [];
  }

  const validCategories = ["Sichtbarkeit", "Zitate", "Wettbewerb", "Content", "Technik"];

  return items.slice(0, 5).map((item: any) => ({
    category: validCategories.includes(item.category) ? item.category : "Content",
    finding: String(item.finding || ""),
    recommendation: String(item.recommendation || ""),
    priority: Math.min(5, Math.max(1, Number(item.priority) || 3)),
  }));
}
