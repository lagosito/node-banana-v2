// GEO Check — LLM endpoint (Phase 2: run providers + review)
// POST /api/geo-check/llm
// Body: { reportId: string }

import { NextRequest, NextResponse } from "next/server";
import { fetchBrandName, normalizeVertical, buildCheckPrompts, buildBrandAliases, extractCoreBrand, fetchPageTitle, buildOtherPrompts, extractBusinessDescriptor } from "@/lib/geo-check";
import { analyzeResponseBatch } from "@/lib/geo-audit/analyzer";
import {
  getReport,
  setReportStatus,
  setProviderStatus,
  setLlmResults,
} from "@/lib/geo-check/storage";
import type { ProviderName } from "@/lib/geo-check/storage";
import { reviewReport } from "@/lib/geo-check/reviewer";

// ─── CORS ───
export const maxDuration = 300; // Vercel Pro — 6 prompts x 3 providers need ~5min

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init?: ResponseInit) {
  const status = init?.status || 200;
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  return NextResponse.json(data, { status, headers });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Descriptor classifier (1 LLM call, long-tail only) ───

async function classifyDescriptor(
  rawDescriptor: string,
  title: string,
  description: string | null,
): Promise<{ descriptor: string; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { descriptor: rawDescriptor, confidence: 0.5 };

  const prompt = `Du bist ein Branchen-Klassifizierer. Extrahiere den Geschäftstyp aus den folgenden Informationen und gib ihn als maximal 2-Wörter auf Deutsch zurück.

Regeln:
- Maximal 2 Wörter
- Immer auf Deutsch, auch wenn die Quelle Englisch ist
- Geschäftstyp, nicht Markenname
- Keine Beschreibung, nur der Begriff

Beispiele:
- "Handmade Jewelry – Handcut golden silhouette pendants" → "Schmuck"
- "Organic Skincare & Wellness Products" → "Kosmetik"
- "Premium Craft Beer Brewery" → "Brauerei"
- "Fine Wine & Spirits" → "Weinhandel"
- "Italian Restaurant & Pizza" → "Restaurant"
- "Home Cleaning Services" → "Reinigungsdienst"

Titel: ${title}
Beschreibung: ${description || "(keine)"}
Rohdeskriptor: ${rawDescriptor}

Geschäftstyp (nur 1-2 Wörter auf Deutsch):`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
        }),
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return { descriptor: rawDescriptor, confidence: 0.5 };
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    // Clean up: remove quotes, periods, extra words
    const cleaned = text.replace(/["'`]/g, "").replace(/\.$/, "").trim();
    // Take first 2 words max
    const words = cleaned.split(/\s+/).slice(0, 2).join(" ");
    if (words.length >= 2) {
      return { descriptor: words, confidence: 0.8 };
    }
    return { descriptor: rawDescriptor, confidence: 0.5 };
  } catch {
    return { descriptor: rawDescriptor, confidence: 0.5 };
  }
}

// ─── Provider callers ───

const PROVIDER_TIMEOUT_MS = 30_000;

async function callGeminiWithGrounding(prompt: string): Promise<{ text: string; error?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", error: "GEMINI_API_KEY not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      return { text: "", error: `Gemini ${res.status}: ${err.slice(0, 200)}` };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { text };
  } catch (err: any) {
    if (err.name === "AbortError") return { text: "", error: "timeout" };
    return { text: "", error: String(err).slice(0, 200) };
  }
}

async function callOpenAIWithWebSearch(prompt: string): Promise<{ text: string; error?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: "", error: "OPENAI_API_KEY not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o",
        tools: [{ type: process.env.OPENAI_SEARCH_TOOL || "web_search_preview" }],
        input: prompt,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      return { text: "", error: `OpenAI ${res.status}: ${err.slice(0, 200)}` };
    }

    const data = await res.json();
    let text = "";
    for (const item of data.output || []) {
      if (item.type === "message" && item.content) {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text;
        }
      }
    }
    return { text };
  } catch (err: any) {
    if (err.name === "AbortError") return { text: "", error: "timeout" };
    return { text: "", error: String(err).slice(0, 200) };
  }
}

async function callPerplexitySonar(prompt: string): Promise<{ text: string; error?: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { text: "", error: "OPENROUTER_API_KEY not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://elkiosk.ai",
        "X-Title": "GEO Check",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      return { text: "", error: `Perplexity ${res.status}: ${err.slice(0, 200)}` };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { text };
  } catch (err: any) {
    if (err.name === "AbortError") return { text: "", error: "timeout" };
    return { text: "", error: String(err).slice(0, 200) };
  }
}

// ─── Provider dispatcher ───

const PROVIDERS: Record<ProviderName, (prompt: string) => Promise<{ text: string; error?: string }>> = {
  gemini: callGeminiWithGrounding,
  openai: callOpenAIWithWebSearch,
  perplexity: callPerplexitySonar,
};

function isProviderEnabled(name: ProviderName): boolean {
  if (name === "gemini") return !!process.env.GEMINI_API_KEY;
  if (name === "openai") return !!process.env.OPENAI_API_KEY;
  if (name === "perplexity") return !!process.env.OPENROUTER_API_KEY;
  return false;
}

// ─── POST handler ───

export async function POST(req: NextRequest) {
  try {
    const { reportId } = await req.json();

    if (!reportId) {
      return json({ error: "reportId is required" }, { status: 400 });
    }

    const report = await getReport(reportId);
    if (!report) {
      return json({ error: "Report not found" }, { status: 404 });
    }

    // Prevent double-run — return success if already completed
    if (report.status === "completed") {
      return json({ reportId: report.id, status: "completed", alreadyCompleted: true });
    }
    // If status is "running", previous run likely timed out — reset to allow retry
    if (report.status === "running") {
      await setReportStatus(report.id, "pending");
    }

    // Mark as running
    await setReportStatus(report.id, "running");

    const brandName = report.brand_name || await fetchBrandName(report.domain);
    const rawTitle = await fetchPageTitle(report.domain);
    const reportVertical = report.vertical || "Other";
    const region = report.region || "Deutschland";

    // Build prompts based on vertical type
    let prompts: string[];
    let verticalResolved = reportVertical;
    let otherDescriptor: string | null = null;

    if (reportVertical === "Other") {
      // C2: Extract descriptor from crawl — reject if confidence too low
      const metaDesc = report.verified_facts?.meta?.description || null;
      const { descriptor: rawDescriptor, confidence } = extractBusinessDescriptor(rawTitle || "", metaDesc, report.domain, brandName);

      if (!rawDescriptor || confidence < 0.5) {
        // C2: Fallback — don't waste 18 LLM calls on bad prompts
        await setReportStatus(report.id, "error");
        return json({
          error: "Wir konnten Ihre Branche nicht eindeutig bestimmen. Bitte wählen Sie eine Branche aus der Liste.",
          errorType: "descriptor_extraction_failed",
        }, { status: 422 });
      }

      // Classify raw descriptor into proper German business type (1 LLM call)
      const { descriptor: classifiedDescriptor } = await classifyDescriptor(
        rawDescriptor, rawTitle || "", metaDesc,
      );
      otherDescriptor = classifiedDescriptor;

      // Build descriptor-based prompts
      prompts = buildOtherPrompts(classifiedDescriptor, region);
      verticalResolved = `Other (descriptor: ${classifiedDescriptor})`;
    } else {
      // Standard vertical: use curated prompts from Prompt Library (6 of 12)
      const vertical = normalizeVertical(reportVertical);
      prompts = buildCheckPrompts(vertical, region);
    }

    // Log prompts for auditability (C1)
    console.log(`[GEO-Check] vertical=${reportVertical}, verticalResolved=${verticalResolved}`);
    console.log(`[GEO-Check] prompts:`, prompts);

    // Run all enabled providers in parallel (Promise.allSettled)
    const enabledProviders = (["gemini", "openai", "perplexity"] as ProviderName[]).filter(isProviderEnabled);

    if (enabledProviders.length === 0) {
      await setReportStatus(report.id, "error");
      return json({ error: "Keine LLM-Provider konfiguriert" }, { status: 500 });
    }

    // Mark all providers as "running" before starting (survives function timeout)
    for (const provider of enabledProviders) {
      await setProviderStatus(report.id, provider, { status: "running", queriesRun: 0, mentions: 0 });
    }

    const t0 = Date.now();

    // Run each provider with all prompts
    const providerPromises = enabledProviders.map(async (provider) => {
      const callFn = PROVIDERS[provider];
      const results: Array<{ prompt: string; text: string; error?: string }> = [];

      // Run prompts in batches of 3 to avoid rate limiting
      for (let i = 0; i < prompts.length; i += 3) {
        const batch = prompts.slice(i, i + 3);
        const batchResults = await Promise.allSettled(
          batch.map(async (prompt) => {
            const result = await callFn(prompt);
            return { prompt, text: result.text, error: result.error };
          }),
        );
        for (const r of batchResults) {
          if (r.status === "fulfilled") results.push(r.value);
          else results.push({ prompt: "batch_error", text: "", error: String(r.reason).slice(0, 200) });
        }
      }

      const providerStatus = {
        status: results.every((r) => r.error) ? "error" : results.some((r) => r.error) ? "partial" : "ok",
        queriesRun: results.length,
        mentions: 0, // updated below after Haiku analysis
        error: results.every((r) => r.error) ? results[0]?.error : undefined,
      };

      // Update provider status in DB immediately
      await setProviderStatus(report.id, provider, providerStatus);

      return { provider, results, providerStatus };
    });

    const settled = await Promise.allSettled(providerPromises);

    // Collect results
    const llmResults: Record<string, any> = {};
    const allResponses: Array<{ id: string; text: string; provider: string }> = [];
    const providerStatuses: Record<string, any> = {};

    for (const result of settled) {
      if (result.status === "fulfilled") {
        const { provider, results, providerStatus } = result.value;
        llmResults[provider] = results;
        providerStatuses[provider] = providerStatus;
        // Collect all non-error responses for Haiku analysis
        for (const r of results) {
          if (!r.error && r.text) {
            allResponses.push({ id: `${provider}-${r.prompt.slice(0, 30)}`, text: r.text, provider });
          }
        }
      } else {
        console.error("Provider promise rejected:", result.reason);
      }
    }

    // ─── Haiku batch analysis (same as quick mode) ───
    const aliases = buildBrandAliases(report.domain, brandName);
    const coreBrand = extractCoreBrand(brandName) || brandName;
    let totalMentions = 0;
    let totalQueries = allResponses.length;
    const allCompetitorCounts: Record<string, number> = {};
    const allAnalysisDetails: Record<string, any> = {};
    let analyses: Record<string, any> = {};

    // ─── FIX 2+3: Track mentions AND avgPosition per provider ───
    const providerMentions: Record<string, number> = {};
    const providerPositionSum: Record<string, number> = {};
    const providerPositionCount: Record<string, number> = {};
    for (const provider of enabledProviders) {
      providerMentions[provider] = 0;
      providerPositionSum[provider] = 0;
      providerPositionCount[provider] = 0;
    }

    if (allResponses.length > 0) {
      try {
        analyses = await analyzeResponseBatch(
          allResponses.map((r) => ({ id: r.id, text: r.text })),
          coreBrand,
          report.domain,
          aliases,
        );

        // Tally mentions, positions, and competitors from Haiku analysis
        for (const resp of allResponses) {
          const analysis = analyses[resp.id];
          if (analysis?.brand_mentioned) {
            totalMentions++;
            providerMentions[resp.provider]++;
            if (analysis.mention_position > 0) {
              providerPositionSum[resp.provider] += analysis.mention_position;
              providerPositionCount[resp.provider]++;
            }
          }
          for (const comp of analysis?.competitors_mentioned || []) {
            allCompetitorCounts[comp] = (allCompetitorCounts[comp] || 0) + 1;
          }
          // Persist full analysis details
          allAnalysisDetails[resp.id] = {
            mention_position: analysis?.mention_position || 0,
            sentiment: analysis?.sentiment || "n/a",
            brand_domain_cited: analysis?.brand_domain_cited || false,
            cited_domains: analysis?.cited_domains || [],
          };
        }
      } catch (err) {
        console.error("Haiku batch analysis failed:", err);
        // Fall back to 0 mentions — Haiku failure is logged, not fatal
      }

      // Re-save provider statuses with final mention counts AND avgPosition
      for (const provider of enabledProviders) {
        const avgPos = providerPositionCount[provider] > 0
          ? providerPositionSum[provider] / providerPositionCount[provider]
          : null;
        providerStatuses[provider] = {
          ...providerStatuses[provider],
          mentions: providerMentions[provider],
          avgPosition: avgPos != null ? Math.round(avgPos * 10) / 10 : null,
        };
        await setProviderStatus(report.id, provider as ProviderName, providerStatuses[provider]);
      }
    }

    // ─── FIX 4: Dedup competitors by alias (e.g. "Ratsherrn Brauerei" + "Ratsherrn") ───
    const dedupedCompetitorCounts: Record<string, number> = {};
    const competitorKeys = Object.keys(allCompetitorCounts);
    const claimed = new Set<string>();
    for (let i = 0; i < competitorKeys.length; i++) {
      if (claimed.has(competitorKeys[i])) continue;
      const a = competitorKeys[i].toLowerCase();
      let bestName = competitorKeys[i];
      let bestCount = allCompetitorCounts[competitorKeys[i]];
      for (let j = i + 1; j < competitorKeys.length; j++) {
        if (claimed.has(competitorKeys[j])) continue;
        const b = competitorKeys[j].toLowerCase();
        // Check if one is a substring of the other (normalized)
        const aNorm = a.replace(/[^a-z0-9]/g, "");
        const bNorm = b.replace(/[^a-z0-9]/g, "");
        if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) {
          // Same brand — keep the longer name, take max count
          if (competitorKeys[j].length > bestName.length) {
            bestName = competitorKeys[j];
          }
          bestCount = Math.max(bestCount, allCompetitorCounts[competitorKeys[j]]);
          claimed.add(competitorKeys[j]);
        }
      }
      dedupedCompetitorCounts[bestName] = bestCount;
      claimed.add(competitorKeys[i]);
    }

    // ─── Compute top competitor + top 5 ranking from deduped data ───
    let topCompetitor = "";
    let topCompetitorMentions = 0;
    const topCompetitors = Object.entries(dedupedCompetitorCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    if (topCompetitors.length > 0) {
      topCompetitor = topCompetitors[0].name;
      topCompetitorMentions = topCompetitors[0].count;
    }

    const mentionRate = totalQueries > 0 ? totalMentions / totalQueries : null;

    // ─── Composite Score (GEO-Check v1) ───
    const totalCompetitorMentions = Object.values(allCompetitorCounts).reduce((a, b) => a + b, 0);
    const brandMentionCount = totalMentions;

    // Mention Rate: % of queries mentioning brand (0-100)
    const mentionRateScore = mentionRate !== null ? mentionRate * 100 : 0;

    // Position: average position of brand mentions, normalized
    let avgPosition = 0;
    let positionCount = 0;
    for (const resp of allResponses) {
      const analysis = analyses[resp.id];
      if (analysis?.brand_mentioned && analysis.mention_position > 0) {
        avgPosition += analysis.mention_position;
        positionCount++;
      }
    }
    const avgPos = positionCount > 0 ? avgPosition / positionCount : null;
    const positionScore = avgPos === null ? null
      : avgPos <= 1 ? 100
      : avgPos <= 2 ? 70
      : avgPos <= 3 ? 50
      : 30;

    // Sentiment: (positives + 0.5 * neutrals) / totalMentions
    let positives = 0, neutrals = 0;
    for (const resp of allResponses) {
      const analysis = analyses[resp.id];
      if (analysis?.brand_mentioned) {
        if (analysis.sentiment === "positiv") positives++;
        else if (analysis.sentiment === "neutral") neutrals++;
      }
    }
    const sentimentScore = brandMentionCount > 0
      ? ((positives + 0.5 * neutrals) / brandMentionCount) * 100
      : null; // null = no mentions, not "worst score"

    // Share of Voice: brand mentions / (brand + competitor mentions)
    const sovScore = (brandMentionCount + totalCompetitorMentions) > 0
      ? (brandMentionCount / (brandMentionCount + totalCompetitorMentions)) * 100
      : 0;

    // Citation Rate: NOT calculated yet (cited-domains feature pending)
    // Composite: weights renormalized when components are null (no data)
    const components = [
      { name: "Erwähnungsrate", value: mentionRateScore, weight: 0.50 },
      { name: "Position", value: positionScore, weight: 0.25 },
      { name: "Sentiment", value: sentimentScore, weight: 0.125 },
      { name: "Share of Voice", value: sovScore, weight: 0.125 },
    ];
    const availableComponents = components.filter((c) => c.value !== null);
    const totalWeight = availableComponents.reduce((sum, c) => sum + c.weight, 0);
    const compositeScore = totalWeight > 0
      ? Math.round(availableComponents.reduce((sum, c) => sum + (c.value as number) * (c.weight / totalWeight), 0))
      : 0;

    const compositeBreakdown = components.map((c) => ({
      component: c.name,
      raw: c.value === null ? "n/a" : `${Math.round(c.value as number)}${c.name === "Position" ? "" : "%"}`,
      weight: c.value === null ? "ausgeschlossen" : `${Math.round((c.weight / totalWeight) * 100)}%`,
      points: c.value === null ? "—" : `${Math.round((c.value as number) * (c.weight / totalWeight))}`,
      excluded: c.value === null,
    }));

    // ─── Safety net: detect self-referencing prompts (T6 bug) ───
    // If mentionRate >= 0.9 AND no competitors → prompts probably contain the brand name
    const isCircularPrompt = mentionRate !== null && mentionRate >= 0.9 && topCompetitors.length === 0;
    if (isCircularPrompt) {
      console.warn(`[GEO-Check] CIRCULAR PROMPT DETECTED: mentionRate=${mentionRate}, no competitors. Measurement is circular for domain=${report.domain}`);
    }

    // If circular prompt detected, override score — it's an echo, not a measurement
    const effectiveCompositeScore = isCircularPrompt ? 0 : compositeScore;

    // ─── Findings (structured, deterministic from data) ───
    // Renderer expects: {category, finding, recommendation, priority}
    const findings: Array<{category: string; finding: string; recommendation: string; priority: number}> = [];

    if (mentionRate !== null && mentionRate < 0.3) {
      findings.push({
        category: "Sichtbarkeit",
        finding: `Ihre Marke wird in weniger als 30% der KI-Antworten erwähnt (${Math.round(mentionRate * 100)}%).`,
        recommendation: "Erstellen Sie ein llms.txt auf Ihrer Website und implementieren Sie strukturierte Daten (Schema.org), damit KI-Systeme Ihre Marke leichter finden.",
        priority: 1,
      });
    }
    if (mentionRate !== null && mentionRate >= 0.3 && mentionRate < 0.7) {
      findings.push({
        category: "Sichtbarkeit",
        finding: `Ihre Marke ist teilweise sichtbar (${Math.round(mentionRate * 100)}%).`,
        recommendation: "Optimieren Sie Ihre FAQ-Seiten mit direkten Antworten (BLUF-Stil) und sichern Sie Einträge in den Verzeichnissen, die Ihre Konkurrenten zitiert bekommen.",
        priority: 2,
      });
    }
    if (mentionRate !== null && mentionRate >= 0.7) {
      findings.push({
        category: "Sichtbarkeit",
        finding: `Ihre Sichtbarkeit ist bereits stark (${Math.round(mentionRate * 100)}%).`,
        recommendation: "Schützen Sie diese Position durch regelmäßige Aktualisierung Ihrer Inhalte und überwachen Sie die KI-Empfehlungen.",
        priority: 5,
      });
    }
    if (avgPos !== null && avgPos > 2) {
      findings.push({
        category: "Position",
        finding: `Wenn Ihre Marke erwähnt wird, erscheint sie durchschnittlich an Position ${avgPos.toFixed(1)}.`,
        recommendation: "Verbessern Sie Ihre Nennung in Verzeichnissen und Presseportalen.",
        priority: 3,
      });
    }
    if (topCompetitor && topCompetitorMentions > brandMentionCount) {
      findings.push({
        category: "Wettbewerb",
        finding: `Ihr Wettbewerber "${topCompetitor}" wird häufiger erwähnt (${topCompetitorMentions} vs. ${brandMentionCount} mal).`,
        recommendation: `Analysieren Sie, welche Quellen ${topCompetitor} zitieren, und sichern Sie vergleichbare Einträge.`,
        priority: 2,
      });
    }
    if (sentimentScore !== null && sentimentScore < 50 && brandMentionCount > 0) {
      findings.push({
        category: "Sichtbarkeit",
        finding: "Das Sentiment Ihrer Marke in KI-Antworten ist überwiegend neutral.",
        recommendation: "Erzeugen Sie positive Signale durch Kundenbewertungen und Fallstudien auf Ihrer Website.",
        priority: 4,
      });
    }
    if (findings.length === 0) {
      findings.push({
        category: "Sichtbarkeit",
        finding: "Es wurden keine konkreten Probleme in den KI-Antworten identifiziert.",
        recommendation: "Führen Sie ein vollständiges GEO-Audit durch, um detaillierte Handlungsempfehlungen zu erhalten.",
        priority: 5,
      });
    }

    // Update AI visibility score
    const categoryScores = { ...report.category_scores };
    if (mentionRate !== null && totalQueries > 0) {
      categoryScores.aiVisibility = {
        score: Math.round(mentionRate * 100),
        checks: [
          {
            id: "ai-vis-quick",
            label: "KI-Sichtbarkeit",
            passed: mentionRate > 0,
            weight: 100,
            detail: `${totalMentions} von ${totalQueries} KI-Abfragen nennen ${brandName}`,
            evidence: `Erwähnungsrate: ${Math.round(mentionRate * 100)}%`,
          },
        ],
      };
    }

    // Anti-hallucination review (only if Gemini available)
    let qualityMeta = null;
    try {
      const findings: Array<{ type: "finding" | "recommendation"; text: string; category?: string }> = [];
      const seenCheckIds = new Set<string>();
      for (const [catKey, cat] of Object.entries(categoryScores)) {
        for (const check of (cat as any).checks) {
          if (seenCheckIds.has(check.id)) continue;
          seenCheckIds.add(check.id);
          findings.push({
            type: check.passed ? "recommendation" : "finding",
            text: `${check.label}: ${check.detail}`,
            category: catKey,
          });
        }
      }

      const review = await reviewReport(
        report.verified_facts,
        findings,
        `Ihre Website ${report.domain} erreicht ${report.overall_score}/100 Punkte.`,
        `Ihre Website ${report.domain} erreicht ${report.overall_score}/100 Punkte.`,
        categoryScores as any,
      );
      qualityMeta = review.qualityMeta;
    } catch (err) {
      console.error("Review failed:", err);
    }

    const tEnd = Date.now();

    // ─── Build visibility summary ───
    const brandDisplayName = report.brand_name || report.domain;
    const mentionPct = mentionRate !== null ? Math.round(mentionRate * 100) : 0;
    const activeProviders = Object.keys(providerStatuses).filter(p => providerStatuses[p].queriesRun > 0);
    const providersWithMentions = activeProviders.filter(p => providerStatuses[p].mentions > 0);

    let visibilitySummary: string;
    if (mentionRate === null || totalQueries === 0) {
      visibilitySummary = `${brandDisplayName} wurde in den analysierten KI-Antworten nicht bewertet.`;
    } else if (mentionRate === 0) {
      visibilitySummary = `${brandDisplayName} wurde in keiner der ${totalQueries} analysierten KI-Abfragen als Empfehlung genannt. Die KI-Sichtbarkeit ist aktuell bei 0%.`;
    } else {
      const providerList = providersWithMentions.length > 0
        ? providersWithMentions.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" und ")
        : "mindestens einem Modell";
      const mentionWord = totalMentions === 1 ? "Erwähnung" : "Erwähnungen";
      visibilitySummary = `${brandDisplayName} wurde ${totalMentions} von ${totalQueries} KI-Abfragen empfohlen (${mentionPct}%). ${providerList} ${providersWithMentions.length === 1 ? "nennt" : "nennen"} die Marke als Empfehlung.`;
    }

    // Save all LLM results
    await setLlmResults(report.id, {
      llm_results: llmResults,
      mention_rate: mentionRate,
      queries_tested: totalQueries,
      quality_meta: qualityMeta,
      top_competitor: topCompetitor || undefined,
      top_competitor_mentions: topCompetitorMentions,
      top_competitors: topCompetitors,
      visibility_summary: visibilitySummary,
      analysis_details: allAnalysisDetails,
      composite_score: effectiveCompositeScore,
      composite_breakdown: compositeBreakdown,
      recommendations: findings,
      prompts_used: prompts, // C1: exact prompts sent to providers
      vertical_resolved: verticalResolved, // C3: what vertical was actually used
      timings: {
        ...report.timings,
        llmMs: tEnd - t0,
        totalWithLlm: tEnd - t0 + (report.timings?.totalMs || 0),
      },
    });

    // Read detection metadata from report
    const detection = report.verified_facts?._detection || {};

    return json({
      reportId: report.id,
      status: "completed",
      providerStatus: providerStatuses,
      // Detection metadata (always present)
      detected_vertical: detection.detected_vertical || null,
      detection_method: detection.detection_method || null,
      selected_vertical: report.vertical || "Other",
      // mentionRate and queriesTested are GATED — served only via GET /report/[id] after unlock
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Reset status so the endpoint can be retried (best effort)
    try {
      const { reportId } = await req.clone().json().catch(() => ({}));
      if (reportId) await setReportStatus(reportId, "pending");
    } catch { /* best effort */ }
    return json({ error: message }, { status: 500 });
  }
}
