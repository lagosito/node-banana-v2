/**
 * ICP Scorer — Explainable 6-dimension scoring engine
 * 
 * Ported from opengtm/qualify.py with adaptations for El Kiosko.
 * 
 * Scoring dimensions (0-100 total):
 * 1. Company Size Fit (0-20)
 * 2. Industry Fit (0-25)
 * 3. Digital Maturity (0-15)
 * 4. Pain Signals (0-20)
 * 5. Revenue Signals (0-10)
 * 6. Content Quality (0-10)
 */

import type { BrandDNA, ICPProfile, ICPScore } from './types'

// ─── Default ICP Profile for El Kiosko (DACH SMEs) ────────────────────────

export const DEFAULT_ICP: ICPProfile = {
  name: 'DACH SME',
  top_industries: [
    'SaaS', 'E-commerce', 'Professional Services', 'Manufacturing',
    'Healthcare', 'Fintech', 'Education', 'Real Estate', 'Hospitality',
    'B2B Services', 'Agency', 'Consulting',
  ],
  ideal_company_size: { min: 10, max: 500 },
  target_product_types: ['SaaS', 'Platform', 'Agency', 'E-commerce', 'Service'],
  pain_weight: 1.0,
  require_blog: false,
  geo_focus: ['DE', 'AT', 'CH'],
  anti_icp: ['Crypto/Web3', 'Gambling', 'Adult', 'Tobacco'],
}

// ─── Industry Tier Scoring ────────────────────────────────────────────────

const INDUSTRY_TIERS: Record<string, number> = {
  'saas': 25, 'software': 25, 'platform': 24,
  'e-commerce': 23, 'ecommerce': 23, 'retail': 20,
  'professional services': 22, 'consulting': 22, 'agency': 22,
  'b2b services': 21, 'services': 18,
  'manufacturing': 20, 'healthcare': 20, 'fintech': 20,
  'education': 18, 'edtech': 18,
  'real estate': 17, 'hospitality': 16,
  'media': 15, 'publishing': 15,
  'ai/ml': 22, 'artificial intelligence': 22,
  'marketing': 20, 'advertising': 18,
  'food & beverage': 14, 'fitness': 14,
  'nonprofit': 10, 'government': 8,
}

// ─── Scoring Functions ────────────────────────────────────────────────────

function scoreCompanySize(dna: BrandDNA, icp: ICPProfile): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Digital maturity as proxy for company size
  const dm = dna.digital_maturity.score

  // Blog presence suggests established company
  if (dna.digital_maturity.breakdown.has_blog) {
    score += 6
    reasons.push('Blog present → likely established (+6)')
  }

  // Social presence
  if (dna.digital_maturity.breakdown.has_social_links) {
    score += 4
    reasons.push('Social links present (+4)')
  }

  // Site complexity (multiple pages suggest larger company)
  if (dna.products.length + dna.services.length > 5) {
    score += 4
    reasons.push(`${dna.products.length + dna.services.length} products/services → likely mid-market (+4)`)
  }

  // CRM/Marketing tools suggest operational maturity
  if (dna.tech_stack.crm.length > 0) {
    score += 3
    reasons.push(`CRM detected (${dna.tech_stack.crm[0]}) → operational maturity (+3)`)
  }

  // GTM playbook suggests structured company
  if (dna.gtm_playbook && dna.gtm_playbook !== 'Unknown') {
    score += 3
    reasons.push(`GTM playbook: ${dna.gtm_playbook} (+3)`)
  }

  return { score: Math.min(score, 20), reasons }
}

function scoreIndustryFit(dna: BrandDNA, icp: ICPProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const industryLower = dna.industry.toLowerCase()

  // Check anti-ICP first
  if (icp.anti_icp.some(a => industryLower.includes(a.toLowerCase()))) {
    reasons.push(`Industry "${dna.industry}" is in anti-ICP list → 0`)
    return { score: 0, reasons }
  }

  // Tiered scoring
  let score = 0
  for (const [keyword, tierScore] of Object.entries(INDUSTRY_TIERS)) {
    if (industryLower.includes(keyword)) {
      score = Math.max(score, tierScore)
      reasons.push(`Industry "${dna.industry}" matches "${keyword}" → ${tierScore}/25`)
      break
    }
  }

  // Sub-industry bonus
  if (dna.industry_sub && score > 0) {
    score = Math.min(score + 2, 25)
    reasons.push(`Sub-industry "${dna.industry_sub}" → +2`)
  }

  if (score === 0) {
    score = 5
    reasons.push(`Industry "${dna.industry}" not in tier list → baseline 5/25`)
  }

  // Geo bonus
  if (icp.geo_focus && icp.geo_focus.includes(dna.primary_country)) {
    score = Math.min(score + 3, 25)
    reasons.push(`Geo match (${dna.primary_country}) → +3`)
  }

  return { score: Math.min(score, 25), reasons }
}

function scoreDigitalMaturity(dna: BrandDNA): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const dm = dna.digital_maturity

  // Map 0-100 maturity score to 0-15
  let score = Math.round(dm.score * 0.15)
  reasons.push(`Digital maturity ${dm.score}/100 (grade ${dm.grade}) → ${score}/15`)

  // Penalty for critical gaps
  if (dm.gaps.includes('could not fetch website')) {
    score = 0
    reasons.push('Website unreachable → 0/15')
  }

  return { score: Math.min(Math.max(score, 0), 15), reasons }
}

function scorePainSignals(dna: BrandDNA, icp: ICPProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // Each pain point detected
  const painCount = dna.pain_points.length
  if (painCount > 0) {
    const painScore = Math.min(painCount * 4, 12)
    score += painScore
    reasons.push(`${painCount} pain points detected → +${painScore}`)
  }

  // Marketing gaps = pain signals for content services
  const gapCount = dna.digital_maturity.gaps.length
  if (gapCount > 0) {
    const gapScore = Math.min(gapCount * 2, 8)
    score += gapScore
    reasons.push(`${gapCount} digital gaps → +${gapScore}`)
  }

  // Apply pain weight
  score = Math.round(score * icp.pain_weight)

  return { score: Math.min(score, 20), reasons }
}

function scoreRevenueSignals(dna: BrandDNA): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // Pricing model detected
  if (dna.pricing_model && dna.pricing_model !== 'Unknown') {
    score += 3
    reasons.push(`Pricing model: ${dna.pricing_model} (+3)`)
  }

  // Multiple products = revenue diversification
  if (dna.products.length >= 2) {
    score += 3
    reasons.push(`${dna.products.length} products → diversified revenue (+3)`)
  }

  // Paid tools detected
  if (dna.tech_stack.crm.length > 0 || dna.tech_stack.marketing.length > 0) {
    score += 2
    reasons.push('Paid CRM/Marketing tools → has budget (+2)')
  }

  // Modern infrastructure = tech investment
  if (dna.tech_stack.infrastructure.length > 0) {
    score += 2
    reasons.push(`Infrastructure: ${dna.tech_stack.infrastructure.join(', ')} (+2)`)
  }

  return { score: Math.min(score, 10), reasons }
}

function scoreContentQuality(dna: BrandDNA): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // Content themes detected
  if (dna.content_themes.length > 0) {
    score += Math.min(dna.content_themes.length * 2, 6)
    reasons.push(`${dna.content_themes.length} content themes → +${Math.min(dna.content_themes.length * 2, 6)}`)
  }

  // Blog present
  if (dna.digital_maturity.breakdown.has_blog) {
    score += 2
    reasons.push('Blog present (+2)')
  }

  // Rich content
  if (dna.digital_maturity.breakdown.content_quality === 'rich') {
    score += 2
    reasons.push('Rich homepage content (+2)')
  }

  return { score: Math.min(score, 10), reasons }
}

// ─── Main Scoring Function ────────────────────────────────────────────────

export function scoreICP(dna: BrandDNA, icp: ICPProfile = DEFAULT_ICP): ICPScore {
  const companySize = scoreCompanySize(dna, icp)
  const industryFit = scoreIndustryFit(dna, icp)
  const digitalMaturity = scoreDigitalMaturity(dna)
  const painSignals = scorePainSignals(dna, icp)
  const revenueSignals = scoreRevenueSignals(dna)
  const contentQuality = scoreContentQuality(dna)

  const total = companySize.score + industryFit.score + digitalMaturity.score
    + painSignals.score + revenueSignals.score + contentQuality.score

  const tier: ICPScore['tier'] = total >= 70 ? 'hot' : total >= 40 ? 'warm' : 'cold'

  const recommendedAction = tier === 'hot'
    ? 'Prioritize outreach. High ICP fit — personalize and engage immediately.'
    : tier === 'warm'
    ? 'Monitor and nurture. Moderate fit — enrich further before outreach.'
    : 'Low priority. Poor ICP fit — deprioritize or revisit criteria.'

  return {
    total,
    tier,
    breakdown: {
      company_size: { ...companySize, max: 20 },
      industry_fit: { ...industryFit, max: 25 },
      digital_maturity: { ...digitalMaturity, max: 15 },
      pain_signals: { ...painSignals, max: 20 },
      revenue_signals: { ...revenueSignals, max: 10 },
      content_quality: { ...contentQuality, max: 10 },
    },
    recommended_action: recommendedAction,
    icp_profile_used: icp.name,
  }
}
