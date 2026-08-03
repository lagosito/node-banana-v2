// GEO Check — Quick endpoint (Phase 1: crawl + deterministic score only)
// POST /api/geo-check/quick
// GET  /api/geo-check/quick?id=REPORT_ID

import { NextRequest, NextResponse } from "next/server";
import {
  validateDomain,
  fetchBrandName,
  isValidVertical,
  normalizeVertical,
  VALID_VERTICALS,
  fetchPageTitle,
  extractBusinessDescriptor,
  inferVerticalFromTitle,
  classifyDescriptor,
} from "@/lib/geo-check";
import { collectFacts } from "@/lib/geo-check/crawler";
import { scoreReport } from "@/lib/geo-check/scoring";
import type { ScoreCheck, CategoryScore } from "@/lib/geo-check/scoring";
import {
  createReport,
  getReport,
  getReportByDomain,
  checkRateLimitDb,
  updateGeneratedQuestions,
} from "@/lib/geo-check/storage";
import { generateQuestions } from "@/lib/geo-check/questions";

// ─── CORS ───

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init?: ResponseInit) {
  const status = init?.status || 200;
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  return NextResponse.json(data, { status, headers });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Build v2 response (Phase 1 only — no LLM data) ───

function buildV2Phase1(row: any): Record<string, unknown> {
  const categoryScores = row.category_scores || null;
  const overallScore = row.overall_score ?? 0;

  return {
    reportId: row.id,
    shortSlug: row.short_slug,
    overallScore,
    categoryScores: categoryScores
      ? Object.fromEntries(
          Object.entries(categoryScores).map(([key, cat]: [string, any]) => [
            key,
            { score: cat.score, checks: cat.checks.map(formatCheck) },
          ]),
        )
      : null,
    citability: row.citability
      ? { score: row.citability.score, breakdown: row.citability.breakdown, checks: (row.citability.checks || []).map(formatCheck) }
      : null,
    verdictLabel: "Berechnet",
    verdictHeadline: "Ihre technische Ausstattung wurde analysiert.",
    summary: `Ihre Website ${row.domain} erreicht ${overallScore}/100 Punkte (technische Bewertung).`,
    topProblems: row.top_problems || [],
    aiCrawlerFacts: row.ai_crawler_facts,
    subpages: row.subpages || [],
    quickWins: [],
    partialCrawl: row.verified_facts?.partialCrawl ?? false,
    // Competitor data (from LLM phase)
    topCompetitor: row.top_competitor || null,
    topCompetitorMentions: row.top_competitor_mentions || 0,
    visibilitySummary: row.visibility_summary || null,
    // Phase 2 not done yet
    status: row.status,
    providerStatus: row.provider_status || {},
    // Generated questions (from DB or null)
    generated_questions: row.generated_questions || null,
    question_source: row.question_source || null,
    brand_tokens: row.brand_tokens || null,
  };
}

function formatCheck(check: ScoreCheck) {
  // aiVisibility placeholder: show as "pending" not "failed"
  if (check.id === "ai-vis-placeholder") {
    return { id: check.id, label: check.label, passed: null, weight: check.weight, detail: "Wird nach KI-Abfragen berechnet", status: "pending" };
  }
  return { id: check.id, label: check.label, passed: check.passed, weight: check.weight, detail: check.detail };
}

// ─── POST handler ───

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { website_url, vertical, region, _hp, force } = body;

    if (_hp) return json({ ok: true });

    if (!website_url) {
      return json({ error: "website_url is required" }, { status: 400 });
    }

    if (vertical && !isValidVertical(vertical)) {
      return json({ error: `Invalid vertical. Valid: ${VALID_VERTICALS.join(", ")}` }, { status: 400 });
    }

    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    // Rate limit — read env vars per request (no deploy needed to change)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const bypassSecret = process.env.GEO_RATE_BYPASS_SECRET || "";
    const bypassHeader = req.headers.get("x-geo-bypass") || "";
    const isBypassed = bypassSecret && bypassHeader === bypassSecret;
    const maxPerDay = parseInt(process.env.GEO_RATE_LIMIT_PER_DAY || "5", 10) || 5;
    const allowlist = (process.env.GEO_RATE_LIMIT_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);
    const isAllowlisted = allowlist.includes(ip);
    const rateLimit = (isBypassed || isAllowlisted)
      ? { allowed: true, remaining: 999 }
      : await checkRateLimitDb(ip, maxPerDay);
    if (!rateLimit.allowed) {
      return json(
        { error: "Zu viele Anfragen, bitte versuchen Sie es morgen erneut." },
        { status: 429, headers: { "x-ratelimit-limit": String(maxPerDay), "x-ratelimit-remaining": "0", "retry-after": "86400" } },
      );
    }

    // Cache: if we already have a report for this domain, return it (skip when force=true)
    if (!force) {
      const cached = await getReportByDomain(dns.domain);
      if (cached) {
        const cachedResponse = buildV2Phase1(cached);
        cachedResponse.selected_vertical = cached.vertical || "Other";

        // Always run detection on cached reports
        // Try to get title from stored verified_facts first, fallback to fetch
        const cachedTitle = cached.verified_facts?.meta?.title
          || await fetchPageTitle(dns.domain);
        if (cachedTitle) {
          const keywordMatch = inferVerticalFromTitle(cachedTitle);
          if (keywordMatch !== "Other") {
            cachedResponse.detected_vertical = keywordMatch;
            cachedResponse.detection_method = "keyword";
          }

          // Always classify descriptor (even if keyword matched)
          const brandName = cached.brand_name || await fetchBrandName(dns.domain);
          const cachedDesc = cached.verified_facts?.meta?.description || null;
          const { descriptor: rawDescriptor, confidence } = extractBusinessDescriptor(
            cachedTitle, cachedDesc, dns.domain, brandName,
          );
          if (rawDescriptor && confidence >= 0.5) {
            const { descriptor: classifiedDescriptor } = await classifyDescriptor(
              rawDescriptor, cachedTitle, cachedDesc,
            );
            cachedResponse.other_descriptor = classifiedDescriptor;
            cachedResponse.other_confidence = confidence;
          }
        }

        return json(cachedResponse, { headers: { "x-ratelimit-limit": String(maxPerDay), "x-ratelimit-remaining": String(rateLimit.remaining) } });
      }
    }

    // ─── Phase 1 pipeline ───
    const t0 = Date.now();

    // Step 1: Collect facts (deterministic crawler)
    const facts = await collectFacts(website_url);
    const tFacts = Date.now();

    // Step 2: Score report (deterministic scoring)
    const scores = scoreReport(facts);
    const tScores = Date.now();

    const brandName = await fetchBrandName(dns.domain);

    // ─── Auto-detect vertical from page title ───
    let effectiveVertical = vertical || "Other";
    let otherDescriptor: string | null = null;
    let otherConfidence = 0;
    let detectedVertical: string | null = null;
    let detectionMethod: string | null = null;

    const rawTitle = await fetchPageTitle(dns.domain);

    if (!vertical || vertical === "Other") {
      // Step 1: Try keyword matching (free, instant) — informational only
      if (rawTitle) {
        const keywordMatch = inferVerticalFromTitle(rawTitle);
        if (keywordMatch !== "Other") {
          detectedVertical = keywordMatch;
          detectionMethod = "keyword";
        }
      }

      // Step 2: Always classify descriptor when vertical is "Other"
      // (even if keyword matched — the keyword is a proposal, not a result)
      if (rawTitle) {
        const { descriptor: rawDescriptor, confidence } = extractBusinessDescriptor(rawTitle, facts.meta.description, dns.domain, brandName);
        if (rawDescriptor && confidence >= 0.5) {
          const { descriptor: classifiedDescriptor } = await classifyDescriptor(
            rawDescriptor, rawTitle, facts.meta.description,
          );
          otherDescriptor = classifiedDescriptor;
          otherConfidence = confidence;
        }
      }
    }

    // Build topProblems from failing checks
    const topProblems: Array<{ title: string; impact: string }> = [];
    for (const cat of Object.values(scores.categoryScores)) {
      for (const check of cat.checks) {
        if (!check.passed) topProblems.push({ title: check.label, impact: check.detail });
      }
    }
    topProblems.sort((a, b) => b.impact.length - a.impact.length);

    // Build findings (dedup by check id — same check in multiple categories appears once)
    const findings: Array<{ type: string; text: string; category: string }> = [];
    const seenCheckIds = new Set<string>();
    for (const [key, cat] of Object.entries(scores.categoryScores)) {
      for (const check of cat.checks) {
        if (seenCheckIds.has(check.id)) continue;
        // Skip ai-vis-placeholder — it's a pending marker, not a finding
        if (check.id === "ai-vis-placeholder") continue;
        seenCheckIds.add(check.id);
        findings.push({
          type: check.passed ? "recommendation" : "finding",
          text: `${check.label}: ${check.detail}`,
          category: key,
        });
      }
    }

    // Save report (status: pending — LLM phase not started)
    const { id: reportId, shortSlug } = await createReport({
      domain: dns.domain,
      url: website_url,
      resolvedUrl: facts.meta.canonical ?? undefined,
      lang: facts.meta.htmlLang ?? undefined,
      overallScore: scores.overallScore,
      categoryScores: scores.categoryScores,
      citability: scores.citability,
      findings,
      topProblems,
      verifiedFacts: facts,
      brandName,
      vertical: effectiveVertical,
      region,
      subpages: facts.scannedUrls,
      aiCrawlerFacts: facts.crawlers,
      timings: {
        factsMs: tFacts - t0,
        scoresMs: tScores - tFacts,
        totalMs: tScores - t0,
      },
    });

    // Fetch the full row for response
    const report = await getReport(reportId);
    const response = buildV2Phase1(report!);

    // Add detection metadata for frontend confirmation screen
    response.selected_vertical = effectiveVertical;
    if (detectedVertical) {
      response.detected_vertical = detectedVertical;
      response.detection_method = detectionMethod;
    }
    if (otherDescriptor) {
      response.other_descriptor = otherDescriptor;
      response.other_confidence = otherConfidence;
    }

    // ─── V1: Generate questions from page content ───
    let generatedQuestions: string[] | null = null;
    let questionSource: "generated" | "curated" | "descriptor" | null = null;
    let brandTokensList: string[] | null = null;

    try {
      const bodyText1500 = (facts as any)?.content?.bodyText?.slice(0, 1500) || "";
      const genResult = await generateQuestions({
        title: rawTitle || "",
        metaDescription: facts.meta?.description || null,
        bodyText1500,
        brand: brandName,
        region: region || "Deutschland",
      });

      if (genResult && genResult.questions.length >= 6) {
        generatedQuestions = genResult.questions;
        questionSource = "generated";
        brandTokensList = genResult.brandTokens;

        // Save to report (non-blocking — log if migration pending)
        await updateGeneratedQuestions(reportId, {
          generated_questions: generatedQuestions,
          question_source: questionSource,
          brand_tokens: brandTokensList,
        });
      } else if (genResult && genResult.questions.length > 0) {
        // Got some but less than 6 — still save, will fallback in /llm
        generatedQuestions = genResult.questions;
        questionSource = "generated";
        brandTokensList = genResult.brandTokens;
        await updateGeneratedQuestions(reportId, {
          generated_questions: generatedQuestions,
          question_source: questionSource,
          brand_tokens: brandTokensList,
        });
      } else {
        // Generation failed or 0 questions — fallback will happen in /llm
        console.warn("[GEO-Check] Question generation returned no usable questions");
      }
    } catch (err) {
      console.error("[GEO-Check] Question generation error:", err);
      // Non-fatal — /llm will use fallback prompts
    }

    // Include in response
    response.generated_questions = generatedQuestions;
    response.question_source = questionSource;
    response.brand_tokens = brandTokensList;

    return json(response, { headers: { "x-ratelimit-limit": "5", "x-ratelimit-remaining": String(rateLimit.remaining) } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    // Expose Supabase URL issues (masked) without leaking secrets
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const urlOk = supabaseUrl.startsWith("http://") || supabaseUrl.startsWith("https://");
    const extra = !urlOk && supabaseUrl
      ? ` (SUPABASE_URL="${supabaseUrl.slice(0,15)}…" — missing https://?)`
      : "";
    return json({ error: message + extra }, { status: 500 });
  }
}

// ─── GET handler ───

export async function GET(req: NextRequest) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const reportId = searchParams.get("id");

    if (!reportId) {
      return json({ error: "Report ID is required" }, { status: 400 });
    }

    const report = await getReport(reportId);
    if (!report) {
      return json({ error: "Report not found or expired" }, { status: 404 });
    }

    return json(buildV2Phase1(report));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
