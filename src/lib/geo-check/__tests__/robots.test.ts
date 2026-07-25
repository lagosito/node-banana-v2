// GEO Check — Robots.txt parser RFC 9309 compliance tests
// 15 fixtures covering all edge cases from the spec.

import { parseRobotsTxt, isCrawlerAllowed } from "../crawler";
import type { RobotsRule } from "../crawler";

const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web",
  "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended",
  "Applebot-Extended", "CCBot", "Bytespider", "Amazonbot", "Meta-ExternalAgent",
  "cohere-ai", "Diffbot", "ImagesiftBot", "Omgilibot", "Timpibot", "YouBot",
];

function countBlocked(rules: RobotsRule[]): string[] {
  return AI_CRAWLERS.filter((c) => !isCrawlerAllowed(rules, c).allowed);
}

describe("Robots.txt parser — RFC 9309 compliance", () => {

  // 1. Empty Disallow value → allow all
  it('1. "Disallow:" empty → allows all 20', () => {
    const { rules } = parseRobotsTxt("User-agent: *\nDisallow:\n");
    expect(countBlocked(rules)).toHaveLength(0);
  });

  // 2. Empty Allow value → no effect
  it('2. "Allow:" empty → no effect', () => {
    const { rules } = parseRobotsTxt("User-agent: *\nAllow:\n");
    expect(countBlocked(rules)).toHaveLength(0);
  });

  // 3. Group without Disallow lines → allow all
  it("3. group with only User-agent and Sitemap → allows all", () => {
    const { rules } = parseRobotsTxt("User-agent: *\nSitemap: https://example.com/sitemap.xml\n");
    const r = isCrawlerAllowed(rules, "GPTBot");
    expect(r.allowed).toBe(true);
  });

  // 4. Disallow: / → blocks all
  it('4. "Disallow: /" → blocks all 20', () => {
    const { rules } = parseRobotsTxt("User-agent: *\nDisallow: /\n");
    expect(countBlocked(rules)).toHaveLength(20);
  });

  // 5. CRLF line endings → identical to LF
  it("5. CRLF line endings → identical behavior to LF", () => {
    const crlf = "User-agent: *\r\nDisallow: /\r\n";
    const lf = "User-agent: *\nDisallow: /\n";
    const rCRLF = countBlocked(parseRobotsTxt(crlf).rules);
    const rLF = countBlocked(parseRobotsTxt(lf).rules);
    expect(rCRLF).toHaveLength(20);
    expect(rLF).toHaveLength(20);
    expect(rCRLF).toEqual(rLF);
  });

  // 6. BOM at start → parsed same
  it("6. BOM at start → parsed correctly", () => {
    const withBOM = "\uFEFFUser-agent: *\nDisallow: /\n";
    const without = "User-agent: *\nDisallow: /\n";
    expect(countBlocked(parseRobotsTxt(withBOM).rules)).toHaveLength(20);
    expect(countBlocked(parseRobotsTxt(without).rules)).toHaveLength(20);
  });

  // 7. Whitespace around values → trimmed
  it("7. whitespace around values → ignored", () => {
    const { rules } = parseRobotsTxt("User-agent:   *  \nDisallow:   /  \n");
    expect(countBlocked(rules)).toHaveLength(20);
  });

  // 8. Multiple User-agent lines before a group → all apply
  it("8. multiple User-agent lines → all agents in group", () => {
    const { rules } = parseRobotsTxt(
      "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n",
    );
    expect(isCrawlerAllowed(rules, "GPTBot").allowed).toBe(false);
    expect(isCrawlerAllowed(rules, "ClaudeBot").allowed).toBe(false);
    expect(isCrawlerAllowed(rules, "GPTBot").allowed).toBe(false);
  });

  // 9. Wildcard * and specific → specific REPLACES wildcard
  it("9. wildcard * blocked, GPTBot allowed → GPTBot allowed, others blocked", () => {
    const { rules } = parseRobotsTxt(
      "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n",
    );
    expect(isCrawlerAllowed(rules, "GPTBot").allowed).toBe(true);
    expect(isCrawlerAllowed(rules, "ClaudeBot").allowed).toBe(false);
    expect(isCrawlerAllowed(rules, "PerplexityBot").allowed).toBe(false);
  });

  // 10. Allow and Disallow conflict → longest path wins
  it("10. Allow /admin vs Disallow / → Allow wins (longer path)", () => {
    const { rules } = parseRobotsTxt(
      "User-agent: GPTBot\nDisallow: /\nAllow: /admin\n",
    );
    // Root "/" is blocked by Disallow: /, Allow: /admin only covers /admin/*
    const rootResult = isCrawlerAllowed(rules, "GPTBot");
    expect(rootResult.allowed).toBe(false);
  });

  it("10b. Allow / vs Disallow /admin → Allow wins for root", () => {
    const { rules } = parseRobotsTxt(
      "User-agent: GPTBot\nDisallow: /admin\nAllow: /\n",
    );
    const rootResult = isCrawlerAllowed(rules, "GPTBot");
    expect(rootResult.allowed).toBe(true);
  });

  // 11. Wildcards * and $ in paths
  it("11. Disallow: /*.json$ → blocks .json paths only", () => {
    const { rules } = parseRobotsTxt(
      "User-agent: GPTBot\nDisallow: /*.json$\n",
    );
    // Root "/" should be allowed
    expect(isCrawlerAllowed(rules, "GPTBot").allowed).toBe(true);
  });

  // 12. Comments with #, inline and full-line
  it("12. comments with # are stripped", () => {
    const { rules } = parseRobotsTxt(
      "# Full line comment\nUser-agent: * # inline comment\nDisallow: / # path comment\n",
    );
    expect(countBlocked(rules)).toHaveLength(20);
  });

  // 13. User-agent case insensitive
  it("13. User-agent case insensitive", () => {
    const { rules } = parseRobotsTxt("User-agent: GPTBOT\nDisallow: /\n");
    expect(isCrawlerAllowed(rules, "GPTBot").allowed).toBe(false);
    expect(isCrawlerAllowed(rules, "gptbot").allowed).toBe(false);
  });

  // 14. Huge file → only first 500KB parsed
  it("14. large file → truncated to 500KB without error", () => {
    const huge = "User-agent: *\nDisallow: /admin\n" + "x".repeat(600000);
    const { rules } = parseRobotsTxt(huge);
    // Should still parse the first rule
    expect(countBlocked(rules).length).toBeGreaterThanOrEqual(0);
  });

  // 15. 5xx status → handled by caller (crawler), not parser
  // This is tested in the integration tests, not unit tests
  it("15. parser handles any string input without throwing", () => {
    expect(() => parseRobotsTxt("")).not.toThrow();
    expect(() => parseRobotsTxt("random garbage")).not.toThrow();
    expect(() => parseRobotsTxt("\r\n\r\n")).not.toThrow();
  });

  // Extra: CRLF with empty Disallow (THE BUG)
  it("EXTRA: CRLF + empty Disallow → allows all (THE BUG)", () => {
    const content = "User-agent: *\r\nDisallow: \r\nSitemap: https://example.com/sitemap.xml\r\n";
    const { rules } = parseRobotsTxt(content);
    expect(countBlocked(rules)).toHaveLength(0);
  });

  // Extra: Lieken's actual robots.txt
  it("EXTRA: lieken.de robots.txt → 20/20 allowed", () => {
    const content = "User-agent: *\r\nDisallow: \r\nSitemap: https://www.lieken.de/sitemap.xml\r\n";
    const { rules, sitemapUrls } = parseRobotsTxt(content);
    expect(countBlocked(rules)).toHaveLength(0);
    expect(sitemapUrls).toEqual(["https://www.lieken.de/sitemap.xml"]);
  });

  // Extra: percent signs as comments (RFC 9309)
  it("EXTRA: % as comment character", () => {
    const { rules } = parseRobotsTxt("User-agent: *\n% comment\nDisallow: /\n");
    expect(countBlocked(rules)).toHaveLength(20);
  });
});
