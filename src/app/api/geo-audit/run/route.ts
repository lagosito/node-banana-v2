// GEO Audit — Webhook endpoint
// POST /api/geo-audit/run
// Body: { audit_id: string }
// Header: x-geo-secret: <secret>

import { NextRequest, NextResponse } from "next/server";
import { runGeoAudit } from "@/lib/geo-audit/runner";
import { generateFindings } from "@/lib/geo-audit/findings";
import { createFinding, getAudit, deleteFindingsForAudit } from "@/lib/geo-audit/airtable";

export const maxDuration = 300;

const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-geo-secret",
};

function corsJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-geo-secret");
    if (GEO_SECRET && secret !== GEO_SECRET) {
      return corsJson({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { audit_id } = body;
    if (!audit_id) {
      return corsJson({ error: "audit_id required" }, { status: 400 });
    }

    // Run audit — returns ResultsJSON (already saved to audit record)
    const result = await runGeoAudit(audit_id);

    // Check completeness — don't generate findings for incomplete audits
    if ((result as any)._completenessError) {
      return corsJson({
        success: false,
        status: "Incomplete",
        error: (result as any)._completenessError,
        result,
      });
    }

    // DELETE old findings for this audit before regenerating
    await deleteFindingsForAudit(audit_id);

    // Generate findings if we have data
    let findings: unknown[] = [];
    const mentionCount = Math.round(result.totalRuns * result.score.mentionRate / 100);
    if (result.totalRuns > 0 && mentionCount > 0) {
      try {
        const audit = await getAudit(audit_id);
        const findingsData = await generateFindings(
          result.brand,
          audit.vertical,
          audit.region || "Deutschland",
          result.score,
          result.topCompetitors.map((c) => c.name),
          result.citedDomains,
          result.totalRuns,
          mentionCount,
        );
        for (const f of findingsData) {
          await createFinding(audit_id, f);
        }
        findings = findingsData;
      } catch (err) {
        findings = [{ error: err instanceof Error ? err.message : "Findings failed" }];
      }
    }

    return corsJson({
      success: result.totalRuns > 0,
      result: { ...result, findings },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
