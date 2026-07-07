// GEO Audit — Webhook endpoint
// POST /api/geo-audit/run
// Body: { audit_id: string }

import { NextRequest, NextResponse } from "next/server";
import { runGeoAudit } from "@/lib/geo-audit/runner";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    const body = await req.json();
    const { audit_id } = body;

    if (!audit_id) {
      return corsJson({ error: "audit_id required" }, { status: 400 });
    }

    // Run asynchronously — don't block the response
    const runPromise = runGeoAudit(audit_id).catch((err) => ({
      error: err.message,
    }));

    // Return immediately, run in background
    // For production: use a proper job queue. For now, run inline with timeout.
    const result = await Promise.race([
      runPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout: audit took too long")), 300_000)
      ),
    ]);

    return corsJson({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
