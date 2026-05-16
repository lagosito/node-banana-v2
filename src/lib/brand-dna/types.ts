/**
 * Brand DNA Pipeline — Type Definitions
 * 
 * Data model for company intelligence extraction from URL.
 * Inspired by opengtm's context.py + ai-marketing-skills' account-researcher.py
 */

// ─── Core Company Context ─────────────────────────────────────────────────

export interface BrandDNA {
  // Identity
  company_name: string
  company_url: string
  domain: string
  description: string
  
  // Classification
  industry: string
  industry_sub?: string
  product_type: string  // SaaS, API, Platform, Marketplace, Agency, E-commerce, etc.
  company_stage?: string  // Startup, Scaleup, Growth, Enterprise
  
  // Offerings
  products: string[]
  services: string[]
  value_propositions: string[]
  use_cases: string[]
  
  // Market
  target_audience: string
  target_audiences: string[]
  primary_region: string
  primary_country: string
  primary_language: string
  
  // Competitive Landscape
  competitors: string[]
  competitor_categories: string[]
  
  // Brand Voice
  tone: string  // professional, casual, technical, friendly, authoritative, etc.
  
  // Pain & Opportunity
  pain_points: string[]
  content_themes: string[]
  
  // GTM Intelligence
  gtm_playbook: string  // PLG, Sales-led, Marketing-led, Community-led, Hybrid
  pricing_model?: string  // Freemium, Subscription, Usage-based, One-time, Custom
  
  // Digital Maturity (from account-researcher.py pattern)
  digital_maturity: DigitalMaturity
  
  // Tech Stack (from collect_builtwith pattern)
  tech_stack: TechStack
  
  // Signals (from trigger_prospector.py pattern)
  signals: CompanySignal[]
  
  // Metadata
  extracted_at: string
  confidence: number  // 0-1
  sources: string[]
}

// ─── Digital Maturity Assessment ──────────────────────────────────────────

export interface DigitalMaturity {
  score: number  // 0-100
  grade: string  // A+ to F
  breakdown: {
    has_blog: boolean
    has_social_links: boolean
    has_analytics: boolean  // GA4/GTM detected
    has_schema_markup: boolean
    has_cta: boolean
    content_quality: 'thin' | 'moderate' | 'rich'
    mobile_responsive: boolean
    https: boolean
  }
  gaps: string[]  // e.g. "no blog detected", "no Google Analytics"
  recommendations: string[]
}

// ─── Tech Stack Detection ─────────────────────────────────────────────────

export interface TechStack {
  cms: string[]         // WordPress, Webflow, Shopify, etc.
  analytics: string[]   // GA4, Mixpanel, Amplitude, etc.
  crm: string[]         // HubSpot, Salesforce, Pipedrive, etc.
  marketing: string[]   // Mailchimp, Klaviyo, etc.
  infrastructure: string[]  // Cloudflare, AWS, Vercel, etc.
  frameworks: string[]  // React, Next.js, Vue, etc.
  raw: string[]         // All detected technologies
}

// ─── Company Signals ──────────────────────────────────────────────────────

export type SignalType = 
  | 'funding' 
  | 'hiring' 
  | 'leadership_change' 
  | 'product_launch' 
  | 'partnership' 
  | 'expansion'
  | 'tech_adoption'
  | 'content_activity'

export interface CompanySignal {
  type: SignalType
  detail: string
  source_url?: string
  detected_at: string
  confidence: number  // 0-1
  relevance_score: number  // 0-100
}

// ─── ICP Scoring (ported from opengtm/qualify.py) ─────────────────────────

export interface ICPProfile {
  name: string
  top_industries: string[]
  ideal_company_size: { min: number; max: number }
  target_product_types: string[]
  pain_weight: number  // 0-2, default 1.0
  require_blog: boolean
  geo_focus?: string[]
  anti_icp: string[]  // Industries/sizes to exclude
}

export interface ICPScore {
  total: number  // 0-100
  tier: 'hot' | 'warm' | 'cold'
  breakdown: {
    company_size: { score: number; max: number; reasons: string[] }
    industry_fit: { score: number; max: number; reasons: string[] }
    digital_maturity: { score: number; max: number; reasons: string[] }
    pain_signals: { score: number; max: number; reasons: string[] }
    revenue_signals: { score: number; max: number; reasons: string[] }
    content_quality: { score: number; max: number; reasons: string[] }
  }
  recommended_action: string
  icp_profile_used: string
}

// ─── Pipeline Input/Output ────────────────────────────────────────────────

export interface BrandDNARequest {
  url: string
  icp_profile?: ICPProfile  // Optional custom ICP, uses default if not provided
  market_context?: {
    country?: string
    language?: string
  }
  include_signals?: boolean  // Default: true
  include_tech_stack?: boolean  // Default: true
}

export interface BrandDNAResponse {
  brand_dna: BrandDNA
  icp_score: ICPScore
  processing_time_ms: number
}

// ─── Ideal Customer Profile (Phase 3) ────────────────────────────────────
// These represent the END CUSTOMERS of the company that entered its URL,
// NOT B2B buyers evaluating that company as a lead.

export interface BuyerPersona {
  type_label: string        // e.g. "The busy professional", "The conscious family"
  emoji: string             // e.g. "🏠", "👨‍👩‍👧", "🧑‍💻"
  description: string       // One-sentence natural language profile
  age_range: string         // e.g. "30-45"
  income_level: string      // e.g. "mid-to-high income"
  lifestyle: string         // 1-2 sentence description of who they are
  goals: string[]           // What they want (consumer goals, not business goals)
  pain_points: string[]     // What frustrates them as consumers
  buying_triggers: string[] // What makes them buy
  objections: string[]      // What holds them back
  preferred_channels: string[] // Where to reach them (Instagram, Google, etc.)
  content_preferences: string[] // What content they consume
}
