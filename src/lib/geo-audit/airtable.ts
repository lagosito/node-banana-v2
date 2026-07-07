// GEO Audit — Airtable operations

import type { AuditRecord, PromptRecord, RunResult, GeoAuditConfig } from "./types";

const AIRTABLE_BASE_ID = process.env.GEO_AUDIT_BASE_ID || "appL4ES7bjExT6908";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";

// Table IDs
const T = {
  AUDITS: "tbldUrux7XHaT9SiU",
  PROMPTS: "tblu2GLRwd4sDVPaJ",
  RUNS: "tblqvbIlCWnrBR7fk",
  FINDINGS: "tblV1S61qmG17H6vZ",
  CONFIG: "tblPpaX9hRBuOcv1h",
};

async function atFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getAudit(auditId: string): Promise<AuditRecord> {
  return atFetch(`/${AIRTABLE_BASE_ID}/${T.AUDITS}/${auditId}`);
}

export async function updateAudit(auditId: string, fields: Record<string, unknown>) {
  return atFetch(`/${AIRTABLE_BASE_ID}/${T.AUDITS}/${auditId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function getActivePrompts(vertical: string): Promise<PromptRecord[]> {
  const filter = encodeURIComponent(`AND({Vertical}='${vertical}',{Active}=TRUE())`);
  const data = await atFetch(
    `/${AIRTABLE_BASE_ID}/${T.PROMPTS}?filterByFormula=${filter}&pageSize=100`
  );
  return data.records || [];
}

export async function createRun(result: RunResult) {
  return atFetch(`/${AIRTABLE_BASE_ID}/${T.RUNS}`, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Audit: [result.auditRecordId],
        Prompt: [result.promptRecordId],
        Provider: result.provider,
        "Response Text": result.responseText,
        "Brand Mentioned": result.brandMentioned,
        "Mention Position": result.mentionPosition,
        Sentiment: result.sentiment,
        "Brand Domain Cited": result.brandDomainCited,
        "Cited Domains": result.citedDomains.join("\n"),
        "Competitors Mentioned": result.competitorsMentioned.join("\n"),
        "Run Date": new Date().toISOString(),
      },
      typecast: true,
    }),
  });
}

export async function getConfig(): Promise<GeoAuditConfig> {
  const data = await atFetch(`/${AIRTABLE_BASE_ID}/${T.CONFIG}?pageSize=20`);
  const config: Record<string, number> = {};
  for (const rec of data.records || []) {
    const key = rec.fields?.Key as string;
    const val = rec.fields?.Value as string;
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
