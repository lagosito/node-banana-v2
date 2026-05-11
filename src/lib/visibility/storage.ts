/**
 * storage.ts — Airtable (signals + truncated previews) + Supabase (raw bodies).
 * Append-only: records are created or updated, never deleted.
 */

import Airtable from 'airtable';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';
import { child } from './logger';
import { BrandScore, ModelAnswer, Prompt, RunRecord } from './types';

const log = child({ module: 'storage' });

let airtableBase: Airtable.Base | null = null;

function base(): Airtable.Base {
  if (airtableBase) return airtableBase;
  const cfg = getConfig();
  airtableBase = new Airtable({ apiKey: cfg.AIRTABLE_API_KEY }).base(cfg.AIRTABLE_BASE_ID);
  return airtableBase;
}

/** Airtable create endpoint accepts up to 10 records per call. */
async function createInChunks<T extends Record<string, unknown>>(
  tableName: string, records: { fields: T }[],
): Promise<{ id: string; fields: T }[]> {
  const out: { id: string; fields: T }[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const created = await base()(tableName).create(records.slice(i, i + 10) as never);
    for (const rec of created) out.push({ id: rec.id, fields: rec.fields as T });
  }
  return out;
}

export async function savePrompts(prompts: Prompt[]): Promise<Prompt[]> {
  const cfg = getConfig();
  const records = prompts.map((p) => ({ fields: { brand_id: [p.brand_id], prompt_text: p.prompt_text, category: p.category, language: p.language, active: p.active } }));
  const created = await createInChunks(cfg.AIRTABLE_TABLE_PROMPTS, records);
  log.info({ count: created.length }, 'saved prompts to Airtable');
  return prompts.map((p, idx) => ({ ...p, prompt_id: created[idx]!.id }));
}

export async function saveRuns(runs: RunRecord[]): Promise<RunRecord[]> {
  const cfg = getConfig();
  const records = runs.map((r) => ({ fields: { prompt_id: [r.prompt_id], brand_id: [r.brand_id], timestamp: r.timestamp, model: r.model, country: r.country, status: r.status, error_message: r.error_message ?? '', duration_ms: r.duration_ms ?? 0 } }));
  const created = await createInChunks(cfg.AIRTABLE_TABLE_RUNS, records);
  return runs.map((r, idx) => ({ ...r, run_id: created[idx]!.id }));
}

const AIRTABLE_TEXT_LIMIT = 90_000;

export interface SavedAnswer { airtable_id: string; supabase_id: string; answer: ModelAnswer; }

export async function saveAnswers(answers: ModelAnswer[], runIdsByIndex: string[]): Promise<SavedAnswer[]> {
  const cfg = getConfig();
  const supa = supabase();

  const rawRows = answers.map((a, idx) => ({
    run_id: runIdsByIndex[idx], prompt_id: a.prompt_id, brand_id: a.brand_id, model: a.model,
    full_response_text: a.full_response_text, citations: a.citations,
    raw_metadata: a.raw_metadata ?? {}, timestamp: a.timestamp,
  }));

  const { data: inserted, error } = await supa.from(cfg.SUPABASE_TABLE_RAW_ANSWERS).insert(rawRows).select('id');
  if (error) { log.error({ err: error.message }, 'supabase insert failed'); throw new Error(`Supabase insert failed: ${error.message}`); }
  if (!inserted || inserted.length !== answers.length) throw new Error('Supabase insert returned unexpected row count');

  const records = answers.map((a, idx) => ({
    fields: {
      run_id: [runIdsByIndex[idx]!], supabase_raw_id: inserted[idx]!.id as string,
      full_response_text: a.full_response_text.length > AIRTABLE_TEXT_LIMIT
        ? a.full_response_text.slice(0, AIRTABLE_TEXT_LIMIT) + '\n[\u2026truncated]'
        : a.full_response_text,
      mention_present: a.mention_present, position: a.position ?? null,
      citations: a.citations.map((c) => c.url).join('\n'),
      competitors_mentioned: a.competitors_mentioned.join(', '), status: a.status,
    },
  }));

  const created = await createInChunks(cfg.AIRTABLE_TABLE_ANSWERS, records);
  log.info({ airtable: created.length, supabase: inserted.length }, 'saved answers');
  return answers.map((a, idx) => ({ airtable_id: created[idx]!.id, supabase_id: inserted[idx]!.id as string, answer: a }));
}

export async function saveScore(score: BrandScore): Promise<string> {
  const cfg = getConfig();
  const fields = {
    brand_id: [score.brand_id], period: score.period, visibility_pct: score.visibility_pct,
    position_avg: score.position_avg ?? null, sentiment_avg: score.sentiment_avg,
    share_of_voice: JSON.stringify(score.share_of_voice), by_model: JSON.stringify(score.by_model),
    by_category: JSON.stringify(score.by_category), sentiment_distribution: JSON.stringify(score.sentiment_distribution),
    total_answers: score.total_answers, successful_answers: score.successful_answers,
    mentions: score.mentions, generated_at: score.generated_at,
  };
  const [rec] = await createInChunks(cfg.AIRTABLE_TABLE_SCORES, [{ fields }]);
  log.info({ brand_id: score.brand_id, period: score.period }, 'saved score');
  return rec!.id;
}

let supabaseClient: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;
  const cfg = getConfig();
  supabaseClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  return supabaseClient;
}
