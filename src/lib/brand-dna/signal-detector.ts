/**
 * Brand DNA Signal Detector — Phase 2
 * 
 * Detects company signals (hiring, funding, news, partnerships, product launches)
 * from web sources using Tavily search + Claude analysis.
 * 
 * Ported from:
 * - ai-marketing-skills/trigger_prospector.py (signal-based prospecting patterns)
 * - opengtm/discover.py (lead discovery via search)
 * 
 * Input: BrandDNA (from Phase 1 extractor)
 * Output: CompanySignal[] with type, detail, source_url, confidence, relevance
 */

import type { BrandDNA, CompanySignal, SignalType } from './types'

// ─── Configuration ────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4'

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  return key
}

// ─── Search Provider Interface ────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
}

interface SearchProvider {
  search(query: string, maxResults?: number): Promise<SearchResult[]>
}

/**
 * Tavily search provider (via direct API call)
 * Falls back to OpenRouter web search if TAVILY_API_KEY not set
 */
class TavilySearchProvider implements SearchProvider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) {
      throw new Error(`Tavily API error ${resp.status}: ${await resp.text()}`)
    }

    const data = await resp.json()
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }))
  }
}

/**
 * DuckDuckGo fallback (no API key needed, less reliable)
 * Uses the instant answer API for basic signal detection
 */
class DuckDuckGoSearchProvider implements SearchProvider {
  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query)
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(10000) }
    )

    if (!resp.ok) return []

    const data = await resp.json()
    const results: SearchResult[] = []

    // DuckDuckGo instant answer has limited results
    if (data.AbstractText) {
      results.push({
        title: data.Heading ?? query,
        url: data.AbstractURL ?? '',
        snippet: data.AbstractText,
      })
    }

    // Related topics
    for (const topic of (data.RelatedTopics ?? []).slice(0, maxResults - 1)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.slice(0, 100),
          url: topic.FirstURL,
          snippet: topic.Text,
        })
      }
    }

    return results
  }
}

function getSearchProvider(): SearchProvider {
  const tavilyKey = process.env.TAVILY_API_KEY
  if (tavilyKey) return new TavilySearchProvider(tavilyKey)
  return new DuckDuckGoSearchProvider()
}

// ─── Signal Query Generation ──────────────────────────────────────────────

interface SignalQuery {
  type: SignalType
  query: string
  weight: number  // How much this signal type matters (0-1)
}

function generateSignalQueries(dna: BrandDNA): SignalQuery[] {
  const company = dna.company_name
  const domain = dna.domain
  const industry = dna.industry

  const queries: SignalQuery[] = [
    // Hiring signals — strong indicator of growth
    {
      type: 'hiring',
      query: `"${company}" hiring jobs careers 2025 2026`,
      weight: 0.9,
    },
    {
      type: 'hiring',
      query: `site:linkedin.com/jobs "${company}"`,
      weight: 0.85,
    },

    // Funding signals — budget available
    {
      type: 'funding',
      query: `"${company}" funding raised series investment 2025 2026`,
      weight: 1.0,
    },
    {
      type: 'funding',
      query: `"${company}" valuation seed round venture capital`,
      weight: 0.9,
    },

    // Leadership changes — new decision makers
    {
      type: 'leadership_change',
      query: `"${company}" appointed CEO CTO VP director new hire`,
      weight: 0.8,
    },

    // Product launches — may need content/marketing support
    {
      type: 'product_launch',
      query: `"${company}" launches announces new product feature`,
      weight: 0.85,
    },

    // Partnerships — expanding reach
    {
      type: 'partnership',
      query: `"${company}" partnership collaboration integrates with`,
      weight: 0.7,
    },

    // Expansion signals — entering new markets
    {
      type: 'expansion',
      query: `"${company}" expands new market international Europe`,
      weight: 0.75,
    },

    // Tech adoption — modernizing stack
    {
      type: 'tech_adoption',
      query: `"${company}" adopts implements migration technology stack`,
      weight: 0.6,
    },

    // Content activity — active marketing
    {
      type: 'content_activity',
      query: `site:${domain} blog article 2025 2026`,
      weight: 0.5,
    },
  ]

  // Add industry-specific queries
  if (industry.toLowerCase().includes('saas')) {
    queries.push({
      type: 'product_launch',
      query: `"${company}" pricing plan tier update changelog`,
      weight: 0.8,
    })
  }

  if (industry.toLowerCase().includes('e-commerce') || industry.toLowerCase().includes('ecommerce')) {
    queries.push({
      type: 'expansion',
      query: `"${company}" new collection launch sale campaign`,
      weight: 0.7,
    })
  }

  return queries
}

// ─── Signal Analysis via Claude ────────────────────────────────────────────

interface RawSignalData {
  query: SignalQuery
  results: SearchResult[]
}

async function analyzeSignalsWithClaude(
  dna: BrandDNA,
  rawData: RawSignalData[]
): Promise<CompanySignal[]> {
  const apiKey = getApiKey()

  // Build context from search results
  const context = rawData
    .filter(d => d.results.length > 0)
    .map(d => {
      const resultsText = d.results
        .map(r => `  - [${r.title}](${r.url}): ${r.snippet.slice(0, 200)}`)
        .join('\n')
      return `## Signal Type: ${d.query.type}\nQuery: "${d.query.query}"\nResults:\n${resultsText}`
    })
    .join('\n\n')

  if (!context.trim()) {
    return []
  }

  const prompt = `Analyze these search results about "${dna.company_name}" (${dna.industry}, ${dna.primary_region}) and extract actionable company signals.

${context}

For each genuine signal found, return a JSON object with:
- type: one of "funding", "hiring", "leadership_change", "product_launch", "partnership", "expansion", "tech_adoption", "content_activity"
- detail: 1-2 sentence description of what happened
- source_url: the URL where this was found
- detected_at: today's date (YYYY-MM-DD format)
- confidence: 0-1 (how confident you are this is a real, recent signal)
- relevance_score: 0-100 (how relevant this is for a content/marketing outreach)

Rules:
- Only include signals from the last 12 months
- Ignore generic/job board aggregator listings (focus on real company events)
- If no real signals found, return an empty array []
- Return ONLY valid JSON array, no markdown, no explanation`

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://elkiosk.ai',
      'X-Title': 'El Kiosko Signal Detector',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a company intelligence analyst. Extract structured signals from search results. Return ONLY valid JSON array, no markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
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

  // Parse JSON
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)

  try {
    const parsed = JSON.parse(jsonStr.trim())
    const signals = Array.isArray(parsed) ? parsed : parsed.signals ?? []

    return signals
      .filter((s: any) => s.type && s.detail)
      .map((s: any) => ({
        type: s.type as SignalType,
        detail: s.detail,
        source_url: s.source_url,
        detected_at: s.detected_at ?? new Date().toISOString().split('T')[0],
        confidence: Math.min(Math.max(Number(s.confidence) || 0.5, 0), 1),
        relevance_score: Math.min(Math.max(Number(s.relevance_score) || 50, 0), 100),
      }))
  } catch {
    return []
  }
}

// ─── Main Signal Detection Pipeline ───────────────────────────────────────

export interface SignalDetectionOptions {
  /** Brand DNA from Phase 1 extraction */
  brandDNA: BrandDNA
  /** Maximum signals to return (default: 10) */
  maxSignals?: number
  /** Minimum confidence threshold (default: 0.3) */
  minConfidence?: number
  /** Only detect specific signal types */
  signalTypes?: SignalType[]
  /** Skip search, use provided results directly (for testing) */
  rawResults?: RawSignalData[]
}

export interface SignalDetectionResult {
  signals: CompanySignal[]
  queries_executed: number
  total_results_analyzed: number
  processing_time_ms: number
}

export async function detectSignals(
  options: SignalDetectionOptions
): Promise<SignalDetectionResult> {
  const startTime = Date.now()
  const {
    brandDNA,
    maxSignals = 10,
    minConfidence = 0.3,
    signalTypes,
    rawResults,
  } = options

  // Step 1: Generate search queries
  let queries = generateSignalQueries(brandDNA)

  // Filter by requested signal types
  if (signalTypes && signalTypes.length > 0) {
    queries = queries.filter(q => signalTypes.includes(q.type))
  }

  // Step 2: Execute searches (parallel, capped at 5 concurrent)
  const searchProvider = getSearchProvider()
  let searchData: RawSignalData[]

  if (rawResults) {
    searchData = rawResults
  } else {
    // Execute top queries (limit to 6 to control API costs)
    const topQueries = queries
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)

    const searchResults = await Promise.allSettled(
      topQueries.map(async (q) => {
        const results = await searchProvider.search(q.query, 3)
        return { query: q, results }
      })
    )

    searchData = searchResults
      .filter((r): r is PromiseFulfilledResult<RawSignalData> => r.status === 'fulfilled')
      .map(r => r.value)
  }

  const totalResults = searchData.reduce((sum, d) => sum + d.results.length, 0)

  // Step 3: Analyze with Claude
  let signals: CompanySignal[] = []
  if (searchData.some(d => d.results.length > 0)) {
    signals = await analyzeSignalsWithClaude(brandDNA, searchData)
  }

  // Step 4: Filter and rank
  signals = signals
    .filter(s => s.confidence >= minConfidence)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, maxSignals)

  return {
    signals,
    queries_executed: searchData.length,
    total_results_analyzed: totalResults,
    processing_time_ms: Date.now() - startTime,
  }
}

// ─── Convenience: Extract + Detect in one call ────────────────────────────

export async function extractWithSignals(
  url: string,
  options?: {
    marketContext?: { country?: string; language?: string }
    maxSignals?: number
    signalTypes?: SignalType[]
  }
): Promise<{ brandDNA: BrandDNA; signals: CompanySignal[] }> {
  // Dynamic import to avoid circular dependency
  const { extractBrandDNA } = await import('./extractor')

  const brandDNA = await extractBrandDNA({
    url,
    marketContext: options?.marketContext,
  })

  const result = await detectSignals({
    brandDNA,
    maxSignals: options?.maxSignals,
    signalTypes: options?.signalTypes,
  })

  return { brandDNA, signals: result.signals }
}
