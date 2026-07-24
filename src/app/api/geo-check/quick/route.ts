// GEO Check — Quick endpoint (Phase 4) with Supabase persistence
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
import { reviewReport } from "@/lib/geo-check/reviewer";
import {
  saveReport,
  getReport,
  getReportByDomain,
  generateShortSlug,
  createLead,
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

// ─── Email validation ───

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── OPTIONS handler ───

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Helper: Build v2 response from a DB report row ───

function buildV2Response(row: any, gated: boolean): Record<string, unknown> {
  const scores = row.category_scores ? { categoryScores: row.category_scores, overallScore: row.overall_score } : null;
  const categoryScores = scores?.categoryScores || null;
  const overallScore = scores?.overallScore ?? 0;
  const verdictLabel = row.quality_meta?.verdictLabel ?? "Unbekannt";
  const verdictHeadline = row.quality_meta?.correctedHeadline ?? "";

  const summary = buildSummary(row.domain, overallScore, verdictHeadline, categoryScores);
  const topProblems = row.top_problems ?? [];
  const quickWins = row.findings
    ? (row.findings as any[])
        .filter((f: any) => f.type === "recommendation")
        .slice(0, 2)
        .map((f: any) => ({ title: f.text.split(":")[0] || f.text, impact: f.text }))
    : [];

  const response: Record<string, unknown> = {
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
    verdictLabel,
    verdictHeadline,
    summary,
    topProblems,
    aiCrawlerFacts: row.ai_crawler_facts,
    mentionRate: row.mention_rate,
    queriesTested: row.queries_tested,
    subpages: row.subpages || [],
    quickWins,
  };

  if (gated) {
    (response as any).recommendations = row.recommendations || [];
  }

  return response;
}

function formatCheck(check: ScoreCheck): { id: string; label: string; passed: boolean; weight: number; detail: string } {
  return { id: check.id, label: check.label, passed: check.passed, weight: check.weight, detail: check.detail };
}

function buildSummary(
  domain: string,
  overallScore: number,
  verdictHeadline: string,
  categoryScores: Record<string, CategoryScore> | null,
): string {
  if (!categoryScores) {
    return `Ihre Website ${domain} erreicht ${overallScore}/100 Punkte. ${verdictHeadline}`;
  }

  let highestKey = "";
  let highestScore = -1;
  let lowestKey = "";
  let lowestScore = 101;

  const categoryLabels: Record<string, string> = {
    technik: "Technik",
    aiReadiness: "KI-Bereitschaft",
    content: "Content",
    trust: "Vertrauen",
    seo: "SEO",
    designUx: "Design & UX",
    performance: "Performance",
    aiVisibility: "KI-Sichtbarkeit",
  };

  for (const [key, cat] of Object.entries(categoryScores)) {
    if (cat.score > highestScore) { highestScore = cat.score; highestKey = key; }
    if (cat.score < lowestScore) { lowestScore = cat.score; lowestKey = key; }
  }

  return `Ihre Website ${domain} erreicht ${overallScore}/100 Punkte. ${verdictHeadline} Staerkste Kategorie: ${categoryLabels[highestKey] || highestKey} (${highestScore}/100). Groesste Verbesserungspotenzial: ${categoryLabels[lowestKey] || lowestKey} (${lowestScore}/100).`;
}

// ─── POST handler ───

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { website_url, vertical, region, _hp, action, reportId: gateReportId, vorname, nachname, email, dsgvo } = body;
    const searchParams = new URL(req.url).searchParams;
    const version = searchParams.get("v");

    // ─── Honeypot check ───
    if (_hp) {
      return json({ ok: true });
    }

    // ─── Email gate action ───
    if (action === "gate") {
      return handleGate({ reportId: gateReportId, vorname, nachname, email, dsgvo });
    }

    // ─── Standard POST flow ───

    if (!website_url) {
      return json({ error: "website_url ist erforderlich" }, { status: 400 });
    }

    if (version === "1" && (!vertical || !region)) {
      return json({ error: "website_url, vertical und region sind erforderlich" }, { status: 400 });
    }

    if (vertical && !isValidVertical(vertical)) {
      return json({ error: `Ungueltiger Vertical. Gueltig: Wein, Feinkost, Craft Beer, Fitness, Gastro` }, { status: 400 });
    }

    // DNS validation
    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    // Rate limit (Supabase)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const rateLimit = await checkRateLimitDb(ip);
    if (!rateLimit.allowed) {
      return json({ error: "Zu viele Anfragen. Bitte versuchen Sie es morgen erneut." }, { status: 429 });
    }

    // Cache check: look for existing report by domain
    const cached = await getReportByDomain(dns.domain);
    if (cached) {
      if (version === "1") {
        return json({ brand_mentions: cached.mention_rate ?? 0, total_runs: cached.queries_tested ?? 0, top_competitor_mentions: 0 });
      }
      return json(buildV2Response(cached, !!cached.lead_id));
    }

    // ─── Pipeline ───
    const t0 = Date.now();

    // Step 1: Collect facts
    const facts = await collectFacts(website_url);
    const tFacts = Date.now();

    // Step 2: Score report
    const scores = scoreReport(facts);
    const tScores = Date.now();

    // Step 3: LLM visibility check (Gemini with grounding)
    let mentionRate: number | null = null;
    let queriesTested = 0;

    if (process.env.GEMINI_API_KEY) {
      try {
        const brandName = await fetchBrandName(dns.domain);

        let brandMentions = 0;
        let totalQueries = 0;

        const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
        if (GEMINI_KEY && brandName) {
          const prompts = [
            `Welche ${vertical || "Unternehmen"} in ${region || "Deutschland"} koennen Sie empfehlen?`,
            `Was sind die besten ${vertical || "Unternehmen"} in ${region || "Deutschland"}?`,
          ];

          for (const prompt of prompts) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  tools: [{ googleSearch: {} }],
                  generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
                }),
              });
              if (res.ok) {
                const data = await res.json();
                const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").toLowerCase();
                if (text.includes(brandName.toLowerCase()) || text.includes(dns.domain.toLowerCase())) {
                  brandMentions++;
                }
                totalQueries++;
              }
            } catch {
              // Skip failed provider calls
            }
          }
        }

        mentionRate = totalQueries > 0 ? brandMentions / totalQueries : null;
        queriesTested = totalQueries;

        if (mentionRate !== null && totalQueries > 0) {
          const aiVisScore = Math.round(mentionRate * 100);
          scores.categoryScores.aiVisibility = {
            score: aiVisScore,
            checks: [
              {
                id: "ai-vis-quick",
                label: "KI-Sichtbarkeit",
                passed: mentionRate > 0,
                weight: 100,
                detail: `${brandMentions} von ${totalQueries} KI-Abfragen nennen ${brandName}`,
                evidence: `Erwaehnungsrate: ${Math.round(mentionRate * 100)}%`,
              },
            ],
          };
        }
      } catch (err) {
        console.error("Quick LLM visibility check failed:", err);
      }
    }
    const tLLM = Date.now();

    // Step 4: Anti-hallucination review
    let review = null;
    try {
      const findings: Array<{ type: "finding" | "recommendation"; text: string; category?: string }> = [];
      for (const [catKey, cat] of Object.entries(scores.categoryScores)) {
        for (const check of cat.checks) {
          findings.push({
            type: check.passed ? "recommendation" : "finding",
            text: `${check.label}: ${check.detail}`,
            category: catKey,
          });
        }
      }

      review = await reviewReport(
        facts,
        findings,
        scores.verdictHeadline,
        scores.verdictHeadline,
        scores.categoryScores as any,
      );
    } catch (err) {
      console.error("Review failed:", err);
    }
    const tReview = Date.now();

    // Step 5: Build and save report
    const brandName = await fetchBrandName(dns.domain);
    const timings = {
      factsMs: tFacts - t0,
      scoresMs: tScores - tFacts,
      llmMs: tLLM - tScores,
      reviewMs: tReview - tLLM,
      totalMs: tReview - t0,
    };

    const { id: reportId, shortSlug } = await saveReport({
      domain: dns.domain,
      url: website_url,
      resolvedUrl: facts.meta.canonical ?? undefined,
      lang: facts.meta.htmlLang ?? undefined,
      overallScore: scores.overallScore,
      categoryScores: scores.categoryScores,
      citability: scores.citability,
      findings: review ? findingsFromScores(scores.categoryScores) : null,
      recommendations: null,
      topProblems: buildTopProblems(scores.categoryScores),
      llmVisibility: { mentionRate, queriesTested },
      verifiedFacts: facts,
      qualityMeta: review?.qualityMeta ?? null,
      timings,
      brandName,
      vertical,
      region,
      subpages: facts.scannedUrls,
      aiCrawlerFacts: facts.crawlers,
      mentionRate,
      queriesTested,
    });

    // Return appropriate version
    if (version === "1") {
      return json({ brand_mentions: mentionRate ?? 0, total_runs: queriesTested, top_competitor_mentions: 0 });
    }

    return json({ ...buildV2Response({
      id: reportId, short_slug: shortSlug, domain: dns.domain, brand_name: brandName,
      overall_score: scores.overallScore,
      category_scores: scores.categoryScores,
      citability: scores.citability,
      quality_meta: review?.qualityMeta ?? null,
      ai_crawler_facts: facts.crawlers,
      mention_rate: mentionRate,
      queries_tested: queriesTested,
      subpages: facts.scannedUrls,
      lead_id: null,
      findings: review ? findingsFromScores(scores.categoryScores) : null,
      recommendations: null,
      top_problems: buildTopProblems(scores.categoryScores),
    }, false) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
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

    const gated = !!report.lead_id;
    return json(buildV2Response(report, gated));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}

// ─── Gate handler ───

async function handleGate(params: {
  reportId: string;
  vorname: string;
  nachname: string;
  email: string;
  dsgvo: boolean;
}) {
  const { reportId, vorname, nachname, email, dsgvo } = params;

  if (!reportId || !vorname || !nachname || !email) {
    return json({ error: "Alle Felder sind erforderlich (reportId, vorname, nachname, email)" }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return json({ error: "Ungueltige E-Mail-Adresse" }, { status: 400 });
  }

  if (dsgvo !== true) {
    return json({ error: "DSGVO-Einwilligung ist erforderlich" }, { status: 400 });
  }

  const report = await getReport(reportId);
  if (!report) {
    return json({ error: "Report nicht gefunden" }, { status: 400 });
  }

  // Create lead and link to report
  await createLead({
    reportId: report.id,
    firstName: vorname,
    lastName: nachname,
    email,
    consentPrivacy: true,
  });

  return json(buildV2Response({ ...report, lead_id: "linked" }, true));
}

// ─── Helpers ───

function buildTopProblems(categoryScores: any): Array<{ title: string; impact: string }> {
  if (!categoryScores) return [];
  const failingChecks: Array<{ weight: number; label: string; detail: string }> = [];
  for (const cat of Object.values(categoryScores)) {
    for (const check of (cat as any).checks) {
      if (!check.passed) failingChecks.push({ weight: check.weight, label: check.label, detail: check.detail });
    }
  }
  failingChecks.sort((a, b) => b.weight - a.weight);
  return failingChecks.slice(0, 7).map((c) => ({ title: c.label, impact: c.detail }));
}

function findingsFromScores(categoryScores: any): Array<{ type: string; text: string; category: string }> {
  if (!categoryScores) return [];
  const findings: Array<{ type: string; text: string; category: string }> = [];
  for (const [key, cat] of Object.entries(categoryScores)) {
    for (const check of (cat as any).checks) {
      findings.push({
        type: check.passed ? "recommendation" : "finding",
        text: `${check.label}: ${check.detail}`,
        category: key,
      });
    }
  }
  return findings;
}
