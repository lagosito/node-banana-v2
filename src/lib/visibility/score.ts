/**
 * score.ts — aggregates per-answer signals into brand-level KPIs.
 * Sentiment uses Claude as judge over short snippets (NOT full response text).
 */

import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { getConfig } from './config';
import { child } from './logger';
import { brandRegex } from './mention';
import {
  BrandScore, CategoryBreakdown, ModelAnswer, ModelBreakdown,
  ModelName, Prompt, PromptCategory, Sentiment, SentimentResult,
} from './types';

const log = child({ module: 'score' });

const ALL_MODELS: readonly ModelName[] = ['chatgpt', 'perplexity', 'gemini'];
const ALL_CATEGORIES: readonly PromptCategory[] = ['positioning', 'comparison', 'use_case', 'branded'];
const SENTIMENT_VALUE: Record<Sentiment, number> = { positive: 1, neutral: 0, negative: -1 };

function extractSnippet(text: string, brandName: string, ctxChars = 240): string | null {
  const re = brandRegex(brandName);
  const match = re.exec(text);
  if (!match) return null;
  const start = Math.max(0, match.index - ctxChars);
  const end = Math.min(text.length, match.index + match[0].length + ctxChars);
  return text.slice(start, end).trim();
}

const SENTIMENT_SYSTEM = `You are a precise sentiment classifier. You will receive a short snippet from an AI assistant's answer that mentions a brand. Classify the sentiment toward THAT brand only. Output strictly JSON: {"sentiment":"positive"|"neutral"|"negative","rationale":"<one short sentence>"}.

Rules:
- "positive" = recommends, praises, lists as a top option, highlights strengths
- "neutral" = mentions factually without endorsement
- "negative" = warns against, lists weaknesses, ranks below alternatives explicitly`;

async function judgeSentiment(
  client: Anthropic, model: string, snippet: string, brandName: string,
): Promise<SentimentResult> {
  const resp = await client.messages.create({
    model, max_tokens: 200, system: SENTIMENT_SYSTEM,
    messages: [{ role: 'user', content: `Brand: ${brandName}\n\nSnippet:\n"""\n${snippet}\n"""\n\nReturn ONLY the JSON.` }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return { sentiment: 'neutral', score: 0, rationale: 'no judge response' };
  const cleaned = block.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { sentiment?: string; rationale?: string };
    const sentiment = (parsed.sentiment ?? 'neutral').toLowerCase() as Sentiment;
    if (!['positive', 'neutral', 'negative'].includes(sentiment)) return { sentiment: 'neutral', score: 0 };
    return { sentiment, score: SENTIMENT_VALUE[sentiment], rationale: parsed.rationale };
  } catch {
    return { sentiment: 'neutral', score: 0, rationale: 'parse error' };
  }
}

export interface ScoreInput {
  brand_id: string;
  brand_name: string;
  competitors: string[];
  period: string;
  answers: ModelAnswer[];
  prompts?: Prompt[];
}

export async function scoreBrand(input: ScoreInput): Promise<BrandScore> {
  const cfg = getConfig();
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });

  const successAnswers = input.answers.filter((a) => a.status === 'success');
  const totalAnswers = input.answers.length;
  const successCount = successAnswers.length;
  const mentioning = successAnswers.filter((a) => a.mention_present);
  const mentions = mentioning.length;

  const visibility_pct = successCount > 0 ? round2((mentions / successCount) * 100) : 0;
  const positions = mentioning.map((a) => a.position).filter((p): p is number => typeof p === 'number');
  const position_avg = positions.length > 0 ? round2(mean(positions)) : null;

  // Share of voice
  const sovCounts: Record<string, number> = { [input.brand_name]: 0 };
  for (const c of input.competitors) sovCounts[c] = 0;
  for (const a of successAnswers) {
    if (a.mention_present) sovCounts[input.brand_name]! += 1;
    for (const c of a.competitors_mentioned) { if (c in sovCounts) sovCounts[c]! += 1; }
  }
  const sovTotal = Object.values(sovCounts).reduce((s, v) => s + v, 0);
  const share_of_voice: Record<string, number> = {};
  for (const [name, count] of Object.entries(sovCounts)) {
    share_of_voice[name] = sovTotal > 0 ? round2((count / sovTotal) * 100) : 0;
  }

  // Sentiment via LLM judge
  const limit = pLimit(cfg.CONCURRENCY_PER_MODEL);
  const sentimentResults = await Promise.all(
    mentioning.map((a) => limit(async () => {
      const snippet = extractSnippet(a.full_response_text, input.brand_name);
      if (!snippet) return null;
      return judgeSentiment(client, cfg.ANTHROPIC_MODEL, snippet, input.brand_name);
    })),
  );
  const validSentiments = sentimentResults.filter((r): r is SentimentResult => r !== null);
  const sentiment_avg = validSentiments.length > 0 ? round2(mean(validSentiments.map((s) => s.score))) : 0;
  const sentiment_distribution = {
    positive: validSentiments.filter((s) => s.sentiment === 'positive').length,
    neutral: validSentiments.filter((s) => s.sentiment === 'neutral').length,
    negative: validSentiments.filter((s) => s.sentiment === 'negative').length,
  };

  // By model
  const by_model = {} as Record<ModelName, ModelBreakdown>;
  for (const m of ALL_MODELS) {
    const subset = successAnswers.filter((a) => a.model === m);
    const subMentions = subset.filter((a) => a.mention_present);
    const subPositions = subMentions.map((a) => a.position).filter((p): p is number => typeof p === 'number');
    by_model[m] = {
      total: subset.length, mentions: subMentions.length,
      visibility_pct: subset.length > 0 ? round2((subMentions.length / subset.length) * 100) : 0,
      position_avg: subPositions.length > 0 ? round2(mean(subPositions)) : null,
    };
  }

  // By category
  const categoryByPromptId = new Map<string, PromptCategory>();
  for (const p of input.prompts ?? []) { if (p.prompt_id) categoryByPromptId.set(p.prompt_id, p.category); }
  const by_category = {} as Record<PromptCategory, CategoryBreakdown>;
  for (const cat of ALL_CATEGORIES) {
    const subset = successAnswers.filter((a) => categoryByPromptId.get(a.prompt_id) === cat);
    const subMentions = subset.filter((a) => a.mention_present);
    by_category[cat] = {
      total: subset.length, mentions: subMentions.length,
      visibility_pct: subset.length > 0 ? round2((subMentions.length / subset.length) * 100) : 0,
    };
  }

  const score: BrandScore = {
    brand_id: input.brand_id, brand_name: input.brand_name, period: input.period,
    total_answers: totalAnswers, successful_answers: successCount, mentions,
    visibility_pct, position_avg, sentiment_avg, sentiment_distribution,
    share_of_voice, by_model, by_category, generated_at: new Date().toISOString(),
  };

  log.info({ brand_id: input.brand_id, visibility_pct, position_avg, sentiment_avg, mentions }, 'brand scored');
  return score;
}

function mean(xs: number[]): number { return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length; }
function round2(x: number): number { return Math.round(x * 100) / 100; }
