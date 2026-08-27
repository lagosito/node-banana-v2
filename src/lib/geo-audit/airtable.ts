// GEO Audit — Supabase operations (PostgREST API)

import type { AuditRecord, PromptRecord, RunResult, GeoAuditConfig } from "./types";

const SUPABASE_URL = "https://qbtoupvgujlhntorwbnj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFidG91cHZndWpsaG50b3J3Ym5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzg0NTEsImV4cCI6MjEwMTg1NDQ1MX0.xrKWg6oeFloG1kEjw4cqoIfQpMkqgde0NG6obKCoRUk";

const SUPABASE_BASE = `${SUPABASE_URL}/rest/v1`;

async function atFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${SUPABASE_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  const text = await res.text();
  // Some Supabase responses (e.g. DELETE with no rows) return empty body
  return text ? JSON.parse(text) : null;
}

export async function getAudit(auditId: string): Promise<AuditRecord> {
  const rows = await atFetch(
    `/geo_audit_audits?id=eq.${encodeURIComponent(auditId)}&limit=1`
  );
  return rows[0];
}

export async function getAuditByToken(token: string): Promise<AuditRecord | null> {
  const rows = await atFetch(
    `/geo_audit_audits?report_token=eq.${encodeURIComponent(token)}&limit=1`
  );
  return rows[0] || null;
}

export async function updateAudit(auditId: string, fields: Record<string, unknown>) {
  const rows = await atFetch(
    `/geo_audit_audits?id=eq.${encodeURIComponent(auditId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(fields),
    }
  );
  return rows?.[0] || null;
}

export async function getActivePrompts(vertical: string): Promise<PromptRecord[]> {
  const params = new URLSearchParams();
  params.set("vertical", `eq.${vertical}`);
  params.set("active", "eq.true");
  params.set("limit", "100");
  const rows = await atFetch(`/geo_audit_prompts?${params.toString()}`);
  return rows || [];
}

export async function createRun(result: RunResult) {
  const rows = await atFetch(`/geo_audit_runs`, {
    method: "POST",
    body: JSON.stringify({
      audit_id: result.auditRecordId,
      prompt_id: result.promptRecordId,
      provider: result.provider,
      response_text: result.responseText,
      brand_mentioned: result.brandMentioned,
      mention_position: result.mentionPosition,
      sentiment: result.sentiment,
      brand_domain_cited: result.brandDomainCited,
      cited_domains: result.citedDomains.join("\n"),
      competitors_mentioned: result.competitorsMentioned.join("\n"),
      run_date: new Date().toISOString(),
    }),
  });
  return rows?.[0] || null;
}

export async function getConfig(): Promise<GeoAuditConfig> {
  const rows = await atFetch(`/geo_audit_config?limit=20`);
  const config: Record<string, number> = {};
  for (const row of rows || []) {
    const key = row.key as string;
    const val = row.value as string;
    if (key && val) config[key] = Number(val);
  }
  return {
    score_weight_mention: config.score_weight_mention ?? 40,
    score_weight_position: config.score_weight_position ?? 20,
    score_weight_citation: config.score_weight_citation ?? 20,
    score_weight_sentiment: config.score_weight_sentiment ?? 10,
    score_weight_sov: config.score_weight_sov ?? 10,
  };
}

export async function createFinding(
  auditId: string,
  finding: { category: string; finding: string; recommendation: string; priority: number }
) {
  const rows = await atFetch(`/geo_audit_findings`, {
    method: "POST",
    body: JSON.stringify({
      audit_id: auditId,
      finding_title: finding.finding.substring(0, 80),
      category: finding.category,
      finding: finding.finding,
      recommendation: finding.recommendation,
      priority: finding.priority,
    }),
  });
  return rows?.[0] || null;
}

export async function getFindingsForAudit(
  auditId: string
): Promise<{ id: string; category: string; finding: string; recommendation: string; priority: number }[]> {
  const rows = await atFetch(
    `/geo_audit_findings?audit_id=eq.${encodeURIComponent(auditId)}`
  );
  return (rows || []).map((r: any) => ({
    id: r.id,
    category: r.category || "",
    finding: r.finding || "",
    recommendation: r.recommendation || "",
    priority: r.priority || 3,
  }));
}

export async function deleteFindingsForAudit(auditId: string): Promise<number> {
  const existing = await getFindingsForAudit(auditId);
  if (existing.length === 0) return 0;

  // Delete all findings for this audit via PostgREST filter
  await atFetch(
    `/geo_audit_findings?audit_id=eq.${encodeURIComponent(auditId)}`,
    {
      method: "DELETE",
    }
  );
  return existing.length;
}
