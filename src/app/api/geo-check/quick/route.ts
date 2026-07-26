// GEO Check — Quick endpoint (Phase 1: crawl + deterministic score only)
// POST /api/geo-check/quick
// GET  /api/geo-check/quick?id=REPORT_ID

import { NextRequest, NextResponse } from "next/server";
import {
  validateDomain,
  fetchBrandName,
  isValidVertical,
} from "@/lib/geo-check";
import { collectFacts } from "@/lib/geo-check/crawler";
import { scoreReport } from "@/lib/geo-check/scoring";
import type { ScoreCheck, CategoryScore } from "@/lib/geo-check/scoring";
import {
  createReport,
  getReport,
  getReportByDomain,
  checkRateLimitDb,
} from "@/lib/geo-check/storage";

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
    // Phase 2 not done yet
    status: row.status,
    providerStatus: row.provider_status || {},
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
    const { website_url, vertical, region, _hp } = body;

    if (_hp) return json({ ok: true });

    if (!website_url) {
      return json({ error: "website_url ist erforderlich" }, { status: 400 });
    }

    if (vertical && !isValidVertical(vertical)) {
      return json({ error: `Ungueltiger Vertical. Gueltig: Wein, Feinkost, Craft Beer, Fitness, Gastro` }, { status: 400 });
    }

    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    // Rate limit
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const rateLimit = await checkRateLimitDb(ip);
    if (!rateLimit.allowed) {
      return json({ error: "Zu viele Anfragen. Bitte versuchen Sie es morgen erneut." }, { status: 429 });
    }

    // Cache: if we already have a report for this domain, return it
    const cached = await getReportByDomain(dns.domain);
    if (cached) {
      return json(buildV2Phase1(cached));
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
      vertical,
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

    return json(buildV2Phase1(report!));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    // Expose Supabase URL issues (masked) without leaking secrets
    const supabaseUrl = process.env.SUPABASE_URL || "";
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
      return json({ error: "Report-ID ist erforderlich" }, { status: 400 });
    }

    const report = await getReport(reportId);
    if (!report) {
      return json({ error: "Report nicht gefunden oder abgelaufen" }, { status: 404 });
    }

    return json(buildV2Phase1(report));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
