// GEO Audit — Type definitions

export interface AuditRecord {
  id: string;
  fields: {
    "Brand Name": string;
    "Website URL": string;
    Vertical: string;
    Region: string;
    Language: string;
    Type: string;
    Status: string;
    "GEO Score": number | null;
    Competitors: string;
    "Results JSON"?: string;
    "Report Token"?: string;
  };
}

export interface PromptRecord {
  id: string;
  fields: {
    "Prompt Text": string;
    Vertical: string;
    Intent: string;
    Language: string;
    Active: boolean;
  };
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
}

export interface GeoAuditConfig {
  score_weight_mention: number;
  score_weight_position: number;
  score_weight_citation: number;
  score_weight_sentiment: number;
  score_weight_sov: number;
}

export type ProviderName = "gemini" | "perplexity" | "openai";
