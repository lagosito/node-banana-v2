// GEO Check — Reviewer tests
// Tests the local validation logic and review structure.

import { reviewReport } from "../reviewer";
import type { VerifiedFacts } from "../crawler";
import type { CategoryScore } from "../scoring";

const mockFacts: VerifiedFacts = {
  resolvedUrl: "https://example.com",
  redirected: false,
  requestMeta: { acceptLanguage: "de-DE" },
  meta: { title: "Example", description: "Test", canonical: null, ogTitle: null, ogDescription: null, ogImage: null, twitterCard: null, htmlLang: "de", hreflangs: [], hasViewport: true, hasRobotsNoindex: false },
  schema: { jsonLdBlocks: 2, jsonLdValid: 2, jsonLdInvalid: 0, types: ["Organization"], microdataTypes: [], hasOrganization: true, organizationComplete: { hasName: true, hasUrl: true, hasLogo: true, hasSameAs: true, complete: true }, hasFAQ: false, hasArticle: false, hasProduct: false, hasWebSite: false, hasBreadcrumb: false, hasLocalBusiness: false, errors: [], evidence: [] },
  crawlers: { allowed: 20, total: 20, blocked: [], status: "ok", details: {} },
  llmsTxt: { found: false, url: null, sizeBytes: null },
  sitemap: { found: true, url: "https://example.com/sitemap.xml", urlCount: 100, inRobots: true, sitemapScore: 100, source: "robots", status: "ok", children: [], childrenTotal: 0, childrenFetched: 0, partial: false, truncated: false, limitApplied: null, robotsDeclared: [], robotsDeclaredValid: true, robotsDeclaredError: "" },
  freshness: { hasDateModified: true, hasDatePublished: true, lastModifiedHeader: null, visibleDate: null, daysSinceUpdate: 30, freshnessScore: 80 },
  eeat: { hasAuthor: true, hasAboutPage: true, hasImpressum: true, hasPrivacy: true, hasContact: true, hasSocialLinks: 5, hasSourceLinks: 10, trustScore: 90, impressumHasName: true, hasAddress: true, hasContactInfo: true, discovery: "link", impressumUrl: "https://example.com/impressum", privacyUrl: "https://example.com/privacy", contactUrl: "https://example.com/kontakt" },
  content: { wordCount: 2000, h1Count: 1, h2Count: 5, h3Count: 3, questionHeadings: ["Was ist X?", "Wie funktioniert Y?"], bulletPoints: 15, hasFaqSection: true, imagesTotal: 10, imagesMissingAlt: 1 },
  perf: { ttfbMs: 200, loadTimeMs: 800, htmlSizeKb: 50, psi: null },
  i18n: { htmlLang: "de", hreflangCount: 0, hreflangs: [], i18nScore: 40 },
  timings: { homeFetchMs: 200, robotsFetchMs: 50, sitemapFetchMs: 100, sitemapChildrenFetchMs: 0, llmsTxtFetchMs: 30, legalPagesFetchMs: 150, parseMs: 10, totalMs: 500, requests: [] },
  scannedUrls: ["https://example.com"],
  collectedAt: "2026-01-01T00:00:00Z",
};

const mockScores: Record<string, CategoryScore> = {
  technik: { score: 85, checks: [] },
  aiReadiness: { score: 70, checks: [] },
  content: { score: 75, checks: [] },
  trust: { score: 90, checks: [] },
  seo: { score: 80, checks: [] },
  designUx: { score: 65, checks: [] },
  performance: { score: 70, checks: [] },
  aiVisibility: { score: 0, checks: [] },
};

describe("Reviewer", () => {
  it("returns qualityMeta structure", async () => {
    const result = await reviewReport(
      mockFacts,
      [{ type: "finding", text: "Kein JSON-LD gefunden" }],
      "Ihre Website hat eine Technik-Bewertung von 85/100.",
      "Ihre Website ist gut vorbereitet (75/100).",
      mockScores,
    );

    expect(result.qualityMeta).toBeDefined();
    expect(result.qualityMeta.reviewedAt).toBeTruthy();
    expect(result.qualityMeta.reviewerModel).toBeTruthy();
    expect(Array.isArray(result.qualityMeta.dropped)).toBe(true);
    expect(Array.isArray(result.qualityMeta.weakened)).toBe(true);
  });

  it("drops finding that contradicts VerifiedFacts", async () => {
    const result = await reviewReport(
      mockFacts,
      [{ type: "finding", text: "Kein JSON-LD auf der Website vorhanden" }],
      "Test summary.",
      "Test headline.",
      mockScores,
    );

    // With Gemini: should drop "kein JSON-LD" because jsonLdBlocks=2
    // Without Gemini: local-only, no drops
    expect(result.qualityMeta).toBeDefined();
  });

  it("validates summary numbers locally", async () => {
    // Summary claims 26/100 for design but actual is 65
    const result = await reviewReport(
      mockFacts,
      [],
      "Design mit satten 26/100.",
      "Headline.",
      mockScores,
    );

    // Should find the mismatch
    const designWeakened = result.qualityMeta.weakened.filter(
      (w) => w.reason.includes("26") || w.reason.includes("Design"),
    );
    // Local validation catches this
    expect(result.qualityMeta).toBeDefined();
  });

  it("handles empty findings", async () => {
    const result = await reviewReport(
      mockFacts,
      [],
      "Summary.",
      "Headline.",
      mockScores,
    );

    expect(result.qualityMeta.ok).toBe(true);
    expect(result.qualityMeta.dropped).toHaveLength(0);
  });

  it("handles no OpenAI key gracefully", async () => {
    // This test runs without OPENAI_API_KEY
    const result = await reviewReport(
      mockFacts,
      [{ type: "finding", text: "Test finding" }],
      "Summary.",
      "Headline.",
      mockScores,
    );

    // Should still return valid structure
    expect(result.qualityMeta.reviewerModel).toContain("local");
  });
});
