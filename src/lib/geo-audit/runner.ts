// GEO Audit — Main runner orchestrator

import {
  getAudit,
  updateAudit,
  getActivePrompts,
  createRun,
} from "./airtable";
import { callProvider, getActiveProviders } from "./providers";
import { analyzeResponse } from "./analyzer";
import type { AuditConfig, RunResult, ProviderName } from "./types";

// ─── Domain extraction from URL ───
function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

// ─── Build aliases from brand name + domain ───
function buildAliases(brandName: string, domain: string): string[] {
  const aliases = [brandName];
  // Add domain without TLD as alias
  const base = domain.split(".")[0];
  if (base !== brandName.toLowerCase().replace(/\s+/g, "")) {
    aliases.push(base);
  }
  return aliases;
}

// ─── Resolve prompt variables ───
function resolvePrompt(template: string, config: AuditConfig): string {
  return template
    .replace(/{vertical}/g, config.vertical)
    .replace(/{region}/g, config.region)
    .replace(/{product}/g, config.product);
}

// ─── Calculate GEO Score ───
function calculateScore(
  results: RunResult[],
  config: { mention: number; position: number; citation: number; sentiment: number; sov: number }
): number {
  if (results.length === 0) return 0;

  const totalRuns = results.length;
  const mentionedCount = results.filter((r) => r.brandMentioned).length;
  const mentionRate = mentionedCount / totalRuns;

  // Average position among mentions (lower = better, 1 = always first)
  const positions = results.filter((r) => r.mentionPosition > 0).map((r) => r.mentionPosition);
  const avgPosition = positions.length > 0
    ? Math.max(0, 1 - (positions.reduce((a, b) => a + b, 0) / positions.length - 1) / 5)
    : 0;

  // Citation rate
  const citationRate = results.filter((r) => r.brandDomainCited).length / totalRuns;

  // Sentiment score
  const sentimentScore =
    results.filter((r) => r.sentiment === "positiv").length / totalRuns;

  // Share of Voice (brand mentions vs total competitor mentions)
  const totalCompetitorMentions = results.reduce(
    (sum, r) => sum + r.competitorsMentioned.length,
    0
  );
  const sov = totalCompetitorMentions > 0
    ? mentionedCount / (mentionedCount + totalCompetitorMentions)
    : mentionRate;

  const score =
    mentionRate * config.mention +
    avgPosition * config.position +
    citationRate * config.citation +
    sentimentScore * config.sentiment +
    sov * config.sov;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ─── Main run function ───
export async function runGeoAudit(
  auditId: string,
  signal?: AbortSignal,
): Promise<{
  brand: string;
  totalRuns: number;
  mentions: number;
  topCompetitors: string[];
  score: number;
  costEstimate: number;
  errors: string[];
}> {
  // 1. Fetch audit
  const audit = await getAudit(auditId);
  const brandName = audit.fields["Brand Name"];
  const brandUrl = audit.fields["Website URL"];
  const vertical = audit.fields.Vertical;
  const region = audit.fields.Region || "Deutschland";
  const language = audit.fields.Language || "DE";

  const auditConfig: AuditConfig = {
    brandName,
    brandDomain: extractDomain(brandUrl),
    aliases: buildAliases(brandName, extractDomain(brandUrl)),
    region,
    vertical,
    product: vertical, // use vertical as default product
    language,
  };

  // 2. Mark as Running
  await updateAudit(auditId, { Status: "Running" });

  // 3. Fetch active prompts for this vertical
  const prompts = await getActivePrompts(vertical);
  if (prompts.length === 0) {
    throw new Error(`No active prompts for vertical: ${vertical}`);
  }

  // 4. Get active providers
  const providers = getActiveProviders();
  if (providers.length === 0) {
    throw new Error("No providers configured");
  }

  // 5. Execute all prompt × provider combinations
  const totalExpected = prompts.length * providers.length;
  let completed = 0;
  const allResults: RunResult[] = [];
  const errors: string[] = [];

  // Concurrency: 3 per provider
  for (const provider of providers) {
    const concurrency = 3;
    for (let i = 0; i < prompts.length; i += concurrency) {
      if (signal?.aborted) break;

      const batch = prompts.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (prompt) => {
          const resolvedPrompt = resolvePrompt(prompt.fields["Prompt Text"], auditConfig);

          // Call provider
          const providerResponse = await callProvider(provider, resolvedPrompt);

          // Analyze with Claude
          const analysis = await analyzeResponse(
            providerResponse.text,
            auditConfig.brandName,
            auditConfig.brandDomain,
            auditConfig.aliases,
          );

          // Save run to Airtable
          const result: RunResult = {
            auditRecordId: auditId,
            promptRecordId: prompt.id,
            provider,
            responseText: providerResponse.text,
            brandMentioned: analysis.brand_mentioned,
            mentionPosition: analysis.mention_position,
            sentiment: analysis.sentiment,
            brandDomainCited: analysis.brand_domain_cited,
            citedDomains: [
              ...new Set([...(providerResponse.citations || []), ...analysis.cited_domains]),
            ],
            competitorsMentioned: analysis.competitors_mentioned,
          };

          await createRun(result);
          completed++;
          return result;
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          allResults.push(r.value);
        } else {
          errors.push(r.reason?.message || "Unknown error");
        }
      }
    }
  }

  // 6. Calculate score
  const weights = {
    mention: 40,
    position: 20,
    citation: 20,
    sentiment: 10,
    sov: 10,
  };
  const score = calculateScore(allResults, weights);

  // 7. Dedupe competitors, top 5
  const competitorCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const c of r.competitorsMentioned) {
      const key = c.toLowerCase().trim();
      competitorCounts[key] = (competitorCounts[key] || 0) + 1;
    }
  }
  const topCompetitors = Object.entries(competitorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  // 8. Update audit: Status = Done, GEO Score, Competitors
  await updateAudit(auditId, {
    Status: "Done",
    "GEO Score": score,
    Competitors: topCompetitors.join("\n"),
  });

  // Rough cost estimate (varies by provider)
  const costEstimate = allResults.length * 0.03; // ~$0.03 per prompt×provider

  return {
    brand: brandName,
    totalRuns: allResults.length,
    mentions: allResults.filter((r) => r.brandMentioned).length,
    topCompetitors,
    score,
    costEstimate,
    errors,
  };
}
