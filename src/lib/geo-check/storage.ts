// GEO Check — Supabase persistence layer (v2 — two-phase architecture)

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

// ─── Types ───

export interface ReportRow {
  id: string;
  short_slug: string;
  domain: string;
  url: string;
  resolved_url: string | null;
  lang: string | null;
  // Phase 1: deterministic
  overall_score: number | null;
  category_scores: any;
  citability: any;
  findings: any;
  top_problems: any;
  verified_facts: any;
  // Phase 2: LLM
  status: "pending" | "running" | "completed" | "error";
  provider_status: Record<string, { status: string; queriesRun: number; mentions: number; error?: string }>;
  llm_results: any;
  mention_rate: number | null;
  queries_tested: number | null;
  // Phase 2b: review
  quality_meta: any;
  recommendations: any;
  // Metadata
  brand_name: string | null;
  vertical: string | null;
  region: string | null;
  subpages: any;
  ai_crawler_facts: any;
  timings: any;
  unlocked: boolean;
  lead_id: string | null;
  created_at: string;
  expires_at: string;
}

export type ProviderName = "gemini" | "openai" | "perplexity";

// ─── Helpers ───

function supabase() {
  if (!isSupabaseConfigured()) return null;
  return getSupabase();
}

export function generateShortSlug(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

// ─── Phase 1: Create report with deterministic scores ───

export async function createReport(data: {
  domain: string;
  url: string;
  resolvedUrl?: string;
  lang?: string;
  overallScore: number;
  categoryScores: any;
  citability: any;
  findings: any;
  topProblems: any;
  verifiedFacts: any;
  brandName?: string;
  vertical?: string;
  region?: string;
  subpages?: string[];
  aiCrawlerFacts?: any;
  timings?: any;
}): Promise<{ id: string; shortSlug: string }> {
  const sb = supabase();
  if (!sb) throw new Error("Supabase not configured");

  let row: any, error: any;
  try {
    const result = await sb
      .from("geo_check_reports")
      .insert({
        short_slug: generateShortSlug(crypto.randomUUID()),
        domain: data.domain,
        url: data.url,
        resolved_url: data.resolvedUrl ?? null,
        lang: data.lang ?? null,
        overall_score: data.overallScore,
        category_scores: data.categoryScores,
        citability: data.citability,
        findings: data.findings,
        top_problems: data.topProblems,
        verified_facts: data.verifiedFacts,
        status: "pending",
        provider_status: {},
        brand_name: data.brandName ?? null,
        vertical: data.vertical ?? null,
        region: data.region ?? null,
        subpages: data.subpages ?? [],
        ai_crawler_facts: data.aiCrawlerFacts ?? null,
        timings: data.timings ?? null,
      })
      .select("id, short_slug")
      .single();
    row = result.data;
    error = result.error;
  } catch (fetchErr: any) {
    throw new Error(`createReport fetch failed: ${fetchErr?.message || fetchErr} (cause: ${fetchErr?.cause?.message || "none"})`);
  }

  if (error) throw new Error(`createReport: ${error.message} (code=${error.code}, details=${error.details || "none"})`);
  return { id: row.id, shortSlug: row.short_slug };
}

// ─── Phase 2: Update report with LLM results ───

export async function setReportStatus(
  id: string,
  status: "running" | "completed" | "error",
): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("geo_check_reports").update({ status }).eq("id", id);
  if (error) throw new Error(`setReportStatus: ${error.message}`);
}

export async function setProviderStatus(
  id: string,
  provider: ProviderName,
  providerStatus: { status: string; queriesRun: number; mentions: number; error?: string },
): Promise<void> {
  const sb = supabase();
  if (!sb) return;

  // Read current provider_status, merge, write back
  const { data: row } = await sb
    .from("geo_check_reports")
    .select("provider_status")
    .eq("id", id)
    .single();

  const current = row?.provider_status || {};
  const updated = { ...current, [provider]: providerStatus };

  const { error } = await sb
    .from("geo_check_reports")
    .update({ provider_status: updated })
    .eq("id", id);

  if (error) throw new Error(`setProviderStatus: ${error.message}`);
}

export async function setLlmResults(
  id: string,
  data: {
    llm_results: any;
    mention_rate: number | null;
    queries_tested: number;
    quality_meta?: any;
    recommendations?: any;
    timings?: any;
  },
): Promise<void> {
  const sb = supabase();
  if (!sb) return;

  const { error } = await sb
    .from("geo_check_reports")
    .update({
      llm_results: data.llm_results,
      mention_rate: data.mention_rate,
      queries_tested: data.queries_tested,
      quality_meta: data.quality_meta ?? null,
      recommendations: data.recommendations ?? null,
      timings: data.timings ?? null,
      status: "completed",
    })
    .eq("id", id);

  if (error) throw new Error(`setLlmResults: ${error.message}`);
}

// ─── Read ───

export async function getReport(idOrSlug: string): Promise<ReportRow | null> {
  const sb = supabase();
  if (!sb) return null;

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

export async function getReportByDomain(domain: string): Promise<ReportRow | null> {
  const sb = supabase();
  if (!sb) return null;

  // Only return completed reports as cache — errors and pending are never served
  const { data, error } = await sb
    .from("geo_check_reports")
    .select("*")
    .eq("domain", domain)
    .eq("status", "completed")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as ReportRow;
}

/** Mark orphaned pending/running rows as expired (never delete). */
export async function expireOrphanedReports(maxAgeMinutes = 10): Promise<number> {
  const sb = supabase();
  if (!sb) return 0;

  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("geo_check_reports")
    .update({ status: "expired" })
    .in("status", ["pending", "running"])
    .lt("created_at", cutoff)
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}

export async function touchReport(id: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  await sb
    .from("geo_check_reports")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", id);
}

// ─── Leads ───

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

  // Link lead to report and set unlocked=true
  await sb
    .from("geo_check_reports")
    .update({ lead_id: data.id, unlocked: true })
    .eq("id", params.reportId);

  return data.id;
}

// ─── Rate Limits ───

export async function checkRateLimitDb(
  ip: string,
  maxPerDay = 5,
): Promise<{ allowed: boolean; remaining: number }> {
  const sb = supabase();
  if (!sb) return { allowed: true, remaining: maxPerDay };

  const today = new Date().toISOString().split("T")[0];

  // Try RPC first (atomic increment)
  const { data: rpcData, error: rpcError } = await sb.rpc("increment_rate_limit", {
    p_ip: ip,
    p_day: today,
    p_max: maxPerDay,
  });

  if (!rpcError && rpcData !== null) {
    const count = rpcData as number;
    if (count > maxPerDay) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: maxPerDay - count };
  }

  // Fallback: read-modify-write
  const { data: existing } = await sb
    .from("geo_check_rate_limits")
    .select("count")
    .eq("ip", ip)
    .eq("day", today)
    .single();

  const currentCount = existing?.count ?? 0;
  if (currentCount >= maxPerDay) return { allowed: false, remaining: 0 };

  await sb
    .from("geo_check_rate_limits")
    .upsert({ ip, day: today, count: currentCount + 1 }, { onConflict: "ip,day" });

  return { allowed: true, remaining: maxPerDay - currentCount - 1 };
}
