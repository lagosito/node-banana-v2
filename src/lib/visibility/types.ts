/**
 * Shared types for the AI Visibility Score module.
 */

import { z } from 'zod';

// ============================================================================
// Brand DNA (input from Airtable Brand DNA table)
// ============================================================================

export const BrandDNASchema = z.object({
  brand_id: z.string(), // Airtable record id, e.g. "rec123abc"
  brand_name: z.string(),
  industry: z.string(), // e.g. "Orthopädie", "Specialty Coffee"
  category: z.string(), // e.g. "Orthopädische Praxis"
  region: z.string().default('Deutschland'), // e.g. "Hamburg", "DACH"
  country_code: z.string().default('DE'),
  language: z.string().default('de'),
  competitors: z.array(z.string()).default([]),
  positioning: z.string().optional(),
  use_cases: z.array(z.string()).default([]),
  target_audience: z.string().optional(),
  website: z.string().url().optional(),
});

export type BrandDNA = z.infer<typeof BrandDNASchema>;

// ============================================================================
// Prompts
// ============================================================================

export const PromptCategorySchema = z.enum([
  'positioning',
  'comparison',
  'use_case',
  'branded',
]);
export type PromptCategory = z.infer<typeof PromptCategorySchema>;

export const PromptSchema = z.object({
  prompt_id: z.string().optional(), // assigned after Airtable insert
  brand_id: z.string(),
  prompt_text: z.string().min(5),
  category: PromptCategorySchema,
  language: z.string().default('de'),
  active: z.boolean().default(true),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const GeneratedPromptSetSchema = z.object({
  brand_id: z.string(),
  prompts: z.array(PromptSchema).length(25),
  generated_at: z.string(), // ISO timestamp
});
export type GeneratedPromptSet = z.infer<typeof GeneratedPromptSetSchema>;

// ============================================================================
// Models / Runs
// ============================================================================

export const ModelNameSchema = z.enum(['chatgpt', 'perplexity', 'gemini']);
export type ModelName = z.infer<typeof ModelNameSchema>;

export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'error',
  'timeout',
  'rate_limited',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export interface RunRecord {
  run_id?: string;
  prompt_id: string;
  brand_id: string;
  timestamp: string;
  model: ModelName;
  country: string;
  status: RunStatus;
  error_message?: string;
  duration_ms?: number;
}

// ============================================================================
// Citations & Answers
// ============================================================================

export interface Citation {
  url: string;
  title?: string;
  snippet?: string;
}

export interface ModelAnswer {
  prompt_id: string;
  prompt_text: string;
  brand_id: string;
  brand_name: string;
  competitors: string[];
  model: ModelName;
  full_response_text: string;
  citations: Citation[];
  mention_present: boolean;
  position: number | null; // 1-based position of first mention; null if not mentioned
  competitors_mentioned: string[];
  status: RunStatus;
  error_message?: string;
  raw_metadata?: Record<string, unknown>;
  duration_ms: number;
  timestamp: string;
}

// ============================================================================
// Scores
// ============================================================================

export const SentimentSchema = z.enum(['positive', 'neutral', 'negative']);
export type Sentiment = z.infer<typeof SentimentSchema>;

export interface SentimentResult {
  sentiment: Sentiment;
  score: number; // -1..1
  rationale?: string;
}

export interface BrandScore {
  brand_id: string;
  brand_name: string;
  period: string; // ISO date or YYYY-WW
  total_answers: number;
  successful_answers: number;
  mentions: number;
  visibility_pct: number; // 0..100
  position_avg: number | null;
  sentiment_avg: number; // -1..1
  sentiment_distribution: { positive: number; neutral: number; negative: number };
  share_of_voice: Record<string, number>; // brand+competitors -> percentage
  by_model: Record<ModelName, ModelBreakdown>;
  by_category: Record<PromptCategory, CategoryBreakdown>;
  generated_at: string;
}

export interface ModelBreakdown {
  total: number;
  mentions: number;
  visibility_pct: number;
  position_avg: number | null;
}

export interface CategoryBreakdown {
  total: number;
  mentions: number;
  visibility_pct: number;
}

// ============================================================================
// Errors
// ============================================================================

export class VisibilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retriable: boolean = false,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VisibilityError';
  }
}
