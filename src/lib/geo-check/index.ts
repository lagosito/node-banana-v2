// GEO Check — Shared utilities
// DNS validation, rate limiting, cache, provider calls, Airtable operations

import { callProvider } from "@/lib/geo-audit/providers";
import { analyzeResponseBatch } from "@/lib/geo-audit/analyzer";
import type { ProviderName } from "@/lib/geo-audit/types";

// ─── Environment ───
const AIRTABLE_BASE_ID = process.env.GEO_AUDIT_BASE_ID || "appL4ES7bjExT6908";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";

// Airtable table IDs (reuse audit base)
const T = {
  AUDITS: "tbldUrux7XHaT9SiU",
  RUNS: "tblqvbIlCWnrBR7fk",
};

// ─── Valid verticals (from Prompt Library) ───

export const VALID_VERTICALS = ["Wein", "Feinkost", "Craft Beer", "Fitness", "Gastro"] as const;
export type ValidVertical = (typeof VALID_VERTICALS)[number];

export function isValidVertical(vertical: string): vertical is ValidVertical {
  return VALID_VERTICALS.includes(vertical as ValidVertical);
}

// ─── DNS Validation ───

export async function validateDomain(url: string): Promise<{ valid: boolean; domain: string; error?: string }> {
  let domain: string;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    domain = u.hostname.replace(/^www\./, "");
  } catch {
    return { valid: false, domain: "", error: "Ungültige URL" };
  }

  try {
    // Check if domain resolves (DNS lookup via fetch with short timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    return { valid: true, domain };
  } catch {
    return { valid: false, domain, error: "Domain nicht erreichbar" };
  }
}

// ─── Rate Limiting (in-memory, per IP, 5/day) ───

const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string, maxPerDay = 5): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now > entry.resetAt) {
    // New day or first request
    rateLimits.set(ip, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return { allowed: true, remaining: maxPerDay - 1 };
  }

  if (entry.count >= maxPerDay) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxPerDay - entry.count };
}

// ─── Cache (in-memory, 30 days per domain) ───

const checkCache = new Map<string, { result: QuickResult; timestamp: number }>();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface QuickResult {
  brand_mentions: number;
  total_runs: number;
  top_competitor_mentions: number;
  cached?: boolean;
}

export function getCachedResult(domain: string): QuickResult | null {
  const entry = checkCache.get(domain);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return { ...entry.result, cached: true };
  }
  checkCache.delete(domain);
  return null;
}

export function setCachedResult(domain: string, result: QuickResult): void {
  checkCache.set(domain, { result, timestamp: Date.now() });
}

// ─── Brand name extraction from domain ───

export function extractBrandFromDomain(domain: string): string {
  // Fallback: convert domain to brand-like name: "buerklin-wolf.de" → "Bürklin Wolf"
  const base = domain.split(".")[0];
  return base
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Fetch the real brand name from the website's <title> or og:title.
 * Falls back to extractBrandFromDomain if fetch fails.
 */
export async function fetchBrandName(domain: string): Promise<string> {
  const fallback = extractBrandFromDomain(domain);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://${domain}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GEO-Check/1.0)" },
    });
    clearTimeout(timeout);
    const html = await res.text();

    // Try og:title first (most reliable)
    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch?.[1]) return cleanBrandName(ogMatch[1]);

    // Try <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return cleanBrandName(titleMatch[1]);

    // Try first <h1>
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) return cleanBrandName(h1Match[1]);
  } catch {
    // Fall through to domain-based name
  }
  return fallback;
}

/** Clean a brand name extracted from HTML: strip suffixes, normalize */
function cleanBrandName(raw: string): string {
  let name = raw.trim();
  // Remove common suffixes after a separator: " | Home", " – Willkommen", " - Startseite"
  name = name.replace(/\s*[|–—-]\s*(Home|Startseite|Willkommen|Homepage|Impressum|Kontakt).*$/i, "");
  // Remove trailing punctuation
  name = name.replace(/[.\s]+$/, "");
  // Limit length (some titles are very long)
  if (name.length > 60) name = name.substring(0, 60).replace(/\s+\S*$/, "");
  return name || extractBrandFromDomain("x.com"); // shouldn't happen
}

// ─── Quick Check (2 prompts × 2 providers = 4 runs, analyzed by Haiku) ───

const QUICK_PROMPTS = [
  "Welche {vertical} in {region} können Sie empfehlen?",
  "Was sind die besten {vertical} in {region}?",
];

export interface QuickRunResult {
  provider: string;
  prompt: string;
  responseText: string;
  brandMentioned: boolean;
  competitorsMentioned: string[];
}

export async function runQuickCheck(
  brandName: string,
  brandDomain: string,
  vertical: string,
  region: string,
): Promise<{ runs: QuickRunResult[]; brandMentions: number; topCompetitor: string; topCompetitorMentions: number }> {
  const providers: ProviderName[] = ["gemini", "perplexity"];
  const activeProviders = providers.filter((p) => {
    if (p === "gemini") return !!process.env.GEMINI_API_KEY;
    if (p === "perplexity") return !!process.env.OPENROUTER_API_KEY;
    return false;
  });

  if (activeProviders.length === 0) {
    throw new Error("No providers configured for quick check");
  }

  // Phase 1: Call all providers with all prompts
  const providerResponses: { promptId: string; text: string; provider: string; prompt: string }[] = [];

  for (const promptTemplate of QUICK_PROMPTS) {
    const prompt = promptTemplate
      .replace(/{vertical}/g, vertical)
      .replace(/{region}/g, region);

    for (const provider of activeProviders) {
      try {
        const response = await callProvider(provider, prompt);
        providerResponses.push({
          promptId: `${provider}-${prompt.slice(0, 30)}`,
          text: response.text,
          provider,
          prompt,
        });
      } catch (err) {
        console.error(`Quick check error (${provider}):`, err);
      }
    }
  }

  // Phase 2: Batch analyze with Claude Haiku (same as audit runner)
  let analyses: Record<string, any> = {};
  if (providerResponses.length > 0) {
    try {
      analyses = await analyzeResponseBatch(
        providerResponses.map((r) => ({ id: r.promptId, text: r.text })),
        brandName,
        brandDomain,
        [], // no aliases for quick check
      );
    } catch (err) {
      console.error("Quick check batch analysis failed:", err);
    }
  }

  // Phase 3: Build results from Haiku analysis (NOT regex)
  const runs: QuickRunResult[] = [];
  const allCompetitorCounts: Record<string, number> = {};

  for (const resp of providerResponses) {
    const analysis = analyses[resp.promptId] || {
      brand_mentioned: false,
      competitors_mentioned: [],
    };

    for (const c of analysis.competitors_mentioned) {
      allCompetitorCounts[c] = (allCompetitorCounts[c] || 0) + 1;
    }

    runs.push({
      provider: resp.provider,
      prompt: resp.prompt,
      responseText: resp.text,
      brandMentioned: analysis.brand_mentioned,
      competitorsMentioned: analysis.competitors_mentioned,
    });
  }

  // Calculate results
  const brandMentions = runs.filter((r) => r.brandMentioned).length;
  let topCompetitor = "";
  let topCompetitorMentions = 0;

  for (const [name, count] of Object.entries(allCompetitorCounts)) {
    if (count > topCompetitorMentions) {
      topCompetitorMentions = count;
      topCompetitor = name;
    }
  }

  return { runs, brandMentions, topCompetitor, topCompetitorMentions };
}

// ─── Airtable operations for Check records ───

async function atFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}

export async function createCheckRecord(data: {
  brandName: string;
  websiteUrl: string;
  vertical: string;
  region: string;
  email?: string;
  status: string;
  resultsJson: string;
}): Promise<string> {
  const result = await atFetch(`/${AIRTABLE_BASE_ID}/${T.AUDITS}`, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Brand Name": data.brandName,
        "Website URL": data.websiteUrl,
        Vertical: data.vertical,
        Region: data.region,
        Language: "DE",
        Type: "Check",
        Status: data.status,
        "Results JSON": data.resultsJson,
      },
      typecast: true,
    }),
  });
  return result.id;
}

// ─── Brevo Email ───

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

// ─── Fixed copy (LANG RULE: German text from Gabriel, not generated) ───
// CONTEXT_LINE: two exact phrases, verbatim, chosen by result
const CONTEXT_LINES = {
  weak: "Potenzielle Kunden, die eine KI nach Empfehlungen fragen, finden aktuell Ihre Wettbewerber, nicht Sie.",
  strong: "Ihre Sichtbarkeit ist bereits stark. Das Audit zeigt, wie Sie diese Position gegen Ihre Wettbewerber verteidigen.",
} as const;

// ─── Slack Notification ───

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

export async function sendSlackPing(params: {
  brandName: string;
  brandDomain: string;
  email: string;
  brandMentions: number;
  totalRuns: number;
  topCompetitor: string;
  topCompetitorMentions: number;
  auditId: string;
}): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.error("SLACK_WEBHOOK_URL not configured");
    return false;
  }

  const { brandName, brandDomain, email, brandMentions, totalRuns, topCompetitor, topCompetitorMentions, auditId } = params;

  const competitorLine = topCompetitor
    ? `*Top-Konkurrent:* ${topCompetitor} (${topCompetitorMentions}/${totalRuns})`
    : "*Kein Konkurrent erkannt*";

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `🔍 GEO-Check: ${brandName}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Marke:*\n${brandName}` },
          { type: "mrkdwn", text: `*Domain:*\n${brandDomain}` },
          { type: "mrkdwn", text: `*Erwähnungen:*\n${brandMentions}/${totalRuns}` },
          { type: "mrkdwn", text: `*E-Mail:*\n${email}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: competitorLine },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Audit-ID: ${auditId}` },
        ],
      },
    ],
  };

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Slack error:", err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Slack ping failed:", err);
    return false;
  }
}

export async function sendCheckEmail(params: {
  to: string;
  brandName: string;
  brandMentions: number;
  totalRuns: number;
  topCompetitor: string;
  topCompetitorMentions: number;
}): Promise<boolean> {
  if (!BREVO_API_KEY) {
    console.error("BREVO_API_KEY not configured");
    return false;
  }

  const { to, brandName, brandMentions, totalRuns, topCompetitor, topCompetitorMentions } = params;

  // ─── Context line: FIXED copy, verbatim (LANG RULE) ───
  const hasCompetitor = !!topCompetitor;
  const isWeak = hasCompetitor && brandMentions < topCompetitorMentions / 2;

  const contextLine = !hasCompetitor
    ? "Wir arbeiten an weiteren Benchmarks für Ihre Branche."
    : isWeak
      ? CONTEXT_LINES.weak
      : CONTEXT_LINES.strong;

  // ─── Subject: competitor from Haiku analysis (already validated) ───
  // Haiku returns only real company names in competitors_mentioned
  const subject = hasCompetitor
    ? `Ihr GEO-Check: ${brandName} vs. ${topCompetitor}`
    : `Ihr GEO-Check: ${brandName}`;

  // ─── Competitor line in body ───
  const competitorHtml = hasCompetitor
    ? `<p style="margin:0 0 12px;"><span style="color:#858588;">Ihr sichtbarster Wettbewerber: <strong>${topCompetitor}</strong> (${topCompetitorMentions} von ${totalRuns}).</span></p>`
    : "";

  const bodyHtml = buildEmailHtml({
    brandName,
    brandMentions,
    totalRuns,
    topCompetitor,
    topCompetitorMentions,
    competitorLine: competitorHtml, // HTML from Claude or fallback
    contextLine,
  });

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "el Kiosk", email: "info@elkiosk.ai" },
        to: [{ email: to }],
        subject,
        htmlContent: bodyHtml,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Brevo error:", err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Email send failed:", err);
    return false;
  }
}

function buildEmailHtml(params: {
  brandName: string;
  brandMentions: number;
  totalRuns: number;
  topCompetitor: string;
  topCompetitorMentions: number;
  competitorLine: string;
  contextLine: string;
}): string {
  const { brandName, brandMentions, totalRuns, competitorLine, contextLine } = params;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body bgcolor="#ffffff" text="#3b3f44" style="background-color:#ffffff;margin:0;padding:0;">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#ffffff;">
<tr><td>
  <!-- HEADER GIF -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="font-size:0;padding:15px 0;">
      <img src="https://img.mailinblue.com/10728009/images/content_library/original/69c39e7fceadca56cd48c993.gif" width="500" style="display:block;width:100%;">
    </td></tr>
  </table>

  <!-- BODY -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="background-color:#ffffff;padding:0 0 20px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td style="color:#3b3f44;font-family:arial,helvetica,sans-serif;font-size:16px;line-height:1.5;padding:0 2px;">
          <h2 style="margin:0 0 16px;"><strong><span style="font-size:24px;">Ihr GEO-Check</span></strong></h2>
          <p style="margin:0 0 20px;"><span style="color:#858588;">Guten Tag,</span></p>
          <p style="margin:0 0 20px;"><span style="color:#858588;">wir haben ChatGPT, Perplexity und Gemini gefragt, welche Anbieter sie in Ihrer Kategorie empfehlen. Das Ergebnis für <strong>${brandName}</strong>:</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <!-- RESULTS BOX -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="background-color:#f8f9fa;border-radius:8px;padding:20px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td style="color:#3b3f44;font-family:arial,helvetica,sans-serif;font-size:16px;line-height:1.8;">
          <p style="margin:0 0 12px;"><span style="color:#858588;">Ihre Marke wurde in <strong>${brandMentions}</strong> von <strong>${totalRuns}</strong> KI-Antworten genannt.</span></p>
          ${competitorLine}
          <p style="margin:0;"><span style="color:#858588;">${contextLine}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <!-- SPACER -->
  <table width="500" align="center"><tr><td style="padding:20px 0 10px;">&nbsp;</td></tr></table>

  <!-- CTA BUTTON -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td align="center">
      <a href="mailto:info@elkiosk.ai?subject=GEO-Audit%20anfragen" style="display:inline-block;background-color:#186af8;color:#ffffff;font-family:arial,helvetica,sans-serif;font-size:16px;text-decoration:none;padding:12px 32px;border-radius:50px;">GEO-Audit anfragen</a>
    </td></tr>
  </table>

  <!-- SPACER -->
  <table width="500" align="center"><tr><td style="padding:10px 0 0;">&nbsp;</td></tr></table>

  <!-- OFFER TEXT -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="background-color:#ffffff;padding:0 0 20px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td style="color:#3b3f44;font-family:arial,helvetica,sans-serif;font-size:14px;line-height:1.6;padding:0 2px;">
          <p style="margin:0 0 8px;"><span style="color:#858588;">Was Sie konkret tun können, zeigt unser vollständiges GEO-Audit:</span></p>
          <p style="margin:0 0 4px;"><span style="color:#858588;">36 KI-Antworten analysiert, Ihr GEO-Score, Wettbewerbs-Analyse und 5 konkrete Handlungsempfehlungen für mehr Sichtbarkeit in KI-Systemen.</span></p>
          <p style="margin:0;"><span style="color:#858588;"><strong>Preis: 390 EUR</strong>, Lieferung als PDF-Report.</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <!-- CLOSING -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="color:#3b3f44;font-family:arial,helvetica,sans-serif;font-size:16px;line-height:1.9;padding:0 2px;">
      <p style="margin:0;"><span style="color:#858588;">Beste Grüße,</span></p>
      <p style="margin:0;"><strong>El Kiosk</strong></p>
      <p style="margin:0;"><a href="https://elkiosk.ai" style="color:#0092ff;">elkiosk.ai</a> | <a href="mailto:info@elkiosk.ai" style="color:#0092ff;">info@elkiosk.ai</a></p>
    </td></tr>
  </table>

  <!-- FOOTER GIF -->
  <table cellspacing="0" cellpadding="0" border="0" width="500" align="center">
    <tr><td style="font-size:0;padding:15px 0;">
      <img src="https://img.mailinblue.com/10728009/images/content_library/original/69c3a501b1d2e6b8f2b6c270.gif" width="500" style="display:block;width:100%;">
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}

// ─── Full Check (3 prompts × 2 providers, reuses quick runs) ───

const FULL_PROMPTS = [
  "Welche {vertical} in {region} können Sie empfehlen?",
  "Was sind die besten {vertical} in {region}?",
  "Welche {vertical} in {region} sind besonders beliebt?",
];

export interface FullCheckResult {
  brandName: string;
  brandMentions: number;
  totalRuns: number;
  topCompetitor: string;
  topCompetitorMentions: number;
  competitorDetails: { name: string; count: number }[];
}

export async function runFullCheck(
  brandName: string,
  brandDomain: string,
  vertical: string,
  region: string,
  existingRuns?: QuickRunResult[],
): Promise<FullCheckResult> {
  const providers: ProviderName[] = ["gemini", "perplexity"];
  const activeProviders = providers.filter((p) => {
    if (p === "gemini") return !!process.env.GEMINI_API_KEY;
    if (p === "perplexity") return !!process.env.OPENROUTER_API_KEY;
    return false;
  });

  // Process existing quick runs (already analyzed by Haiku)
  const allCompetitorCounts: Record<string, number> = {};
  let totalBrandMentions = 0;
  let totalRuns = 0;

  if (existingRuns) {
    for (const run of existingRuns) {
      totalRuns++;
      if (run.brandMentioned) totalBrandMentions++;
      for (const c of run.competitorsMentioned) {
        allCompetitorCounts[c] = (allCompetitorCounts[c] || 0) + 1;
      }
    }
  }

  // Determine which prompts still need to run
  const existingPrompts = new Set(existingRuns?.map((r) => r.prompt) || []);
  const promptsToRun = FULL_PROMPTS
    .map((p) => p.replace(/{vertical}/g, vertical).replace(/{region}/g, region))
    .filter((p) => !existingPrompts.has(p));

  // Phase 1: Call remaining providers
  const providerResponses: { id: string; text: string }[] = [];

  for (const prompt of promptsToRun) {
    for (const provider of activeProviders) {
      try {
        const response = await callProvider(provider, prompt);
        providerResponses.push({
          id: `${provider}-${prompt.slice(0, 30)}`,
          text: response.text,
        });
      } catch (err) {
        console.error(`Full check error (${provider}):`, err);
        totalRuns++;
      }
    }
  }

  // Phase 2: Batch analyze with Claude Haiku (same as audit runner)
  let analyses: Record<string, any> = {};
  if (providerResponses.length > 0) {
    try {
      analyses = await analyzeResponseBatch(
        providerResponses,
        brandName,
        brandDomain,
        [], // no aliases for check
      );
    } catch (err) {
      console.error("Full check batch analysis failed:", err);
    }
  }

  // Phase 3: Build results from Haiku analysis
  for (const resp of providerResponses) {
    const analysis = analyses[resp.id] || {
      brand_mentioned: false,
      competitors_mentioned: [],
    };

    if (analysis.brand_mentioned) totalBrandMentions++;
    totalRuns++;

    for (const c of analysis.competitors_mentioned) {
      allCompetitorCounts[c] = (allCompetitorCounts[c] || 0) + 1;
    }
  }

  // Sort competitors
  const competitorDetails = Object.entries(allCompetitorCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topCompetitor = competitorDetails[0]?.name || "";
  const topCompetitorMentions = competitorDetails[0]?.count || 0;

  return {
    brandName,
    brandMentions: totalBrandMentions,
    totalRuns,
    topCompetitor,
    topCompetitorMentions,
    competitorDetails,
  };
}
