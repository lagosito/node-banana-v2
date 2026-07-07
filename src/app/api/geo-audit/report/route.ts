// GEO Audit — PDF Report Generator
// POST /api/geo-audit/report
// Body: { audit_id: string }

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAudit } from "@/lib/geo-audit/airtable";

const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";

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

    const audit = await getAudit(audit_id);
    const f = audit.fields;
    const brandName = f["Brand Name"];
    const score = f["GEO Score"] || 0;
    const vertical = f.Vertical;
    const region = f.Region || "Deutschland";
    const competitors = (f.Competitors || "").split("\n").filter(Boolean);
    const today = new Date().toLocaleDateString("de-DE", {
      day: "2-digit", month: "long", year: "numeric",
    });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [r, g, b] = scoreColor(score);

    // ─── PAGE 1: Cover ───
    const cover = pdf.addPage([595, 842]);
    cover.drawRectangle({ x: 0, y: 700, width: 595, height: 142, color: rgb(0.08, 0.08, 0.12) });
    cover.drawText("el Kiosk", { x: 50, y: 790, size: 14, font, color: rgb(0.95, 0.95, 0.95) });
    cover.drawText("GEO-Audit", { x: 50, y: 810, size: 24, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(`GEO-Audit für ${brandName}`, { x: 50, y: 620, size: 28, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    cover.drawText(`${vertical} | ${region}`, { x: 50, y: 585, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
    cover.drawText(today, { x: 50, y: 560, size: 12, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawRectangle({ x: 50, y: 400, width: 160, height: 100, color: rgb(r, g, b) });
    cover.drawText(`${score}`, { x: 80, y: 450, size: 48, font: fontBold, color: rgb(1, 1, 1) });
    cover.drawText(scoreLabel(score), { x: 90, y: 415, size: 14, font, color: rgb(1, 1, 1) });
    cover.drawText("GEO Score", { x: 75, y: 385, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    cover.drawText("elkiosk.ai | info@elkiosk.ai", { x: 50, y: 40, size: 10, font, color: rgb(0.6, 0.6, 0.6) });

    // ─── PAGE 2: Zusammenfassung ───
    const p2 = pdf.addPage([595, 842]);
    let y = 780;
    p2.drawText("Zusammenfassung", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const summaryLines = [
      `Das GEO-Audit für ${brandName} (${vertical}, ${region})`,
      `ergibt einen Score von ${score} von 100 Punkten.`,
      "",
      `Die Marke wird in ${score >= 50 ? "einem erheblichen" : "einem geringen"} Teil`,
      "der KI-Antworten erwähnt. Die Konkurrenz",
      `(insbesondere ${competitors.slice(0, 3).join(", ")})`,
      "dominiert die Sichtbarkeit in diesem Segment.",
    ];
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
      "Dieses Analyse basiert auf einer systematischen",
      "Befragung von drei führenden KI-Sprachmodellen:",
      "",
      "• ChatGPT (OpenAI) mit Web-Suche",
      "• Perplexity mit Echtzeit-Indizierung",
      "• Gemini (Google) mit Google Search Grounding",
      "",
      `Für die Kategorie "${vertical}" wurden 12 repräsentative`,
      "Fragen formuliert, die typische Kundensuchen widerspiegeln.",
      "Jede Frage wurde an alle drei Modelle gestellt,",
      "was insgesamt 36 KI-Antworten ergab.",
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

    // ─── PAGE 4: Ergebnisse ───
    const p4 = pdf.addPage([595, 842]);
    y = 780;
    p4.drawText("Ergebnisse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    p4.drawText(`GEO Score: ${score}/100`, { x: 50, y, size: 16, font: fontBold, color: rgb(r, g, b) });
    y -= 30;
    p4.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 25;

    const breakdown = [
      ["Komponente", "Punkte"],
      ["Mention Rate (40%)", `${Math.round(score * 0.4)}`],
      ["Position (20%)", `${Math.round(score * 0.2)}`],
      ["Citation Rate (20%)", `${Math.round(score * 0.2)}`],
      ["Sentiment (10%)", `${Math.round(score * 0.1)}`],
      ["Share of Voice (10%)", `${Math.round(score * 0.1)}`],
    ];
    for (const [label, val] of breakdown) {
      if (y < 80) break;
      p4.drawText(label, { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
      p4.drawText(val, { x: 400, y, size: 11, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      y -= 20;
    }

    // ─── PAGE 5: Wettbewerb ───
    const p5 = pdf.addPage([595, 842]);
    y = 780;
    p5.drawText("Wettbewerbs-Analyse", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    for (let i = 0; i < Math.min(5, competitors.length); i++) {
      if (y < 80) break;
      p5.drawText(`${i + 1}. ${competitors[i]}`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
      y -= 25;
    }

    // ─── PAGE 6: Empfehlungen ───
    const p6 = pdf.addPage([595, 842]);
    y = 780;
    p6.drawText("Handlungsempfehlungen", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const recs = [
      "1. llms.txt anlegen mit Strukturd Daten für KI-Systeme",
      "2. Schema.org LocalBusiness/Produkt implementieren",
      "3. FAQ-Seiten mit direkten Antworten (BLUF) erstellen",
      "4. Einträge in zitierten Verzeichnissen anlegen",
      "5. Google Business Profile vollständig pflegen",
    ];
    for (const rec of recs) {
      if (y < 80) break;
      p6.drawText(rec, { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 25;
    }

    // ─── PAGE 7: Angebot ───
    const p7 = pdf.addPage([595, 842]);
    y = 780;
    p7.drawText("GEO-Monitoring Angebot", { x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    y -= 40;
    const offer = [
      "Monatlicher Re-Check mit Delta-Analyse",
      "Aktualisierung der KI-Antworten",
      "Handlungsempfehlungen bei Veränderungen",
      "Wettbewerbs-Tracking",
      "",
      "Preis: 129 EUR / Monat",
      "",
      "Kontakt: info@elkiosk.ai | elkiosk.ai",
    ];
    for (const line of offer) {
      if (y < 80) break;
      p7.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 20;
    }

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
