// GEO Check — LLM endpoint (Phase 2: run providers + review)
// POST /api/geo-check/llm
// Body: { reportId: string }

import { NextRequest, NextResponse } from "next/server";
import { fetchBrandName, normalizeVertical, QUICK_PROMPTS, buildPrompt, buildBrandAliases, extractCoreBrand, resolveVertical, fetchPageTitle } from "@/lib/geo-check";
import { analyzeResponseBatch } from "@/lib/geo-audit/analyzer";
import {
  getReport,
  setReportStatus,
  setProviderStatus,
  setLlmResults,
  touchReport,
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

// ─── Provider callers ───

const PROVIDER_TIMEOUT_MS = 30_000;

async function callGeminiWithGrounding(prompt: string): Promise<{ text: string; error?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", error: "GEMINI_API_KEY not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
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

    // Prevent double-run
    if (report.status === "completed") {
      return json({ error: "LLM phase already completed" }, { status: 409 });
    }
    // If status is "running", previous run likely timed out — reset to allow retry
    if (report.status === "running") {
      await setReportStatus(report.id, "pending");
    }

    // Mark as running
    await setReportStatus(report.id, "running");

    const brandName = report.brand_name || await fetchBrandName(report.domain);
    const rawTitle = await fetchPageTitle(report.domain);
    const vertical = resolveVertical(report.vertical || "Other", rawTitle);
    const region = report.region || "Deutschland";

    // Build prompts (from Prompt Library logic — vertical-aware)
    const prompts = QUICK_PROMPTS.map((t) => buildPrompt(t, vertical, region));

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

    if (allResponses.length > 0) {
      try {
        analyses = await analyzeResponseBatch(
          allResponses.map((r) => ({ id: r.id, text: r.text })),
          coreBrand,
          report.domain,
          aliases,
        );

        // Tally mentions and competitors from Haiku analysis
        for (const resp of allResponses) {
          const analysis = analyses[resp.id];
          if (analysis?.brand_mentioned) {
            totalMentions++;
            providerStatuses[resp.provider].mentions++;
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
    }

    // ─── Compute top competitor + top 5 ranking from Haiku analysis ───
    let topCompetitor = "";
    let topCompetitorMentions = 0;
    const topCompetitors = Object.entries(allCompetitorCounts)
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
    const avgPos = positionCount > 0 ? avgPosition / positionCount : 0;
    const positionScore = avgPos === 0 ? 0
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
      : 0;

    // Share of Voice: brand mentions / (brand + competitor mentions)
    const sovScore = (brandMentionCount + totalCompetitorMentions) > 0
      ? (brandMentionCount / (brandMentionCount + totalCompetitorMentions)) * 100
      : 0;

    // Citation Rate: NOT calculated yet (cited-domains feature pending)
    // Composite: Mention 50% + Position 25% + Sentiment 12.5% + SoV 12.5%
    const compositeScore = Math.round(
      mentionRateScore * 0.50
      + positionScore * 0.25
      + sentimentScore * 0.125
      + sovScore * 0.125
    );

    const compositeBreakdown = [
      { component: "Erwaehnungsrate", raw: `${Math.round(mentionRateScore)}%`, weight: "50%", points: `${Math.round(mentionRateScore * 0.50)}` },
      { component: "Position", raw: avgPos > 0 ? `Platz ${avgPos.toFixed(1)}` : "n/a", weight: "25%", points: `${Math.round(positionScore * 0.25)}` },
      { component: "Sentiment", raw: `${Math.round(sentimentScore)}%`, weight: "12.5%", points: `${Math.round(sentimentScore * 0.125)}` },
      { component: "Share of Voice", raw: `${Math.round(sovScore)}%`, weight: "12.5%", points: `${Math.round(sovScore * 0.125)}` },
    ];

    // ─── Recommendations (deterministic from data) ───
    const recommendations: string[] = [];

    if (mentionRate !== null && mentionRate < 0.3) {
      recommendations.push("Ihre Marke wird in weniger als 30% der KI-Antworten erwaehnt. Erstellen Sie ein llms.txt auf Ihrer Website und implementieren Sie strukturierte Daten (Schema.org), damit KI-Systeme Ihre Marke leichter finden.");
    }
    if (mentionRate !== null && mentionRate >= 0.3 && mentionRate < 0.7) {
      recommendations.push("Ihre Marke ist teilweise sichtbar. Optimieren Sie Ihre FAQ-Seiten mit direkten Antworten (BLUF-Stil) und sichern Sie Eintraege in den Verzeichnissen, die Ihre Konkurrenten zitiert bekommen.");
    }
    if (mentionRate !== null && mentionRate >= 0.7) {
      recommendations.push("Ihre Sichtbarkeit ist bereits stark. Schuetzen Sie diese Position durch regelmässige Aktualisierung Ihrer Inhalte und ueberwachen Sie die KI-Empfehlungen.");
    }
    if (avgPos > 2) {
      recommendations.push("Wenn Ihre Marke erwaehnt wird, erscheint sie durchschnittlich an Position " + avgPos.toFixed(1) + ". Verbessern Sie Ihre Nennung in Verzeichnissen und Presseportalen.");
    }
    if (topCompetitor && topCompetitorMentions > brandMentionCount) {
      recommendations.push(`Ihr Wettbewerber "${topCompetitor}" wird haeufiger erwaehnt (${topCompetitorMentions} vs. ${brandMentionCount} mal). Analysieren Sie, welche Quellen ${topCompetitor} zitieren.`);
    }
    if (sentimentScore < 50 && brandMentionCount > 0) {
      recommendations.push("Das Sentiment Ihrer Marke in KI-Antworten ist ueberwiegend neutral. Erzeugen Sie positive Signale durch Kundenbewertungen und Fallstudien auf Ihrer Website.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Fuehren Sie ein vollstaendiges GEO-Audit durch, um detaillierte Handlungsempfehlungen zu erhalten.");
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
            evidence: `Erwaehnungsrate: ${Math.round(mentionRate * 100)}%`,
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
      composite_score: compositeScore,
      composite_breakdown: compositeBreakdown,
      recommendations,
      timings: {
        ...report.timings,
        llmMs: tEnd - t0,
        totalWithLlm: tEnd - t0 + (report.timings?.totalMs || 0),
      },
    });

    return json({
      reportId: report.id,
      status: "completed",
      providerStatus: providerStatuses,
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
