// GEO Audit — Report Data API
// GET /api/geo-audit/report-data?token={token}
// Returns JSON with all report data for Lovable frontend rendering.
// Token is a 32-char base64url string generated when the audit completes.

import { NextRequest, NextResponse } from "next/server";
import { getAuditByToken, getFindingsForAudit } from "@/lib/geo-audit/airtable";
import type { ResultsJSON } from "@/lib/geo-audit/runner";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

// ─── Normalize Results JSON (backward compatibility) ───
function normalizeResultsJSON(raw: any, auditFields: any): ResultsJSON {
  // If already in new format, return as-is
  if (raw.breakdown && raw.providerTable && raw.citedDomains) return raw as ResultsJSON;

  const s = raw.score || {
    total: 0, mentionRate: 0, mentionWeighted: 0,
    positionAvg: 0, positionWeighted: 0, citationRate: 0, citationWeighted: 0,
    sentimentRate: 0, sentimentWeighted: 0, sov: 0, sovWeighted: 0,
  };

  // Build provider table from runSummary if available
  const providerTable = raw.providerTable || (raw.runSummary
    ? Object.entries(raw.runSummary).map(([name, info]: [string, any]) => ({
        name,
        runs: info.completed || 0,
        mentions: 0,
        avgPosition: 0,
        cited: 0,
      }))
    : []);

  // Normalize topCompetitors (old: string[], new: {name, count}[])
  const topCompetitors = Array.isArray(raw.topCompetitors)
    ? raw.topCompetitors.map((c: any) =>
        typeof c === "string" ? { name: c, count: 1 } : c
      )
    : [];

  return {
    brand: raw.brand || auditFields["Brand Name"] || "",
    vertical: raw.vertical || auditFields.Vertical || "",
    region: raw.region || auditFields.Region || "",
    date: raw.date || new Date().toISOString().split("T")[0],
    totalRuns: raw.totalRuns || 0,
    expectedRuns: raw.expectedRuns || raw.totalRuns || 0,
    score: s,
    breakdown: raw.breakdown || [
      { component: "Mention Rate", raw: `${s.mentionRate}%`, weight: "40%", points: (s.mentionWeighted || 0).toFixed(2) },
      { component: "Position (norm.)", raw: `${s.positionAvg}`, weight: "20%", points: (s.positionWeighted || 0).toFixed(2) },
      { component: "Citation Rate", raw: `${s.citationRate}%`, weight: "20%", points: (s.citationWeighted || 0).toFixed(2) },
      { component: "Sentiment", raw: `${s.sentimentRate}%`, weight: "10%", points: (s.sentimentWeighted || 0).toFixed(2) },
      { component: "Share of Voice", raw: `${s.sov}%`, weight: "10%", points: (s.sovWeighted || 0).toFixed(2) },
      { component: "GESAMT", raw: `${s.total}`, weight: "100%", points: `${s.total}` },
    ],
    providerTable,
    topCompetitors,
    citedDomains: raw.citedDomains || [],
    runSummary: raw.runSummary || {},
    errors: raw.errors || [],
    costEstimate: raw.costEstimate || 0,
  };
}

// ─── Normalize findings (old format has them in Results JSON) ───
interface Finding {
  category: string;
  finding: string;
  recommendation: string;
  priority: number;
}

function normalizeFindings(resultsFindings: any[], airtableFindings: Finding[]): Finding[] {
  // If we have Airtable findings, prefer those
  if (airtableFindings.length > 0) {
    return airtableFindings.sort((a, b) => a.priority - b.priority).slice(0, 5);
  }
  // Otherwise use findings from Results JSON
  if (Array.isArray(resultsFindings) && resultsFindings.length > 0) {
    return resultsFindings.slice(0, 5).map((f: any) => ({
      category: f.category || "Content",
      finding: String(f.finding || ""),
      recommendation: String(f.recommendation || ""),
      priority: Math.min(5, Math.max(1, Number(f.priority) || 3)),
    }));
  }
  return [];
}

// ─── Generate Zusammenfassung (deterministic, no LLM) ───
function generateZusammenfassung(data: ResultsJSON): string[] {
  const { brand, vertical, region, score, providerTable, topCompetitors, totalRuns } = data;
  const mentionProviders = providerTable.filter((p) => p.mentions > 0).map((p) => p.name);
  const noMentionProviders = providerTable.filter((p) => p.runs > 0 && p.mentions === 0).map((p) => p.name);

  return [
    `Das GEO-Audit für ${brand} (${vertical}, ${region})`,
    `ergibt einen Score von ${score.total} von 100 Punkten.`,
    "",
    mentionProviders.length > 0
      ? `Die Marke wird von ${mentionProviders.join(" und ")} in KI-Antworten erwähnt.`
      : "Die Marke wird von keinem der getesteten KI-Modelle erwähnt.",
    noMentionProviders.length > 0
      ? `${noMentionProviders.join(" und ")} ${noMentionProviders.length === 1 ? "nennt" : "nennen"} die Marke in keinem einzigen Fall.`
      : "",
    "",
    `Mit ${data.totalRuns - topCompetitors.reduce((s, c) => s + c.count, 0)} Erwähnungen in ${data.totalRuns} Antworten`,
    `(Mention Rate: ${score.mentionRate}%) liegt ${brand}`,
    `deutlich hinter den Top-Konkurrenten zurück.`,
    "",
    "Die Konkurrenz dominiert die Sichtbarkeit:",
    ...topCompetitors.slice(0, 3).map((c) => `  ${c.name} (${c.count} Erwähnungen)`),
  ].filter(Boolean);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token || token.length < 20) {
      return corsJson({ error: "Invalid or missing token" }, { status: 400 });
    }

    // Look up audit by Report Token
    const audit = await getAuditByToken(token);
    if (!audit) {
      return corsJson({ error: "Audit not found" }, { status: 404 });
    }

    // Read Results JSON
    const resultsJSONRaw = audit.fields["Results JSON"];
    if (!resultsJSONRaw) {
      return corsJson({ error: "Audit has no Results JSON" }, { status: 404 });
    }

    const rawResults = JSON.parse(resultsJSONRaw as string);
    const data: ResultsJSON = normalizeResultsJSON(rawResults, audit.fields);

    // Fetch findings — try Airtable first, fallback to Results JSON
    let airtableFindings: Finding[] = [];
    try {
      airtableFindings = await getFindingsForAudit(audit.id);
    } catch {
      // Airtable query failed, will use embedded findings
    }
    const findings = normalizeFindings(rawResults.findings || [], airtableFindings);

    // Generate Zusammenfassung
    const zusammenfassung = generateZusammenfassung(data);

    // Format date in German
    const dateFormatted = new Date(data.date).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    return corsJson({
      // Brand info
      brand: data.brand,
      vertical: data.vertical,
      region: data.region,
      date: data.date,
      dateFormatted,

      // Score
      score: data.score.total,
      scoreLabel: data.score.total < 40 ? "Schwach" : data.score.total <= 70 ? "Mittel" : "Stark",
      breakdown: data.breakdown.map((b) => ({
        component: b.component,
        raw: b.raw,
        weight: b.weight,
        points: b.points,
      })),

      // Provider table
      providerTable: data.providerTable.map((p) => ({
        name: p.name,
        runs: p.runs,
        mentions: p.mentions,
        avgPosition: p.avgPosition,
        cited: p.cited,
      })),

      // Competitors
      topCompetitors: data.topCompetitors.slice(0, 5).map((c) => ({
        name: c.name,
        count: c.count,
      })),

      // Cited domains
      citedDomains: data.citedDomains,

      // Findings
      findings: findings.map((f) => ({
        category: f.category,
        finding: f.finding,
        recommendation: f.recommendation,
        priority: f.priority,
      })),

      // Zusammenfassung
      zusammenfassung,

      // Metadata
      totalRuns: data.totalRuns,
      costEstimate: data.costEstimate,
      token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
