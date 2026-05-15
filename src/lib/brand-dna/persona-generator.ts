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

  return `You are a B2B buyer persona expert. Generate 2-4 detailed buyer personas for outreach to this company.

Company Profile:
- Name: ${dna.company_name}
- Industry: ${dna.industry}${dna.industry_sub ? ` (${dna.industry_sub})` : ''}
- Description: ${dna.description}
- Products: ${dna.products.join(', ') || 'N/A'}
- Services: ${dna.services.join(', ') || 'N/A'}
- Value Props: ${dna.value_propositions.join(', ') || 'N/A'}
- Target Audience: ${dna.target_audience}
- GTM Playbook: ${dna.gtm_playbook}
- Tone: ${dna.tone}
- Pain Points: ${dna.pain_points.join(', ') || 'N/A'}
- Competitors: ${dna.competitors.join(', ') || 'N/A'}
- Digital Maturity: ${dna.digital_maturity.score}/100 (${dna.digital_maturity.grade})
- Tech Stack: ${dna.tech_stack.raw.join(', ') || 'N/A'}
- Region: ${dna.primary_region} (${dna.primary_country})${signalContext}

For each persona, return a JSON object with:
- name: fictional but realistic name
- role: job title (be specific to the company's likely org structure)
- seniority: "C-Level" | "VP" | "Director" | "Manager" | "Individual Contributor"
- department: "Marketing" | "Sales" | "Product" | "Engineering" | "Operations" | "Finance" | "HR" | "Executive"
- age_range: e.g. "35-45"
- background: 2-3 sentence professional background
- goals: array of 3-4 professional goals
- pain_points: array of 3-4 specific pain points this persona faces daily
- buying_triggers: array of 3-4 events/situations that would make them buy
- objections: array of 3-4 likely objections to a content/marketing service
- objection_responses: array of responses matching each objection
- content_preferences: array of content types they consume (e.g. "case studies", "LinkedIn posts", "webinars")
- communication_style: how to talk to them (e.g. "data-driven, ROI-focused, no fluff")
- outreach_angle: specific hook for first contact (reference their company, industry, or recent signals)
- preferred_channels: array of outreach channels (e.g. "LinkedIn DM", "Email", "Referral")
- decision_power: "budget owner" | "influencer" | "end user" | "gatekeeper"
- estimated_budget_authority: "< €5K" | "€5-20K" | "€20-50K" | "> €50K"

Rules:
- Base personas on the actual company profile, not generic templates
- At least one persona should be a decision maker (C-Level or VP)
- At least one persona should be an end user or implementer
- Outreach angles should reference specific company details
- Pain points should be specific to their industry and digital maturity level
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
          content: 'You are a B2B buyer persona expert specializing in DACH market companies. Generate realistic, actionable personas. Return ONLY valid JSON array, no markdown.',
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
      name: p.name ?? 'Unknown',
      role: p.role ?? 'Unknown',
      seniority: p.seniority ?? 'Manager',
      department: p.department ?? 'Marketing',
      age_range: p.age_range ?? '30-40',
      background: p.background ?? '',
      goals: Array.isArray(p.goals) ? p.goals : [],
      pain_points: Array.isArray(p.pain_points) ? p.pain_points : [],
      buying_triggers: Array.isArray(p.buying_triggers) ? p.buying_triggers : [],
      objections: Array.isArray(p.objections) ? p.objections : [],
      objection_responses: Array.isArray(p.objection_responses) ? p.objection_responses : [],
      content_preferences: Array.isArray(p.content_preferences) ? p.content_preferences : [],
      communication_style: p.communication_style ?? '',
      outreach_angle: p.outreach_angle ?? '',
      preferred_channels: Array.isArray(p.preferred_channels) ? p.preferred_channels : ['LinkedIn DM', 'Email'],
      decision_power: p.decision_power ?? 'influencer',
      estimated_budget_authority: p.estimated_budget_authority ?? '< €5K',
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
