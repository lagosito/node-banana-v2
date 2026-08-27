// GEO Audit — Report Data API
// GET /api/geo-audit/report-data?token={token}
// Returns canonical Results JSON for Lovable frontend rendering.

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

function isCanonicalResultsJSON(raw: any): raw is ResultsJSON {
  return (
    raw &&
    typeof raw.brand === "string" &&
    typeof raw.vertical === "string" &&
    typeof raw.region === "string" &&
    typeof raw.date === "string" &&
    typeof raw.totalRuns === "number" &&
    typeof raw.expectedRuns === "number" &&
    raw.score &&
    typeof raw.score.total === "number" &&
    Array.isArray(raw.breakdown) &&
    raw.breakdown.length >= 5 &&
    Array.isArray(raw.providerTable) &&
    raw.providerTable.length > 0 &&
    Array.isArray(raw.topCompetitors) &&
    raw.topCompetitors.every((c: any) => typeof c.name === "string" && typeof c.count === "number") &&
    Array.isArray(raw.citedDomains)
  );
}

function generateZusammenfassung(data: ResultsJSON): string {
  const { brand, vertical, region, score, providerTable, topCompetitors, totalRuns } = data;
  const mentionProviders = providerTable.filter((p) => p.mentions > 0).map((p) => p.name);
  const noMentionProviders = providerTable.filter((p) => p.runs > 0 && p.mentions === 0).map((p) => p.name);

  const parts: string[] = [];
  parts.push(`Das GEO-Audit für ${brand} (${vertical}, ${region}) ergibt einen Score von ${score.total} von 100 Punkten.`);

  if (mentionProviders.length > 0) {
    parts.push(`Die Marke wird von ${mentionProviders.join(" und ")} in KI-Antworten erwähnt.`);
  } else {
    parts.push("Die Marke wird von keinem der getesteten KI-Modelle erwähnt.");
  }

  if (noMentionProviders.length > 0) {
    parts.push(`${noMentionProviders.join(" und ")} ${noMentionProviders.length === 1 ? "nennt" : "nennen"} die Marke in keinem einzigen Fall.`);
  }

  const mentionCount = Math.round(totalRuns * score.mentionRate / 100);
  parts.push(`Mit ${mentionCount} Erwähnungen in ${totalRuns} Antworten (Mention Rate: ${score.mentionRate}%) liegt ${brand} deutlich hinter den Top-Konkurrenten zurück.`);

  if (topCompetitors.length > 0) {
    parts.push(`Die Konkurrenz dominiert die Sichtbarkeit: ${topCompetitors.slice(0, 3).map((c) => `${c.name} (${c.count})`).join(", ")}.`);
  }

  return parts.join(" ");
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

    const audit = await getAuditByToken(token);
    if (!audit) {
      return corsJson({ error: "Audit not found" }, { status: 404 });
    }

    const resultsJSONRaw = audit.results_json;
    if (!resultsJSONRaw) {
      return corsJson({ error: "Audit has no Results JSON" }, { status: 404 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(resultsJSONRaw as string);
    } catch {
      return corsJson({ error: "Invalid Results JSON" }, { status: 404 });
    }

    if (!isCanonicalResultsJSON(parsed)) {
      return corsJson(
        { error: "Audit format outdated, re-run required" },
        { status: 404 }
      );
    }

    const data: ResultsJSON = parsed;

    // Fetch findings from Airtable FINDINGS table
    let findings: { category: string; finding: string; recommendation: string; priority: number }[] = [];
    try {
      findings = await getFindingsForAudit(audit.id);
      findings.sort((a, b) => a.priority - b.priority);
    } catch {
      // Findings table query failed — return empty
    }

    const zusammenfassung = generateZusammenfassung(data);

    const dateFormatted = new Date(data.date).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    return corsJson({
      brand: data.brand,
      vertical: data.vertical,
      region: data.region,
      date: data.date,
      dateFormatted,

      score: data.score.total,
      scoreLabel: data.score.total < 40 ? "Schwach" : data.score.total <= 70 ? "Mittel" : "Stark",
      breakdown: data.breakdown.map((b) => ({
        component: b.component,
        raw: b.raw,
        weight: b.weight,
        points: b.points,
      })),

      providerTable: data.providerTable.map((p) => ({
        name: p.name,
        runs: p.runs,
        mentions: p.mentions,
        avgPosition: p.avgPosition,
        cited: p.cited,
      })),

      topCompetitors: data.topCompetitors.slice(0, 5).map((c) => ({
        name: c.name,
        count: c.count,
      })),

      citedDomains: data.citedDomains,

      findings: findings.slice(0, 5).map((f) => ({
        category: f.category,
        finding: f.finding,
        recommendation: f.recommendation,
        priority: f.priority,
      })),

      zusammenfassung,

      totalRuns: data.totalRuns,
      costEstimate: data.costEstimate,
      token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}
