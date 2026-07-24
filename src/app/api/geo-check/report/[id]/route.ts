// GEO Check — Report endpoint with Supabase persistence
// GET /api/geo-check/report/[id]

import { NextRequest, NextResponse } from "next/server";
import { getReport, touchReport } from "@/lib/geo-check/storage";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = params;

    const report = await getReport(id);
    if (!report) {
      return NextResponse.json(
        { error: "Report nicht gefunden" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    // Extend TTL on access
    await touchReport(report.id);

    const hasLead = !!report.lead_id;

    if (hasLead) {
      return NextResponse.json(
        {
          reportId: report.id,
          shortSlug: report.short_slug,
          domain: report.domain,
          brandName: report.brand_name,
          overallScore: report.overall_score,
          categoryScores: report.category_scores,
          citability: report.citability,
          verdictLabel: report.quality_meta?.verdictLabel,
          verdictHeadline: report.quality_meta?.correctedHeadline || "",
          summary: report.quality_meta?.correctedSummary || "",
          qualityMeta: report.quality_meta,
          topProblems: report.top_problems,
          quickWins: [],
          aiCrawlerFacts: report.ai_crawler_facts,
          mentionRate: report.mention_rate,
          queriesTested: report.queries_tested,
          subpages: report.subpages || [],
          recommendations: report.recommendations || [],
          createdAt: report.created_at,
          gated: true,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Ungated version
    return NextResponse.json(
      {
        reportId: report.id,
        shortSlug: report.short_slug,
        domain: report.domain,
        overallScore: report.overall_score,
        categoryScores: report.category_scores,
        citability: report.citability,
        verdictLabel: report.quality_meta?.verdictLabel,
        verdictHeadline: report.quality_meta?.correctedHeadline || "",
        summary: "",
        topProblems: report.top_problems,
        quickWins: [],
        aiCrawlerFacts: report.ai_crawler_facts,
        mentionRate: report.mention_rate,
        queriesTested: report.queries_tested,
        subpages: report.subpages || [],
        gated: false,
        gateUrl: `/api/geo-check/quick`,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
