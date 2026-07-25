// GEO Check — Crawler integration tests (v2)
// 5 control domains: stripe, example, buerklin (apex+www), El Kiosk client

import { collectFacts } from "../crawler";
import * as fs from "fs";

const DOMAINS = [
  { url: "https://stripe.com", label: "stripe" },
  { url: "https://example.com", label: "example" },
  { url: "https://buerklin-wolf.de", label: "buerklin-apex" },
  { url: "https://www.buerklin-wolf.de", label: "buerklin-www" },
  { url: "https://www.schlenkerla.de", label: "schlenkerla" },
];

async function runTest(domain: { url: string; label: string }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${domain.url}`);
  console.log(`${"=".repeat(60)}`);

  const start = Date.now();
  try {
    const facts = await collectFacts(domain.url);
    const elapsed = Date.now() - start;

    console.log(`  Completed in ${elapsed}ms`);
    console.log(`  Resolved URL: ${facts.resolvedUrl}`);
    console.log(`  Redirected: ${facts.redirected}`);
    console.log(`  Scanned URLs: ${facts.scannedUrls.length}`);
    console.log(`  Title: ${facts.meta.title}`);
    console.log(`  JSON-LD blocks: ${facts.schema.jsonLdBlocks}`);
    console.log(`  Crawlers: ${facts.crawlers.allowed}/${facts.crawlers.total} (${facts.crawlers.status})`);
    console.log(`  Blocked: ${facts.crawlers.blocked.length}`);
    console.log(`  Sitemap: found=${facts.sitemap.found} source=${facts.sitemap.source} url=${facts.sitemap.url} count=${facts.sitemap.urlCount}`);
    console.log(`  llms.txt: ${facts.llmsTxt.found}`);
    console.log(`  Trust score: ${facts.eeat.trustScore}`);
    console.log(`  Content words: ${facts.content.wordCount}`);
    console.log(`  HTML size: ${facts.perf.htmlSizeKb}KB`);
    console.log(`  TTFB: ${facts.perf.ttfbMs}ms`);

    const outPath = `/tmp/geo-check-${domain.label}.json`;
    fs.writeFileSync(outPath, JSON.stringify(facts, null, 2));
    console.log(`  Saved to: ${outPath}`);

    return facts;
  } catch (err) {
    console.error(`  ERROR: ${err}`);
    return null;
  }
}

async function main() {
  console.log("GEO Check Crawler v2 — Control Domain Tests");
  console.log("Date:", new Date().toISOString());

  const results: Record<string, any> = {};
  for (const domain of DOMAINS) {
    results[domain.label] = await runTest(domain);
  }

  // Validation checks
  console.log("\n\n=== VALIDATION CHECKS ===");

  const stripe = results.stripe;
  if (stripe) {
    const sitemapOk = stripe.sitemap.found && stripe.sitemap.source === "robots";
    console.log(`${sitemapOk ? "✅" : "❌"} Stripe sitemap found via robots.txt: ${stripe.sitemap.found} (source: ${stripe.sitemap.source})`);
  }

  const apex = results["buerklin-apex"];
  const www = results["buerklin-www"];
  if (apex && www) {
    const resolvedSame = apex.resolvedUrl === www.resolvedUrl || apex.resolvedUrl.replace(/\/$/, "") === www.resolvedUrl.replace(/\/$/, "");
    const robotsOk = apex.crawlers.status === "ok" && www.crawlers.status === "ok";
    const sitemapSame = apex.sitemap.urlCount === www.sitemap.urlCount;
    console.log(`${apex.redirected ? "✅" : "⚠️"} Bürklin apex redirects: ${apex.redirected} → ${apex.resolvedUrl}`);
    console.log(`${robotsOk ? "✅" : "❌"} Both have robots.txt parsed: apex=${apex.crawlers.status} www=${www.crawlers.status}`);
    console.log(`${resolvedSame ? "✅" : "⚠️"} Same resolved URL: apex=${apex.resolvedUrl} www=${www.resolvedUrl}`);
    console.log(`${sitemapSame ? "✅" : "⚠️"} Same sitemap urlCount: apex=${apex.sitemap.urlCount} www=${www.sitemap.urlCount}`);
  }

  console.log("\nDone. Check /tmp/geo-check-*.json for full output.");
}

main();
