/**
 * Brand DNA API Routes
 * 
 * POST /api/brand-dna              — Extract Brand DNA from URL
 * POST /api/brand-dna (signals)    — Brand DNA + Signal Detection
 * POST /api/brand-dna (personas)   — Brand DNA + Buyer Personas
 * POST /api/brand-dna (lookalikes) — Brand DNA + Lookalike Discovery
 * POST /api/brand-dna (full)       — Full Intelligence Pipeline
 * GET  /api/brand-dna              — Health check
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractBrandDNA } from '@/lib/brand-dna/extractor'
import { scoreICP, DEFAULT_ICP } from '@/lib/brand-dna/scorer'
import { detectSignals } from '@/lib/brand-dna/signal-detector'
import { generatePersonas, extractFullIntelligence } from '@/lib/brand-dna/persona-generator'
import { discoverLookalikes } from '@/lib/brand-dna/lookalike-discovery'
import type { ICPProfile, SignalType } from '@/lib/brand-dna/types'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

function corsJson(data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, init)
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    const body = await req.json()
    const { 
      url, 
      market_context, 
      icp_profile, 
      include_signals = false,
      include_personas = false,
      include_lookalikes = false,
      signal_types,
      max_signals = 10,
      max_personas,
      max_lookalikes = 10,
      lookalike_region,
      persona_instructions,
      include_tech_stack = true,
      full_pipeline = false,
    } = body

    if (!url || typeof url !== 'string') {
      return corsJson(
        { error: 'Missing required field: url (string)' },
        { status: 400 }
      )
    }

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`

    // Full pipeline shortcut
    if (full_pipeline || (include_signals && include_personas)) {
      const result = await extractFullIntelligence(normalizedUrl, {
        marketContext: market_context,
        maxSignals: max_signals,
        maxPersonas: max_personas,
        customInstructions: persona_instructions,
      })

      const icp: ICPProfile = icp_profile ?? DEFAULT_ICP
      const icpScore = scoreICP(result.brandDNA, icp)

      // Optional lookalikes in full pipeline
      let lookalikes = undefined
      if (include_lookalikes) {
        const lookalikeResult = await discoverLookalikes({
          brandDNA: result.brandDNA,
          maxResults: max_lookalikes,
          region: lookalike_region,
        })
        lookalikes = lookalikeResult.lookalikes
      }

      return corsJson({
        brand_dna: result.brandDNA,
        icp_score: icpScore,
        signals: result.signals,
        personas: result.personas,
        ...(lookalikes && { lookalikes }),
        processing_time_ms: Date.now() - startTime,
      })
    }

    // Step 1: Extract Brand DNA
    const brandDNA = await extractBrandDNA({
      url: normalizedUrl,
      marketContext: market_context,
      includeTechStack: include_tech_stack,
    })

    // Step 2: Score against ICP
    const icp: ICPProfile = icp_profile ?? DEFAULT_ICP
    const icpScore = scoreICP(brandDNA, icp)

    // Step 3 (optional): Detect signals
    let signals = undefined
    let signalMeta = undefined
    if (include_signals) {
      const signalResult = await detectSignals({
        brandDNA,
        maxSignals: max_signals,
        signalTypes: signal_types as SignalType[] | undefined,
      })
      signals = signalResult.signals
      signalMeta = {
        queries_executed: signalResult.queries_executed,
        total_results_analyzed: signalResult.total_results_analyzed,
      }
    }

    // Step 4 (optional): Generate personas
    let personas = undefined
    if (include_personas) {
      const personaResult = await generatePersonas({
        brandDNA,
        signals,
        maxPersonas: max_personas,
        customInstructions: persona_instructions,
      })
      personas = personaResult.personas
    }

    // Step 5 (optional): Discover lookalikes
    let lookalikes = undefined
    if (include_lookalikes) {
      const lookalikeResult = await discoverLookalikes({
        brandDNA,
        maxResults: max_lookalikes,
        region: lookalike_region,
      })
      lookalikes = lookalikeResult.lookalikes
    }

    const processingTime = Date.now() - startTime

    return corsJson({
      brand_dna: brandDNA,
      icp_score: icpScore,
      ...(signals && { signals }),
      ...(signalMeta && { signal_meta: signalMeta }),
      ...(personas && { personas }),
      ...(lookalikes && { lookalikes }),
      processing_time_ms: processingTime,
    })
  } catch (error: any) {
    console.error('[brand-dna] Error:', error)

    if (error.message?.includes('OPENROUTER_API_KEY')) {
      return corsJson(
        { error: 'Server configuration error: missing API key' },
        { status: 500 }
      )
    }

    if (error.message?.includes('JSON')) {
      return corsJson(
        { error: 'Failed to parse AI response. Please try again.' },
        { status: 502 }
      )
    }

    return corsJson(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    service: 'brand-dna-pipeline',
    version: '4.0.0',
    status: 'ok',
    endpoints: {
      'POST /api/brand-dna': 'Extract Brand DNA from URL',
      'POST /api/brand-dna (include_signals: true)': 'Brand DNA + Signal Detection',
      'POST /api/brand-dna (include_personas: true)': 'Brand DNA + Buyer Personas',
      'POST /api/brand-dna (include_lookalikes: true)': 'Brand DNA + Lookalike Companies',
      'POST /api/brand-dna (full_pipeline: true)': 'Full Intelligence: DNA + Signals + Personas + Lookalikes',
    },
    features: {
      brand_dna_extraction: true,
      icp_scoring: true,
      signal_detection: true,
      buyer_persona_generation: true,
      lookalike_discovery: true,
      tech_stack_detection: true,
      digital_maturity: true,
      full_pipeline: true,
    },
  })
}
