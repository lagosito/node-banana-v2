// GEO Check — Quick endpoint (public, anonymous, sync)
// POST /api/geo-check/quick
// Body: { website_url, vertical, region, _hp?: string } (honeypot)

import { NextRequest, NextResponse } from "next/server";
import {
  validateDomain,
  checkRateLimit,
  getCachedResult,
  setCachedResult,
  extractBrandFromDomain,
  fetchBrandName,
  runQuickCheck,
  isValidVertical,
} from "@/lib/geo-check";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
    const body = await req.json();
    const { website_url, vertical, region, _hp } = body;

    // ─── Honeypot check ───
    if (_hp) {
      // Bot detected — return fake success
      return json({ brand_mentions: 2, total_runs: 4, top_competitor_mentions: 1 });
    }

    // ─── Validation ───
    if (!website_url || !vertical || !region) {
      return json({ error: "website_url, vertical und region sind erforderlich" }, { status: 400 });
    }

    // Vertical validation
    if (!isValidVertical(vertical)) {
      return json({ error: `Ungültiger Vertical. Gültig: Wein, Feinkost, Craft Beer, Fitness, Gastro` }, { status: 400 });
    }

    // DNS validation
    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    // ─── Rate limit ───
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return json({ error: "Zu viele Anfragen. Bitte versuchen Sie es morgen erneut." }, { status: 429 });
    }

    // ─── Cache check ───
    const cached = getCachedResult(dns.domain);
    if (cached) {
      return json({
        brand_mentions: cached.brand_mentions,
        total_runs: cached.total_runs,
        top_competitor_mentions: cached.top_competitor_mentions,
      });
    }

    // ─── Run quick check ───
    const brandName = await fetchBrandName(dns.domain);
    const result = await runQuickCheck(brandName, dns.domain, vertical, region);

    const response = {
      brand_mentions: result.brandMentions,
      total_runs: result.runs.length,
      top_competitor_mentions: result.topCompetitorMentions,
    };

    // Cache result
    setCachedResult(dns.domain, response);

    return json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}
