/**
 * Brand DNA Buyer Persona Generator — Phase 3
 * 
 * Generates detailed buyer personas from Brand DNA extraction.
 * Each persona includes: demographics, psychographics, pain points,
 * buying triggers, objection handling, content preferences, and outreach angle.
 * 
 * Input: BrandDNA (from Phase 1) + optional CompanySignal[] (from Phase 2)
 * Output: BuyerPersona[] (2-4 personas per company)
 */

import type { BrandDNA, CompanySignal, BuyerPersona } from './types'

// ─── Configuration ────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4'

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  return key
}

// ─── Prompt Construction ──────────────────────────────────────────────────

function buildPersonaPrompt(dna: BrandDNA, signals?: CompanySignal[]): string {
  const signalContext = signals && signals.length > 0
    ? `\n\nRecent company signals:\n${signals.map(s => `- [${s.type}] ${s.detail} (confidence: ${s.confidence})`).join('\n')}`
    : ''

  return `You are a consumer insights expert. Generate 2-4 ideal customer profiles for this brand's END CUSTOMERS — the people who actually buy and use their products/services. These are NOT B2B buyers or leads. These are the real consumers this brand serves.

Company Profile:
- Name: ${dna.company_name}
- Industry: ${dna.industry}${dna.industry_sub ? ` (${dna.industry_sub})` : ''}
- Description: ${dna.description}
- Brand Statement: ${dna.brand_statement || 'N/A'}
- Products: ${dna.products.join(', ') || 'N/A'}
- Services: ${dna.services.join(', ') || 'N/A'}
- Value Props: ${dna.value_propositions.join(', ') || 'N/A'}
- Target Audience: ${dna.target_audience}
- Target Audiences: ${dna.target_audiences.join(', ') || 'N/A'}
- Tone: ${dna.tone}
- Competitors: ${dna.competitors.join(', ') || 'N/A'}
- Region: ${dna.primary_region} (${dna.primary_country})${signalContext}

For each customer profile, return a JSON object with:
- type_label: a short descriptive label (e.g. "The busy professional", "The conscious family", "The digital native", "The health-conscious pet owner"). NOT a name like "Markus Weber".
- emoji: a single emoji that represents this customer type (e.g. "🏠", "👨‍👩‍👧", "🧑‍💻", "🐕")
- description: one sentence in natural language describing who they are and what matters to them. Example: "Men 30-45, mid-to-high income, shops online for convenience, values premium quality without having to research."
- age_range: e.g. "30-45"
- income_level: e.g. "mid-to-high income", "budget-conscious", "affluent"
- lifestyle: 1-2 sentences about their daily life, habits, and values as a CONSUMER
- goals: array of 3-4 things they want as consumers (NOT business goals). Example: "Keep my pet healthy with quality food", "Save time on shopping"
- pain_points: array of 3-4 things that frustrate them as CONSUMERS of this type of product/service. Example: "No time to compare different shops", "Hard to know if premium is worth the price"
- buying_triggers: array of 3-4 situations that make them buy. Example: "Running out of pet food", "Seeing a recommendation from a trusted source"
- objections: array of 3-4 things that hold them back from buying. Example: "Is the quality really better than the discounter?", "Don't want to commit to a subscription"
- preferred_channels: array of where they spend time (e.g. "Instagram", "Google Search", "YouTube", "Newsletter", "TikTok"). Consumer channels, NOT B2B outreach channels.
- content_preferences: array of content types they consume (e.g. "product reviews", "how-to videos", "comparison articles", "social media stories")

Rules:
- Think from the CONSUMER's perspective, not the company's perspective
- These are people who BUY FROM the company, not people who buy the company
- Pain points should be about their consumer experience, not about internal business problems
- NO B2B language: no "outreach", "lead", "prospect", "budget authority", "decision maker"
- NO invented names — use descriptive type labels only
- Base profiles on the actual company's target audience, products, and market
- Return ONLY valid JSON array, no markdown, no explanation`
}

// ─── Claude Persona Generation ────────────────────────────────────────────

async function generatePersonasWithClaude(prompt: string): Promise<BuyerPersona[]> {
  const apiKey = getApiKey()

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://elkiosk.ai',
      'X-Title': 'El Kiosko Persona Generator',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a consumer insights expert specializing in DACH market brands. Generate realistic ideal customer profiles that describe the END CONSUMERS of a brand — the people who buy and use their products. Return ONLY valid JSON array, no markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenRouter API error ${resp.status}: ${err}`)
  }

  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content ?? '[]'

  // Parse JSON
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)

  try {
    const parsed = JSON.parse(jsonStr.trim())
    const personas = Array.isArray(parsed) ? parsed : parsed.personas ?? []

    return personas.map((p: any) => ({
      type_label: p.type_label ?? 'The customer',
      emoji: p.emoji ?? '👤',
      description: p.description ?? '',
      age_range: p.age_range ?? '30-45',
      income_level: p.income_level ?? 'mid-income',
      lifestyle: p.lifestyle ?? '',
      goals: Array.isArray(p.goals) ? p.goals : [],
      pain_points: Array.isArray(p.pain_points) ? p.pain_points : [],
      buying_triggers: Array.isArray(p.buying_triggers) ? p.buying_triggers : [],
      objections: Array.isArray(p.objections) ? p.objections : [],
      preferred_channels: Array.isArray(p.preferred_channels) ? p.preferred_channels : ['Instagram', 'Google Search'],
      content_preferences: Array.isArray(p.content_preferences) ? p.content_preferences : [],
    }))
  } catch {
    return []
  }
}

// ─── Main Persona Generation Pipeline ─────────────────────────────────────

export interface PersonaGenerationOptions {
  /** Brand DNA from Phase 1 extraction */
  brandDNA: BrandDNA
  /** Optional signals from Phase 2 for richer outreach angles */
  signals?: CompanySignal[]
  /** Number of personas to generate (default: 2-4, controlled by Claude) */
  maxPersonas?: number
  /** Custom instructions for persona generation */
  customInstructions?: string
}

export interface PersonaGenerationResult {
  personas: BuyerPersona[]
  processing_time_ms: number
}

export async function generatePersonas(
  options: PersonaGenerationOptions
): Promise<PersonaGenerationResult> {
  const startTime = Date.now()
  const { brandDNA, signals, maxPersonas, customInstructions } = options

  // Build prompt
  let prompt = buildPersonaPrompt(brandDNA, signals)
  
  if (maxPersonas) {
    prompt += `\n\nGenerate exactly ${maxPersonas} personas.`
  }
  
  if (customInstructions) {
    prompt += `\n\nAdditional instructions: ${customInstructions}`
  }

  // Generate
  const personas = await generatePersonasWithClaude(prompt)

  return {
    personas,
    processing_time_ms: Date.now() - startTime,
  }
}

// ─── Convenience: Full Pipeline (Extract + Score + Signals + Personas) ────

export async function extractFullIntelligence(
  url: string,
  options?: {
    marketContext?: { country?: string; language?: string }
    maxSignals?: number
    maxPersonas?: number
    customInstructions?: string
  }
): Promise<{
  brandDNA: BrandDNA
  signals: CompanySignal[]
  personas: BuyerPersona[]
}> {
  // Dynamic imports to avoid circular dependency
  const { extractBrandDNA } = await import('./extractor')
  const { detectSignals } = await import('./signal-detector')

  // Phase 1: Extract Brand DNA
  const brandDNA = await extractBrandDNA({
    url,
    marketContext: options?.marketContext,
  })

  // Phase 2: Detect Signals
  const signalResult = await detectSignals({
    brandDNA,
    maxSignals: options?.maxSignals ?? 8,
  })

  // Phase 3: Generate Personas
  const personaResult = await generatePersonas({
    brandDNA,
    signals: signalResult.signals,
    maxPersonas: options?.maxPersonas,
    customInstructions: options?.customInstructions,
  })

  return {
    brandDNA,
    signals: signalResult.signals,
    personas: personaResult.personas,
  }
}
