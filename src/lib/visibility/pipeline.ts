/**
 * pipeline.ts — end-to-end orchestrator + Vercel HTTP handler.
 * Mount as api/visibility/run.ts in node-banana-v2.
 */

import { generatePrompts } from './generate_prompts';
import { runVisibility } from './run_visibility';
import { scoreBrand } from './score';
import { saveAnswers, savePrompts, saveRuns, saveScore } from './storage';
import { child } from './logger';
import { BrandDNA, BrandDNASchema, BrandScore, ModelAnswer, ModelName, Prompt, RunRecord } from './types';
import { buildAllProviders } from './providers';
import type { IncomingMessage, ServerResponse } from 'node:http';

const log = child({ module: 'pipeline' });

export interface PipelineResult {
  brand_id: string;
  prompts: Prompt[];
  answers: ModelAnswer[];
  score: BrandScore;
  duration_ms: number;
}

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export async function runFullPipeline(brandInput: unknown): Promise<PipelineResult> {
  const started = Date.now();
  const brand: BrandDNA = BrandDNASchema.parse(brandInput);
  log.info({ brand_id: brand.brand_id }, 'pipeline starting');

  const promptSet = await generatePrompts(brand);
  const savedPrompts = await savePrompts(promptSet.prompts);

  const providers = buildAllProviders();
  const modelNames = providers.map((p) => p.name);

  const runRecords: RunRecord[] = [];
  for (const prompt of savedPrompts) {
    for (const model of modelNames) {
      runRecords.push({ prompt_id: prompt.prompt_id!, brand_id: brand.brand_id, timestamp: new Date().toISOString(), model, country: brand.country_code, status: 'pending' });
    }
  }
  const savedRuns = await saveRuns(runRecords);

  const runOut = await runVisibility({ brand, prompts: savedPrompts, providers });

  const runIdByKey = new Map<string, string>();
  for (const r of savedRuns) runIdByKey.set(`${r.prompt_id}:${r.model}`, r.run_id!);
  const runIdsByIndex = runOut.answers.map((a) => {
    const id = runIdByKey.get(`${a.prompt_id}:${a.model}`);
    if (!id) throw new Error(`No run_id for ${a.prompt_id}:${a.model}`);
    return id;
  });

  await saveAnswers(runOut.answers, runIdsByIndex);

  const score = await scoreBrand({
    brand_id: brand.brand_id, brand_name: brand.brand_name, competitors: brand.competitors,
    period: isoWeek(), answers: runOut.answers, prompts: savedPrompts,
  });
  await saveScore(score);

  const result: PipelineResult = { brand_id: brand.brand_id, prompts: savedPrompts, answers: runOut.answers, score, duration_ms: Date.now() - started };
  log.info({ brand_id: brand.brand_id, duration_ms: result.duration_ms, visibility_pct: score.visibility_pct }, 'pipeline finished');
  return result;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown; method?: string },
  res: ServerResponse & { json?: (data: unknown) => void; status?: (code: number) => unknown },
): Promise<void> {
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'method_not_allowed' })); return; }

  const expected = process.env.VISIBILITY_WEBHOOK_SECRET;
  const provided = req.headers['x-visibility-secret'];
  if (expected && provided !== expected) { res.statusCode = 401; res.end(JSON.stringify({ error: 'unauthorized' })); return; }

  try {
    let body = req.body;
    if (!body) {
      const chunks: Buffer[] = [];
      for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
    const result = await runFullPipeline(body);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ brand_id: result.brand_id, score: result.score, duration_ms: result.duration_ms }));
  } catch (err) {
    log.error({ err: String(err) }, 'pipeline handler error');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'pipeline_failed', message: String(err) }));
  }
}

export const config = { maxDuration: 300 };
