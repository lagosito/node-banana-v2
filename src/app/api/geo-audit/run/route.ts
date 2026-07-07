// GEO Audit — Webhook endpoint
// POST /api/geo-audit/run
// Body: { audit_id: string }
// Header: x-geo-secret: <secret>

import { NextRequest, NextResponse } from "next/server";
import { runGeoAudit } from "@/lib/geo-audit/runner";

export const maxDuration = 240; // Pro plan allows up to 300s

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
    // Secret validation (skip if no secret configured — dev mode)
    const secret = req.headers.get("x-geo-secret");
    if (GEO_SECRET && secret !== GEO_SECRET) {
      return corsJson({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { audit_id } = body;

    if (!audit_id) {
      return corsJson({ error: "audit_id required" }, { status: 400 });
    }

    const result = await runGeoAudit(audit_id);

    // If there are critical errors (all providers failed), return partial result with warning
    const hasResults = result.totalRuns > 0;
    return corsJson({
      success: hasResults,
      result,
      ...(result.errors.length > 0 && { warnings: result.errors }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
