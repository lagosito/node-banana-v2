// GEO Audit — Main runner orchestrator v2
// Single source of truth: saves Results JSON to audit record at completion

import {
  getAudit,
  updateAudit,
  getActivePrompts,
  createRun,
  getConfig,
} from "./airtable";
import { callProvider, getActiveProviders } from "./providers";
import { analyzeResponse, analyzeResponseBatch } from "./analyzer";
import type { AuditConfig, RunResult, ProviderName, GeoAuditConfig } from "./types";
import crypto from "crypto";

export interface ScoreBreakdown {
  mentionRate: number;
  mentionWeighted: number;
  positionAvg: number;
  positionWeighted: number;
  citationRate: number;
  citationWeighted: number;
  sentimentRate: number;
  sentimentWeighted: number;
  sov: number;
  sovWeighted: number;
  total: number;
}

export interface ResultsJSON {
  brand: string;
  vertical: string;
  region: string;
  date: string;
  totalRuns: number;
  expectedRuns: number;
  score: ScoreBreakdown;
  breakdown: {
    component: string;
    raw: string;
    weight: string;
    points: string;
  }[];
  providerTable: {
    name: string;
    runs: number;
    mentions: number;
    avgPosition: number;
    cited: number;
  }[];
  topCompetitors: { name: string; count: number }[];
  citedDomains: string[];
  runSummary: Record<string, { expected: number; completed: number; errorCount: number }>;
  errors: string[];
  costEstimate: number;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

function buildAliases(brandName: string, domain: string): string[] {
  const aliases = [brandName];
  const base = domain.split(".")[0];
  if (base !== brandName.toLowerCase().replace(/\s+/g, "")) {
    aliases.push(base);
  }
  return aliases;
}

function resolvePrompt(template: string, config: AuditConfig): string {
  return template
    .replace(/{vertical}/g, config.vertical)
    .replace(/{region}/g, config.region)
    .replace(/{product}/g, config.product);
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  const mentionPct = (mentionedCount / totalRuns) * 100;
  const mentionWeighted = (mentionPct / 100) * weights.score_weight_mention;

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

  const citationPct = (results.filter((r) => r.brandDomainCited).length / totalRuns) * 100;
  const citationWeighted = (citationPct / 100) * weights.score_weight_citation;

  const positiveCount = results.filter((r) => r.sentiment === "positiv").length;
  const neutralCount = results.filter((r) => r.sentiment === "neutral").length;
  const sentimentPct = mentionedCount > 0
    ? ((positiveCount + 0.5 * neutralCount) / mentionedCount) * 100
    : 0;
  const sentimentWeighted = (sentimentPct / 100) * weights.score_weight_sentiment;

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

function buildResultsJSON(
  allResults: RunResult[],
  score: ScoreBreakdown,
  brandName: string,
  vertical: string,
  region: string,
  runSummary: Record<string, { expected: number; completed: number; errors: string[] }>,
  errors: string[],
  weights: GeoAuditConfig,
): ResultsJSON {
  // Provider table
  const providerNames: Record<string, string> = {
    gemini: "Gemini", openai: "ChatGPT (OpenAI)", perplexity: "Perplexity",
  };
  const providerTable: ResultsJSON["providerTable"] = [];
  for (const [p, summary] of Object.entries(runSummary)) {
    const pResults = allResults.filter((r) => r.provider === p);
    const positions = pResults.filter((r) => r.mentionPosition > 0).map((r) => r.mentionPosition);
    providerTable.push({
      name: providerNames[p] || p,
      runs: summary.completed,
      mentions: pResults.filter((r) => r.brandMentioned).length,
      avgPosition: positions.length > 0
        ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
        : 0,
      cited: pResults.filter((r) => r.brandDomainCited).length,
    });
  }

  // Competitors with counts
  const compCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const c of r.competitorsMentioned) {
      const key = capitalize(c.toLowerCase().trim());
      compCounts[key] = (compCounts[key] || 0) + 1;
    }
  }
  const topCompetitors = Object.entries(compCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Cited domains: normalize, dedupe, filter to 2+ occurrences
  const domainCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const d of r.citedDomains) {
      let clean: string;
      try {
        if (d.startsWith("http")) {
          clean = new URL(d).hostname.replace(/^www\./, "").toLowerCase();
        } else {
          clean = d.replace(/^www\./, "").toLowerCase();
        }
      } catch {
        clean = d.toLowerCase();
      }
      if (clean && !clean.includes("google") && !clean.includes("cloud.google")) {
        domainCounts[clean] = (domainCounts[clean] || 0) + 1;
      }
    }
  }
  const citedDomains = Object.entries(domainCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);

  // Score breakdown table
  const breakdown: ResultsJSON["breakdown"] = [
    { component: "Mention Rate", raw: `${score.mentionRate}%`, weight: `${weights.score_weight_mention}%`, points: score.mentionWeighted.toFixed(2) },
    { component: "Position (norm.)", raw: `${score.positionAvg}`, weight: `${weights.score_weight_position}%`, points: score.positionWeighted.toFixed(2) },
    { component: "Citation Rate", raw: `${score.citationRate}%`, weight: `${weights.score_weight_citation}%`, points: score.citationWeighted.toFixed(2) },
    { component: "Sentiment", raw: `${score.sentimentRate}%`, weight: `${weights.score_weight_sentiment}%`, points: score.sentimentWeighted.toFixed(2) },
    { component: "Share of Voice", raw: `${score.sov}%`, weight: `${weights.score_weight_sov}%`, points: score.sovWeighted.toFixed(2) },
    { component: "GESAMT", raw: `${score.total}`, weight: "100%", points: `${score.total}` },
  ];

  // Run summary (without error messages, just counts)
  const cleanSummary: ResultsJSON["runSummary"] = {};
  for (const [p, s] of Object.entries(runSummary)) {
    cleanSummary[p] = { expected: s.expected, completed: s.completed, errorCount: s.errors.length };
  }

  // Cost estimate
  const costMap: Record<string, number> = { gemini: 0.01, perplexity: 0.03, openai: 0.05 };
  const costEstimate = Math.round(allResults.reduce((sum, r) => sum + (costMap[r.provider] || 0.03), 0) * 100) / 100;

  return {
    brand: brandName,
    vertical,
    region,
    date: new Date().toISOString().split("T")[0],
    totalRuns: allResults.length,
    expectedRuns: Object.values(runSummary).reduce((s, v) => s + v.expected, 0),
    score,
    breakdown,
    providerTable,
    topCompetitors,
    citedDomains,
    runSummary: cleanSummary,
    errors,
    costEstimate,
  };
}

// ─── Main run function ───
export async function runGeoAudit(
  auditId: string,
  signal?: AbortSignal,
): Promise<ResultsJSON> {
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

  // 3. Fetch active prompts
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

  // 5. Execute all prompt × provider combinations (batch analysis per provider)
  const allResults: RunResult[] = [];
  const errors: string[] = [];
  const runSummary: Record<string, { expected: number; completed: number; errors: string[] }> = {};

  for (const provider of providers) {
    const providerErrors: string[] = [];
    let providerCompleted = 0;

    // Gemini free tier = 5 RPM, use lower concurrency to avoid 429
    // Paid Gemini can handle more, but be conservative
    const concurrency = provider === "gemini" ? 3 : 6;

    // Phase 1: Call providers in parallel batches
    const providerResponses: {
      promptId: string;
      responseText: string;
      citations: string[];
    }[] = [];

    for (let i = 0; i < prompts.length; i += concurrency) {
      if (signal?.aborted) break;
      const batch = prompts.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (prompt) => {
          const resolvedPrompt = resolvePrompt(prompt.fields["Prompt Text"], auditConfig);
          const providerResponse = await callProvider(provider, resolvedPrompt);
          return { promptId: prompt.id, responseText: providerResponse.text, citations: providerResponse.citations || [] };
        })
      );
      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        if (r.status === "fulfilled") {
          providerResponses.push(r.value);
          providerCompleted++;
        } else {
          const errMsg = `${provider}/${batch[j].id}: ${r.reason?.message || "Unknown error"}`;
          providerErrors.push(errMsg);
          errors.push(errMsg);
        }
      }

      // Wait between batches for Gemini to respect rate limits
      if (provider === "gemini" && i + concurrency < prompts.length) {
        await new Promise((r) => setTimeout(r, 15000)); // 15s cooldown
      }
    }

    // Phase 2: Batch analyze all responses for this provider (1 Claude call)
    let analyses: Record<string, any> = {};
    if (providerResponses.length > 0) {
      try {
        analyses = await analyzeResponseBatch(
          providerResponses.map((r) => ({ id: r.promptId, text: r.responseText })),
          auditConfig.brandName,
          auditConfig.brandDomain,
          auditConfig.aliases,
        );
      } catch (err) {
        // Fallback: analyze one by one
        for (const resp of providerResponses) {
          try {
            const a = await analyzeResponse(
              resp.responseText, auditConfig.brandName, auditConfig.brandDomain, auditConfig.aliases
            );
            analyses[resp.promptId] = a;
          } catch (e) {
            errors.push(`${provider}/${resp.promptId}: analysis failed`);
          }
        }
      }
    }

    // Phase 3: Build RunResult objects
    for (const resp of providerResponses) {
      const analysis = analyses[resp.promptId] || {
        brand_mentioned: false, mention_position: 0, sentiment: "n/a",
        brand_domain_cited: false, cited_domains: [], competitors_mentioned: [],
      };
      const result: RunResult = {
        auditRecordId: auditId,
        promptRecordId: resp.promptId,
        provider,
        responseText: resp.responseText,
        brandMentioned: analysis.brand_mentioned,
        mentionPosition: analysis.mention_position,
        sentiment: analysis.sentiment,
        brandDomainCited: analysis.brand_domain_cited,
        citedDomains: [...new Set([...(resp.citations || []), ...analysis.cited_domains])],
        competitorsMentioned: analysis.competitors_mentioned,
      };
      await createRun(result);
      allResults.push(result);
    }

    runSummary[provider] = {
      expected: prompts.length,
      completed: providerCompleted,
      errors: providerErrors,
    };
  }

  // 6. Calculate score
  let weights: GeoAuditConfig;
  try {
    weights = await getConfig();
  } catch {
    weights = {
      score_weight_mention: 40, score_weight_position: 20,
      score_weight_citation: 20, score_weight_sentiment: 10, score_weight_sov: 10,
    };
  }
  const score = calculateScore(allResults, weights);

  // 7. Build Results JSON
  const resultsJSON = buildResultsJSON(
    allResults, score, brandName, vertical, region, runSummary, errors, weights,
  );

  // 8. COMPLETENESS CHECK: mark Incomplete if runs are missing without errors
  const totalCompleted = allResults.length;
  const totalErrors = errors.length;
  const isComplete = totalCompleted === expectedRuns;

  if (!isComplete) {
    // Build detailed missing-runs report
    const missingDetails: string[] = [];
    for (const [provider, summary] of Object.entries(runSummary)) {
      const missing = summary.expected - summary.completed;
      if (missing > 0) {
        missingDetails.push(`${provider}: ${summary.completed}/${summary.expected} completed (${missing} missing, ${summary.errors.length} errors)`);
      }
    }

    const statusMessage = `Incomplete: ${totalCompleted}/${expectedRuns} runs completed. ${missingDetails.join("; ")}`;

    await updateAudit(auditId, {
      Status: "Incomplete",
      "GEO Score": Math.round(score.total),
      Competitors: resultsJSON.topCompetitors.map((c) => c.name).join("\n"),
      "Results JSON": JSON.stringify(resultsJSON),
      // NO Report Token for incomplete audits
    });

    // Attach completeness info to the returned JSON
    (resultsJSON as any)._completenessError = statusMessage;
    return resultsJSON;
  }

  // 9. Audit is complete — generate report token and save
  const reportToken = crypto.randomBytes(24).toString("base64url"); // 32 chars
  await updateAudit(auditId, {
    Status: "Done",
    "GEO Score": Math.round(score.total),
    Competitors: resultsJSON.topCompetitors.map((c) => c.name).join("\n"),
    "Results JSON": JSON.stringify(resultsJSON),
    "Report Token": reportToken,
  });

  return resultsJSON;
}
