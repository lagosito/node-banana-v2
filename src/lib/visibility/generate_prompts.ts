/**
 * generate_prompts.ts
 *
 * Generates 25 German-language search prompts for a Brand DNA record.
 * Distribution: 10 positioning, 5 comparison, 7 use_case, 3 branded.
 * Uses Claude to produce varied, natural-sounding prompts and deduplicates.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config';
import { child } from './logger';
import {
  BrandDNA, BrandDNASchema, GeneratedPromptSet, Prompt, PromptCategory, VisibilityError,
} from './types';

const log = child({ module: 'generate_prompts' });

interface CategoryTarget {
  category: PromptCategory;
  count: number;
  instructions: string;
}

const CATEGORY_TARGETS: readonly CategoryTarget[] = [
  {
    category: 'positioning',
    count: 10,
    instructions: `Generate 10 GERMAN positioning queries that a real person would type into ChatGPT/Perplexity/Gemini when looking for a provider in this category. Mix:
- "Welche [category] gibt es in [region]?"
- "Beste [category] [region]"
- "[category] Empfehlung [region]"
- "Top [category] [region] 2026"
- Variations with "in der N\u00e4he", "Vergleich", "\u00dcbersicht"
DO NOT mention the brand name. Vary phrasing.`,
  },
  {
    category: 'comparison',
    count: 5,
    instructions: `Generate 5 GERMAN comparison queries pitting the brand against named competitors.
Examples:
- "[brand] vs [competitor] - was ist besser?"
- "Unterschied zwischen [brand] und [competitor]"
- "[brand] oder [competitor] - Erfahrungen"`,
  },
  {
    category: 'use_case',
    count: 7,
    instructions: `Generate 7 GERMAN use-case queries combining the category with specific use cases / pain points / target audiences.
Examples:
- "Beste [category] f\u00fcr [use_case]"
- "[category] bei [problem]"
- "Welche [category] empfehlen sich f\u00fcr [audience]?"`,
  },
  {
    category: 'branded',
    count: 3,
    instructions: `Generate 3 GERMAN branded queries explicitly mentioning the brand:
- "Was ist [brand]?"
- "[brand] Erfahrungen / Bewertungen / Test"
- "Ist [brand] seri\u00f6s / empfehlenswert?"`,
  },
] as const;

const SYSTEM_PROMPT = `Du bist ein SEO- und LLM-Visibility-Experte f\u00fcr den DACH-Markt. Du generierst realistische, nat\u00fcrliche deutsche Suchanfragen, die echte Nutzer an ChatGPT, Perplexity oder Gemini stellen w\u00fcrden.

Regeln:
- IMMER Deutsch (au\u00dfer Markennamen).
- Keine Anf\u00fchrungszeichen um die Anfragen.
- Keine Nummerierung.
- Eine Anfrage pro Zeile.
- Keine Erkl\u00e4rungen, nur die rohen Anfragen.`;

function buildUserPrompt(brand: BrandDNA, target: CategoryTarget): string {
  const competitorList = brand.competitors.length > 0
    ? brand.competitors.join(', ')
    : '(keine bekannten Wettbewerber \u2014 generische Alternativen verwenden)';
  const useCaseList = brand.use_cases.length > 0
    ? brand.use_cases.join(', ')
    : '(aus Branche ableiten)';

  return `BRAND DNA:
- Marke: ${brand.brand_name}
- Branche: ${brand.industry}
- Kategorie: ${brand.category}
- Region: ${brand.region}
- Wettbewerber: ${competitorList}
- Use Cases: ${useCaseList}
- Positionierung: ${brand.positioning ?? '(nicht angegeben)'}
- Zielgruppe: ${brand.target_audience ?? '(nicht angegeben)'}

AUFGABE:
${target.instructions}

Gib genau ${target.count} Anfragen aus, eine pro Zeile, ohne Nummerierung.`;
}

function parsePrompts(rawText: string, expected: number): string[] {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .map((l) => l.replace(/^[-*\u2022\d.)\s]+/, '').replace(/^["'\u201e\u00bb]|["'\u201c\u00ab]$/g, ''))
    .filter((l) => l.length >= 5);

  if (lines.length < expected) {
    throw new VisibilityError(
      `Claude returned ${lines.length} prompts, expected ${expected}`,
      'PROMPT_COUNT_MISMATCH',
      true,
    );
  }
  return lines.slice(0, expected);
}

function dedupe(prompts: Prompt[]): Prompt[] {
  const seen = new Set<string>();
  const out: Prompt[] = [];
  for (const p of prompts) {
    const key = p.prompt_text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) { log.warn({ duplicate: p.prompt_text }, 'duplicate prompt removed'); continue; }
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function generateForCategory(
  client: Anthropic, brand: BrandDNA, target: CategoryTarget, model: string,
): Promise<Prompt[]> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(brand, target) }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new VisibilityError('Claude returned no text content', 'CLAUDE_NO_TEXT', true);
  }

  const lines = parsePrompts(textBlock.text, target.count);
  return lines.map<Prompt>((prompt_text) => ({
    brand_id: brand.brand_id, prompt_text, category: target.category, language: brand.language, active: true,
  }));
}

async function topUpCategory(
  client: Anthropic, brand: BrandDNA, target: CategoryTarget, existing: Prompt[], model: string,
): Promise<Prompt[]> {
  const missing = target.count - existing.length;
  if (missing <= 0) return existing;
  log.warn({ category: target.category, missing }, 'topping up category after dedup');
  const extra = await generateForCategory(client, brand, { ...target, count: missing + 2 }, model);
  return dedupe([...existing, ...extra]).slice(0, target.count);
}

export async function generatePrompts(brandInput: unknown): Promise<GeneratedPromptSet> {
  const brand = BrandDNASchema.parse(brandInput);
  const cfg = getConfig();
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });

  log.info({ brand_id: brand.brand_id, brand_name: brand.brand_name }, 'generating prompts');

  const results = await Promise.all(
    CATEGORY_TARGETS.map((target) =>
      generateForCategory(client, brand, target, cfg.ANTHROPIC_MODEL).catch((err) => {
        log.error({ category: target.category, err: String(err) }, 'category generation failed');
        throw err;
      }),
    ),
  );

  const finalPerCategory = await Promise.all(
    results.map((prompts, idx) => {
      const target = CATEGORY_TARGETS[idx]!;
      return topUpCategory(client, brand, target, dedupe(prompts), cfg.ANTHROPIC_MODEL);
    }),
  );

  const allPrompts = dedupe(finalPerCategory.flat());

  if (allPrompts.length !== 25) {
    throw new VisibilityError(`Final prompt count is ${allPrompts.length}, expected 25`, 'FINAL_COUNT_MISMATCH', false);
  }

  const set: GeneratedPromptSet = { brand_id: brand.brand_id, prompts: allPrompts, generated_at: new Date().toISOString() };
  log.info({ brand_id: brand.brand_id, total: allPrompts.length }, 'prompts generated successfully');
  return set;
}
