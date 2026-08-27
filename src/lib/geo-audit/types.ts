// GEO Audit — Type definitions (Supabase flat format)

export interface AuditRecord {
  id: string;
  airtable_id?: string;
  report_token?: string;
  domain?: string;
  brand?: string;
  brand_name?: string;
  website_url?: string;
  vertical: string;
  region?: string;
  language?: string;
  type?: string;
  status: string;
  score?: number | null;
  results_json?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PromptRecord {
  id: string;
  airtable_id?: string;
  vertical: string;
  active: boolean;
  text: string;
}

export interface RunResult {
  auditRecordId: string;
  promptRecordId: string;
  provider: string;
  responseText: string;
  brandMentioned: boolean;
  mentionPosition: number;
  sentiment: string;
  brandDomainCited: boolean;
  citedDomains: string[];
  competitorsMentioned: string[];
}

export interface AnalysisOutput {
  brand_mentioned: boolean;
  mention_position: number;
  sentiment: "positiv" | "neutral" | "negativ" | "n/a";
  brand_domain_cited: boolean;
  cited_domains: string[];
  competitors_mentioned: string[];
}

export interface AuditConfig {
  brandName: string;
  brandDomain: string;
  aliases: string[];
  region: string;
  vertical: string;
  product: string;
  language: string;
}

export interface ProviderResponse {
  text: string;
  citations?: string[];
  groundingMetadata?: Record<string, unknown>;
  /** Full raw response from the provider API. Persisted for forensics. */
  rawResponse?: Record<string, unknown>;
  /** Concrete model version that served the request (e.g. from Gemini's modelVersion field). */
  modelVersion?: string;
}

export interface GeoAuditConfig {
  score_weight_mention: number;
  score_weight_position: number;
  score_weight_citation: number;
  score_weight_sentiment: number;
  score_weight_sov: number;
}

export type ProviderName = "gemini" | "perplexity" | "openai";
