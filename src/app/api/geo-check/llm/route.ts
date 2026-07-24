// GEO Check — LLM endpoint (Phase 2: run providers + review)
// POST /api/geo-check/llm
// Body: { reportId: string }

import { NextRequest, NextResponse } from "next/server";
import { fetchBrandName } from "@/lib/geo-check";
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`,
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
        tools: [{ type: "web_search_preview" }],
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

// ─── Count brand mentions in text ───

function countMentions(text: string, brandName: string, domain: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  const brandLower = brandName.toLowerCase();
  const domainLower = domain.toLowerCase();

  // Count occurrences
  let idx = 0;
  while ((idx = lower.indexOf(brandLower, idx)) !== -1) {
    count++;
    idx += brandLower.length;
  }
  idx = 0;
  while ((idx = lower.indexOf(domainLower, idx)) !== -1) {
    count++;
    idx += domainLower.length;
  }

  return count;
}

// ─── POST handler ───

export async function POST(req: NextRequest) {
  try {
    const { reportId } = await req.json();

    if (!reportId) {
      return json({ error: "reportId ist erforderlich" }, { status: 400 });
    }

    const report = await getReport(reportId);
    if (!report) {
      return json({ error: "Report nicht gefunden" }, { status: 404 });
    }

    // Prevent double-run
    if (report.status === "running") {
      return json({ error: "LLM-Phase laeuft bereits" }, { status: 409 });
    }
    if (report.status === "completed") {
      return json({ error: "LLM-Phase bereits abgeschlossen" }, { status: 409 });
    }

    // Mark as running
    await setReportStatus(report.id, "running");

    const brandName = report.brand_name || await fetchBrandName(report.domain);
    const vertical = report.vertical || "Unternehmen";
    const region = report.region || "Deutschland";

    // Build prompts (from Prompt Library logic — vertical-aware)
    const prompts = [
      `Welche ${vertical} in ${region} koennen Sie empfehlen?`,
      `Was sind die besten ${vertical} in ${region}?`,
    ];

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
      let mentions = 0;
      let totalMentionsChecked = 0;

      for (const prompt of prompts) {
        const result = await callFn(prompt);
        results.push({ prompt, text: result.text, error: result.error });

        if (!result.error && result.text) {
          mentions += countMentions(result.text, brandName, report.domain);
          totalMentionsChecked++;
        }
      }

      const providerStatus = {
        status: results.every((r) => r.error) ? "error" : results.some((r) => r.error) ? "partial" : "ok",
        queriesRun: results.length,
        mentions,
        error: results.every((r) => r.error) ? results[0]?.error : undefined,
      };

      // Update provider status in DB immediately
      await setProviderStatus(report.id, provider, providerStatus);

      return { provider, results, providerStatus };
    });

    const settled = await Promise.allSettled(providerPromises);

    // Collect results
    const llmResults: Record<string, any> = {};
    let totalMentions = 0;
    let totalQueries = 0;
    const providerStatuses: Record<string, any> = {};

    for (const result of settled) {
      if (result.status === "fulfilled") {
        const { provider, results, providerStatus } = result.value;
        llmResults[provider] = results;
        totalMentions += providerStatus.mentions;
        totalQueries += providerStatus.queriesRun;
        providerStatuses[provider] = providerStatus;
      } else {
        // This shouldn't happen since we catch errors inside each provider
        console.error("Provider promise rejected:", result.reason);
      }
    }

    const mentionRate = totalQueries > 0 ? totalMentions / totalQueries : null;

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
      for (const [catKey, cat] of Object.entries(categoryScores)) {
        for (const check of (cat as any).checks) {
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

    // Save all LLM results
    await setLlmResults(report.id, {
      llm_results: llmResults,
      mention_rate: mentionRate,
      queries_tested: totalQueries,
      quality_meta: qualityMeta,
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
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
