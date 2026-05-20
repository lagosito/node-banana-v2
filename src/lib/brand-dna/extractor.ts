/**
 * Brand DNA Extractor — Core extraction logic
 * 
 * Takes a URL → scrapes website → sends to Claude via OpenRouter → returns structured Brand DNA.
 * 
 * Ported from:
 * - opengtm/context.py (structured extraction prompt + field schema)
 * - ai-marketing-skills/account-researcher.py (website scraping + gap detection + tech stack)
 */

import { z } from 'zod'
import type { BrandDNA, DigitalMaturity, TechStack } from './types'

// ─── Zod Schema for Claude structured output ──────────────────────────────

const BrandDNASchema = z.object({
  company_name: z.string(),
  company_url: z.string(),
  description: z.string(),
  brand_statement: z.string(),
  industry: z.string(),
  industry_sub: z.string().optional(),
  product_type: z.string(),
  company_stage: z.string().optional(),
  products: z.array(z.string()),
  services: z.array(z.string()),
  value_propositions: z.array(z.string()),
  use_cases: z.array(z.string()),
  target_audience: z.string(),
  target_audiences: z.array(z.string()),
  primary_region: z.string(),
  primary_country: z.string(),
  primary_language: z.string(),
  competitors: z.array(z.string()),
  competitor_categories: z.array(z.string()),
  tone: z.string(),
  pain_points: z.array(z.string()),
  content_themes: z.array(z.string()),
  gtm_playbook: z.string(),
  pricing_model: z.string().optional(),
})

// ─── Configuration ────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4'

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  return key
}

// ─── Website Scraping (ported from account-researcher.py) ──────────────────

interface ScrapedWebsite {
  url: string
  title: string
  description: string
  bodySnippet: string
  html: string | null
  gaps: string[]
  https: boolean
}

async function scrapeWebsite(url: string): Promise<ScrapedWebsite> {
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`
  const isHttps = normalizedUrl.startsWith('https')

  try {
    const resp = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElKiosko-BrandDNA/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    const html = await resp.text()
    const htmlLower = html.toLowerCase()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch?.[1]?.trim() ?? ''

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
    const description = descMatch?.[1]?.trim() ?? ''

    // Extract body text (first 2000 chars, stripped of HTML)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const bodyRaw = bodyMatch?.[1] ?? html
    const bodyText = bodyRaw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000)

    // Detect marketing gaps (ported from account-researcher.py)
    const gaps: string[] = []
    if (!htmlLower.includes('/blog') && !htmlLower.includes('blog'))
      gaps.push('no blog detected')
    if (!htmlLower.includes('ga4') && !htmlLower.includes('gtag') && !htmlLower.includes('google-analytics'))
      gaps.push('no Google Analytics detected')
    if (bodyText.length < 500)
      gaps.push('thin homepage content')
    if (!htmlLower.includes('schema.org') && !htmlLower.includes('itemtype'))
      gaps.push('no schema markup detected')

    return { url: normalizedUrl, title, description, bodySnippet: bodyText, html, gaps, https: isHttps }
  } catch {
    return { url: normalizedUrl, title: '', description: '', bodySnippet: '', html: null, gaps: ['could not fetch website'], https: isHttps }
  }
}

// ─── Tech Stack Detection (ported from collect_builtwith pattern) ──────────

function detectTechStack(html: string | null): TechStack {
  const empty: TechStack = { cms: [], analytics: [], crm: [], marketing: [], infrastructure: [], frameworks: [], raw: [] }
  if (!html) return empty
  const h = html.toLowerCase()

  // CMS detection
  if (h.includes('wp-content') || h.includes('wordpress')) empty.cms.push('WordPress')
  if (h.includes('webflow')) empty.cms.push('Webflow')
  if (h.includes('shopify')) empty.cms.push('Shopify')
  if (h.includes('squarespace')) empty.cms.push('Squarespace')
  if (h.includes('wix.com')) empty.cms.push('Wix')
  if (h.includes('contentful')) empty.cms.push('Contentful')
  if (h.includes('strapi')) empty.cms.push('Strapi')

  // Analytics
  if (h.includes('google-analytics') || h.includes('gtag') || h.includes('ga4')) empty.analytics.push('Google Analytics')
  if (h.includes('mixpanel')) empty.analytics.push('Mixpanel')
  if (h.includes('amplitude')) empty.analytics.push('Amplitude')
  if (h.includes('hotjar')) empty.analytics.push('Hotjar')
  if (h.includes('segment')) empty.analytics.push('Segment')
  if (h.includes('plausible')) empty.analytics.push('Plausible')
  if (h.includes('posthog')) empty.analytics.push('PostHog')

  // CRM
  if (h.includes('hubspot')) empty.crm.push('HubSpot')
  if (h.includes('salesforce')) empty.crm.push('Salesforce')
  if (h.includes('pipedrive')) empty.crm.push('Pipedrive')
  if (h.includes('intercom')) empty.crm.push('Intercom')
  if (h.includes('drift')) empty.crm.push('Drift')

  // Marketing
  if (h.includes('mailchimp')) empty.marketing.push('Mailchimp')
  if (h.includes('klaviyo')) empty.marketing.push('Klaviyo')
  if (h.includes('activecampaign')) empty.marketing.push('ActiveCampaign')
  if (h.includes('marketo')) empty.marketing.push('Marketo')

  // Infrastructure
  if (h.includes('cloudflare')) empty.infrastructure.push('Cloudflare')
  if (h.includes('vercel')) empty.infrastructure.push('Vercel')
  if (h.includes('netlify')) empty.infrastructure.push('Netlify')
  if (h.includes('aws') || h.includes('amazonaws')) empty.infrastructure.push('AWS')
  if (h.includes('google cloud') || h.includes('gcp')) empty.infrastructure.push('GCP')

  // Frameworks
  if (h.includes('__next') || h.includes('_next/')) empty.frameworks.push('Next.js')
  if (h.includes('react')) empty.frameworks.push('React')
  if (h.includes('vue')) empty.frameworks.push('Vue.js')
  if (h.includes('angular')) empty.frameworks.push('Angular')
  if (h.includes('svelte')) empty.frameworks.push('Svelte')
  if (h.includes('tailwind')) empty.frameworks.push('Tailwind CSS')

  empty.raw = [...empty.cms, ...empty.analytics, ...empty.crm, ...empty.marketing, ...empty.infrastructure, ...empty.frameworks]
  return empty
}

// ─── Digital Maturity Scoring (ported from opengtm/qualify.py pattern) ─────

function assessDigitalMaturity(website: ScrapedWebsite, techStack: TechStack): DigitalMaturity {
  let score = 0
  const reasons: string[] = []

  // Blog presence (+15)
  const hasBlog = !website.gaps.includes('no blog detected')
  if (hasBlog) { score += 15; reasons.push('Has blog') }
  else { reasons.push('No blog detected (-15)') }

  // Social links (+10)
  const hasSocial = website.html ? /linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/i.test(website.html) : false
  if (hasSocial) { score += 10; reasons.push('Has social links') }

  // Analytics (+10)
  const hasAnalytics = techStack.analytics.length > 0
  if (hasAnalytics) { score += 10; reasons.push(`Analytics: ${techStack.analytics.join(', ')}`) }

  // Schema markup (+10)
  const hasSchema = !website.gaps.includes('no schema markup detected')
  if (hasSchema) { score += 10; reasons.push('Has schema markup') }

  // HTTPS (+5)
  if (website.https) { score += 5; reasons.push('HTTPS enabled') }

  // Content quality (+15)
  const contentRich = website.bodySnippet.length > 1000
  if (contentRich) { score += 15; reasons.push('Rich homepage content') }
  else if (website.bodySnippet.length > 300) { score += 8; reasons.push('Moderate homepage content') }

  // CRM/Marketing tools (+10)
  if (techStack.crm.length > 0) { score += 10; reasons.push(`CRM: ${techStack.crm.join(', ')}`) }
  if (techStack.marketing.length > 0) { score += 5; reasons.push(`Marketing tools: ${techStack.marketing.join(', ')}`) }

  // Modern framework (+10)
  if (techStack.frameworks.length > 0) { score += 10; reasons.push(`Framework: ${techStack.frameworks.join(', ')}`) }

  // Grade
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B'
    : score >= 50 ? 'C+' : score >= 40 ? 'C' : score >= 30 ? 'D' : 'F'

  return {
    score: Math.min(score, 100),
    grade,
    breakdown: {
      has_blog: hasBlog,
      has_social_links: hasSocial,
      has_analytics: hasAnalytics,
      has_schema_markup: hasSchema,
      has_cta: website.html ? /cta|sign up|get started|book a demo|contact us/i.test(website.html) : false,
      content_quality: contentRich ? 'rich' : website.bodySnippet.length > 300 ? 'moderate' : 'thin',
      mobile_responsive: website.html ? /viewport/i.test(website.html) : false,
      https: website.https,
    },
    gaps: website.gaps,
    recommendations: website.gaps.map(g => {
      if (g.includes('blog')) return 'Add a blog for SEO and thought leadership'
      if (g.includes('Analytics')) return 'Install Google Analytics or Plausible for visitor tracking'
      if (g.includes('schema')) return 'Add structured data (JSON-LD) for better search visibility'
      if (g.includes('thin')) return 'Expand homepage content with value propositions and social proof'
      return `Fix: ${g}`
    }),
  }
}

// ─── Claude Extraction via OpenRouter ──────────────────────────────────────

function buildExtractionPrompt(website: ScrapedWebsite, marketContext?: { country?: string; language?: string }): string {
  let prompt = `Analyze this company website and extract structured Brand DNA.

URL: ${website.url}
Title: ${website.title}
Meta Description: ${website.description}
Body Content (first 2000 chars):
${website.bodySnippet}

Return a JSON object with these fields:
- company_name: Official company name
- company_url: Website URL
- description: 2-3 sentence company description
- brand_statement: CRITICAL — One single sentence in English that captures what this brand uniquely offers its ideal customer. This is NOT a generic description. It must feel like a tagline the customer would remember. Rules: (1) Be specific to THIS brand's actual offering — reference real products/services found on the site, (2) Highlight the unique differentiator — why choose THIS brand over competitors, (3) Speak FROM the customer's perspective — what THEY get, not what the company does, (4) NEVER use generic words like "premium", "quality", "serving customers", "excellence", "innovation" — these are banned. (5) Keep it under 20 words. Examples of GOOD brand statements: "Your morning routine, automated — fresh coffee before your feet hit the floor." (smart coffee maker), "Track every shipment in real time — no more calling customer service." (logistics SaaS), "Designer furniture without the designer price — direct from European workshops." (DTC furniture). Examples of BAD brand statements: "A premium brand serving discerning customers." (too generic), "Innovation and excellence in everything we do." (empty buzzwords), "We help businesses grow." (says nothing specific).
- industry: Primary industry (e.g. "SaaS", "E-commerce", "Healthcare")
- industry_sub: Sub-category (e.g. "Marketing Automation", "DTC Fashion")
- product_type: SaaS, API, Platform, Marketplace, Agency, E-commerce, Service, etc.
- company_stage: Startup, Scaleup, Growth, Enterprise (infer from content)
- products: Array of products offered
- services: Array of services offered
- value_propositions: Key value props (what they promise customers)
- use_cases: Common use cases or scenarios
- target_audience: Ideal customer profile description
- target_audiences: Array of audience segments
- primary_region: Geographic market (e.g. "DACH", "Global", "US")
- primary_country: ISO country code
- primary_language: ISO language code
- competitors: Main competitors (3-5)
- competitor_categories: Competing solution categories
- tone: Brand voice (professional, casual, technical, friendly, authoritative, playful)
- pain_points: Customer pain points this company solves
- content_themes: Topics they blog/post about
- gtm_playbook: GTM strategy (PLG, Sales-led, Marketing-led, Community-led, Hybrid)
- pricing_model: Freemium, Subscription, Usage-based, One-time, Custom, Unknown

Be specific. Extract from the actual content, don't guess.`

  if (marketContext?.country || marketContext?.language) {
    prompt += `\n\nTarget market context: country=${marketContext.country ?? 'any'}, language=${marketContext.language ?? 'any'}`
    prompt += `\nTailor competitor and market analysis for this region.`
  }

  return prompt
}

async function extractWithClaude(prompt: string): Promise<Partial<BrandDNA>> {
  const apiKey = getApiKey()

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://elkiosk.ai',
      'X-Title': 'El Kiosko Brand DNA Pipeline',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a company intelligence analyst. Extract structured data from website content. Return ONLY valid JSON, no markdown, no explanation. IMPORTANT: The brand_statement field must always be in English, regardless of the source website language.',
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
  const content = data.choices?.[0]?.message?.content ?? ''

  // Parse JSON (handle markdown code blocks)
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)

  const parsed = JSON.parse(jsonStr.trim())
  return BrandDNASchema.parse(parsed) as Partial<BrandDNA>
}

// ─── Main Extraction Pipeline ─────────────────────────────────────────────

export interface ExtractOptions {
  url: string
  marketContext?: { country?: string; language?: string }
  includeTechStack?: boolean
}

export async function extractBrandDNA(options: ExtractOptions): Promise<BrandDNA> {
  const { url, marketContext, includeTechStack = true } = options
  const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  // Step 1: Scrape website
  const website = await scrapeWebsite(url)

  // Step 2: Detect tech stack from HTML
  const techStack = includeTechStack ? detectTechStack(website.html) : {
    cms: [], analytics: [], crm: [], marketing: [], infrastructure: [], frameworks: [], raw: [],
  }

  // Step 3: Assess digital maturity
  const digitalMaturity = assessDigitalMaturity(website, techStack)

  // Step 4: Extract structured Brand DNA via Claude
  const prompt = buildExtractionPrompt(website, marketContext)
  const extracted = await extractWithClaude(prompt)

  // Step 5: Merge into final Brand DNA
  const brandDNA: BrandDNA = {
    company_name: extracted.company_name ?? website.title.split(/[|–—-]/)[0]?.trim() ?? domain,
    company_url: extracted.company_url ?? website.url,
    domain,
    description: extracted.description ?? website.description ?? '',
    brand_statement: extracted.brand_statement ?? '',
    industry: extracted.industry ?? '',
    industry_sub: extracted.industry_sub,
    product_type: extracted.product_type ?? '',
    company_stage: extracted.company_stage,
    products: extracted.products ?? [],
    services: extracted.services ?? [],
    value_propositions: extracted.value_propositions ?? [],
    use_cases: extracted.use_cases ?? [],
    target_audience: extracted.target_audience ?? '',
    target_audiences: extracted.target_audiences ?? [],
    primary_region: extracted.primary_region ?? '',
    primary_country: extracted.primary_country ?? '',
    primary_language: extracted.primary_language ?? 'de',
    competitors: extracted.competitors ?? [],
    competitor_categories: extracted.competitor_categories ?? [],
    tone: extracted.tone ?? 'professional',
    pain_points: extracted.pain_points ?? [],
    content_themes: extracted.content_themes ?? [],
    gtm_playbook: extracted.gtm_playbook ?? '',
    pricing_model: extracted.pricing_model,
    digital_maturity: digitalMaturity,
    tech_stack: techStack,
    signals: [],  // Populated by signal-detector if requested
    extracted_at: new Date().toISOString(),
    confidence: website.html ? 0.85 : 0.4,
    sources: [website.url],
  }

  return brandDNA
}
