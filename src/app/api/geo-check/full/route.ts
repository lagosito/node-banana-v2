// GEO Check — Full endpoint (public, async with email)
// POST /api/geo-check/full
// Body: { website_url, vertical, region, email, _hp?: string }

import { NextRequest, NextResponse } from "next/server";
import {
  validateDomain,
  getCachedResult,
  extractBrandFromDomain,
  fetchBrandName,
  runFullCheck,
  createCheckRecord,
  sendCheckEmail,
  sendSlackPing,
  isValidVertical,
  VALID_VERTICALS,
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
    const { website_url, vertical, region, email, _hp } = body;

    // ─── Honeypot check ───
    if (_hp) {
      return json({ success: true, message: "Thank you! We will get back to you shortly." });
    }

    // ─── Validation ───
    if (!website_url || !vertical || !region || !email) {
      return json({ error: "website_url, vertical, region, and email are required" }, { status: 400 });
    }

    // Vertical validation
    if (!isValidVertical(vertical)) {
      return json({ error: `Invalid vertical. Valid: ${VALID_VERTICALS.join(", ")}` }, { status: 400 });
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid email address" }, { status: 400 });
    }

    // DNS validation
    const dns = await validateDomain(website_url);
    if (!dns.valid) {
      return json({ error: dns.error }, { status: 400 });
    }

    // ─── Get cached quick results if available ───
    const cachedQuick = getCachedResult(dns.domain);

    // ─── Fetch real brand name from website (with fallback to domain) ───
    const brandName = await fetchBrandName(dns.domain);

    // ─── Respond immediately (202 Accepted) ───
    // Processing continues in background
    processFullCheck({
      brandName,
      brandDomain: dns.domain,
      websiteUrl: website_url,
      vertical,
      region,
      email,
      existingQuickResult: cachedQuick,
    }).catch((err) => {
      console.error("Full check background error:", err);
    });

    return json(
      { success: true, message: "Thank you! We will send you the results shortly via email." },
      { status: 202 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return json({ error: message }, { status: 500 });
  }
}

// ─── Background processing ───

async function processFullCheck(params: {
  brandName: string;
  brandDomain: string;
  websiteUrl: string;
  vertical: string;
  region: string;
  email: string;
  existingQuickResult?: { brand_mentions: number; total_runs: number; top_competitor_mentions: number } | null;
}) {
  const { brandName, brandDomain, websiteUrl, vertical, region, email, existingQuickResult } = params;

  try {
    // Run full check (reuses quick runs if cached)
    const result = await runFullCheck(brandName, brandDomain, vertical, region);

    // Save to Airtable
    const resultsJson = JSON.stringify({
      brand: brandName,
      domain: brandDomain,
      vertical,
      region,
      email,
      date: new Date().toISOString().split("T")[0],
      totalRuns: result.totalRuns,
      brandMentions: result.brandMentions,
      topCompetitor: result.topCompetitor,
      topCompetitorMentions: result.topCompetitorMentions,
      competitorDetails: result.competitorDetails,
    });

    const auditId = await createCheckRecord({
      brandName,
      websiteUrl,
      vertical,
      region,
      email,
      status: "Done",
      resultsJson,
    });

    // Send email
    const emailSent = await sendCheckEmail({
      to: email,
      brandName,
      brandMentions: result.brandMentions ?? 0,
      totalRuns: result.totalRuns,
      topCompetitor: result.topCompetitor,
      topCompetitorMentions: result.topCompetitorMentions,
    });

    // Slack notification
    await sendSlackPing({
      brandName,
      brandDomain,
      email,
      brandMentions: result.brandMentions ?? 0,
      totalRuns: result.totalRuns,
      topCompetitor: result.topCompetitor,
      topCompetitorMentions: result.topCompetitorMentions,
      auditId,
    });

    console.log(`GEO-Check full done: ${brandName} (audit: ${auditId}, email sent: ${emailSent})`);
  } catch (err) {
    console.error(`GEO-Check full failed for ${brandName}:`, err);
  }
}
