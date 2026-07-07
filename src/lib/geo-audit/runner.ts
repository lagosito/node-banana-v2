// GEO Audit — Main runner orchestrator

import {
  getAudit,
  updateAudit,
  getActivePrompts,
  createRun,
  getConfig,
} from "./airtable";
import { callProvider, getActiveProviders } from "./providers";
import { analyzeResponse } from "./analyzer";
import type { AuditConfig, RunResult, ProviderName, GeoAuditConfig } from "./types";

export interface ScoreBreakdown {
  mentionRate: number;       // 0-100
  mentionWeighted: number;   // contribution to score
  positionAvg: number;       // 0-100
  positionWeighted: number;
  citationRate: number;      // 0-100
  citationWeighted: number;
  sentimentRate: number;     // 0-100
  sentimentWeighted: number;
  sov: number;               // 0-100
  sovWeighted: number;
  total: number;
}

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

// ─── Extract domain from Google grounding redirect URL ───
function extractDomainFromRedirect(url: string): string {
  try {
    // Google grounding URLs sometimes contain the actual domain in the redirect
    // or are direct URLs. Extract hostname.
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

// ─── Calculate GEO Score (returns exact breakdown) ───
function calculateScore(
  results: RunResult[],
  weights: GeoAuditConfig,
): ScoreBreakdown {
  if (results.length === 0) {
    return {
      mentionRate: 0, mentionWeighted: 0,
      positionAvg: 0, positionWeighted: 0,
      citationRate: 0, citationWeighted: 0,
      sentimentRate: 0, sentimentWeighted: 0,
      sov: 0, sovWeighted: 0,
      total: 0,
    };
  }

  const totalRuns = results.length;
  const mentionedCount = results.filter((r) => r.brandMentioned).length;

  // Mention Rate: % of runs where brand was mentioned
  const mentionPct = (mentionedCount / totalRuns) * 100;
  const mentionWeighted = (mentionPct / 100) * weights.score_weight_mention;

  // Position: normalized 0-100 (pos 1 = 100, pos 2 = 70, pos 3 = 50, 4+ = 30)
  const positions = results.filter((r) => r.mentionPosition > 0).map((r) => r.mentionPosition);
  let positionPct = 0;
  if (positions.length > 0) {
    const avgPos = positions.reduce((a, b) => a + b, 0) / positions.length;
    if (avgPos <= 1) positionPct = 100;
    else if (avgPos <= 2) positionPct = 70;
    else if (avgPos <= 3) positionPct = 50;
    else positionPct = 30;
  }
  const positionWeighted = (positionPct / 100) * weights.score_weight_position;

  // Citation Rate: % of runs where domain was cited
  const citationPct = (results.filter((r) => r.brandDomainCited).length / totalRuns) * 100;
  const citationWeighted = (citationPct / 100) * weights.score_weight_citation;

  // Sentiment: (positives + 0.5 * neutrals) / totalMentions * 100
  const positiveCount = results.filter((r) => r.sentiment === "positiv").length;
  const neutralCount = results.filter((r) => r.sentiment === "neutral").length;
  const sentimentPct = mentionedCount > 0
    ? ((positiveCount + 0.5 * neutralCount) / mentionedCount) * 100
    : 0;
  const sentimentWeighted = (sentimentPct / 100) * weights.score_weight_sentiment;

  // Share of Voice: brand mentions / (brand + competitor mentions)
  const totalCompetitorMentions = results.reduce(
    (sum, r) => sum + r.competitorsMentioned.length, 0
  );
  const sovPct = (mentionedCount + totalCompetitorMentions) > 0
    ? (mentionedCount / (mentionedCount + totalCompetitorMentions)) * 100
    : 0;
  const sovWeighted = (sovPct / 100) * weights.score_weight_sov;

  const total = Math.round(
    (mentionWeighted + positionWeighted + citationWeighted + sentimentWeighted + sovWeighted) * 10
  ) / 10;

  return {
    mentionRate: Math.round(mentionPct * 10) / 10,
    mentionWeighted: Math.round(mentionWeighted * 100) / 100,
    positionAvg: Math.round(positionPct * 10) / 10,
    positionWeighted: Math.round(positionWeighted * 100) / 100,
    citationRate: Math.round(citationPct * 10) / 10,
    citationWeighted: Math.round(citationWeighted * 100) / 100,
    sentimentRate: Math.round(sentimentPct * 10) / 10,
    sentimentWeighted: Math.round(sentimentWeighted * 100) / 100,
    sov: Math.round(sovPct * 10) / 10,
    sovWeighted: Math.round(sovWeighted * 100) / 100,
    total,
  };
}

// ─── Main run function ───
export async function runGeoAudit(
  auditId: string,
  signal?: AbortSignal,
): Promise<{
  brand: string;
  totalRuns: number;
  expectedRuns: number;
  mentions: number;
  topCompetitors: string[];
  score: ScoreBreakdown;
  costEstimate: number;
  errors: string[];
  runSummary: Record<string, { expected: number; completed: number; errors: string[] }>;
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
    product: vertical,
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

  const expectedRuns = prompts.length * providers.length;

  // 5. Execute all prompt × provider combinations
  const allResults: RunResult[] = [];
  const errors: string[] = [];
  const runSummary: Record<string, { expected: number; completed: number; errors: string[] }> = {};

  for (const provider of providers) {
    const providerErrors: string[] = [];
    let providerCompleted = 0;
    const concurrency = 3;

    for (let i = 0; i < prompts.length; i += concurrency) {
      if (signal?.aborted) break;

      const batch = prompts.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (prompt) => {
          const resolvedPrompt = resolvePrompt(prompt.fields["Prompt Text"], auditConfig);

          const providerResponse = await callProvider(provider, resolvedPrompt);

          const analysis = await analyzeResponse(
            providerResponse.text,
            auditConfig.brandName,
            auditConfig.brandDomain,
            auditConfig.aliases,
          );

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
          return result;
        })
      );

      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        const promptId = batch[j].id;
        if (r.status === "fulfilled") {
          allResults.push(r.value);
          providerCompleted++;
        } else {
          const errMsg = `${provider}/${promptId}: ${r.reason?.message || "Unknown error"}`;
          providerErrors.push(errMsg);
          errors.push(errMsg);
        }
      }
    }

    runSummary[provider] = {
      expected: prompts.length,
      completed: providerCompleted,
      errors: providerErrors,
    };
  }

  // 6. Calculate score with weights from Config table
  let weights: GeoAuditConfig;
  try {
    weights = await getConfig();
  } catch {
    // Fallback to default weights if Config table read fails
    weights = {
      score_weight_mention: 40,
      score_weight_position: 20,
      score_weight_citation: 20,
      score_weight_sentiment: 10,
      score_weight_sov: 10,
    };
  }
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
    "GEO Score": Math.round(score.total),
    Competitors: topCompetitors.join("\n"),
  });

  // Cost estimate per provider
  const costMap: Record<string, number> = {
    gemini: 0.01,
    perplexity: 0.03,
    openai: 0.05,
  };
  const costEstimate = allResults.reduce((sum, r) => sum + (costMap[r.provider] || 0.03), 0);

  return {
    brand: brandName,
    totalRuns: allResults.length,
    expectedRuns,
    mentions: allResults.filter((r) => r.brandMentioned).length,
    topCompetitors,
    score,
    costEstimate: Math.round(costEstimate * 100) / 100,
    errors,
    runSummary,
  };
}
