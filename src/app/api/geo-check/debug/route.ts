// GEO Check — Debug endpoint (gated by x-debug-secret header)
// POST /api/geo-check/debug
// Returns raw LLM responses + brandName + aliases for diagnostics.
// NEVER expose to anonymous users — llm_results is gated data.

import { NextRequest, NextResponse } from "next/server";
import {
  validateDomain,
  fetchBrandName,
  runQuickCheck,
  buildBrandAliases,
  isValidVertical,
} from "@/lib/geo-check";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-debug-secret",
};

function json(data: unknown, init?: ResponseInit) {
  const status = init?.status || 200;
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  return NextResponse.json(data, { status, headers });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    // ─── Gate: require debug secret ───
    const debugSecret = req.headers.get("x-debug-secret");
    const expected = process.env.DEBUG_SECRET;
    if (!expected || debugSecret !== expected) {
      return json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { website_url, vertical, region } = body;

    if (!website_url) {
      return json({ error: "website_url erforderlich" }, { status: 400 });
    }

    if (vertical && !isValidVertical(vertical)) {
      return json({ error: `Ungültiger Vertical. Gültig: Wein, Feinkost, Craft Beer, Fitness, Gastro` }, { status: 400 });
    }

    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    const brandName = await fetchBrandName(dns.domain);
    const aliases = buildBrandAliases(dns.domain, brandName);

    // Run quick check — returns raw LLM text in each run
    const result = await runQuickCheck(
      brandName,
      dns.domain,
      vertical || "Wein",
      region || "Pfalz",
    );

    // Build debug output: raw LLM responses + metadata
    const debugRuns = result.runs.map((r) => ({
      provider: r.provider,
      prompt: r.prompt,
      responseText: r.responseText,
      brandMentioned: r.brandMentioned,
      competitorsMentioned: r.competitorsMentioned,
    }));

    return json({
      brandName,
      domain: dns.domain,
      aliases,
      brandMentions: result.brandMentions,
      totalRuns: result.runs.length,
      topCompetitor: result.topCompetitor,
      topCompetitorMentions: result.topCompetitorMentions,
      llm_results: debugRuns,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
