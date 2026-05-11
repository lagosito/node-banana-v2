/**
 * run_visibility.ts
 *
 * For each (prompt x model) pair: query the model, extract brand mentions,
 * record raw answers. Runs in parallel with a per-model concurrency cap and
 * exponential-backoff retries on transient failures (429 / 5xx / timeout).
 */

import pLimit from 'p-limit';
import pRetry, { AbortError } from 'p-retry';
import { getConfig } from './config';
import { child } from './logger';
import { findCompetitorMentions, findMention } from './mention';
import { buildAllProviders, ProviderClient, ProviderResponse } from './providers';
import {
  BrandDNA, BrandDNASchema, ModelAnswer, ModelName, Prompt, PromptSchema, RunStatus, VisibilityError,
} from './types';

const log = child({ module: 'run_visibility' });

export interface RunInput {
  brand: BrandDNA;
  prompts: Prompt[];
  providers?: ProviderClient[];
}

export interface RunOutput {
  brand_id: string;
  answers: ModelAnswer[];
  started_at: string;
  finished_at: string;
  summary: { total: number; success: number; error: number; timeout: number; rate_limited: number };
}

function classify(err: unknown): { status: RunStatus; message: string } {
  if (err instanceof VisibilityError) {
    if (err.code.includes('RATE_LIMIT')) return { status: 'rate_limited', message: err.message };
    return { status: 'error', message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(msg)) return { status: 'timeout', message: msg };
  if (/429|rate.?limit/i.test(msg)) return { status: 'rate_limited', message: msg };
  return { status: 'error', message: msg };
}

function isRetriable(err: unknown): boolean {
  if (err instanceof VisibilityError) return err.retriable;
  const msg = err instanceof Error ? err.message : String(err);
  return /429|5\d\d|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|abort/i.test(msg);
}

async function askWithRetry(
  provider: ProviderClient, prompt: string, maxRetries: number, timeoutMs: number,
): Promise<ProviderResponse> {
  return pRetry(
    async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        return await provider.ask(prompt, ctl.signal);
      } catch (err) {
        if (!isRetriable(err)) throw new AbortError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      retries: maxRetries,
      factor: 2,
      minTimeout: 1_000,
      maxTimeout: 30_000,
      randomize: true,
      onFailedAttempt: (err) => {
        log.warn({ provider: provider.name, attempt: err.attemptNumber, retriesLeft: err.retriesLeft, err: err.error.message }, 'retrying after failed attempt');
      },
    },
  );
}

async function runOne(
  provider: ProviderClient, prompt: Prompt, brand: BrandDNA, cfg: ReturnType<typeof getConfig>,
): Promise<ModelAnswer> {
  const started = Date.now();
  const base = {
    prompt_id: prompt.prompt_id ?? '',
    prompt_text: prompt.prompt_text,
    brand_id: brand.brand_id,
    brand_name: brand.brand_name,
    competitors: brand.competitors,
    model: provider.name,
  };

  try {
    const result = await askWithRetry(provider, prompt.prompt_text, cfg.MAX_RETRIES, cfg.REQUEST_TIMEOUT_MS);
    const mention = findMention(result.text, brand.brand_name);
    const competitorsMentioned = findCompetitorMentions(result.text, brand.competitors);

    return {
      ...base,
      full_response_text: result.text,
      citations: result.citations,
      mention_present: mention.present,
      position: mention.position,
      competitors_mentioned: competitorsMentioned,
      status: 'success' as const,
      raw_metadata: { citation_count: result.citations.length, mention_count: mention.count },
      duration_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const { status, message } = classify(err);
    log.error({ provider: provider.name, prompt_id: prompt.prompt_id, status, err: message }, 'run failed');
    return {
      ...base,
      full_response_text: '',
      citations: [],
      mention_present: false,
      position: null,
      competitors_mentioned: [],
      status,
      error_message: message,
      duration_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function runVisibility(input: RunInput): Promise<RunOutput> {
  const cfg = getConfig();
  const brand = BrandDNASchema.parse(input.brand);
  const prompts = input.prompts.map((p) => PromptSchema.parse(p));
  const providers = input.providers ?? buildAllProviders();

  if (providers.length === 0) throw new VisibilityError('No providers configured', 'NO_PROVIDERS', false);

  const startedAt = new Date().toISOString();
  log.info({ brand_id: brand.brand_id, prompts: prompts.length, providers: providers.map((p) => p.name) }, 'starting visibility run');

  const limiters = new Map<ModelName, ReturnType<typeof pLimit>>();
  for (const p of providers) limiters.set(p.name, pLimit(cfg.CONCURRENCY_PER_MODEL));

  const tasks: Promise<ModelAnswer>[] = [];
  for (const provider of providers) {
    const limiter = limiters.get(provider.name)!;
    for (const prompt of prompts) tasks.push(limiter(() => runOne(provider, prompt, brand, cfg)));
  }

  const answers = await Promise.all(tasks);
  const finishedAt = new Date().toISOString();

  const summary = {
    total: answers.length,
    success: answers.filter((a) => a.status === 'success').length,
    error: answers.filter((a) => a.status === 'error').length,
    timeout: answers.filter((a) => a.status === 'timeout').length,
    rate_limited: answers.filter((a) => a.status === 'rate_limited').length,
  };

  log.info({ brand_id: brand.brand_id, summary }, 'visibility run finished');
  return { brand_id: brand.brand_id, answers, started_at: startedAt, finished_at: finishedAt, summary };
}
