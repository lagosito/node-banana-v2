// GEO Audit — PDF Report Generator v3
// Single source of truth: reads ONLY from "Results JSON" field on the audit record.
// No queries to Runs table, no recalculation.

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAudit } from "@/lib/geo-audit/airtable";
import type { ResultsJSON } from "@/lib/geo-audit/runner";

// ─── Normalize Results JSON (backward compatibility) ───
function normalizeResultsJSON(raw: any): ResultsJSON {
  if (raw.breakdown && raw.providerTable && raw.citedDomains) return raw as ResultsJSON;
  const s = raw.score || { total: 0, mentionRate: 0, mentionWeighted: 0, positionAvg: 0, positionWeighted: 0, citationRate: 0, citationWeighted: 0, sentimentRate: 0, sentimentWeighted: 0, sov: 0, sovWeighted: 0 };
  return {
    brand: raw.brand||'', vertical: raw.vertical||'', region: raw.region||'',
    date: raw.date||new Date().toISOString().split('T')[0],
    totalRuns: raw.totalRuns||0, expectedRuns: raw.expectedRuns||raw.totalRuns||0, score: s,
    breakdown: raw.breakdown||[
      {component:'Mention Rate',raw:s.mentionRate+'%',weight:'40',points:(s.mentionWeighted||0).toFixed(2)},
      {component:'Position',raw:''+s.positionAvg,weight:'20',points:(s.positionWeighted||0).toFixed(2)},
      {component:'Citation Rate',raw:s.citationRate+'%',weight:'20',points:(s.citationWeighted||0).toFixed(2)},
      {component:'Sentiment',raw:s.sentimentRate+'%',weight:'10',points:(s.sentimentWeighted||0).toFixed(2)},
      {component:'Share of Voice',raw:s.sov+'%',weight:'10',points:(s.sovWeighted||0).toFixed(2)},
      {component:'GESAMT',raw:'',weight:'100',points:(s.total||0).toFixed(2)},
    ],
    providerTable: raw.providerTable||Object.entries(raw.runSummary||{}).map(([n,i]:[string,any])=>({name:n,runs:i.completed||0,mentions:0,avgPosition:0,cited:0})),
    topCompetitors: Array.isArray(raw.topCompetitors)?raw.topCompetitors.map((c:any)=>typeof c==='string'?{name:c,count:1}:c):[],
    citedDomains: raw.citedDomains||[],
    runSummary: raw.runSummary||{},errors:raw.errors||[],costEstimate:raw.costEstimate||0,
  };
}
const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";

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
/** Sanitize text for pdf-lib Helvetica (non-ASCII unsupported) */
function sanitize(text: string): string {
  return text.replace(/[^\x00-\x7F]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code === 0xe4) return 'ae';
    if (code === 0xf6) return 'oe';
    if (code === 0xfc) return 'ue';
    if (code === 0xc4) return 'Ae';
    if (code === 0xd6) return 'Oe';
    if (code === 0xdc) return 'Ue';
    if (code === 0xdf) return 'ss';
    if (code === 0x2248) return '~';
    if (code === 0x2265) return '>=';
    if (code === 0x2264) return '<=';
    if (code === 0x00d7) return 'x';
    if (code === 0x2013 || code === 0x2014) return '-';
    if (code === 0x201c || code === 0x201d) return '"';
    if (code === 0x2018 || code === 0x2019) return "'";
    if (code === 0x2022 || code === 0x2023) return '-';
    return '';
  });
}

// ─── QA Gate ───

function validateResultsJSON(data: ResultsJSON): string[] {
  const errors: string[] = [];

  // 1. Check breakdown sums to total
  const sum = data.breakdown
    .filter((b) => b.component !== "GESAMT")
    .reduce((s, b) => s + parseFloat(b.points), 0);
  const gesamt = parseFloat(data.breakdown.find((b) => b.component === "GESAMT")?.points || "0");
  if (Math.abs(Math.round(sum * 10) / 10 - gesamt) > 0.2) {
    errors.push(`Breakdown sum ${sum.toFixed(2)} != GESAMT ${gesamt}`);
  }

  // 2. Check provider table runs add up
  const providerRuns = data.providerTable.reduce((s, p) => s + p.runs, 0);
  if (providerRuns !== data.totalRuns) {
    errors.push(`Provider runs ${providerRuns} != totalRuns ${data.totalRuns}`);
  }

  // 3. Check no duplicate cited domains
  const uniqueDomains = new Set(data.citedDomains);
  if (uniqueDomains.size !== data.citedDomains.length) {
    errors.push(`Duplicate cited domains: ${data.citedDomains.length} total, ${uniqueDomains.size} unique`);
  }

  return errors;
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

    // Fetch audit record
    const audit = await getAudit(audit_id);
    const f = audit.fields;

    // Read Results JSON — SINGLE SOURCE OF TRUTH
    const resultsJSONRaw = f["Results JSON"];
    if (!resultsJSONRaw) {
      return NextResponse.json({
        error: "No Results JSON found. Run the audit first (Status must be Done).",
      }, { status: 400 });
    }

    const data: ResultsJSON = normalizeResultsJSON(JSON.parse(resultsJSONRaw as string));

    // QA Gate
    const qaErrors = validateResultsJSON(data);
    if (qaErrors.length > 0) {
      return NextResponse.json({
        error: "QA gate failed",
        details: qaErrors,
      }, { status: 422 });
    }

    const { brand, vertical, region, date, score, breakdown, providerTable,
      topCompetitors, citedDomains, costEstimate } = data;
    const today = new Date(date).toLocaleDateString("de-DE", {
      day: "2-digit", month: "long", year: "numeric",
    });

    // ─── Build PDF ───
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [cr, cg, cb] = scoreColor(score.total);

    // ─── PAGE 1: Cover ───
    const cover = pdf.addPage([595, 842]);
    cover.drawRectangle({ x: 0, y: 700, width: 595, height: 142, color: rgb(0.08, 0.08, 0.12) });
    cover.drawText("el Kiosk", { x: 50, y: 790, size: 14, font, color: rgb(0.95, 0.95, 0.95) });
    cover.drawText("GEO-Audit", { x: 50, y: 810, size: 24, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(`GEO-Audit für ${brand}`, { x: 50, y: 620, size: 28, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    cover.drawText(`${vertical} | ${region}`, { x: 50, y: 585, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
    cover.drawText(today, { x: 50, y: 560, size: 12, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawRectangle({ x: 50, y: 400, width: 160, height: 100, color: rgb(cr, cg, cb) });
    cover.drawText(`${Math.round(score.total)}`, { x: 80, y: 450, size: 48, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(scoreLabel(score.total), { x: 90, y: 415, size: 14, font, color: rgb(1, 1, 1) });
    cover.drawText("GEO Score", { x: 75, y: 385, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawText("elkiosk.ai | info@elkiosk.ai", { x: 50, y: 40, size: 10, font, color: rgb(0.6, 0.6, 0.6) });

    // ─── PAGE 2: Zusammenfassung ───
    const p2 = pdf.addPage([595, 842]);
    let y = 780;
    p2.drawText("Zusammenfassung", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    // Generate clean summary from data
    const mentionProviders = providerTable.filter((p) => p.mentions > 0).map((p) => p.name);
    const noMentionProviders = providerTable.filter((p) => p.runs > 0 && p.mentions === 0).map((p) => p.name);
    const summaryLines = [
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
    for (const line of summaryLines) {
      if (y < 80) break;
      p2.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 20;
    }

    // ─── PAGE 3: Methodik ───
    const p3 = pdf.addPage([595, 842]);
    y = 780;
    p3.drawText("Methodik", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const methodLines = [
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
      `was insgesamt ${data.totalRuns} KI-Antworten ergab.`,
      "",
      "Jede Antwort wurde mit einer KI-gestützten Analyse",
      "auf Markenerwähnung, Position, Zitation, Sentiment",
      "und Konkurrenznennungen geprüft.",
    ];
    for (const line of methodLines) {
      if (y < 80) break;
      p3.drawText(line, { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 18;
    }

    // ─── PAGE 4: Ergebnisse (Score Breakdown + Provider Table) ───
    const p4 = pdf.addPage([595, 842]);
    y = 780;
    p4.drawText("Ergebnisse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 30;
    p4.drawText(`GEO Score: ${score.total}/100`, { x: 50, y, size: 16, font: fontBold, color: rgb(cr, cg, cb) });
    y -= 25;
    p4.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 25;

    // Score breakdown from JSON
    const colX = [50, 220, 340, 440];
    const headers = ["Komponente", "Rohwert", "Gewicht", "Punkte"];
    for (let j = 0; j < headers.length; j++) {
      p4.drawText(headers[j], { x: colX[j], y, size: 10, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    }
    y -= 5;
    p4.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;

    for (const row of breakdown) {
      if (y < 80) break;
      const isTotal = row.component === "GESAMT";
      const useFont = isTotal ? fontBold : font;
      const vals = [row.component, row.raw, row.weight, row.points];
      for (let j = 0; j < vals.length; j++) {
        p4.drawText(vals[j], {
          x: colX[j], y, size: 10, font: useFont,
          color: isTotal ? rgb(cr, cg, cb) : rgb(0.12, 0.12, 0.12),
        });
      }
      y -= 18;
    }

    // Provider table from JSON
    y -= 25;
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
    for (const row of providerTable) {
      p4.drawText(row.name, { x: provColX[0], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(`${row.mentions}/${row.runs}`, { x: provColX[1], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(`${row.avgPosition || "-"}`, { x: provColX[2], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(`${row.cited}`, { x: provColX[3], y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 18;
    }

    // ─── PAGE 5: Wettbewerb ───
    const p5 = pdf.addPage([595, 842]);
    y = 780;
    p5.drawText("Wettbewerbs-Analyse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 35;
    p5.drawText("Top 5 Konkurrenten nach Erwähnungshäufigkeit:", { x: 50, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 30;
    for (let i = 0; i < topCompetitors.length; i++) {
      if (y < 80) break;
      p5.drawText(`${i + 1}. ${topCompetitors[i].name}`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      p5.drawText(`(${topCompetitors[i].count} Erwähnungen)`, { x: 300, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
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
    if (citedDomains.length === 0) {
      p6.drawText("Keine zitierten Dominios erfasst.", { x: 50, y, size: 11, font, color: rgb(0.5, 0.5, 0.5) });
      y -= 20;
    }
    for (const d of citedDomains) {
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

    // Findings based on actual data
    const findings: { title: string; lines: string[] }[] = [];

    if (score.citationRate === 0) {
      findings.push({
        title: "1. Einträge in zitierten Verzeichnissen anlegen",
        lines: [
          "Die KI-Modelle zitieren Weinportale wie Vinum und wirwinzer.de.",
          "Ein vollständiger Eintrag mit Weingut-Info, Weinen und Auszeichnungen",
          "erhöht die Chance, in KI-Antworten als Quelle genannt zu werden.",
        ],
      });
    }
    if (score.sov < 10) {
      findings.push({
        title: "2. Google Business Profile optimieren",
        lines: [
          `Der Share of Voice liegt bei nur ${score.sov}% trotz renommiertem Namen.`,
          "Ein vollständiges Google Business Profile mit aktuellen Fotos,",
          "Öffnungszeiten und Weinprobenterminen verbessert die Sichtbarkeit.",
        ],
      });
    }
    if (score.positionAvg < 50) {
      findings.push({
        title: "3. FAQ-Seiten mit direkten Antworten erstellen",
        lines: [
          "Die durchschnittliche Position der Erwähnungen ist niedrig,",
          "was auf fehlende direkte Antworten bei typischen Fragen hindeutet.",
          "FAQ-Seiten im BLUF-Stil (Antwort zuerst) verbessern das Ranking.",
        ],
      });
    }
    if (score.mentionRate < 60) {
      findings.push({
        title: "4. Schema.org LocalBusiness/Product implementieren",
        lines: [
          "Strukturierte Daten helfen KI-Systemen, Informationen über das Weingut",
          "zu verstehen und in Antworten einzubeziehen. Dies ist eine technische",
          "Maßnahme mit hoher Wirkung für die KI-Sichtbarkeit.",
        ],
      });
    }
    findings.push({
      title: "5. Produktseiten mit klaren Fakten gestalten",
      lines: [
        "Die aktuellen Produktseiten sind wahrscheinlich zu marketing-lastig.",
        "KI-Modelle bevorzugen sachliche Fakten: Rebsorte, Jahrgang, Auszeichnung,",
        "Preis. Klare Fakten statt Marketing-Text erhöhen die Zitierwahrscheinlichkeit.",
      ],
    });

    for (const finding of findings.slice(0, 5)) {
      if (y < 100) break;
      p7.drawText(finding.title, { x: 50, y, size: 11, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      y -= 18;
      for (const line of finding.lines) {
        p7.drawText(line, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 15;
      }
      y -= 10;
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
        "Content-Disposition": `attachment; filename="GEO-Audit-${brand.replace(/\s+/g, "-")}.pdf"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
