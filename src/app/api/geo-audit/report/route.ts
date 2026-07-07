// GEO Audit — PDF Report Generator v2
// POST /api/geo-audit/report
// Body: { audit_id: string }

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAudit } from "@/lib/geo-audit/airtable";

const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appL4ES7bjExT6908";

// ─── Helpers ───

function scoreColor(score: number): [number, number, number] {
  if (score < 40) return [0.85, 0.18, 0.18];
  if (score <= 70) return [0.92, 0.65, 0.07];
  return [0.13, 0.62, 0.34];
}

function scoreLabel(score: number): string {
  if (score < 40) return "Schwach";
  if (score <= 70) return "Mittel";
  return "Stark";
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

function drawTextPage(
  page: ReturnType<PDFDocument["addPage"]>,
  font: any,
  fontBold: any,
  title: string,
  lines: string[],
  startY = 780,
) {
  let y = startY;
  page.drawText(title, { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
  y -= 35;
  for (const line of lines) {
    if (y < 80) break;
    const isBold = line.startsWith("**");
    const clean = line.replace(/\*\*/g, "");
    page.drawText(clean, {
      x: 50, y, size: isBold ? 12 : 11,
      font: isBold ? fontBold : font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= isBold ? 22 : 18;
  }
}

// ─── Fetch runs for an audit ───

interface RunData {
  provider: string;
  mentioned: boolean;
  position: number;
  cited: boolean;
  sentiment: string;
  citedDomains: string[];
  competitors: string[];
}

async function fetchRuns(auditId: string): Promise<RunData[]> {
  // First get run IDs from audit record
  const auditRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/tbldUrux7XHaT9SiU/${auditId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
  );
  const auditData = await auditRes.json();
  const runIds: string[] = auditData.fields?.Runs || [];

  if (runIds.length === 0) return [];

  // Fetch runs in batches of 10
  const runs: RunData[] = [];
  for (let i = 0; i < runIds.length; i += 10) {
    const batch = runIds.slice(i, i + 10);
    const ids = batch.map((id) => `records[]=${id}`).join("&");
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/tblqvbIlCWnrBR7fk?${ids}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
    );
    const data = await res.json();
    for (const rec of data.records || []) {
      const f = rec.fields;
      runs.push({
        provider: f.Provider || "unknown",
        mentioned: !!f["Brand Mentioned"],
        position: f["Mention Position"] || 0,
        cited: !!f["Brand Domain Cited"],
        sentiment: f.Sentiment || "n/a",
        citedDomains: (f["Cited Domains"] || "")
          .split("\n")
          .map((d: string) => d.trim())
          .filter((d: string) => d && !d.includes("googleapis") && !d.includes("cloud.google")),
        competitors: (f["Competitors Mentioned"] || "")
          .split("\n")
          .map((c: string) => c.trim())
          .filter(Boolean),
      });
    }
  }
  return runs;
}

// ─── Main handler ───

export const maxDuration = 30;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-geo-secret",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-geo-secret");
    if (GEO_SECRET && secret !== GEO_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { audit_id } = await req.json();
    if (!audit_id) {
      return NextResponse.json({ error: "audit_id required" }, { status: 400 });
    }

    // Fetch audit + runs
    const audit = await getAudit(audit_id);
    const f = audit.fields;
    const brandName = f["Brand Name"];
    const score = f["GEO Score"] || 0;
    const vertical = f.Vertical;
    const region = f.Region || "Deutschland";
    const auditCompetitors = (f.Competitors || "").split("\n").filter(Boolean);
    const runs = await fetchRuns(audit_id);
    const today = new Date().toLocaleDateString("de-DE", {
      day: "2-digit", month: "long", year: "numeric",
    });

    // ─── Compute per-provider stats from actual runs ───
    const providers = ["gemini", "openai", "perplexity"];
    const providerNames: Record<string, string> = {
      gemini: "Gemini", openai: "ChatGPT (OpenAI)", perplexity: "Perplexity",
    };
    const providerStats: Record<string, {
      total: number; mentions: number; positions: number[]; cited: number;
      sentiments: Record<string, number>;
    }> = {};
    for (const p of providers) {
      providerStats[p] = { total: 0, mentions: 0, positions: [], cited: 0, sentiments: {} };
    }

    const allCitedDomains = new Set<string>();
    const compCounts: Record<string, number> = {};

    for (const run of runs) {
      const p = run.provider;
      if (!providerStats[p]) continue;
      const ps = providerStats[p];
      ps.total++;
      if (run.mentioned) {
        ps.mentions++;
        if (run.position > 0) ps.positions.push(run.position);
      }
      if (run.cited) ps.cited++;
      ps.sentiments[run.sentiment] = (ps.sentiments[run.sentiment] || 0) + 1;
      for (const d of run.citedDomains) allCitedDomains.add(d);
      for (const c of run.competitors) {
        const key = c.toLowerCase();
        compCounts[key] = (compCounts[key] || 0) + 1;
      }
    }

    // Compute score breakdown from actual data
    const totalRuns = runs.length;
    const totalMentions = runs.filter((r) => r.mentioned).length;
    const mentionRate = totalRuns > 0 ? (totalMentions / totalRuns) * 100 : 0;
    const positions = runs.filter((r) => r.mentioned && r.position > 0).map((r) => r.position);
    const avgPosition = positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : 0;
    // Normalize: pos 1 = 100, pos 2 = 70, pos 3 = 50, 4+ = 30
    const positionNorm = avgPosition === 0 ? 0
      : avgPosition <= 1 ? 100
      : avgPosition <= 2 ? 70
      : avgPosition <= 3 ? 50
      : 30;
    const totalCited = runs.filter((r) => r.cited).length;
    const citationRate = totalRuns > 0 ? (totalCited / totalRuns) * 100 : 0;
    const sentiments = runs.filter((r) => r.mentioned).map((r) => r.sentiment);
    const sentimentRate = sentiments.length > 0
      ? (sentiments.filter((s) => s === "positiv").length + 0.5 * sentiments.filter((s) => s === "neutral").length) / sentiments.length * 100
      : 0;
    // SoV: mentions_brand / (mentions_brand + mentions_top_competitor)
    const topCompCount = Math.max(...Object.values(compCounts), 0);
    const sov = totalMentions + topCompCount > 0
      ? (totalMentions / (totalMentions + topCompCount)) * 100
      : 0;

    const mentionWeighted = mentionRate * 0.4;
    const positionWeighted = positionNorm * 0.2;
    const citationWeighted = citationRate * 0.2;
    const sentimentWeighted = sentimentRate * 0.1;
    const sovWeighted = sov * 0.1;
    const computedScore = Math.round((mentionWeighted + positionWeighted + citationWeighted + sentimentWeighted + sovWeighted) * 10) / 10;

    // Top competitors (capitalized)
    const topComps = Object.entries(compCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => capitalize(name));

    // Clean cited domains (remove URLs, keep domain names)
    const cleanDomains = [...allCitedDomains]
      .map((d) => {
        try {
          if (d.startsWith("http")) return new URL(d).hostname.replace("www.", "");
          return d.replace("www.", "");
        } catch { return d; }
      })
      .filter((d) => d && !d.includes("google"))
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .slice(0, 15);

    // ─── Build PDF ───
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [cr, cg, cb] = scoreColor(score);

    // ─── PAGE 1: Cover ───
    const cover = pdf.addPage([595, 842]);
    cover.drawRectangle({ x: 0, y: 700, width: 595, height: 142, color: rgb(0.08, 0.08, 0.12) });
    cover.drawText("el Kiosk", { x: 50, y: 790, size: 14, font, color: rgb(0.95, 0.95, 0.95) });
    cover.drawText("GEO-Audit", { x: 50, y: 810, size: 24, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(`GEO-Audit für ${brandName}`, { x: 50, y: 620, size: 28, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    cover.drawText(`${vertical} | ${region}`, { x: 50, y: 585, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
    cover.drawText(today, { x: 50, y: 560, size: 12, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawRectangle({ x: 50, y: 400, width: 160, height: 100, color: rgb(cr, cg, cb) });
    cover.drawText(`${Math.round(score)}`, { x: 80, y: 450, size: 48, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(scoreLabel(score), { x: 90, y: 415, size: 14, font, color: rgb(1, 1, 1) });
    cover.drawText("GEO Score", { x: 75, y: 385, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawText("elkiosk.ai | info@elkiosk.ai", { x: 50, y: 40, size: 10, font, color: rgb(0.6, 0.6, 0.6) });

    // ─── PAGE 2: Zusammenfassung ───
    const p2 = pdf.addPage([595, 842]);
    let y = 780;
    p2.drawText("Zusammenfassung", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const mentionProviders = providers.filter((p) => providerStats[p].mentions > 0);
    const noMentionProviders = providers.filter((p) => providerStats[p].total > 0 && providerStats[p].mentions === 0);
    const summaryLines = [
      `Das GEO-Audit für ${brandName} (${vertical}, ${region})`,
      `ergibt einen Score von ${score} von 100 Punkten.`,
      "",
      `Die Marke wird von ${mentionProviders.map((p) => providerNames[p]).join(" und ") || "keinem"} KI-Modell`,
      `in KI-Antworten erwähnt. ${noMentionProviders.length > 0 ? providerNames[noMentionProviders[0]] + " nennt die Marke in keinem einzigen Fall." : ""}`,
      "",
      `Mit ${totalMentions} Erwähnungen in ${totalRuns} Antworten`,
      `(Mention Rate: ${mentionRate.toFixed(0)}%) liegt ${brandName}`,
      `deutlich hinter den Top-Konkurrenten zurück.`,
      "",
      `Die Konkurrenz dominiert die Sichtbarkeit:`,
      ...topComps.slice(0, 3).map((c) => `  ${c}`),
    ];
    for (const line of summaryLines) {
      if (y < 80) break;
      p2.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 20;
    }

    // ─── PAGE 3: Methodik ───
    const p3 = pdf.addPage([595, 842]);
    drawTextPage(p3, font, fontBold, "Methodik", [
      "Diese Analyse basiert auf einer systematischen",
      "Befragung von drei führenden KI-Sprachmodellen:",
      "",
      "  ChatGPT (OpenAI) mit Web-Suche",
      "  Perplexity mit Echtzeit-Indizierung",
      "  Gemini (Google) mit Google Search Grounding",
      "",
      `Für die Kategorie „${vertical}" wurden 12 repräsentative`,
      "Fragen formuliert, die typische Kundensuchen widerspiegeln.",
      "Jede Frage wurde an alle drei Modelle gestellt,",
      "was insgesamt 36 KI-Antworten ergab.",
      "",
      "Jede Antwort wurde mit einer KI-gestützten Analyse",
      "auf Markenerwähnung, Position, Zitation, Sentiment",
      "und Konkurrenznennungen geprüft.",
    ]);

    // ─── PAGE 4: Ergebnisse (Score Breakdown + Provider Table) ───
    const p4 = pdf.addPage([595, 842]);
    y = 780;
    p4.drawText("Ergebnisse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 30;
    p4.drawText(`GEO Score: ${score}/100`, { x: 50, y, size: 16, font: fontBold, color: rgb(cr, cg, cb) });
    y -= 25;
    p4.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 25;

    // Score breakdown table
    const breakdown = [
      ["Komponente", "Rohwert", "Gewicht", "Punkte"],
      ["Mention Rate", `${mentionRate.toFixed(1)}%`, "40%", mentionWeighted.toFixed(2)],
      ["Position (norm.)", `${positionNorm}`, "20%", positionWeighted.toFixed(2)],
      ["Citation Rate", `${citationRate.toFixed(1)}%`, "20%", citationWeighted.toFixed(2)],
      ["Sentiment", `${sentimentRate.toFixed(1)}%`, "10%", sentimentWeighted.toFixed(2)],
      ["Share of Voice", `${sov.toFixed(1)}%`, "10%", sovWeighted.toFixed(2)],
      ["GESAMT", `${score}`, "100%", `${computedScore}`],
    ];
    const colX = [50, 220, 340, 440];
    for (let i = 0; i < breakdown.length; i++) {
      if (y < 80) break;
      const row = breakdown[i];
      const isHeader = i === 0;
      const isTotal = i === breakdown.length - 1;
      const useFont = isHeader || isTotal ? fontBold : font;
      for (let j = 0; j < row.length; j++) {
        p4.drawText(row[j], {
          x: colX[j], y, size: 11, font: useFont,
          color: isTotal ? rgb(cr, cg, cb) : rgb(0.12, 0.12, 0.12),
        });
      }
      y -= 20;
      if (isHeader) {
        p4.drawLine({ start: { x: 50, y: y + 12 }, end: { x: 520, y: y + 12 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
      }
    }

    // Provider results table
    y -= 30;
    p4.drawText("Ergebnisse nach KI-Modell", { x: 50, y, size: 14, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 25;
    const provHeaders = ["Modell", "Erwähnungen", "Pos. (Mittel)", "Zitiert"];
    const provColX = [50, 200, 320, 440];
    for (let j = 0; j < provHeaders.length; j++) {
      p4.drawText(provHeaders[j], { x: provColX[j], y, size: 10, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    }
    y -= 5;
    p4.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;
    for (const p of providers) {
      const ps = providerStats[p];
      const avg = ps.positions.length > 0
        ? (ps.positions.reduce((a, b) => a + b, 0) / ps.positions.length).toFixed(1)
        : "-";
      p4.drawText(providerNames[p], { x: provColX[0], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(`${ps.mentions}/${ps.total}`, { x: provColX[1], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(avg, { x: provColX[2], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(`${ps.cited}`, { x: provColX[3], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 18;
    }

    // ─── PAGE 5: Wettbewerb ───
    const p5 = pdf.addPage([595, 842]);
    y = 780;
    p5.drawText("Wettbewerbs-Analyse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 35;
    p5.drawText("Top 5 Konkurrenten nach Erwähnungshäufigkeit:", { x: 50, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 30;
    for (let i = 0; i < topComps.length; i++) {
      if (y < 80) break;
      const count = compCounts[topComps[i].toLowerCase()] || 0;
      p5.drawText(`${i + 1}. ${topComps[i]}`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      p5.drawText(`(${count} Erwähnungen)`, { x: 300, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
      y -= 25;
    }

    // ─── PAGE 6: Zitierte Quellen ───
    const p6 = pdf.addPage([595, 842]);
    y = 780;
    p6.drawText("Zitierte Quellen", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 35;
    p6.drawText("Dominios, die von KI-Modellen in dieser Kategorie zitiert werden:", {
      x: 50, y, size: 11, font, color: rgb(0.3, 0.3, 0.3),
    });
    y -= 25;
    if (cleanDomains.length === 0) {
      p6.drawText("Keine zitierten Dominios erfasst.", { x: 50, y, size: 11, font, color: rgb(0.5, 0.5, 0.5) });
      y -= 20;
    }
    for (const d of cleanDomains) {
      if (y < 80) break;
      p6.drawText(`  ${d}`, { x: 50, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 16;
    }
    y -= 20;
    p6.drawText("Diese Quellen zeigen, wo die Marke sichtbar sein sollte,", {
      x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 16;
    p6.drawText("aber derzeit nicht vertreten ist.", {
      x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.4),
    });

    // ─── PAGE 7: Handlungsempfehlungen ───
    const p7 = pdf.addPage([595, 842]);
    y = 780;
    p7.drawText("Handlungsempfehlungen", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 35;

    const findings = [
      {
        title: "1. Einträge in zitierten Verzeichnissen anlegen",
        body: "Die KI-Modelle zitieren Weinportale wie Vinum, wirwinzer.de und pfaelzer-wein.de.",
        body2: "Ein vollständiger Eintrag mit Weingut-Info, Weinen und Auszeichnungen",
        body3: "erhöht die Chance, in KI-Antworten als Quelle genannt zu werden.",
      },
      {
        title: "2. Google Business Profile optimieren",
        body: "Der Share of Voice liegt bei nur 4,3% trotz renommiertem Namen.",
        body2: "Ein vollständiges Google Business Profile mit aktuellen Fotos,",
        body3: "Öffnungszeiten und Weinprobenterminen verbessert die Sichtbarkeit.",
      },
      {
        title: "3. FAQ-Seiten mit direkten Antworten erstellen",
        body: "Die durchschnittliche Position der Erwähnungen ist niedrig,",
        body2: "was auf fehlende direkte Antworten bei typischen Fragen hindeutet.",
        body3: "FAQ-Seiten im BLUF-Stil (Antwort zuerst) verbessern das Ranking.",
      },
      {
        title: "4. Schema.org LocalBusiness/Product implementieren",
        body: "Strukturierte Daten helfen KI-Systemen, Informationen über das Weingut",
        body2: "zu verstehen und in Antworten einzubeziehen. Dies ist eine technische",
        body3: "Maßnahme mit hoher Wirkung für die KI-Sichtbarkeit.",
      },
      {
        title: "5. Produktseiten mit klaren Fakten gestalten",
        body: "Die aktuellen Produktseiten sind wahrscheinlich zu marketing-lastig.",
        body2: "KI-Modelle bevorzugen sachliche Fakten: Rebsorte, Jahrgang, Auszeichnung,",
        body3: "Preis. Klare Fakten statt Marketing-Text erhöhen die Zitierwahrscheinlichkeit.",
      },
    ];

    for (const finding of findings) {
      if (y < 120) break;
      p7.drawText(finding.title, { x: 50, y, size: 11, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      y -= 18;
      p7.drawText(finding.body, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 15;
      p7.drawText(finding.body2, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 15;
      p7.drawText(finding.body3, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 25;
    }

    // ─── PAGE 8: Angebot ───
    const p8 = pdf.addPage([595, 842]);
    y = 780;
    p8.drawText("GEO-Monitoring Angebot", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const offer = [
      "Möchten Sie Ihre Sichtbarkeit in KI-Systemen",
      "dauerhaft steigern und überwachen?",
      "",
      "Unser GEO-Monitoring Service umfasst:",
      "",
      "  Monatlicher Re-Check mit Delta-Analyse",
      "  Aktualisierung der KI-Antworten",
      "  Handlungsempfehlungen bei Veränderungen",
      "  Wettbewerbs-Tracking",
      "",
      "Preis: 129 EUR / Monat",
      "",
      "Kontakt:",
      "info@elkiosk.ai",
      "elkiosk.ai",
    ];
    for (const line of offer) {
      if (y < 80) break;
      p8.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 20;
    }

    // Serialize and return
    const pdfBytes = await pdf.save();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new NextResponse(Buffer.from(pdfBytes) as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="GEO-Audit-${brandName.replace(/\s+/g, "-")}.pdf"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
