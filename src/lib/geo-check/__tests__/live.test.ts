// GEO Check — Live integration tests (10 control domains)
// Run manually before approving each phase.
// May fail due to external factors.

import { collectFacts } from "../crawler";
import * as fs from "fs";

const DOMAINS = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/control-domains.json", import.meta.url),
    "utf-8",
  ),
);

async function runTest(d: { domain: string; label: string; expectedTraits: string[] }) {
  const url = `https://${d.domain}`;
  const start = Date.now();
  try {
    const facts = await collectFacts(url);
    const elapsed = Date.now() - start;
    return { ...d, facts, elapsed, error: null };
  } catch (err: any) {
    return { ...d, facts: null, elapsed: Date.now() - start, error: err.message };
  }
}

async function main() {
  console.log("GEO Check — Live Test (10 domains)");
  console.log("Date:", new Date().toISOString());

  const results: any[] = [];
  for (const d of DOMAINS) {
    const r = await runTest(d);
    results.push(r);
    const status = r.error ? "ERROR" : "OK";
    const f = r.facts;
    console.log(`\n${status} ${r.domain} (${r.elapsed}ms)`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
    } else {
      console.log(`  Resolved: ${f.resolvedUrl} (redirected: ${f.redirected})`);
      console.log(`  Title: ${f.meta.title?.slice(0, 60)}`);
      console.log(`  JSON-LD: ${f.schema.jsonLdBlocks} blocks, types: [${f.schema.types.join(", ")}]`);
      console.log(`  Crawlers: ${f.crawlers.allowed}/${f.crawlers.total} (${f.crawlers.status})`);
      console.log(`  Sitemap: found=${f.sitemap.found} source=${f.sitemap.source} count=${f.sitemap.urlCount} children=${f.sitemap.children?.length || 0}`);
      console.log(`  robotsDeclared: ${f.sitemap.robotsDeclared?.length || 0} urls, valid=${f.sitemap.robotsDeclaredValid}`);
      console.log(`  llms.txt: ${f.llmsTxt.found}`);
      console.log(`  E-E-A-T: trust=${f.eeat.trustScore} discovery=${f.eeat.discovery}`);
      console.log(`    impressum: ${f.eeat.hasImpressum} url=${f.eeat.impressumUrl}`);
      console.log(`    privacy: ${f.eeat.hasPrivacy} url=${f.eeat.privacyUrl}`);
      console.log(`    contact: ${f.eeat.hasContact} url=${f.eeat.contactUrl}`);
      console.log(`  Content: ${f.content.wordCount} words, h1=${f.content.h1Count} h2=${f.content.h2Count}`);
      console.log(`  Perf: ttfb=${f.perf.ttfbMs}ms html=${f.perf.htmlSizeKb}KB`);

      // Save JSON
      const outPath = `/tmp/geo-check-${r.label}.json`;
      fs.writeFileSync(outPath, JSON.stringify(f, null, 2));
    }
  }

  // Validation checks
  console.log("\n\n=== VALIDATION CHECKS ===");

  const schlenkerla = results.find((r) => r.label === "schlenkerla");
  if (schlenkerla?.facts) {
    const f = schlenkerla.facts;
    console.log(`${f.eeat.hasImpressum ? "✅" : "❌"} Schlenkerla Impressum found: ${f.eeat.hasImpressum} (url: ${f.eeat.impressumUrl})`);
    console.log(`${f.eeat.hasPrivacy ? "✅" : "❌"} Schlenkerla Datenschutz found: ${f.eeat.hasPrivacy} (url: ${f.eeat.privacyUrl})`);
    console.log(`${f.eeat.trustScore > 20 ? "✅" : "❌"} Schlenkerla trust > 20: ${f.eeat.trustScore}`);
  }

  const buerklin = results.find((r) => r.label === "buerklin");
  if (buerklin?.facts) {
    const f = buerklin.facts;
    console.log(`${(f.sitemap.urlCount > 4 || (f.sitemap.status === "ok" && f.sitemap.childrenTotal > 0)) ? "✅" : "⚠️"} Buerklin sitemap: urlCount=${f.sitemap.urlCount} status=${f.sitemap.status} childrenTotal=${f.sitemap.childrenTotal}`);
    console.log(`${f.sitemap.childrenTotal > 0 ? "✅" : "❌"} Buerklin has sitemap children: total=${f.sitemap.childrenTotal} fetched=${f.sitemap.childrenFetched}`);
    console.log(`${!f.sitemap.robotsDeclaredValid ? "✅" : "⚠️"} Buerklin robotsDeclaredValid: ${f.sitemap.robotsDeclaredValid}`);
  }

  const stripe = results.find((r) => r.label === "stripe");
  if (stripe?.facts) {
    console.log(`${stripe.facts.sitemap.found ? "✅" : "❌"} Stripe sitemap found: ${stripe.facts.sitemap.found} (source: ${stripe.facts.sitemap.source})`);
  }

  // Timing summary
  console.log("\n=== TIMINGS ===");
  const valid = results.filter((r) => !r.error);
  const times = valid.map((r) => r.elapsed).sort((a, b) => a - b);
  if (times.length > 0) {
    console.log(`p50: ${times[Math.floor(times.length / 2)]}ms`);
    console.log(`p95: ${times[Math.floor(times.length * 0.95)]}ms`);
    console.log(`min: ${times[0]}ms, max: ${times[times.length - 1]}ms`);
  }

  console.log("\nDone.");
}

main();
