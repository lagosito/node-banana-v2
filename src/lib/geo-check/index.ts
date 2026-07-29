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

// ─── Shared config (single source of truth) ───
import {
  VALID_VERTICALS,
  type ValidVertical,
  isValidVertical,
  normalizeVertical,
  PROMPTS_BY_VERTICAL,
  selectCheckPrompts,
  buildPrompt,
  buildCheckPrompts,
  resolveVertical,
  inferVerticalFromTitle,
  OTHER_TEMPLATES,
  buildOtherPrompts,
  extractBusinessDescriptor,
} from "./config";

import { classifyDescriptor } from "./classify";
export {
  VALID_VERTICALS,
  type ValidVertical,
  isValidVertical,
  normalizeVertical,
  PROMPTS_BY_VERTICAL,
  selectCheckPrompts,
  buildPrompt,
  buildCheckPrompts,
  resolveVertical,
  inferVerticalFromTitle,
  OTHER_TEMPLATES,
  buildOtherPrompts,
  extractBusinessDescriptor,
  classifyDescriptor,
};

// Re-export fetchPageTitle (defined below, exported here for external consumers)

// ─── DNS Validation ───

export async function validateDomain(url: string): Promise<{ valid: boolean; domain: string; error?: string }> {
  let domain: string;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    domain = u.hostname.replace(/^www\./, "");
  } catch {
    return { valid: false, domain: "", error: "Invalid URL" };
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
    return { valid: false, domain, error: "Domain unreachable" };
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
 * Fetch just the page title (raw, before cleaning) for vertical inference.
 */
export async function fetchPageTitle(domain: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://${domain}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GEO-Check/1.0)" },
    });
    clearTimeout(timeout);
    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch?.[1]) return ogMatch[1].trim();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return titleMatch[1].trim();
  } catch {}
  return "";
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
  return name || "";
}

/**
 * FIX 5: Brand guard by form — rejects non-brand strings deterministically.
 */
function isValidBrand(raw: string): boolean {
  const name = raw.trim();
  if (!name) return false;
  const words = name.split(/\s+/);
  if (words.length > 4) return false;
  const PREPOSITIONS = new Set([
    "in", "für", "aus", "von", "mit", "der", "die", "das", "dem", "den",
    "im", "zum", "zur", "bei", "auf", "an", "am", "um", "nach", "vor",
    "über", "unter", "zwischen", "ohne", "seit", "während", "trotz",
  ]);
  const lastWord = words[words.length - 1].toLowerCase().replace(/[^a-zäöüß]/g, "");
  if (PREPOSITIONS.has(lastWord)) return false;
  if (/[|–—:»]/.test(name) && name.split(/[|–—:»]/).length > 1) return false;
  const BLACKLIST = new Set([
    "homepage", "startseite", "willkommen", "willkommen bei", "firma", "unternehmen",
    "online-shop", "portal", "shop", "dienstleistung", "anbieter", "service",
    "webseite", "website", "seite", "home",
  ]);
  if (BLACKLIST.has(name.toLowerCase())) return false;
  return true;
}

/**
 * Extract brand name with fallback chain: og:title → title → h1 → og:site_name → JSON-LD → domain.
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

    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch?.[1]) {
      const cleaned = cleanBrandName(ogMatch[1]);
      if (cleaned && isValidBrand(cleaned)) return cleaned;
    }
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const cleaned = cleanBrandName(titleMatch[1]);
      if (cleaned && isValidBrand(cleaned)) return cleaned;
    }
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) {
      const cleaned = cleanBrandName(h1Match[1]);
      if (cleaned && isValidBrand(cleaned)) return cleaned;
    }
    const siteNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
    if (siteNameMatch?.[1]) {
      const cleaned = cleanBrandName(siteNameMatch[1]);
      if (cleaned && isValidBrand(cleaned)) return cleaned;
    }
    const jsonLdMatch = html.match(/"@type"\s*:\s*"Organization"[^}]*"name"\s*:\s*"([^"]+)"/i);
    if (jsonLdMatch?.[1]) {
      const cleaned = cleanBrandName(jsonLdMatch[1]);
      if (cleaned && isValidBrand(cleaned)) return cleaned;
    }
  } catch {
    // Fall through to domain-based name
  }
  return fallback;
}

// ─── Brand Aliases ───

const GENERIC = new Set(["weingut","winery","dr","dr.","home","startseite","willkommen","gmbh","co","kg","und"]);
const deUmlaut = (s: string) => s
  .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
  .replace(/Ä/g,"Ae").replace(/Ö/g,"Oe").replace(/Ü/g,"Ue");

// Inverse: ae→ä, oe→ö, ue→ü (for matching brands stored with ASCII umlauts)
const reUmlaut = (s: string) => s
  .replace(/ae/g,"ä").replace(/oe/g,"ö").replace(/ue/g,"ü")
  .replace(/Ae/g,"Ä").replace(/Oe/g,"Ö").replace(/Ue/g,"Ü");

/**
 * Extract the distinctive core of a brand name from a page title.
 * Cuts at a SPACED separator or at , | :
 * Prefers segment matching the domain, then falls back to shortest segment.
 */
export function extractCoreBrand(brandName: string, domain?: string): string {
  const segments = brandName.split(/\s+[-–—]\s+|[,|:]/);
  if (segments.length <= 1) {
    return brandName
      .split(/\s+/)
      .filter(w => !GENERIC.has(w.toLowerCase().replace(/\.$/, "")))
      .join(" ")
      .trim();
  }

  const domainBase = domain?.split(".")[0]?.toLowerCase().replace(/-/g, "") || "";

  // Prefer segment whose words appear in the domain
  if (domainBase) {
    for (const seg of segments) {
      const segWords = seg.trim().split(/\s+/).map(w => w.toLowerCase().replace(/\.$/, ""));
      if (segWords.some(w => domainBase.includes(w) || (w.length >= 4 && w.includes(domainBase.slice(0, 4))))) {
        const cleaned = seg.trim()
          .split(/\s+/)
          .filter(w => !GENERIC.has(w.toLowerCase().replace(/\.$/, "")))
          .join(" ")
          .trim();
        if (cleaned) return cleaned;
      }
    }
  }

  // Fallback: shortest segment (descriptions tend to be longer)
  const cleaned = segments
    .map(s => ({
      cleaned: s.trim()
        .split(/\s+/)
        .filter(w => !GENERIC.has(w.toLowerCase().replace(/\.$/, "")))
        .join(" ")
        .trim(),
    }))
    .filter(s => s.cleaned.length > 0)
    .sort((a, b) => a.cleaned.length - b.cleaned.length);

  return cleaned[0]?.cleaned || "";
}

export function buildBrandAliases(domain: string, brandName: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => { if (s && s.trim().length > 1) out.add(s.trim()); };
  // Núcleo distintivo primero: es el ancla más fuerte para el matcher.
  const cleaned = extractCoreBrand(brandName, domain);
  add(cleaned);
  add(deUmlaut(cleaned));
  add(reUmlaut(cleaned));
  add(brandName);
  add(deUmlaut(brandName));
  add(reUmlaut(brandName));
  add(domain);
  const core = domain.split(".")[0];
  add(core);
  add(core.replace(/-/g, " "));
  add(deUmlaut(core));
  add(reUmlaut(core));
  return [...out];
}

// ─── Quick Check (2 prompts × 2 providers = 4 runs, analyzed by Haiku) ───

// selectCheckPrompts imported from ./config

export interface QuickRunResult {
  provider: string;
  prompt: string;
  responseText: string;
  brandMentioned: boolean | null;  // null = "sin dato" (analyzer failed)
  competitorsMentioned: string[];
  analysisError?: string;          // set when Haiku failed for this run
}

export async function runQuickCheck(
  brandName: string,
  brandDomain: string,
  vertical: string,
  region: string,
): Promise<{
  runs: QuickRunResult[];
  brandMentions: number | null;    // null = "sin dato"
  totalRuns: number;
  providersAttempted: number;
  providersSucceeded: number;
  topCompetitor: string;
  topCompetitorMentions: number;
  aliases: string[];
  analysisError?: string;          // propagated from batch analysis failure
}> {
  const aliases = buildBrandAliases(brandDomain, brandName);
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

  // Select 6 prompts from the vertical's prompt library
  const selected = selectCheckPrompts(vertical);
  for (const p of selected) {
    const prompt = buildPrompt(p.text, vertical, region);

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
  let analysisError: string | undefined;
  if (providerResponses.length > 0) {
    try {
      analyses = await analyzeResponseBatch(
        providerResponses.map((r) => ({ id: r.promptId, text: r.text })),
        extractCoreBrand(brandName) || brandName,
        brandDomain,
        aliases,
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Quick check batch analysis FAILED:", msg);
      analysisError = msg;
    }
  }

  // Phase 3: Build results from Haiku analysis (NOT regex)
  const runs: QuickRunResult[] = [];
  const allCompetitorCounts: Record<string, number> = {};
  const analysisFailed = analysisError !== undefined;

  for (const resp of providerResponses) {
    const analysis = analyses[resp.promptId];
    // null = analyzer failed → "sin dato"; false = analyzer ran, no mention
    const brandMentioned: boolean | null = analysisFailed
      ? null
      : analysis
        ? Boolean(analysis.brand_mentioned)
        : false;
    const competitors = analysisFailed
      ? []
      : analysis?.competitors_mentioned || [];

    for (const c of competitors) {
      allCompetitorCounts[c] = (allCompetitorCounts[c] || 0) + 1;
    }

    runs.push({
      provider: resp.provider,
      prompt: resp.prompt,
      responseText: resp.text,
      brandMentioned,
      competitorsMentioned: competitors,
      ...(analysisFailed ? { analysisError } : {}),
    });
  }

  // Calculate results
  const brandMentions = analysisFailed
    ? null
    : runs.filter((r) => r.brandMentioned === true).length;
  let topCompetitor = "";
  let topCompetitorMentions = 0;

  for (const [name, count] of Object.entries(allCompetitorCounts)) {
    if (count > topCompetitorMentions) {
      topCompetitorMentions = count;
      topCompetitor = name;
    }
  }

  const providerSuccessCounts: Record<string, number> = {};
  for (const resp of providerResponses) {
    providerSuccessCounts[resp.provider] = (providerSuccessCounts[resp.provider] || 0) + 1;
  }
  const providersAttempted = activeProviders.length;
  const providersSucceeded = Object.keys(providerSuccessCounts).length;

  return { runs, brandMentions, totalRuns: runs.length, providersAttempted, providersSucceeded, topCompetitor, topCompetitorMentions, aliases, analysisError };
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

// selectCheckPrompts imported from ./config

export interface FullCheckResult {
  brandName: string;
  brandMentions: number | null;    // null = "sin dato" (analyzer failed)
  totalRuns: number;
  topCompetitor: string;
  topCompetitorMentions: number;
  competitorDetails: { name: string; count: number }[];
  aliases: string[];
  analysisError?: string;
}

export async function runFullCheck(
  brandName: string,
  brandDomain: string,
  vertical: string,
  region: string,
  existingRuns?: QuickRunResult[],
): Promise<FullCheckResult> {
  const aliases = buildBrandAliases(brandDomain, brandName);
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
  // Use all 12 prompts from the vertical for full check
  const allPrompts = selectCheckPrompts(vertical, 12);
  const promptsToRun = allPrompts
    .map((p) => buildPrompt(p.text, vertical, region))
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
  let analysisError: string | undefined;
  if (providerResponses.length > 0) {
    try {
      analyses = await analyzeResponseBatch(
        providerResponses,
        extractCoreBrand(brandName) || brandName,
        brandDomain,
        aliases,
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Full check batch analysis FAILED:", msg);
      analysisError = msg;
    }
  }

  // Phase 3: Build results from Haiku analysis
  const analysisFailed = analysisError !== undefined;
  for (const resp of providerResponses) {
    const analysis = analyses[resp.id];
    // null = analyzer failed → "sin dato"; false = analyzer ran, no mention
    const brandMentioned: boolean | null = analysisFailed
      ? null
      : analysis
        ? Boolean(analysis.brand_mentioned)
        : false;
    const competitors = analysisFailed
      ? []
      : analysis?.competitors_mentioned || [];

    if (brandMentioned === true) totalBrandMentions++;
    totalRuns++;

    for (const c of competitors) {
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
    brandMentions: analysisFailed ? null : totalBrandMentions,
    totalRuns,
    topCompetitor,
    topCompetitorMentions,
    competitorDetails,
    aliases,
    ...(analysisError ? { analysisError } : {}),
  };
}
