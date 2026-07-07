// GEO Audit — PDF Report Generator (minimal test)
import { NextRequest, NextResponse } from "next/server";

const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-geo-secret",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-geo-secret");
    if (GEO_SECRET && secret !== GEO_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { audit_id } = await req.json();
    if (!audit_id) {
      return NextResponse.json({ error: "audit_id required" }, { status: 400 });
    }

    // Minimal test response
    return NextResponse.json({
      success: true,
      message: "Report endpoint working",
      audit_id,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
