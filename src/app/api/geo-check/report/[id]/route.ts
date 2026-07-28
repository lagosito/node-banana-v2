// GEO Check — Report endpoint (gated by unlocked status)
// GET /api/geo-check/report/[id]

import { NextRequest, NextResponse } from "next/server";
import { getReport, createLead } from "@/lib/geo-check/storage";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// ─── GET: Read report ───

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const report = await getReport(id);

    if (!report) {
      return json({ error: "Report not found" }, { status: 404 });
    }

    // Extend TTL on access — REMOVED: was keeping old reports alive indefinitely
    // touchReport(report.id);

    // All data returned always (gate removed)
    // Build compatibility fields for Lovable frontend (GEO-Audit format)
    const providerTable = Object.entries(report.provider_status || {}).map(
      ([name, ps]: [string, any]) => ({
        name,
        runs: ps.queriesRun || 0,
        mentions: ps.mentions || 0,
        avgPosition: (ps.mentions || 0) > 0 ? null : null, // null = no data, never 0
        cited: 0,
        incomplete: ps.status === "partial" || ps.status === "error",
      }),
    );
    const citedDomains: string[] = [];
    if (report.analysis_details) {
      const domainSet = new Set<string>();
      for (const detail of Object.values(report.analysis_details) as any[]) {
        for (const d of detail.cited_domains || []) {
          if (d && typeof d === "string") domainSet.add(d);
        }
      }
      citedDomains.push(...domainSet);
    }
    const findings = (report.top_problems || []).map((p: any, i: number) => ({
      category: "GEO-Check",
      finding: p.title || "",
      recommendation: p.impact || "",
      priority: i + 1,
    }));
    const zusammenfassung = report.visibility_summary || "";
    const breakdown = report.composite_breakdown || [];
    const score = report.composite_score ?? report.overall_score ?? 0;

    const response: Record<string, unknown> = {
      reportId: report.id,
      shortSlug: report.short_slug,
      domain: report.domain,
      overallScore: report.overall_score,
      categoryScores: report.category_scores,
      citability: report.citability,
      topProblems: report.top_problems,
      aiCrawlerFacts: report.ai_crawler_facts,
      subpages: report.subpages || [],
      status: report.status,
      providerStatus: report.provider_status || {},
      createdAt: report.created_at,
      // LLM phase data (always included)
      mentionRate: report.mention_rate,
      queriesTested: report.queries_tested,
      recommendations: report.recommendations || [],
      qualityMeta: report.quality_meta,
      llmResults: report.llm_results,
      topCompetitor: report.top_competitor || null,
      topCompetitorMentions: report.top_competitor_mentions || 0,
      topCompetitors: report.top_competitors || [],
      visibilitySummary: report.visibility_summary || null,
      // New v2 fields
      compositeScore: report.composite_score ?? null,
      compositeBreakdown: report.composite_breakdown || null,
      analysisDetails: report.analysis_details || null,
      // Compatibility fields for Lovable frontend (GEO-Audit format)
      findings,
      providerTable,
      citedDomains,
      zusammenfassung,
      breakdown,
      score,
      technicalScore: report.overall_score ?? 0, // Phase 1 technical score (separate from composite)
      // Gate status (informational only)
      gated: false,
      emailCollected: report.unlocked,
      // T6: Other vertical
      promptsUsed: report.prompts_used || null,
      verticalResolved: report.vertical_resolved || null,
    };

    return json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}

// ─── POST: Gate (email unlock) ───

export async function POST(req: NextRequest) {
  try {
    const { reportId, vorname, nachname, email, dsgvo } = await req.json();

    if (!reportId || !vorname || !nachname || !email) {
      return json({ error: "All fields are required" }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return json({ error: "Invalid email address" }, { status: 400 });
    }

    if (dsgvo !== true) {
      return json({ error: "Privacy consent is required" }, { status: 400 });
    }

    const report = await getReport(reportId);
    if (!report) {
      return json({ error: "Report not found" }, { status: 404 });
    }

    if (report.unlocked) {
      return json({ error: "Report bereits freigeschaltet" }, { status: 409 });
    }

    // Create lead and unlock report
    await createLead({
      reportId: report.id,
      firstName: vorname,
      lastName: nachname,
      email,
      consentPrivacy: true,
    });

    // Re-fetch to get updated report with unlocked=true
    const unlocked = await getReport(reportId);

    return json({
      reportId: unlocked!.id,
      shortSlug: unlocked!.short_slug,
      domain: unlocked!.domain,
      overallScore: unlocked!.overall_score,
      categoryScores: unlocked!.category_scores,
      citability: unlocked!.citability,
      topProblems: unlocked!.top_problems,
      aiCrawlerFacts: unlocked!.ai_crawler_facts,
      subpages: unlocked!.subpages || [],
      status: unlocked!.status,
      providerStatus: unlocked!.provider_status || {},
      mentionRate: unlocked!.mention_rate,
      queriesTested: unlocked!.queries_tested,
      recommendations: unlocked!.recommendations || [],
      qualityMeta: unlocked!.quality_meta,
      llmResults: unlocked!.llm_results,
      topCompetitor: unlocked!.top_competitor || null,
      topCompetitorMentions: unlocked!.top_competitor_mentions || 0,
      topCompetitors: unlocked!.top_competitors || [],
      visibilitySummary: unlocked!.visibility_summary || null,
      compositeScore: unlocked!.composite_score ?? null,
      compositeBreakdown: unlocked!.composite_breakdown || null,
      analysisDetails: unlocked!.analysis_details || null,
      promptsUsed: unlocked!.prompts_used || null,
      verticalResolved: unlocked!.vertical_resolved || null,
      gated: false,
      emailCollected: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
