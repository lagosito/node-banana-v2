// GEO Audit — Response analyzer (Claude via OpenRouter)
// Single + Batch modes. Batch sends all responses in one call (Haiku for cost).

import type { AnalysisOutput } from "./types";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const SYSTEM_PROMPT = `Du bist ein Experte für die Analyse von KI-Antworten im Kontext von Markensichtbarkeit (GEO Audit).

REGELN:
1. brand_mentioned: TRUE wenn der Markenname, eine Variante oder der Domain-Name irgendwo in der Antwort vorkommt.
2. mention_position: Die 1-basierte Position der Marke in der Reihenfolge der Erwähnungen. 0 wenn nicht erwähnt.
3. sentiment: "positiv" wenn die Marke lobend erwähnt wird, "negativ" bei Kritik, "neutral" bei sachlicher Erwähnung, "n/a" wenn nicht erwähnt.
4. brand_domain_cited: TRUE wenn die Website der Marke als Quelle verlinkt oder als URL genannt wird.
5. cited_domains: Alle Domains die als Quellen genannt/verlinkt werden (nur Domains, keine Pfade).
6. competitors_mentioned: Marken/Unternehmen die im selben Kontext wie die Zielmarke genannt werden.

TOLERANZ FÜR MARKEN-MATCHING:
- Weingut Müller = Weingut Mueller = weingut-mueller.de = Mueller Weine = alle sind dieselbe Marke
- Berücksichtige Pluralformen, Kurzformen, Domains, Social-Media-Handles`;

const BATCH_SYSTEM_PROMPT = `Du bist ein Experte für die Analyse von KI-Antworten im Kontext von Markensichtbarkeit (GEO Audit).

Du erhältst ein Array von KI-Antworten mit IDs. Analysiere JEDE Antwort einzeln auf:
1. brand_mentioned (boolean)
2. mention_position (1-basiert, 0 wenn nicht erwähnt)
3. sentiment ("positiv"|"neutral"|"negativ"|"n/a")
4. brand_domain_cited (boolean)
5. cited_domains (array von Domains)
6. competitors_mentioned (array von Marken)

TOLERANZ: Weingut Müller = Mueller = weingut-mueller.de = alle sind dieselbe Marke.

Antworte mit einem JSON-Objekt: { "results": { "<id>": { ... analysis fields ... }, ... } }
Jede ID muss ein vollständiges Analyse-Ergebnis haben.`;

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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as AnalysisOutput;

  return {
    brand_mentioned: Boolean(parsed.brand_mentioned),
    mention_position: Number(parsed.mention_position) || 0,
    sentiment: ["positiv", "neutral", "negativ", "n/a"].includes(parsed.sentiment)
      ? parsed.sentiment : "n/a",
    brand_domain_cited: Boolean(parsed.brand_domain_cited),
    cited_domains: Array.isArray(parsed.cited_domains) ? parsed.cited_domains : [],
    competitors_mentioned: Array.isArray(parsed.competitors_mentioned)
      ? parsed.competitors_mentioned : [],
  };
}

// ─── Batch analysis: 1 call for N responses (Haiku for cost) ───

export async function analyzeResponseBatch(
  responses: { id: string; text: string }[],
  brandName: string,
  brandDomain: string,
  aliases: string[],
): Promise<Record<string, AnalysisOutput>> {
  if (responses.length === 0) return {};

  // Truncate each response to ~4000 chars (Haiku 200K context — 4×4000 is safe)
  const truncated = responses.map((r) => ({
    id: r.id,
    text: r.text.slice(0, 4000),
  }));

  const userPrompt = `Analysiere diese ${responses.length} KI-Antworten:

ZIELMARKE: ${brandName}
DOMÄNE: ${brandDomain}
ALIASE: ${aliases.join(", ")}

${truncated.map((r) => `=== ID: ${r.id} ===\n${r.text}\n=== ENDE ===`).join("\n\n")}

Liefere ein JSON mit "results" Objekt, eine Analyse pro ID.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://elkiosk.ai",
      "X-Title": "GEO Audit Batch Analyzer",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: BATCH_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Batch Analyzer ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);

  const results: Record<string, AnalysisOutput> = {};
  const rawResults = parsed.results || parsed;

  for (const r of responses) {
    const a = rawResults[r.id] || {};
    results[r.id] = {
      brand_mentioned: Boolean(a.brand_mentioned),
      mention_position: Number(a.mention_position) || 0,
      sentiment: ["positiv", "neutral", "negativ", "n/a"].includes(a.sentiment)
        ? a.sentiment : "n/a",
      brand_domain_cited: Boolean(a.brand_domain_cited),
      cited_domains: Array.isArray(a.cited_domains) ? a.cited_domains : [],
      competitors_mentioned: Array.isArray(a.competitors_mentioned)
        ? a.competitors_mentioned : [],
    };
  }

  return results;
}
