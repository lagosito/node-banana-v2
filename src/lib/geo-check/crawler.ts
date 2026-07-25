// GEO Check — Deterministic Crawler (zero LLM cost)
// Crawls a website, extracts verified facts with evidence.
// No inference, no LLM calls, everything is verifiable.
//
// v2 fixes:
// - BUG 1: Sitemap resolved from robots.txt first, strict XML validation
// - BUG 2: Follow redirects (up to 5), resolvedUrl, crawlers.status
// - EXTRA 1: linkedom for HTML parsing (no regex on DOM)
// - EXTRA 2: requestMeta with Accept-Language
// v3 fixes:
// - BUG 4: Link-based legal page discovery (impressum, privacy, contact, etc.)
// v3.1 — Phase 1.3 parallelization:
// - CHANGE 1: Single parse per page (homeDoc reused, no duplicate parseHTML)
// - CHANGE 2: Parallel fetching phases (home+robots+llms simultaneously)
// - CHANGE 3: Separate timeouts per resource type
// - CHANGE 4: Sitemap truncation flag for large sitemaps
// - CHANGE 5: Children detail with status field
// - CHANGE 6: Instrumented timings for every request
// - CHANGE 7: Shared fetch agent with keep-alive
// - CHANGE 8: 3MB byte limit in fetchFollowRedirects

import { parseHTML } from "linkedom";

// ─── Types ───

export interface VerifiedFacts {
  resolvedUrl: string;
  redirected: boolean;
  requestMeta: {
    acceptLanguage: string;
  };
  meta: {
    title: string | null;
    description: string | null;
    canonical: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    twitterCard: string | null;
    htmlLang: string | null;
    hreflangs: string[];
    hasViewport: boolean;
    hasRobotsNoindex: boolean;
  };
  schema: {
    jsonLdBlocks: number;
    jsonLdValid: number;
    jsonLdInvalid: number;
    types: string[];
    microdataTypes: string[];
    hasOrganization: boolean;
    organizationComplete: {
      hasName: boolean;
      hasUrl: boolean;
      hasLogo: boolean;
      hasSameAs: boolean;
      complete: boolean;
    };
    hasFAQ: boolean;
    hasArticle: boolean;
    hasProduct: boolean;
    hasWebSite: boolean;
    hasBreadcrumb: boolean;
    hasLocalBusiness: boolean;
    errors: string[];
    evidence: string[];
  };
  crawlers: {
    allowed: number | null;
    total: number;
    blocked: string[];
    status: "ok" | "unknown";
    details: Record<string, { allowed: boolean | null; rule: string }>;
  };
  llmsTxt: {
    found: boolean;
    url: string | null;
    sizeBytes: number | null;
  };
  sitemap: {
    found: boolean;
    url: string | null;
    urlCount: number;
    inRobots: boolean;
    sitemapScore: number;
    source: "robots" | "guess" | null;
    status: "ok" | "pending" | "timeout";
    children: Array<{ url: string; status: number; urlCount: number; ok: boolean; error?: string }>;
    childrenTotal: number;
    childrenFetched: number;
    partial: boolean;
    truncated: boolean;
    limitApplied: number | null;
    robotsDeclared: string[];
    robotsDeclaredValid: boolean;
    robotsDeclaredError: string;
  };
  freshness: {
    hasDateModified: boolean;
    hasDatePublished: boolean;
    lastModifiedHeader: string | null;
    visibleDate: string | null;
    daysSinceUpdate: number | null;
    freshnessScore: number;
  };
  eeat: {
    hasAuthor: boolean;
    hasAboutPage: boolean;
    hasImpressum: boolean;
    hasPrivacy: boolean;
    hasContact: boolean;
    hasSocialLinks: number;
    hasSourceLinks: number;
    trustScore: number;
    impressumHasName: boolean | null;
    hasAddress: boolean | null;
    hasContactInfo: boolean | null;
    discovery: "link" | "guess" | "none";
    impressumUrl: string | null;
    privacyUrl: string | null;
    contactUrl: string | null;
  };
  content: {
    wordCount: number;
    h1Count: number;
    h2Count: number;
    h3Count: number;
    questionHeadings: string[];
    bulletPoints: number;
    hasFaqSection: boolean;
    imagesTotal: number;
    imagesMissingAlt: number;
  };
  perf: {
    ttfbMs: number;
    loadTimeMs: number;
    htmlSizeKb: number;
    psi: {
      lcp: number | null;
      cls: number | null;
      inp: number | null;
      performanceScore: number | null;
    } | null;
  };
  i18n: {
    htmlLang: string | null;
    hreflangCount: number;
    hreflangs: string[];
    i18nScore: number;
  };
  timings: {
    homeFetchMs: number;
    robotsFetchMs: number;
    sitemapFetchMs: number;
    sitemapChildrenFetchMs: number;
    llmsTxtFetchMs: number;
    legalPagesFetchMs: number;
    parseMs: number;
    totalMs: number;
    requests: Array<{ url: string; ms: number; status: number; bytes: number }>;
  };
  scannedUrls: string[];
  partialCrawl: boolean;
  collectedAt: string;
}

// ─── Constants ───

// CHANGE 3: Separate timeouts per resource type
const PAGE_TIMEOUT = 4000;
const CRAWL_TIME_BUDGET_MS = 12_000; // Time budget for entire crawl (Vercel safe)
const ROBOTS_TIMEOUT = 3000;
const SITEMAP_TIMEOUT = 6000;
const SITEMAP_CHILD_TIMEOUT = 6000;
const LLMS_TXT_TIMEOUT = 3000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 3 * 1024 * 1024; // CHANGE 8: 3MB byte limit

const ACCEPT_LANGUAGE = "de-DE,de;q=0.9,en;q=0.8";

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "Meta-ExternalAgent",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Timpibot",
  "YouBot",
] as const;

const PAGES_TO_CHECK = [
  "/",
  "/impressum",
  "/imprint",
  "/kontakt",
  "/contact",
  "/datenschutz",
  "/privacy",
  "/about",
  "/ueber-uns",
];

const SOCIAL_DOMAINS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "github.com",
];

const QUESTION_PREFIXES = [
  "was", "wie", "warum", "wann", "welche", "welcher", "welches", "welchem", "wer",
  "how", "why", "when", "which", "who", "what", "where", "does", "do", "can", "should", "is", "are",
];

// ─── Helpers ───

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'");
}

function resolveUrl(base: string, path: string): string {
  try { return new URL(path, base).href; } catch { return ""; }
}

function getBaseDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// CHANGE 7: Shared fetch headers for connection reuse
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; GEO-Check-Bot/2.0; +https://elkiosk.ai)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": ACCEPT_LANGUAGE,
} as const;

/**
 * Fetch with automatic redirect following (up to MAX_REDIRECTS).
 * CHANGE 8: Aborts if response body exceeds 3MB.
 * CHANGE 3: Accepts type-specific timeout.
 */
async function fetchFollowRedirects(
  url: string,
  timeoutMs = PAGE_TIMEOUT,
  maxRedirects = MAX_REDIRECTS,
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  headers: Headers;
  finalUrl: string;
  redirected: boolean;
  ttfbMs: number;
  totalTimeMs: number;
  sizeBytes: number;
  contentType: string;
} | null> {
  const start = performance.now();
  let currentUrl = url;
  let redirectCount = 0;

  for (let i = 0; i <= maxRedirects; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual", // We handle redirects ourselves
        headers: FETCH_HEADERS,
      });
      clearTimeout(timeout);

      // Follow 3xx redirects
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        currentUrl = resolveUrl(currentUrl, location);
        if (!currentUrl) break;
        redirectCount++;
        continue;
      }

      // Final response
      const ttfbMs = Math.round(performance.now() - start);

      // CHANGE 8: Stream body with byte limit (3MB)
      const reader = res.body?.getReader();
      const contentType = res.headers.get("content-type") || "";

      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.length;
            if (totalBytes > MAX_BYTES) {
              reader.cancel().catch(() => {});
              break;
            }
          }
        } catch {
          reader.cancel().catch(() => {});
        }
        const text = new TextDecoder().decode(Buffer.concat(chunks));
        const totalTimeMs = Math.round(performance.now() - start);
        const sizeBytes = totalBytes;

        return {
          ok: res.ok,
          status: res.status,
          text,
          headers: res.headers,
          finalUrl: currentUrl,
          redirected: currentUrl !== url,
          ttfbMs,
          totalTimeMs,
          sizeBytes,
          contentType,
        };
      } else {
        // Fallback: no body stream available
        const text = await res.text();
        const totalTimeMs = Math.round(performance.now() - start);
        const sizeBytes = new TextEncoder().encode(text).length;

        return {
          ok: res.ok,
          status: res.status,
          text,
          headers: res.headers,
          finalUrl: currentUrl,
          redirected: currentUrl !== url,
          ttfbMs,
          totalTimeMs,
          sizeBytes,
          contentType,
        };
      }
    } catch {
      return null;
    }
  }

  // Exhausted redirects
  const totalTimeMs = Math.round(performance.now() - start);
  return {
    ok: false,
    status: 0,
    text: "",
    headers: new Headers(),
    finalUrl: currentUrl,
    redirected: currentUrl !== url,
    ttfbMs: totalTimeMs,
    totalTimeMs,
    sizeBytes: 0,
    contentType: "",
  };
}

// ─── linkedom-based HTML extraction ───

function extractMeta(doc: Document, _html: string): VerifiedFacts["meta"] {
  const getMeta = (attr: string, value: string): string | null => {
    const el = doc.querySelector(`meta[${attr}="${value}"]`);
    return el?.getAttribute("content") || null;
  };

  const title = doc.querySelector("title")?.textContent?.trim() || null;
  const description = getMeta("name", "description");
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
  const ogTitle = getMeta("property", "og:title");
  const ogDescription = getMeta("property", "og:description");
  const ogImage = getMeta("property", "og:image");
  const twitterCard = getMeta("name", "twitter:card");
  const htmlLang = doc.documentElement?.getAttribute("lang") || null;
  const hasViewport = !!doc.querySelector('meta[name="viewport"]');
  const hasRobotsNoindex = /noindex/i.test(
    doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
  );

  const hreflangs: string[] = [];
  doc.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => {
    const h = el.getAttribute("hreflang");
    if (h) hreflangs.push(h);
  });

  return {
    title, description, canonical, ogTitle, ogDescription, ogImage,
    twitterCard, htmlLang, hreflangs, hasViewport, hasRobotsNoindex,
  };
}

function extractSchema(doc: Document): VerifiedFacts["schema"] {
  const jsonLdBlocks: string[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    const text = el.textContent?.trim();
    if (text) jsonLdBlocks.push(text);
  });

  let jsonLdValid = 0;
  let jsonLdInvalid = 0;
  const types: string[] = [];
  const errors: string[] = [];
  const evidence: string[] = [];
  let hasOrganization = false;
  let hasFAQ = false;
  let hasArticle = false;
  let hasProduct = false;
  let hasWebSite = false;
  let hasBreadcrumb = false;
  let hasLocalBusiness = false;
  const orgComplete = { hasName: false, hasUrl: false, hasLogo: false, hasSameAs: false, complete: false };

  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item?.["@type"]) {
          jsonLdInvalid++;
          errors.push("JSON-LD block without @type");
          continue;
        }
        jsonLdValid++;
        const typeName = Array.isArray(item["@type"]) ? item["@type"].join(",") : item["@type"];
        types.push(typeName);

        if (/Organization/i.test(typeName)) {
          hasOrganization = true;
          orgComplete.hasName = !!item.name;
          orgComplete.hasUrl = !!item.url;
          orgComplete.hasLogo = !!item.logo;
          orgComplete.hasSameAs = !!(item.sameAs && (
            Array.isArray(item.sameAs) ? item.sameAs.length > 0 : true
          ));
          orgComplete.complete = orgComplete.hasName && orgComplete.hasUrl && orgComplete.hasLogo && orgComplete.hasSameAs;
          evidence.push(`JSON-LD Organization: name=${orgComplete.hasName} url=${orgComplete.hasUrl} logo=${orgComplete.hasLogo} sameAs=${orgComplete.hasSameAs}`);
        }
        if (/FAQ/i.test(typeName)) hasFAQ = true;
        if (/Article/i.test(typeName)) hasArticle = true;
        if (/Product/i.test(typeName)) hasProduct = true;
        if (/WebSite/i.test(typeName)) hasWebSite = true;
        if (/BreadcrumbList/i.test(typeName)) hasBreadcrumb = true;
        if (/LocalBusiness/i.test(typeName)) hasLocalBusiness = true;
        evidence.push(`JSON-LD type: ${typeName}`);
      }
    } catch {
      jsonLdInvalid++;
      errors.push("JSON-LD block: invalid JSON");
    }
  }

  // Microdata
  const microdataTypes: string[] = [];
  doc.querySelectorAll("[itemscope]").forEach((el) => {
    const t = el.getAttribute("itemtype");
    if (t) {
      const short = t.split("/").pop() || t;
      if (!microdataTypes.includes(short)) microdataTypes.push(short);
    }
  });

  if (jsonLdBlocks.length === 0) evidence.push("No JSON-LD blocks found on page");

  return {
    jsonLdBlocks: jsonLdBlocks.length,
    jsonLdValid, jsonLdInvalid,
    types: [...new Set(types)],
    microdataTypes,
    hasOrganization, organizationComplete: orgComplete,
    hasFAQ, hasArticle, hasProduct, hasWebSite, hasBreadcrumb, hasLocalBusiness,
    errors, evidence,
  };
}

function extractContent(doc: Document): VerifiedFacts["content"] {
  // Word count from visible text
  const bodyText = doc.body?.textContent || "";
  const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;

  const h1Count = doc.querySelectorAll("h1").length;
  const h2Count = doc.querySelectorAll("h2").length;
  const h3Count = doc.querySelectorAll("h3").length;

  const questionHeadings: string[] = [];
  doc.querySelectorAll("h2, h3").forEach((el) => {
    const text = el.textContent?.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (
      text.endsWith("?") ||
      QUESTION_PREFIXES.some((p) => lower.startsWith(p + " ") || lower.startsWith(p + ","))
    ) {
      questionHeadings.push(text);
    }
  });

  const bulletPoints = doc.querySelectorAll("li").length;

  const hasFaqSection =
    /FAQ|Häufige Fragen|Häufig gestellte Fragen/i.test(doc.body?.innerHTML || "") ||
    doc.querySelector('[class*="faq"],[id*="faq"]') !== null;

  const allImages = doc.querySelectorAll("img");
  const imagesTotal = allImages.length;
  let imagesMissingAlt = 0;
  allImages.forEach((img) => {
    const alt = img.getAttribute("alt");
    if (alt === null || alt === undefined || alt.trim() === "") imagesMissingAlt++;
  });

  return {
    wordCount, h1Count, h2Count, h3Count,
    questionHeadings, bulletPoints, hasFaqSection,
    imagesTotal, imagesMissingAlt,
  };
}

function extractEEAT(
  doc: Document,
  eeatPages: { impressum: boolean; privacy: boolean; contact: boolean; about: boolean },
  baseDomain: string,
): VerifiedFacts["eeat"] {
  const hasAuthor =
    doc.querySelector('meta[name="author"]') !== null ||
    doc.querySelector('[class*="author"]') !== null;

  const socialLinks = doc.querySelectorAll("a[href]");
  let socialCount = 0;
  let sourceLinks = 0;
  socialLinks.forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (SOCIAL_DOMAINS.some((d) => href.toLowerCase().includes(d))) socialCount++;
    try {
      if (href.startsWith("http")) {
        const linkDomain = new URL(href).hostname.replace(/^www\./, "");
        if (linkDomain !== baseDomain && !SOCIAL_DOMAINS.some((d) => linkDomain.includes(d))) {
          sourceLinks++;
        }
      }
    } catch { /* skip invalid URLs */ }
  });

  let impressumHasName: boolean | null = null;
  let hasAddress: boolean | null = null;
  let hasContactInfo: boolean | null = null;
  if (eeatPages.impressum) {
    const html = doc.body?.innerHTML || "";
    impressumHasName = /GmbH|AG|UG|e\.K\.|OHG/i.test(html);
    hasAddress = /<address/i.test(html) || /straße|str\.|weg\s|platz|d-\d{5}/i.test(html);
    hasContactInfo = doc.querySelector('a[href^="mailto:"]') !== null || /\+49[\s-]?\d/i.test(html);
  }

  let trustScore = 0;
  if (hasAuthor) trustScore += 20;
  if (eeatPages.about) trustScore += 20;
  if (eeatPages.impressum) trustScore += 20;
  if (eeatPages.privacy) trustScore += 10;
  if (eeatPages.contact) trustScore += 10;
  if (socialCount > 0) trustScore += 10;
  if (sourceLinks > 0) trustScore += 10;

  return {
    hasAuthor, hasAboutPage: eeatPages.about,
    hasImpressum: eeatPages.impressum, hasPrivacy: eeatPages.privacy,
    hasContact: eeatPages.contact, hasSocialLinks: socialCount,
    hasSourceLinks: sourceLinks, trustScore,
    impressumHasName, hasAddress, hasContactInfo,
    // placeholders — overwritten by caller in Step 3/7
    discovery: "none",
    impressumUrl: null,
    privacyUrl: null,
    contactUrl: null,
  };
}

function extractFreshness(
  doc: Document,
  lastModifiedHeader: string | null,
): VerifiedFacts["freshness"] {
  const html = doc.body?.innerHTML || "";
  const hasDateModified = /dateModified/i.test(html) ||
    doc.querySelector('meta[name="dcterms.modified"]') !== null;
  const hasDatePublished = /datePublished/i.test(html) ||
    doc.querySelector('meta[name="dcterms.created"]') !== null;

  let visibleDate: string | null = null;
  const timeEl = doc.querySelector("time[datetime]");
  if (timeEl) visibleDate = timeEl.getAttribute("datetime");

  let daysSinceUpdate: number | null = null;
  const dateSource = visibleDate || lastModifiedHeader;
  if (dateSource) {
    try {
      const d = new Date(dateSource);
      daysSinceUpdate = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    } catch { /* invalid date */ }
  }

  let freshnessScore = 0;
  if (daysSinceUpdate !== null) {
    if (daysSinceUpdate < 30) freshnessScore = 100;
    else if (daysSinceUpdate < 90) freshnessScore = 80;
    else if (daysSinceUpdate < 180) freshnessScore = 60;
    else if (daysSinceUpdate < 365) freshnessScore = 40;
    else freshnessScore = 20;
  }
  if (hasDateModified) freshnessScore = Math.min(100, freshnessScore + 10);
  if (hasDatePublished) freshnessScore = Math.min(100, freshnessScore + 5);

  return {
    hasDateModified, hasDatePublished, lastModifiedHeader,
    visibleDate, daysSinceUpdate, freshnessScore,
  };
}

// ─── Robots.txt Parser (exported for unit tests) ───

export interface RobotsRule {
  agents: string[];
  allows: string[];
  disallows: string[];
}

export interface RobotsTxtResult {
  rules: RobotsRule[];
  sitemapUrls: string[];
}

export function parseRobotsTxt(content: string): RobotsTxtResult {
  const rules: RobotsRule[] = [];
  const sitemapUrls: string[] = [];
  let currentRule: RobotsRule | null = null;

  // RFC 9309: Normalize line endings (CRLF → LF), strip BOM
  const normalized = content
    .replace(/^\uFEFF/, "")  // strip BOM
    .replace(/\r\n/g, "\n")  // CRLF → LF
    .replace(/\r/g, "\n");   // lone CR → LF

  for (const line of normalized.split("\n")) {
    // Strip inline comments (RFC 9309: # or %)
    const trimmed = line.replace(/[#%].*$/, "").trim();
    if (!trimmed) {
      // Empty line = group separator, but only if current rule has records
      if (currentRule && (currentRule.allows.length > 0 || currentRule.disallows.length > 0)) {
        rules.push(currentRule);
        currentRule = null;
      }
      // If currentRule has no records, comment/empty line is invisible — don't break the group
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      if (currentRule && currentRule.agents.length > 0 && (currentRule.allows.length > 0 || currentRule.disallows.length > 0)) {
        // Only push previous rule if it has records (Allow/Disallows)
        rules.push(currentRule);
      }
      if (currentRule && currentRule.agents.length > 0 && currentRule.allows.length === 0 && currentRule.disallows.length === 0) {
        // Same group: add agent to existing rule (no records yet)
        currentRule.agents.push(value.toLowerCase());
      } else {
        currentRule = { agents: [value.toLowerCase()], allows: [], disallows: [] };
      }
    } else if (key === "allow" && currentRule) {
      // RFC 9309: empty Allow value = no effect, ignore
      if (value) currentRule.allows.push(value);
    } else if (key === "disallow" && currentRule) {
      // RFC 9309: empty Disallow value = allow all (no restriction)
      // Only push non-empty disallow values
      if (value) currentRule.disallows.push(value);
    } else if (key === "sitemap") {
      if (value) sitemapUrls.push(value);
    }
  }
  if (currentRule && currentRule.agents.length > 0) {
    rules.push(currentRule);
  }
  return { rules, sitemapUrls };
}

/**
 * RFC 9309 compliant path matching with wildcards.
 * * matches any sequence of characters
 * $ marks end of string
 */
function matchPath(pattern: string, path: string): boolean {
  // Handle $ end-of-string anchor
  const anchored = pattern.endsWith("$");
  const pat = anchored ? pattern.slice(0, -1) : pattern;

  // Convert robots.txt wildcard to regex
  const regexStr = "^" + pat.replace(/\*/g, ".*").replace(/\?/g, ".") + (anchored ? "$" : "");
  try {
    return new RegExp(regexStr, "i").test(path);
  } catch {
    return path.startsWith(pat);
  }
}

export function isCrawlerAllowed(
  rules: RobotsRule[],
  crawler: string,
): { allowed: boolean; rule: string } {
  const crawlerLower = crawler.toLowerCase();

  // RFC 9309: specific User-agent group REPLACES wildcard group (not merges)
  const specificRules = rules.filter((r) =>
    r.agents.some((a) => a === crawlerLower),
  );
  const wildcardRules = rules.filter((r) =>
    r.agents.some((a) => a === "*"),
  );

  // Specific rules take precedence over wildcard (RFC 9309 Section 2.1)
  const applicableRules = specificRules.length > 0 ? specificRules : wildcardRules;
  if (applicableRules.length === 0) {
    return { allowed: true, rule: "no matching rule, default: allow" };
  }

  // Collect all Allow and Disallow records from applicable rules
  const records: { type: "allow" | "disallow"; path: string }[] = [];
  for (const rule of applicableRules) {
    for (const disallow of rule.disallows) {
      records.push({ type: "disallow", path: disallow });
    }
    for (const allow of rule.allows) {
      records.push({ type: "allow", path: allow });
    }
  }

  if (records.length === 0) {
    // Group exists but has no Allow/Disallows → allow all
    return { allowed: true, rule: "group exists but no restrictions, default: allow" };
  }

  // RFC 9309: longest matching path wins for Allow/Disallow conflicts
  // Evaluate against a test path "/" (the root)
  let bestMatch: { type: "allow" | "disallow"; path: string } | null = null;
  let bestLen = -1;

  for (const rec of records) {
    if (matchPath(rec.path, "/")) {
      if (rec.path.length > bestLen) {
        bestMatch = rec;
        bestLen = rec.path.length;
      }
    }
  }

  if (bestMatch) {
    if (bestMatch.type === "disallow") {
      return { allowed: false, rule: `Disallow: ${bestMatch.path} (matches /)` };
    } else {
      return { allowed: true, rule: `Allow: ${bestMatch.path} (overrides, matches /)` };
    }
  }

  // No rule matches "/" → allow
  return { allowed: true, rule: "no rule matches root path, default: allow" };
}
// ─── Sitemap helpers ───

/** Validate that fetched content is actual XML sitemap. */
function isValidSitemapXml(text: string, contentType: string): boolean {
  // Check content-type (allow xml, gzip, or empty let body decide)
  if (contentType && !/xml|gzip|text\/plain/i.test(contentType)) {
    return false;
  }
  // Must contain <urlset> or <sitemapindex>
  const hasUrlset = /<urlset[\s>]/i.test(text);
  const hasSitemapindex = /<sitemapindex[\s>]/i.test(text);
  return hasUrlset || hasSitemapindex;
}

function countSitemapUrls(text: string): number {
  return (text.match(/<loc>/gi) || []).length;
}

function extractSitemapChildUrls(text: string): string[] {
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    urls.push(decodeHtmlEntities(m[1].trim()));
  }
  return urls;
}

// ─── Legal link classification (BUG 4) ───

interface LegalLinkResult {
  impressum: string | null;
  privacy: string | null;
  contact: string | null;
  about: string | null;
  agb: string | null;
}

/**
 * Classifies internal links on the page into legal page categories.
 * Checks both anchor text and href path, case-insensitively.
 * Accepts ü/ue interchangeably and common extensions (.html, .php, .aspx, .htm).
 * Includes #fragments in the result URL.
 *
 * Excludes article/content paths to avoid false positives (BUG: heise.de).
 * Content validation gates classification — a link is only accepted if
 * the target page contains real legal signals.
 */
function classifyLegalLinks(doc: Document, baseUrl: string): LegalLinkResult {
  const result: LegalLinkResult = {
    impressum: null,
    privacy: null,
    contact: null,
    about: null,
    agb: null,
  };

  // Paths to exclude (article/content sections that mention legal terms)
  const EXCLUDE_PATHS = /\/(news|artikel|blog|presse|magazin|thema|forum|en\/|archive|category|tag|search|login|register|account|shop|cart|checkout|ratgeber|specials|test|kaufberatung|longread|analyse|meinung|kommentar|kolumne|ranking)\//i;
  // URLs ending in long numeric IDs (article pages)
  const NUMERIC_ID = /\/\d{5,}$/;

  const allAnchors = doc.querySelectorAll("a[href]");
  for (let i = 0; i < allAnchors.length; i++) {
    const a = allAnchors[i];
    const href = a.getAttribute("href") || "";
    const fullUrl = resolveUrl(baseUrl, href);
    if (!fullUrl || !fullUrl.startsWith(baseUrl)) continue;

    const path = new URL(fullUrl).pathname.toLowerCase();

    // Skip excluded paths and numeric IDs
    if (EXCLUDE_PATHS.test(path)) continue;
    if (NUMERIC_ID.test(path)) continue;

    const anchorText = (a.textContent || "").toLowerCase();
    const combined = `${path} ${anchorText}`;

    // Normalize ü/ue for matching
    const normalized = combined.replace(/ü/g, "ue").replace(/ö/g, "oe").replace(/ä/g, "ae");

    // Also strip common extensions for matching
    const stripped = normalized.replace(/\.(html|php|aspx|htm)$/i, "");

    // impressum — prefer short paths
    if (!result.impressum) {
      if (/impressum|imprint|anbieterkennzeichnung|rechtliches|legal/i.test(stripped)) {
        result.impressum = fullUrl;
      }
    }

    // privacy
    if (!result.privacy) {
      if (/datenschutz|privacy|privacy-policy/i.test(stripped)) {
        result.privacy = fullUrl;
      }
    }

    // contact
    if (!result.contact) {
      if (/kontakt|contact|anschrift|standort/i.test(stripped)) {
        result.contact = fullUrl;
      }
    }

    // about
    if (!result.about) {
      if (/ueber-uns|about|unternehmen|wir-ueber-uns|wer-wir-sind/i.test(stripped)) {
        result.about = fullUrl;
      }
    }

    // agb
    if (!result.agb) {
      if (/agb|terms|nutzungsbedingungen/i.test(stripped)) {
        result.agb = fullUrl;
      }
    }
  }

  return result;
}

/**
 * Checks if fetched HTML contains real impressum signals.
 * Returns true if ANY of the known German legal terms are found.
 */
function validateImpressumContent(html: string): boolean {
  // Company types
  if (/GmbH|AG|UG|e\.K\.|OHG|KG/i.test(html)) return true;

  // Legal phrases
  if (/Vertreten durch|Registergericht|USt-IdNr|Geschäftsführer|Handelsregister/i.test(html)) return true;

  // Additional German legal signals
  if (/Amtsgericht|HRA|HRB|Sitz der Gesellschaft|Verantwortlich nach|Postfach/i.test(html)) return true;

  // German address indicators
  if (/Straße|straße|PLZ|\b\d{5}\b/.test(html)) return true;

  return false;
}

/**
 * CHANGE 5: Process sitemap child results with status field.
 */
function processSitemapChild(
  childResult: Awaited<ReturnType<typeof fetchFollowRedirects>>,
  childUrl: string,
  partial: boolean,
): { child: VerifiedFacts["sitemap"]["children"][number]; isPartial: boolean } {
  if (childResult?.ok && childResult.status === 200 && isValidSitemapXml(childResult.text, childResult.contentType)) {
    const childUrlCount = countSitemapUrls(childResult.text);
    return {
      child: { url: childUrl, status: childResult.status, urlCount: childUrlCount, ok: true },
      isPartial: false,
    };
  } else {
    const errorMsg = childResult ? `HTTP ${childResult.status}` : "fetch failed";
    return {
      child: { url: childUrl, status: childResult?.status ?? 0, urlCount: 0, ok: false, error: errorMsg },
      isPartial: true,
    };
  }
}

// ─── Main Crawler ───

export async function collectFacts(url: string): Promise<VerifiedFacts> {
  const totalStart = performance.now();

  // Normalize URL
  let baseUrl: string;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    baseUrl = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const scannedUrls: string[] = [];
  const requestTimings: Array<{ url: string; ms: number; status: number; bytes: number }> = [];

  // ═══════════════════════════════════════════════════════════
  // PHASE 0 (t=0): Fire SIMULTANEOUSLY
  //   - GET home (follow redirects)
  //   - GET /robots.txt
  //   - GET /llms.txt
  //   - PageSpeed Insights if GOOGLE_PSI_API_KEY exists
  // ═══════════════════════════════════════════════════════════

  const homeUrl = `${baseUrl}/`;
  const robotsUrl = resolveUrl(baseUrl, "/robots.txt");
  const llmsUrl = resolveUrl(baseUrl, "/llms.txt");
  const psiKey = process.env.GOOGLE_PSI_API_KEY;

  const [homeSettled, robotsSettled, llmsSettled, psiSettled, ...sitemapGuessSettled] = await Promise.allSettled([
    fetchFollowRedirects(homeUrl, PAGE_TIMEOUT),
    fetchFollowRedirects(robotsUrl, ROBOTS_TIMEOUT),
    fetchFollowRedirects(llmsUrl, LLMS_TXT_TIMEOUT),
    psiKey
      ? fetch(
          `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(baseUrl)}&strategy=mobile&key=${psiKey}`,
        ).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null),
    // Sitemap guess URLs fetched in parallel from the start (3s timeout to not block return)
    fetchFollowRedirects(resolveUrl(baseUrl, "/sitemap.xml"), 3000),
    fetchFollowRedirects(resolveUrl(baseUrl, "/sitemap_index.xml"), 3000),
    fetchFollowRedirects(resolveUrl(baseUrl, "/sitemap-index.xml"), 3000),
  ]);

  const homeResult = homeSettled.status === "fulfilled" ? homeSettled.value : null;
  const robotsResult = robotsSettled.status === "fulfilled" ? robotsSettled.value : null;
  const llmsResult = llmsSettled.status === "fulfilled" ? llmsSettled.value : null;
  const psiData = psiSettled.status === "fulfilled" ? psiSettled.value : null;

  if (!homeResult?.ok) {
    throw new Error(`Homepage not reachable: ${homeUrl}`);
  }

  // Record Phase 0 timings
  if (homeResult) requestTimings.push({ url: homeUrl, ms: homeResult.totalTimeMs, status: homeResult.status, bytes: homeResult.sizeBytes });
  if (robotsResult) requestTimings.push({ url: robotsUrl, ms: robotsResult.totalTimeMs, status: robotsResult.status, bytes: robotsResult.sizeBytes });
  if (llmsResult) requestTimings.push({ url: llmsUrl, ms: llmsResult.totalTimeMs, status: llmsResult.status, bytes: llmsResult.sizeBytes });

  // Process sitemap guess results from Phase 0 (fetched in parallel from start)
  const sitemapGuessUrls = [
    resolveUrl(baseUrl, "/sitemap.xml"),
    resolveUrl(baseUrl, "/sitemap_index.xml"),
    resolveUrl(baseUrl, "/sitemap-index.xml"),
  ];
  let sitemapFromGuess: { found: boolean; url: string | null; text: string; contentType: string; finalUrl: string } | null = null;
  for (let i = 0; i < sitemapGuessSettled.length; i++) {
    const sr = sitemapGuessSettled[i];
    if (sr.status !== "fulfilled" || !sr.value?.ok) continue;
    const { value: smResult } = sr;
    if (smResult.status === 200 && isValidSitemapXml(smResult.text, smResult.contentType)) {
      sitemapFromGuess = { found: true, url: sitemapGuessUrls[i], text: smResult.text, contentType: smResult.contentType, finalUrl: smResult.finalUrl };
      requestTimings.push({ url: sitemapGuessUrls[i], ms: smResult.totalTimeMs, status: smResult.status, bytes: smResult.sizeBytes });
      break;
    }
  }

  scannedUrls.push(homeResult.finalUrl);

  // The resolved base URL after redirects
  const resolvedBase = homeResult.redirected
    ? new URL(homeResult.finalUrl).origin
    : baseUrl;

  // ═══════════════════════════════════════════════════════════
  // PHASE 1 (t≈0.3s): robots.txt responds.
  //   Parse immediately → if it declares Sitemap URLs, fetch
  //   those IMMEDIATELY (don't wait for home parsing).
  // ═══════════════════════════════════════════════════════════

  let robotsParsed: RobotsTxtResult | null = null;
  let robotsStatus: "ok" | "unknown" = "unknown";

  if (robotsResult?.ok && robotsResult.status === 200) {
    robotsParsed = parseRobotsTxt(robotsResult.text);
    robotsStatus = "ok";
  } else if (robotsResult?.status === 404 || robotsResult?.status === 410) {
    // 404 = no robots.txt = everything allowed
    robotsParsed = { rules: [], sitemapUrls: [] };
    robotsStatus = "ok";
  }
  // else: network error or other status → robotsParsed stays null, status stays "unknown"

  // Evaluate crawlers
  const crawlerDetails: Record<string, { allowed: boolean | null; rule: string }> = {};
  const blocked: string[] = [];
  let allowedCount: number | null = null;

  if (robotsParsed) {
    allowedCount = 0;
    for (const crawler of AI_CRAWLERS) {
      const result = isCrawlerAllowed(robotsParsed.rules, crawler);
      crawlerDetails[crawler] = result;
      if (result.allowed) {
        allowedCount++;
      } else {
        blocked.push(crawler);
      }
    }
  }

  // Fire sitemap fetches from robots.txt IMMEDIATELY (don't wait for home)
  const robotsDeclaredUrls = robotsParsed?.sitemapUrls || [];
  let robotsDeclaredValid = true;
  let robotsDeclaredError = "";

  const sitemapFetchPromise = robotsDeclaredUrls.length > 0
    ? Promise.allSettled(
        robotsDeclaredUrls.map((smUrl) =>
          fetchFollowRedirects(smUrl, SITEMAP_TIMEOUT).then((result) => ({ url: smUrl, result })),
        ),
      )
    : Promise.resolve([] as PromiseSettledResult<{ url: string; result: ReturnType<typeof fetchFollowRedirects> extends Promise<infer R> ? R : never }>[]);

  // ═══════════════════════════════════════════════════════════
  // PHASE 2 (t≈0.5-1s): home downloaded and parsed ONCE.
  //   From this single DOM extract: brand, vertical, meta,
  //   schema, content, internal links (legal pages).
  //   CHANGE 1: Single parse per page — no duplicate parseHTML.
  // ═══════════════════════════════════════════════════════════

  const parseStart = performance.now();
  const homeDoc = parseHTML(homeResult.text).document;
  const parseMs = Math.round(performance.now() - parseStart);

  // Extract everything from the single home DOM — no re-parsing
  const meta = extractMeta(homeDoc, homeResult.text);
  const homeSchema = extractSchema(homeDoc);
  const combinedContent = extractContent(homeDoc);

  // Classify legal links from home page (reuses homeDoc — CHANGE 1)
  const legalLinks = classifyLegalLinks(homeDoc, resolvedBase);

  // Discover subpages from home links (reuses homeDoc — CHANGE 1)
  const subpageUrls: string[] = [];
  homeDoc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || subpageUrls.length >= 3) return;
    const full = resolveUrl(resolvedBase, href);
    if (!full.startsWith(resolvedBase)) return;
    const path = new URL(full).pathname;
    if (path === "/") return;
    if (/(wp-admin|wp-content|api\/|assets\/|images\/|js\/|css\/)/i.test(path)) return;
    // Skip legal pages we already discovered
    if (
      full === legalLinks.impressum ||
      full === legalLinks.privacy ||
      full === legalLinks.contact ||
      full === legalLinks.about
    ) return;
    if (!subpageUrls.includes(full)) subpageUrls.push(full);
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 3 (t≈1-1.5s): sitemap done → ONE batch of ALL
  //   remaining URLs in parallel:
  //   - Legal pages discovered by links
  //   - Subpages from home links (up to 3)
  //   - Sitemapindex children (up to 3)
  //   - Guessed fallback routes (if link discovery found nothing)
  //   All fetched with Promise.allSettled.
  // ═══════════════════════════════════════════════════════════

  // Wait for sitemap results from Phase 1
  const sitemapFetchResults = await sitemapFetchPromise;

  // Process sitemap results — find first valid sitemap
  let sitemapFound = false;
  let sitemapUrl: string | null = null;
  let sitemapUrlCount = 0;
  let sitemapSource: "robots" | "guess" | null = null;
  let sitemapChildren: VerifiedFacts["sitemap"]["children"] = [];
  let sitemapPartial = false;

  // Validate each declared sitemap URL from robots.txt
  for (const sr of sitemapFetchResults) {
    if (sr.status !== "fulfilled") continue;
    const { url: smUrl, result: smResult } = sr.value;
    if (!smResult?.ok) {
      robotsDeclaredValid = false;
      robotsDeclaredError = robotsDeclaredError || `${smUrl}: HTTP ${smResult?.status || "error"}`;
    } else if (!isValidSitemapXml(smResult.text, smResult.contentType)) {
      robotsDeclaredValid = false;
      robotsDeclaredError = robotsDeclaredError || `${smUrl}: not valid sitemap XML`;
    }
  }

  // Find first valid sitemap from robots-declared URLs
  const sitemapChildUrls: string[] = [];
  for (const sr of sitemapFetchResults) {
    if (sr.status !== "fulfilled") continue;
    const { url: smUrl, result: smResult } = sr.value;
    if (smResult?.ok && smResult.status === 200 && isValidSitemapXml(smResult.text, smResult.contentType)) {
      sitemapFound = true;
      sitemapUrl = smResult.finalUrl;
      sitemapSource = "robots";

      if (/<sitemapindex[\s>]/i.test(smResult.text)) {
        // Sitemapindex: collect child URLs for batch fetch
        sitemapChildUrls.push(...extractSitemapChildUrls(smResult.text).slice(0, 3));
      } else {
        sitemapUrlCount = countSitemapUrls(smResult.text);
      }
      break;
    }
  }

  // If robots.txt didn't yield a sitemap, use Phase 0 guess results
  if (!sitemapFound && sitemapFromGuess?.found) {
    sitemapFound = true;
    sitemapUrl = sitemapFromGuess.finalUrl;
    sitemapSource = "guess";

    if (/<sitemapindex[\s>]/i.test(sitemapFromGuess.text)) {
      sitemapChildUrls.push(...extractSitemapChildUrls(sitemapFromGuess.text).slice(0, 3));
    } else {
      sitemapUrlCount = countSitemapUrls(sitemapFromGuess.text);
    }
  }

  // Collect ALL remaining URLs to fetch in ONE batch
  type FetchTarget = { category: string; url: string; timeoutMs: number };
  const remainingFetches: FetchTarget[] = [];

  // Legal pages discovered by links
  if (legalLinks.impressum) remainingFetches.push({ category: "impressum", url: legalLinks.impressum, timeoutMs: PAGE_TIMEOUT });
  if (legalLinks.privacy) remainingFetches.push({ category: "privacy", url: legalLinks.privacy, timeoutMs: PAGE_TIMEOUT });
  if (legalLinks.contact) remainingFetches.push({ category: "contact", url: legalLinks.contact, timeoutMs: PAGE_TIMEOUT });
  if (legalLinks.about) remainingFetches.push({ category: "about", url: legalLinks.about, timeoutMs: PAGE_TIMEOUT });

  // Subpages from home links (up to 3)
  for (const sp of subpageUrls.slice(0, 3)) {
    remainingFetches.push({ category: "subpage", url: sp, timeoutMs: PAGE_TIMEOUT });
  }

  // Sitemapindex children (up to 3)
  for (const childUrl of sitemapChildUrls.slice(0, 3)) {
    remainingFetches.push({ category: "sitemap-child", url: childUrl, timeoutMs: SITEMAP_CHILD_TIMEOUT });
  }

  // Sitemap fallback: if robots.txt didn't yield a valid sitemap, try guessed paths
  if (!sitemapFound) {
    for (const smPath of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
      const smUrl = resolveUrl(resolvedBase, smPath);
      if (smUrl) remainingFetches.push({ category: "sitemap-guess", url: smUrl, timeoutMs: SITEMAP_TIMEOUT });
    }
  }

  // Guessed fallback routes (if link discovery found nothing)
  const discoveredLegal = {
    impressum: null as string | null,
    impressumValid: false,
    privacy: null as string | null,
    contact: null as string | null,
    about: null as string | null,
  };

  if (!legalLinks.impressum && !legalLinks.privacy && !legalLinks.contact) {
    const guessRoutes: Array<{ category: string; paths: string[] }> = [
      { category: "impressum", paths: ["/impressum", "/imprint", "/impressum.html"] },
      { category: "privacy", paths: ["/datenschutz", "/privacy", "/datenschutz.html"] },
      { category: "contact", paths: ["/kontakt", "/contact", "/kontakt.html"] },
    ];
    for (const { category, paths } of guessRoutes) {
      const p = paths[0]; // try first path only
      const guessUrl = resolveUrl(resolvedBase, p);
      if (guessUrl) remainingFetches.push({ category: `guess-${category}`, url: guessUrl, timeoutMs: PAGE_TIMEOUT });
    }
  }

  // Time-budget gate: only truncate CONTENT pages, never infrastructure (sitemap)
  // Split: infrastructure always fires, content subject to budget
  const infrastructureFetches = remainingFetches.filter(
    (f) => f.category === "sitemap-child" || f.category === "sitemap-guess",
  );
  const contentFetches = remainingFetches.filter(
    (f) => f.category !== "sitemap-child" && f.category !== "sitemap-guess",
  );

  const elapsedMs = performance.now() - totalStart;
  const remainingBudgetMs = Math.max(0, CRAWL_TIME_BUDGET_MS - elapsedMs);
  const maxContentFromBudget = Math.max(0, Math.floor(remainingBudgetMs / PAGE_TIMEOUT));
  const droppedPages = contentFetches.length - maxContentFromBudget;
  const partialCrawl = droppedPages > 0;
  if (droppedPages > 0) {
    contentFetches.length = maxContentFromBudget;
  }

  // Reassemble: content (truncated) + infrastructure (always included)
  remainingFetches.length = 0;
  remainingFetches.push(...contentFetches, ...infrastructureFetches);

  // Fire ALL remaining URLs in ONE parallel batch
  const legalFetchStart = performance.now();
  const remainingResults = await Promise.allSettled(
    remainingFetches.map(({ url: fetchUrl, timeoutMs }) =>
      fetchFollowRedirects(fetchUrl, timeoutMs).then((result) => ({ url: fetchUrl, result })),
    ),
  );
  const legalPagesFetchMs = Math.round(performance.now() - legalFetchStart);

  // Process remaining results
  let foundViaLink = false;
  for (let i = 0; i < remainingResults.length; i++) {
    const pr = remainingResults[i];
    const target = remainingFetches[i];

    if (pr.status !== "fulfilled" || !pr.value.result?.ok) continue;
    const { result } = pr.value;
    scannedUrls.push(result!.finalUrl);
    requestTimings.push({ url: target.url, ms: result!.totalTimeMs, status: result!.status, bytes: result!.sizeBytes });

    // Track legal page results
    if (target.category === "impressum") {
      discoveredLegal.impressum = result!.finalUrl;
      discoveredLegal.impressumValid = validateImpressumContent(result!.text);
      foundViaLink = true;
    } else if (target.category === "privacy") {
      discoveredLegal.privacy = result!.finalUrl;
      foundViaLink = true;
    } else if (target.category === "contact") {
      discoveredLegal.contact = result!.finalUrl;
      foundViaLink = true;
    } else if (target.category === "about") {
      discoveredLegal.about = result!.finalUrl;
      foundViaLink = true;
    } else if (target.category.startsWith("guess-")) {
      // Handle guessed fallback results
      const cat = target.category.replace("guess-", "");
      if (cat === "impressum" && !discoveredLegal.impressum) {
        discoveredLegal.impressum = result!.finalUrl;
        discoveredLegal.impressumValid = validateImpressumContent(result!.text);
      } else if (cat === "privacy" && !discoveredLegal.privacy) {
        discoveredLegal.privacy = result!.finalUrl;
      } else if (cat === "contact" && !discoveredLegal.contact) {
        discoveredLegal.contact = result!.finalUrl;
      }
      foundViaLink = false; // guessed, not via link
    }
  }

  // Determine discovery mode
  let discoveryMode: "link" | "guess" | "none" = "none";
  if (foundViaLink) {
    discoveryMode = "link";
  } else if (discoveredLegal.impressum || discoveredLegal.privacy || discoveredLegal.contact) {
    discoveryMode = "guess";
  }

  // ─── Sitemap children processing ───
  // CHANGE 5: Children always have status field
  let totalSitemapChildUrls = 0;
  for (const childUrl of sitemapChildUrls.slice(0, 3)) {
    const childTarget = remainingFetches.find((f) => f.url === childUrl && f.category === "sitemap-child");
    const childResult = remainingResults[remainingFetches.indexOf(childTarget!)];
    const childUrlObj = childTarget?.url || childUrl;

    if (childResult?.status === "fulfilled") {
      const { child, isPartial } = processSitemapChild(childResult.value.result, childUrlObj, false);
      sitemapChildren.push(child);
      if (isPartial) sitemapPartial = true;
      if (child.ok) totalSitemapChildUrls += child.urlCount;
    } else {
      sitemapChildren.push({
        url: childUrl,
        status: 0,
        urlCount: 0,
        ok: false,
        error: "fetch failed",
      });
      sitemapPartial = true;
    }
  }

  // If sitemap found and had children, use accumulated count
  if (sitemapFound && sitemapChildren.length > 0 && sitemapUrlCount === 0) {
    sitemapUrlCount = totalSitemapChildUrls;
  }

  // Process sitemap-guess results (fallback from guessed paths)
  // Children are fetched fire-and-forget, status = "pending"
  let sitemapChildrenFromGuess: Array<{ url: string; status: number; urlCount: number; ok: boolean; error?: string }> = [];
  let sitemapChildrenTotalFromGuess = 0;
  if (!sitemapFound) {
    for (let i = 0; i < remainingFetches.length; i++) {
      if (remainingFetches[i].category !== "sitemap-guess") continue;
      const result = remainingResults[i];
      if (result?.status !== "fulfilled") continue;
      const { result: smResult } = result.value;
      if (smResult?.ok && smResult.status === 200 && isValidSitemapXml(smResult.text, smResult.contentType)) {
        sitemapFound = true;
        sitemapUrl = smResult.finalUrl;
        sitemapSource = "guess";

        if (/<sitemapindex[\s>]/i.test(smResult.text)) {
          const childUrls = extractSitemapChildUrls(smResult.text).slice(0, 3);
          sitemapChildrenTotalFromGuess = childUrls.length;
          // Await children — fire-and-forget loses results in serverless
          const childResults = await Promise.allSettled(
            childUrls.map((childUrl) =>
              fetchFollowRedirects(childUrl, SITEMAP_CHILD_TIMEOUT).then((r) => ({ childUrl, result: r })),
            ),
          );
          for (const cr of childResults) {
            if (cr.status === "fulfilled" && cr.value.result?.ok) {
              const { child, isPartial } = processSitemapChild(cr.value.result, cr.value.childUrl, false);
              sitemapChildrenFromGuess.push(child);
              if (child.ok) sitemapUrlCount += child.urlCount;
              if (isPartial) sitemapPartial = true;
            }
          }
        } else {
          sitemapUrlCount = countSitemapUrls(smResult.text);
        }
        break;
      }
    }
  }

  // CHANGE 4: Sitemap truncation flag
  const sitemapTruncated = sitemapUrlCount > 10000;
  const sitemapLimitApplied = sitemapTruncated ? 10000 : null;

  const sitemapScore = sitemapFound ? (sitemapUrlCount > 0 ? 100 : 50) : 0;

  // ─── Merge schemas from all visited pages ───
  // CHANGE 1: Parse each visited page ONCE, extract both schema AND content
  for (const target of remainingFetches) {
    const pr = remainingResults[remainingFetches.indexOf(target)];
    if (pr?.status !== "fulfilled" || !pr.value.result?.ok) continue;
    const html = pr.value.result.text;

    // Parse ONCE per page (CHANGE 1)
    const doc = parseHTML(html).document;

    // Extract schema from same document
    const extra = extractSchema(doc);
    for (const t of extra.types) {
      if (!homeSchema.types.includes(t)) homeSchema.types.push(t);
    }
    homeSchema.jsonLdBlocks += extra.jsonLdBlocks;
    homeSchema.jsonLdValid += extra.jsonLdValid;
    homeSchema.jsonLdInvalid += extra.jsonLdInvalid;
    if (extra.hasFAQ) homeSchema.hasFAQ = true;
    if (extra.hasArticle) homeSchema.hasArticle = true;
    if (extra.hasProduct) homeSchema.hasProduct = true;
    if (extra.hasWebSite) homeSchema.hasWebSite = true;
    if (extra.hasBreadcrumb) homeSchema.hasBreadcrumb = true;
    if (extra.hasLocalBusiness) homeSchema.hasLocalBusiness = true;
    if (!homeSchema.hasOrganization && extra.hasOrganization) {
      homeSchema.hasOrganization = true;
      homeSchema.organizationComplete = extra.organizationComplete;
    }
    homeSchema.errors.push(...extra.errors);
    homeSchema.evidence.push(...extra.evidence);

    // Extract content from SAME document (CHANGE 1 — no second parseHTML)
    const extraContent = extractContent(doc);
    combinedContent.questionHeadings.push(...extraContent.questionHeadings);
    combinedContent.bulletPoints += extraContent.bulletPoints;
    if (extraContent.hasFaqSection) combinedContent.hasFaqSection = true;
  }
  combinedContent.questionHeadings = [...new Set(combinedContent.questionHeadings)];

  // ─── E-E-A-T — use discoveredLegal from Phase 3 ───
  const eeatPages = {
    impressum: !!discoveredLegal.impressum && discoveredLegal.impressumValid,
    privacy: !!discoveredLegal.privacy,
    contact: !!discoveredLegal.contact,
    about: !!discoveredLegal.about,
  };
  const eeat = extractEEAT(homeDoc, eeatPages, getBaseDomain(resolvedBase));

  eeat.discovery = discoveryMode;
  eeat.impressumUrl = discoveredLegal.impressum;
  eeat.privacyUrl = discoveredLegal.privacy;
  eeat.contactUrl = discoveredLegal.contact;

  // Freshness
  const freshness = extractFreshness(homeDoc, homeResult.headers.get("last-modified"));

  // i18n
  let i18nScore = 0;
  if (meta.htmlLang) i18nScore += 40;
  if (meta.hreflangs.length > 0) i18nScore += 30;
  if (meta.htmlLang && meta.hreflangs.some((h) => h.startsWith(meta.htmlLang!.split("-")[0]))) i18nScore += 30;

  // ─── Performance ───
  const perf: VerifiedFacts["perf"] = {
    ttfbMs: homeResult.ttfbMs,
    loadTimeMs: homeResult.totalTimeMs,
    htmlSizeKb: Math.round((homeResult.sizeBytes / 1024) * 10) / 10,
    psi: null,
  };

  // Process PSI result from Phase 0
  if (psiData) {
    try {
      const lhr = psiData.lighthouseResult;
      if (lhr?.categories?.performance?.score !== undefined) {
        perf.psi = {
          performanceScore: Math.round(lhr.categories.performance.score * 100),
          lcp: lhr.audits?.["largest-contentful-paint"]?.numericValue
            ? Math.round(lhr.audits["largest-contentful-paint"].numericValue) : null,
          cls: lhr.audits?.["cumulative-layout-shift"]?.numericValue
            ? Math.round(lhr.audits["cumulative-layout-shift"].numericValue * 1000) / 1000 : null,
          inp: lhr.audits?.["interaction-to-next-paint"]?.numericValue
            ? Math.round(lhr.audits["interaction-to-next-paint"].numericValue) : null,
        };
      }
    } catch { /* PSI not available */ }
  }

  // ─── llms.txt ───
  const llmsTxtFound = llmsResult?.ok === true && (llmsResult.sizeBytes ?? 0) > 50;
  const llmsTxtUrl = llmsTxtFound ? llmsResult!.finalUrl : null;
  const llmsTxtSize = llmsTxtFound ? llmsResult!.sizeBytes : null;

  // ─── CHANGE 6: Instrumented timings ───
  const totalMs = Math.round(performance.now() - totalStart);

  const timings: VerifiedFacts["timings"] = {
    homeFetchMs: homeResult.totalTimeMs,
    robotsFetchMs: robotsResult?.totalTimeMs ?? 0,
    sitemapFetchMs: 0, // computed below
    sitemapChildrenFetchMs: 0, // computed below
    llmsTxtFetchMs: llmsResult?.totalTimeMs ?? 0,
    legalPagesFetchMs,
    parseMs,
    totalMs,
    requests: requestTimings,
  };

  // Compute sitemap timing from individual requests
  for (const sr of sitemapFetchResults) {
    if (sr.status === "fulfilled") {
      timings.sitemapFetchMs += sr.value.result?.totalTimeMs ?? 0;
    }
  }

  // Compute sitemap children timing from Phase 3 results
  for (let i = 0; i < remainingFetches.length; i++) {
    if (remainingFetches[i].category === "sitemap-child") {
      const pr = remainingResults[i];
      if (pr?.status === "fulfilled") {
        timings.sitemapChildrenFetchMs += pr.value.result?.totalTimeMs ?? 0;
      }
    }
  }

  // Add sitemap and child timings to requests
  for (const sr of sitemapFetchResults) {
    if (sr.status === "fulfilled" && sr.value.result) {
      const { url, result } = sr.value;
      requestTimings.push({ url, ms: result.totalTimeMs, status: result.status, bytes: result.sizeBytes });
    }
  }

  return {
    resolvedUrl: homeResult.finalUrl,
    redirected: homeResult.redirected,
    requestMeta: { acceptLanguage: ACCEPT_LANGUAGE },
    meta,
    schema: homeSchema,
    crawlers: {
      allowed: allowedCount,
      total: AI_CRAWLERS.length,
      blocked,
      status: robotsStatus,
      details: crawlerDetails,
    },
    llmsTxt: { found: llmsTxtFound, url: llmsTxtUrl, sizeBytes: llmsTxtSize },
    sitemap: {
      found: sitemapFound,
      url: sitemapUrl,
      urlCount: sitemapUrlCount,
      inRobots: robotsDeclaredUrls.length > 0,
      sitemapScore,
      source: sitemapSource,
      status: sitemapFound ? "ok" : "pending",
      children: [...sitemapChildren, ...sitemapChildrenFromGuess],
      childrenTotal: sitemapChildUrls.length + sitemapChildrenTotalFromGuess,
      childrenFetched: sitemapChildren.length + sitemapChildrenFromGuess.length,
      partial: sitemapPartial || sitemapChildrenFromGuess.length < sitemapChildrenTotalFromGuess,
      truncated: sitemapTruncated,
      limitApplied: sitemapLimitApplied,
      robotsDeclared: robotsDeclaredUrls,
      robotsDeclaredValid,
      robotsDeclaredError,
    },
    freshness,
    eeat,
    content: combinedContent,
    perf,
    i18n: {
      htmlLang: meta.htmlLang,
      hreflangCount: meta.hreflangs.length,
      hreflangs: meta.hreflangs,
      i18nScore,
    },
    timings,
    scannedUrls,
    partialCrawl,
    collectedAt: new Date().toISOString(),
  };
}
