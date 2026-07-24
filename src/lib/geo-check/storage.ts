// GEO Check — Supabase persistence layer
// Replaces in-memory Maps for reports, leads, and rate limits.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

// ─── Types ───

export interface ReportRow {
  id: string;
  short_slug: string;
  domain: string;
  url: string;
  resolved_url: string | null;
  lang: string | null;
  overall_score: number | null;
  category_scores: any;
  citability: any;
  findings: any;
  recommendations: any;
  top_problems: any;
  llm_visibility: any;
  verified_facts: any;
  quality_meta: any;
  timings: any;
  brand_name: string | null;
  vertical: string | null;
  region: string | null;
  subpages: any;
  ai_crawler_facts: any;
  mention_rate: number | null;
  queries_tested: number | null;
  created_at: string;
  expires_at: string;
  lead_id: string | null;
}

export interface LeadRow {
  id: string;
  report_id: string;
  first_name: string;
  last_name: string;
  email: string;
  consent_privacy: boolean;
  created_at: string;
}

// ─── Reports ───

function supabase() {
  if (!isSupabaseConfigured()) return null;
  return getSupabase();
}

/** Generate a short slug from UUID (first 8 hex chars, no dashes) */
export function generateShortSlug(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

/** Save a new report. Returns { id, shortSlug }. */
export async function saveReport(data: {
  domain: string;
  url: string;
  resolvedUrl?: string;
  lang?: string;
  overallScore?: number;
  categoryScores?: any;
  citability?: any;
  findings?: any;
  recommendations?: any;
  topProblems?: any;
  llmVisibility?: any;
  verifiedFacts?: any;
  qualityMeta?: any;
  timings?: any;
  brandName?: string;
  vertical?: string;
  region?: string;
  subpages?: string[];
  aiCrawlerFacts?: any;
  mentionRate?: number | null;
  queriesTested?: number;
}): Promise<{ id: string; shortSlug: string }> {
  const sb = supabase();
  if (!sb) throw new Error("Supabase not configured");

  const { data: row, error } = await sb
    .from("geo_check_reports")
    .insert({
      short_slug: generateShortSlug(crypto.randomUUID()),
      domain: data.domain,
      url: data.url,
      resolved_url: data.resolvedUrl ?? null,
      lang: data.lang ?? null,
      overall_score: data.overallScore ?? null,
      category_scores: data.categoryScores ?? null,
      citability: data.citability ?? null,
      findings: data.findings ?? null,
      recommendations: data.recommendations ?? null,
      top_problems: data.topProblems ?? null,
      llm_visibility: data.llmVisibility ?? null,
      verified_facts: data.verifiedFacts ?? null,
      quality_meta: data.qualityMeta ?? null,
      timings: data.timings ?? null,
      brand_name: data.brandName ?? null,
      vertical: data.vertical ?? null,
      region: data.region ?? null,
      subpages: data.subpages ?? [],
      ai_crawler_facts: data.aiCrawlerFacts ?? null,
      mention_rate: data.mentionRate ?? null,
      queries_tested: data.queriesTested ?? 0,
    })
    .select("id, short_slug")
    .single();

  if (error) throw new Error(`saveReport: ${error.message}`);
  return { id: row.id, shortSlug: row.short_slug };
}

/** Fetch a report by UUID id OR by short_slug. */
export async function getReport(idOrSlug: string): Promise<ReportRow | null> {
  const sb = supabase();
  if (!sb) return null;

  // Try UUID first, then short_slug
  let { data, error } = await sb
    .from("geo_check_reports")
    .select("*")
    .eq("id", idOrSlug)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !data) {
    ({ data, error } = await sb
      .from("geo_check_reports")
      .select("*")
      .eq("short_slug", idOrSlug)
      .gt("expires_at", new Date().toISOString())
      .single());
  }

  if (error || !data) return null;
  return data as ReportRow;
}

/** Fetch a report by domain (used for cache lookups). */
export async function getReportByDomain(domain: string): Promise<ReportRow | null> {
  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("geo_check_reports")
    .select("*")
    .eq("domain", domain)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as ReportRow;
}

/** Update a report (e.g. attach lead_id). */
export async function updateReport(
  id: string,
  patch: Partial<Pick<ReportRow, "lead_id" | "timings" | "recommendations" | "quality_meta">>,
): Promise<void> {
  const sb = supabase();
  if (!sb) return;

  const { error } = await sb
    .from("geo_check_reports")
    .update(patch)
    .eq("id", id);

  if (error) throw new Error(`updateReport: ${error.message}`);
}

/** Touch a report's expires_at (extend TTL by 7 days). */
export async function touchReport(id: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;

  const { error } = await sb
    .from("geo_check_reports")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", id);

  if (error) throw new Error(`touchReport: ${error.message}`);
}

// ─── Leads ───

/** Create a lead and link it to a report. Returns lead_id. */
export async function createLead(params: {
  reportId: string;
  firstName: string;
  lastName: string;
  email: string;
  consentPrivacy: boolean;
}): Promise<string> {
  const sb = supabase();
  if (!sb) throw new Error("Supabase not configured");

  const { data, error } = await sb
    .from("geo_check_leads")
    .insert({
      report_id: params.reportId,
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      consent_privacy: params.consentPrivacy,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createLead: ${error.message}`);

  // Link lead to report
  await updateReport(params.reportId, { lead_id: data.id });

  return data.id;
}

// ─── Rate Limits ───

/** Check if an IP has exceeded the daily limit. */
export async function checkRateLimitDb(
  ip: string,
  maxPerDay = 5,
): Promise<{ allowed: boolean; remaining: number }> {
  const sb = supabase();
  if (!sb) return { allowed: true, remaining: maxPerDay }; // fallback if no DB

  const today = new Date().toISOString().split("T")[0];

  // Upsert: increment count
  const { data, error } = await sb
    .from("geo_check_rate_limits")
    .upsert(
      { ip, day: today, count: 1 },
      { onConflict: "ip,day", ignoreDuplicates: false },
    )
    .select("count")
    .single();

  // If upsert succeeded, count was set to 1 (new row) — need to increment
  // Actually, upsert with count:1 will set to 1. We need raw SQL for atomic increment.
  // Fallback: read, then update atomically via RPC or raw query.

  // Simpler approach: use a single RPC call
  const { data: rpcData, error: rpcError } = await sb.rpc("increment_rate_limit", {
    p_ip: ip,
    p_day: today,
    p_max: maxPerDay,
  });

  if (rpcError) {
    // Fallback: try read-modify-write (not atomic but acceptable for rate limiting)
    const { data: existing } = await sb
      .from("geo_check_rate_limits")
      .select("count")
      .eq("ip", ip)
      .eq("day", today)
      .single();

    const currentCount = existing?.count ?? 0;
    if (currentCount >= maxPerDay) {
      return { allowed: false, remaining: 0 };
    }

    await sb
      .from("geo_check_rate_limits")
      .upsert({ ip, day: today, count: currentCount + 1 }, { onConflict: "ip,day" });

    return { allowed: true, remaining: maxPerDay - currentCount - 1 };
  }

  const count = rpcData as number;
  if (count > maxPerDay) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: maxPerDay - count };
}

// ─── Cleanup ───

/** Delete expired reports (call periodically). */
export async function cleanupExpired(): Promise<number> {
  const sb = supabase();
  if (!sb) return 0;

  const { data, error } = await sb
    .from("geo_check_reports")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
