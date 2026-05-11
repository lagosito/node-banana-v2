import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'ai-visibility' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'apiKey',
      '*.apiKey',
      'authorization',
      '*.authorization',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'PERPLEXITY_API_KEY',
      'GEMINI_API_KEY',
      'AIRTABLE_API_KEY',
      'SUPABASE_SERVICE_KEY',
    ],
    censor: '[REDACTED]',
  },
});

export function child(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
