import { z } from 'zod';

const ConfigSchema = z.object({
  // AI providers — only ANTHROPIC and GEMINI are strictly required
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.5'),

  PERPLEXITY_API_KEY: z.string().optional(),
  PERPLEXITY_MODEL: z.string().default('sonar'),

  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // Storage
  AIRTABLE_API_KEY: z.string().min(1),
  AIRTABLE_BASE_ID: z.string().default('appuXgF7lJxG52Tqd'),
  AIRTABLE_TABLE_PROMPTS: z.string().default('prompts'),
  AIRTABLE_TABLE_RUNS: z.string().default('runs'),
  AIRTABLE_TABLE_ANSWERS: z.string().default('answers'),
  AIRTABLE_TABLE_SCORES: z.string().default('scores'),
  AIRTABLE_TABLE_BRAND_DNA: z.string().default('Brand DNA'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_TABLE_RAW_ANSWERS: z.string().default('visibility_raw_answers'),

  // Rate limiting
  CONCURRENCY_PER_MODEL: z.coerce.number().int().min(1).max(20).default(4),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  MAX_RETRIES: z.coerce.number().int().default(4),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;

  // Map env vars that might have different names in Vercel
  const env: Record<string, string | undefined> = { ...process.env };
  if (!env.SUPABASE_SERVICE_KEY && env.SUPABASE_SERVICE_ROLE_KEY) {
    env.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  }
  // Convert undefined to empty string for optional fields
  if (!env.OPENAI_API_KEY) env.OPENAI_API_KEY = '';
  if (!env.PERPLEXITY_API_KEY) env.PERPLEXITY_API_KEY = '';

  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
