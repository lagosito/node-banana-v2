// GEO Audit — Response analyzer (Claude via OpenRouter, structured output)

import type { AnalysisOutput } from "./types";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const SYSTEM_PROMPT = `Du bist ein Experte für die Analyse von KI-Antworten im Kontext von Markensichtbarkeit (GEO Audit).

Du analysierst eine KI-Antwort (z.B. von ChatGPT, Perplexity oder Gemini) und prüfst, ob eine bestimmte Marke darin erwähnt wird.

REGELN:
1. brand_mentioned: TRUE wenn der Markenname, eine Variante oder der Domain-Name irgendwo in der Antwort vorkommt (auch in Listen, Tabellen, Absätzen).
2. mention_position: Die 1-basierte Position der Marke in der Reihenfolge der Erwähnungen. 0 wenn nicht erwähnt.
3. sentiment: "positiv" wenn die Marke lobend/polemisch erwähnt wird, "negativ" bei Kritik/Warnung, "neutral" bei sachlicher Erwähnung, "n/a" wenn nicht erwähnt.
4. brand_domain_cited: TRUE wenn die Website der Marke als Quelle verlinkt oder als URL genannt wird.
5. cited_domains: Alle Domains die als Quellen genannt/verlinkt werden (nur Domains, keine Pfade).
6. competitors_mentioned: Marken/Unternehmen die im selben Kontext wie die Zielmarke genannt werden (Konkurrenzprodukte, Alternativen). Keine allgemeinen Begriffe wie "Weingüter" oder "Restaurants".

TOLERANZ FÜR MARKEN-MATCHING:
- Weingut Müller = Weingut Mueller = weingut-mueller.de = Mueller Weine = alle sind dieselbe Marke
- Berücksichtige Pluralformen, Kurzformen, Domains, Social-Media-Handles

Antworte NUR mit einem gültigen JSON-Objekt, keine Erklärungen.`;

export async function analyzeResponse(
  responseText: string,
  brandName: string,
  brandDomain: string,
  aliases: string[],
): Promise<AnalysisOutput> {
  const userPrompt = `Analysiere diese KI-Antwort:

=== KI-ANTWORT ===
${responseText}
=== ENDE ===

ZIELMARKE: ${brandName}
DOMÄNE: ${brandDomain}
ALIASE: ${aliases.join(", ")}

Liefere das JSON-Ergebnis.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://elkiosk.ai",
      "X-Title": "GEO Audit Analyzer",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Analyzer ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Parse with strict validation
  const parsed = JSON.parse(cleaned) as AnalysisOutput;

  return {
    brand_mentioned: Boolean(parsed.brand_mentioned),
    mention_position: Number(parsed.mention_position) || 0,
    sentiment: ["positiv", "neutral", "negativ", "n/a"].includes(parsed.sentiment)
      ? parsed.sentiment
      : "n/a",
    brand_domain_cited: Boolean(parsed.brand_domain_cited),
    cited_domains: Array.isArray(parsed.cited_domains) ? parsed.cited_domains : [],
    competitors_mentioned: Array.isArray(parsed.competitors_mentioned)
      ? parsed.competitors_mentioned
      : [],
  };
}
