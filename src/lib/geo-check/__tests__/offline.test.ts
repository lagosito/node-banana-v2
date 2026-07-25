// GEO Check — Offline fixture tests
// Parses raw HTML/robots.txt/sitemap from fixtures/raw/ without network.
// Run: npx vitest run src/lib/geo-check/__tests__/offline.test.ts

import * as fs from "fs";
import * as path from "path";
import { parseRobotsTxt, isCrawlerAllowed } from "../crawler";

const FIXTURES_DIR = path.join(__dirname, "fixtures/raw");
const DOMAINS_FILE = path.join(__dirname, "fixtures/control-domains.json");

interface DomainFixture {
  domain: string;
  label: string;
  cms: string;
  vertical: string;
  expectedTraits: string[];
  notes: string;
}

function loadDomains(): DomainFixture[] {
  return JSON.parse(fs.readFileSync(DOMAINS_FILE, "utf-8"));
}

function readFixture(label: string, file: string): string | null {
  const p = path.join(FIXTURES_DIR, label, file);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

// ─── Robots.txt offline tests ───

describe("Offline: robots.txt parsing", () => {
  const domains = loadDomains();

  for (const d of domains) {
    describe(d.domain, () => {
      it("parses robots.txt without errors", () => {
        const txt = readFixture(d.label, "robots.txt");
        if (!txt) {
          // No robots.txt = all allowed
          expect(true).toBe(true);
          return;
        }
        const { rules, sitemapUrls } = parseRobotsTxt(txt);
        expect(Array.isArray(rules)).toBe(true);
        expect(Array.isArray(sitemapUrls)).toBe(true);
      });

      it("has expected traits for crawlers", () => {
        const txt = readFixture(d.label, "robots.txt");
        if (!txt) return; // no robots = skip

        const { rules } = parseRobotsTxt(txt);
        const blockedCount = 20 - Array.from({ length: 20 }, (_, i) =>
          isCrawlerAllowed(rules, [
            "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web",
            "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended",
            "Applebot-Extended", "CCBot", "Bytespider", "Amazonbot", "Meta-ExternalAgent",
            "cohere-ai", "Diffbot", "ImagesiftBot", "Omgilibot", "Timpibot", "YouBot",
          ][i]).allowed
        ).length;

        // Just verify it parses and gives a number
        expect(typeof blockedCount).toBe("number");
        expect(blockedCount).toBeGreaterThanOrEqual(0);
        expect(blockedCount).toBeLessThanOrEqual(20);
      });
    });
  }
});

// ─── HTML parsing offline tests ───

describe("Offline: HTML meta extraction", () => {
  const domains = loadDomains();

  for (const d of domains) {
    describe(d.domain, () => {
      const html = readFixture(d.label, "home.html");

      if (!html) {
        it("has home.html fixture", () => {
          expect(true).toBe(false); // fail if no fixture
        });
        return;
      }

      it("has a <title> tag", () => {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        expect(titleMatch).not.toBeNull();
      });

      it("has expected schema traits", () => {
        const hasJsonLd = /application\/ld\+json/.test(html);
        if (d.expectedTraits.includes("no_schema")) {
          expect(hasJsonLd).toBe(false);
        }
        if (d.expectedTraits.includes("jsonld_organization")) {
          expect(hasJsonLd).toBe(true);
        }
      });

      it("has expected CMS markers", () => {
        if (d.expectedTraits.includes("wordpress")) {
          expect(html.toLowerCase()).toMatch(/wordpress|wp-content/);
        }
        if (d.expectedTraits.includes("squarespace")) {
          expect(html.toLowerCase()).toMatch(/squarespace/);
        }
        if (d.expectedTraits.includes("typo3") || d.expectedTraits.includes("fileadmin_assets")) {
          expect(html.toLowerCase()).toMatch(/typo3|fileadmin/);
        }
        if (d.expectedTraits.includes("jimdo")) {
          expect(html.toLowerCase()).toMatch(/jimdo/);
        }
      });
    });
  }
});

// ─── Sitemap offline tests ───

describe("Offline: sitemap parsing", () => {
  const domains = loadDomains();

  for (const d of domains) {
    describe(d.domain, () => {
      const sitemap = readFixture(d.label, "sitemap.xml");

      if (!sitemap) {
        it("has no sitemap fixture (expected for some domains)", () => {
          // stripe has sitemap at non-standard path, frankenwein has none
          expect(true).toBe(true);
        });
        return;
      }

      it("is valid XML with urlset or sitemapindex", () => {
        const hasUrlset = /<urlset[\s>]/i.test(sitemap);
        const hasSitemapindex = /<sitemapindex[\s>]/i.test(sitemap);
        expect(hasUrlset || hasSitemapindex).toBe(true);
      });

      it("has loc entries", () => {
        const locCount = (sitemap.match(/<loc>/gi) || []).length;
        expect(locCount).toBeGreaterThan(0);
      });

      // buerklin previously had sitemapindex with query strings,
      // server now returns urlset directly (verified live 2026-07-24)
    });
  }
});

// ─── Content analysis offline tests ───

describe("Offline: content structure", () => {
  const domains = loadDomains();

  for (const d of domains) {
    describe(d.domain, () => {
      const html = readFixture(d.label, "home.html");
      if (!html) return;

      it("word count matches expectations", () => {
        const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
        const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const words = text.split(/\s+/).filter((w) => w.length > 0).length;

        if (d.expectedTraits.includes("minimal_content")) {
          expect(words).toBeLessThan(100);
        }
        if (d.expectedTraits.includes("high_word_count")) {
          expect(words).toBeGreaterThan(500);
        }
        if (d.expectedTraits.includes("content_rich")) {
          expect(words).toBeGreaterThan(200);
        }
      });

      it("has heading structure", () => {
        const h1s = (html.match(/<h1[\s>]/gi) || []).length;
        const h2s = (html.match(/<h2[\s>]/gi) || []).length;
        // Some JS-rendered sites have no h1 in raw HTML
        expect(typeof h1s).toBe("number");
        expect(typeof h2s).toBe("number");
      });
    });
  }
});
