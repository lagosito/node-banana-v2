// GEO Audit — Findings generator (Claude via OpenRouter)
// Generates EXACTLY 5 findings, each mapped to a DISTINCT menu item.
// All numbers cited in findings come from the Results JSON.

import type { ScoreBreakdown } from "./runner";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

export const RECOMMENDATION_MENU = [
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
  const mentionRate = Math.round((mentions / totalRuns) * 1000) / 10;
  const sovRaw = totalRuns > 0 ? Math.round((mentions / (mentions + topCompetitors.length * totalRuns * 0.3)) * 1000) / 10 : 0;

  const systemPrompt = `Du bist ein GEO-Audit Experte. Generierst genau 5 Empfehlungen auf Deutsch.

HARTE REGELN:
1. Genau 5 Findings, jedes mit category, finding, recommendation, priority (1-5).
2. JEDES finding muss eine ANDERE Empfehlung aus dem Menú verwenden — keine Wiederholungen.
3. Die 5 Empfehlungen müssen jeweils zu einer dieser Kategorien passen: Sichtbarkeit, Zitate, Wettbewerb, Content, Technik.
4. JEDE Zahl die du im Finding-text nennst, MUSS exakt aus dem Audit-Stamm kommen — NICHT schätzen.
5. Keine Marketing-Floskeln. Spezifisch und umsetzbar.
6. NUR ein gültiges JSON-Array, keine Erklärungen.

ERLAUBTES MENÜ (jedes Item genau EINMAL verwenden):
${RECOMMENDATION_MENU.map((r, i) => `${i + 1}. ${r}`).join("\n")}

NUMMERISCHE DATEN AUS DEM AUDIT (nur diese Zahlen verwenden):
- GEO Score: ${score.total}/100
- Mention Rate: ${mentionRate}%
- Position (norm.): ${score.positionAvg}
- Citation Rate: ${score.citationRate}%
- Sentiment: ${score.sentimentRate}%
- Share of Voice: ${score.sov}%
- Erwähnungen: ${mentions} von ${totalRuns} Runs`;

  const userPrompt = `Audit-Ergebnisse für ${brandName} (${vertical}, ${region}):

Score ${score.total}/100 — ${score.total < 40 ? "Schwach" : score.total <= 70 ? "Mittel" : "Stark"}
- Mention Rate: ${mentionRate}% (${mentions}/${totalRuns})
- Citation Rate: ${score.citationRate}%
- Sentiment: ${score.sentimentRate}%
- Share of Voice: ${score.sov}%
- Top-Konkurrenten: ${topCompetitors.slice(0, 3).join(", ") || "Keine"}
- Zitierte Domains: ${citedDomains.length > 0 ? citedDomains.join(", ") : "Keine"}

Generiere genau 5 Empfehlungen (je eine aus dem Menú, keine Wiederholung).`;

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
    const arrKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    items = arrKey ? (obj[arrKey] as unknown[]) : [];
  } else {
    items = [];
  }

  const validCategories = ["Sichtbarkeit", "Zitate", "Wettbewerb", "Content", "Technik"];

  // Map each finding to nearest menu item if recommendation doesn't match
  const mapToMenu = (rec: string): string => {
    const lower = rec.toLowerCase();
    for (const item of RECOMMENDATION_MENU) {
      if (lower.includes(item.toLowerCase().substring(0, 15))) return item;
    }
    // Fallback: return as-is (will be caught by uniqueness check)
    return rec;
  };

  let findings: Finding[] = items.slice(0, 7).map((item: any) => ({
    category: validCategories.includes(item.category) ? item.category : "Content",
    finding: String(item.finding || ""),
    recommendation: mapToMenu(String(item.recommendation || "")),
    priority: Math.min(5, Math.max(1, Number(item.priority) || 3)),
  }));

  // UNIQUENESS: ensure each recommendation maps to a distinct menu item
  const seenMenuItems = new Set<string>();
  const uniqueFindings: Finding[] = [];
  for (const f of findings) {
    if (!seenMenuItems.has(f.recommendation)) {
      seenMenuItems.add(f.recommendation);
      uniqueFindings.push(f);
    }
    if (uniqueFindings.length >= 5) break;
  }

  // If we don't have 5 unique, pad from remaining menu items
  if (uniqueFindings.length < 5) {
    const remaining = RECOMMENDATION_MENU.filter((m) => !seenMenuItems.has(m));
    for (const menu of remaining) {
      if (uniqueFindings.length >= 5) break;
      uniqueFindings.push({
        category: "Content",
        finding: `${brandName} könnte von "${menu}" profitieren`,
        recommendation: menu,
        priority: 4,
      });
    }
  }

  // Re-prioritize: sort by priority, renumber
  uniqueFindings.sort((a, b) => a.priority - b.priority);

  return uniqueFindings.slice(0, 5);
}
