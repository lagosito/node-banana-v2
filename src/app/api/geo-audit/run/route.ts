// GEO Audit — Webhook endpoint
// POST /api/geo-audit/run
// Body: { audit_id: string }
// Header: x-geo-secret: <secret>

import { NextRequest, NextResponse } from "next/server";
import { runGeoAudit } from "@/lib/geo-audit/runner";
import { generateFindings } from "@/lib/geo-audit/findings";
import { createFinding, getAudit } from "@/lib/geo-audit/airtable";

export const maxDuration = 240;

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
    // Secret validation
    const secret = req.headers.get("x-geo-secret");
    if (GEO_SECRET && secret !== GEO_SECRET) {
      return corsJson({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { audit_id } = body;

    if (!audit_id) {
      return corsJson({ error: "audit_id required" }, { status: 400 });
    }

    // Phase 1-3: Run the audit
    const result = await runGeoAudit(audit_id);

    // Phase 4: Generate findings if we have data
    let findings: unknown[] = [];
    if (result.totalRuns > 0 && result.mentions > 0) {
      try {
        // Collect all cited domains from runs
        // (we need to re-fetch or pass from runner — for now use empty)
        const audit = await getAudit(audit_id);
        const findingsData = await generateFindings(
          result.brand,
          audit.fields.Vertical,
          audit.fields.Region || "Deutschland",
          result.score,
          result.topCompetitors,
          [], // citedDomains — collected during runs but not passed back
          result.totalRuns,
          result.mentions,
        );

        // Save findings to Airtable
        for (const f of findingsData) {
          await createFinding(audit_id, f);
        }
        findings = findingsData;
      } catch (err) {
        // Findings generation is non-critical
        findings = [{ error: err instanceof Error ? err.message : "Findings generation failed" }];
      }
    }

    return corsJson({
      success: result.totalRuns > 0,
      result: {
        ...result,
        findings,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
