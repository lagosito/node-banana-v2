/**
 * Brand DNA Lookalike Discovery — Phase 4
 * 
 * Given a Brand DNA profile, discovers similar companies that match
 * the same ICP pattern. Useful for outbound prospecting: "find me 10
 * more companies like this one."
 * 
 * Strategy:
 * 1. Extract key attributes from Brand DNA (industry, size, tech, region)
 * 2. Generate targeted search queries
 * 3. Search + scrape candidate companies
 * 4. Score each candidate against the source DNA
 * 5. Return ranked lookalikes
 * 
 * Ported from:
 * - opengtm/discover.py (lead discovery via search)
 * - ai-marketing-skills/trigger_prospector.py (signal-based prospecting)
 */

import type { BrandDNA, ICPProfile, ICPScore } from './types'

// ─── Configuration ────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4'

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  return key
}

// ─── Search Provider (reuses signal-detector pattern) ─────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  const tavilyKey = process.env.TAVILY_API_KEY

  if (tavilyKey) {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (resp.ok) {
      const data = await resp.json()
      return (data.results ?? []).map((r: any) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
      }))
    }
  }

  // Fallback: DuckDuckGo
  const encoded = encodeURIComponent(query)
  const resp = await fetch(
    `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
    { signal: AbortSignal.timeout(10000) }
  )
  if (!resp.ok) return []
  const data = await resp.json()
  const results: SearchResult[] = []
  if (data.AbstractText) {
    results.push({ title: data.Heading ?? query, url: data.AbstractURL ?? '', snippet: data.AbstractText })
  }
  for (const topic of (data.RelatedTopics ?? []).slice(0, maxResults - 1)) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.slice(0, 100), url: topic.FirstURL, snippet: topic.Text })
    }
  }
  return results
}

// ─── Query Generation ─────────────────────────────────────────────────────

function generateLookalikeQueries(dna: BrandDNA, region?: string): string[] {
  const industry = dna.industry
  const sub = dna.industry_sub ?? ''
  const geo = region ?? dna.primary_region ?? 'DACH'
  const productType = dna.product_type

  const queries = [
    // Direct industry + geo search
    `${industry} ${sub} companies ${geo} ${productType}`.trim(),
    `${industry} ${sub} startups ${geo} 2025 2026`.trim(),

    // Competitor-adjacent search
    `companies like ${dna.competitors[0] ?? dna.company_name} ${geo}`,

    // Tech stack match (find companies using similar tools)
    ...(dna.tech_stack.crm.length > 0
      ? [`${dna.tech_stack.crm[0]} customers ${industry} ${geo}`]
      : []),
    ...(dna.tech_stack.cms.length > 0
      ? [`${dna.tech_stack.cms[0]} ${industry} websites ${geo}`]
      : []),

    // Industry directories / lists
    `top ${industry} companies ${geo} 2025 list`,
    `${industry} ${sub} SaaS directory ${geo}`,

    // Pain point search (companies with similar challenges)
    ...(dna.pain_points.length > 0
      ? [`${industry} "${dna.pain_points[0]}" ${geo} company`]
      : []),
  ]

  return queries.slice(0, 6) // Cap at 6 queries
}

// ─── Candidate Extraction via Claude ──────────────────────────────────────

interface LookalikeCandidate {
  company_name: string
  url: string
  industry: string
  description: string
  why_similar: string
  estimated_size: string
  estimated_region: string
}

async function extractCandidatesWithClaude(
  dna: BrandDNA,
  searchResults: SearchResult[]
): Promise<LookalikeCandidate[]> {
  const apiKey = getApiKey()

  const resultsText = searchResults
    .map(r => `- [${r.title}](${r.url}): ${r.snippet.slice(0, 200)}`)
    .join('\n')

  const prompt = `From these search results, extract companies that are SIMILAR to ${dna.company_name} (${dna.industry}, ${dna.product_type}, ${dna.primary_region}).

Search Results:
${resultsText}

Source Company Profile:
- Industry: ${dna.industry}${dna.industry_sub ? ` (${dna.industry_sub})` : ''}
- Type: ${dna.product_type}
- Region: ${dna.primary_region}
- Competitors: ${dna.competitors.join(', ')}
- Tech Stack: ${dna.tech_stack.raw.join(', ')}

Rules:
- Only extract REAL companies with actual websites
- Do NOT include the source company itself (${dna.company_name})
- Do NOT include major corporations (Google, Microsoft, Amazon, etc.) — focus on SMEs
- Each company must be in a similar industry or serve a similar market
- Return companies that could realistically be prospects for content/marketing services

For each company, return:
- company_name: official name
- url: website URL (must be a real, working URL)
- industry: their industry
- description: 1 sentence about what they do
- why_similar: 1 sentence explaining why they're similar to ${dna.company_name}
- estimated_size: "Startup" | "Scaleup" | "Mid-Market" | "Enterprise"
- estimated_region: country/region

Return ONLY valid JSON array, no markdown. If no good candidates found, return [].`

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://elkiosk.ai',
      'X-Title': 'El Kiosko Lookalike Discovery',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a B2B market research analyst. Extract real companies from search results. Return ONLY valid JSON array, no markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenRouter API error ${resp.status}: ${err}`)
  }

  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content ?? '[]'

  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)

  try {
    const parsed = JSON.parse(jsonStr.trim())
    const candidates = Array.isArray(parsed) ? parsed : parsed.companies ?? []

    return candidates
      .filter((c: any) => c.company_name && c.url)
      .map((c: any) => ({
        company_name: c.company_name,
        url: c.url,
        industry: c.industry ?? '',
        description: c.description ?? '',
        why_similar: c.why_similar ?? '',
        estimated_size: c.estimated_size ?? 'Unknown',
        estimated_region: c.estimated_region ?? '',
      }))
  } catch {
    return []
  }
}

// ─── Main Lookalike Discovery Pipeline ────────────────────────────────────

export interface LookalikeOptions {
  /** Source company's Brand DNA */
  brandDNA: BrandDNA
  /** Max lookalikes to return (default: 10) */
  maxResults?: number
  /** Override region for search (default: source company's region) */
  region?: string
  /** ICP profile for scoring lookalikes */
  icpProfile?: ICPProfile
}

export interface LookalikeResult {
  lookalikes: LookalikeCandidate[]
  queries_executed: number
  total_results_analyzed: number
  processing_time_ms: number
}

export async function discoverLookalikes(
  options: LookalikeOptions
): Promise<LookalikeResult> {
  const startTime = Date.now()
  const { brandDNA, maxResults = 10, region, icpProfile } = options

  // Step 1: Generate search queries
  const queries = generateLookalikeQueries(brandDNA, region)

  // Step 2: Execute searches (parallel)
  const searchResults = await Promise.allSettled(
    queries.map(q => searchWeb(q, 5))
  )

  const allResults = searchResults
    .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  // Deduplicate by URL
  const seen = new Set<string>()
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })

  // Step 3: Extract candidates via Claude
  let candidates = await extractCandidatesWithClaude(brandDNA, uniqueResults)

  // Step 4: Filter out the source company itself
  candidates = candidates.filter(c =>
    c.company_name.toLowerCase() !== brandDNA.company_name.toLowerCase() &&
    c.url !== brandDNA.company_url
  )

  // Step 5: Limit
  candidates = candidates.slice(0, maxResults)

  return {
    lookalikes: candidates,
    queries_executed: queries.length,
    total_results_analyzed: uniqueResults.length,
    processing_time_ms: Date.now() - startTime,
  }
}

// ─── Convenience: Full Intelligence + Lookalikes ──────────────────────────

export async function extractWithLookalikes(
  url: string,
  options?: {
    marketContext?: { country?: string; language?: string }
    maxLookalikes?: number
    region?: string
  }
): Promise<{
  brandDNA: BrandDNA
  lookalikes: LookalikeCandidate[]
}> {
  const { extractBrandDNA } = await import('./extractor')

  const brandDNA = await extractBrandDNA({
    url,
    marketContext: options?.marketContext,
  })

  const result = await discoverLookalikes({
    brandDNA,
    maxResults: options?.maxLookalikes ?? 10,
    region: options?.region,
  })

  return { brandDNA, lookalikes: result.lookalikes }
}
