// GEO Audit — PDF Report Generator
// POST /api/geo-audit/report
// Body: { audit_id: string }

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAudit, getConfig } from "@/lib/geo-audit/airtable";

const GEO_SECRET = process.env.GEO_AUDIT_SECRET || "";

// Score color: red <40, yellow 40-70, green >70
function scoreColor(score: number): [number, number, number] {
  if (score < 40) return [0.85, 0.18, 0.18]; // red
  if (score <= 70) return [0.92, 0.65, 0.07]; // yellow/amber
  return [0.13, 0.62, 0.34]; // green
}

function scoreLabel(score: number): string {
  if (score < 40) return "Schwach";
  if (score <= 70) return "Mittel";
  return "Stark";
}

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

    // Fetch audit data
    const audit = await getAudit(audit_id);
    const f = audit.fields;
    const brandName = f["Brand Name"];
    const score = f["GEO Score"] || 0;
    const vertical = f.Vertical;
    const region = f.Region || "Deutschland";
    const competitors = (f.Competitors || "").split("\n").filter(Boolean);
    const today = new Date().toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // Build PDF with pdf-lib (works on Vercel, no Puppeteer needed)
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [r, g, b] = scoreColor(score);

    // ─── PAGE 1: Cover ───
    const cover = pdf.addPage([595, 842]); // A4
    // Background accent bar
    cover.drawRectangle({
      x: 0, y: 700, width: 595, height: 142,
      color: rgb(0.08, 0.08, 0.12),
    });
    // "el Kiosk" branding
    cover.drawText("el Kiosk", {
      x: 50, y: 790, size: 14, font, color: rgb(0.95, 0.95, 0.95),
    });
    cover.drawText("GEO-Audit", {
      x: 50, y: 810, size: 24, font: fontBold, color: rgb(1, 1, 1),
    });
    // Title
    cover.drawText(`GEO-Audit für ${brandName}`, {
      x: 50, y: 620, size: 28, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    cover.drawText(`${vertical} | ${region}`, {
      x: 50, y: 585, size: 14, font, color: rgb(0.4, 0.4, 0.4),
    });
    cover.drawText(today, {
      x: 50, y: 560, size: 12, font, color: rgb(0.5, 0.5, 0.5),
    });
    // Score circle (approximated with rectangle)
    cover.drawRectangle({
      x: 50, y: 400, width: 160, height: 100,
      color: rgb(r, g, b), borderRadius: 12,
    });
    cover.drawText(`${score}`, {
      x: 80, y: 450, size: 48, font: fontBold, color: rgb(1, 1, 1),
    });
    cover.drawText(scoreLabel(score), {
      x: 90, y: 415, size: 14, font, color: rgb(1, 1, 1),
    });
    cover.drawText("GEO Score", {
      x: 75, y: 385, size: 10, font, color: rgb(0.5, 0.5, 0.5),
    });
    // Footer
    cover.drawText("elkiosk.ai | info@elkiosk.ai", {
      x: 50, y: 40, size: 10, font, color: rgb(0.6, 0.6, 0.6),
    });

    // ─── PAGE 2: Zusammenfassung ───
    const p2 = pdf.addPage([595, 842]);
    let y = 780;
    p2.drawText("Zusammenfassung", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    y -= 40;

    // Auto-generated summary (placeholder — will be enhanced with Claude)
    const summaryLines = [
      `Das GEO-Audit für ${brandName} (${vertical}, ${region})`,
      `ergibt einen Score von ${score} von 100 Punkten.`,
      ``,
      `Die Marke wird in ${score >= 50 ? "einem erheblichen" : "einem geringen"} Teil`,
      `der KI-Antworten erwähnt. Die Konkurrenz`,
      `(insbesondere ${competitors.slice(0, 3).join(", ")})`,
      `dominiert die Sichtbarkeit in diesem Segment.`,
    ];
    for (const line of summaryLines) {
      if (y < 80) break;
      p2.drawText(line, {
        x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2),
      });
      y -= 20;
    }

    // ─── PAGE 3: Methodik ───
    const p3 = pdf.addPage([595, 842]);
    y = 780;
    p3.drawText("Methodik", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
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
      p3.drawText(line, {
        x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
    }

    // ─── PAGE 4: Ergebnisse (Score Breakdown) ───
    const p4 = pdf.addPage([595, 842]);
    y = 780;
    p4.drawText("Ergebnisse", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    y -= 40;

    // Score breakdown table
    const breakdown = [
      ["Komponente", "Wert", "Gewicht", "Punkte"],
      ["Mention Rate", `${score}%`, "40%", `${Math.round(score * 0.4)}`],
      ["Position", "varies", "20%", "varies"],
      ["Citation Rate", "varies", "20%", "varies"],
      ["Sentiment", "varies", "10%", "varies"],
      ["Share of Voice", "varies", "10%", "varies"],
      ["GESAMT", `${score}`, "100%", `${score}`],
    ];

    for (const row of breakdown) {
      if (y < 80) break;
      const isHeader = row[0] === "Komponente";
      const isTotal = row[0] === "GESAMT";
      const useFont = isHeader || isTotal ? fontBold : font;
      const clr = isTotal ? rgb(r, g, b) : rgb(0.12, 0.12, 0.12);
      p4.drawText(row[0], { x: 50, y, size: 11, font: useFont, color: clr });
      p4.drawText(row[1], { x: 250, y, size: 11, font: useFont, color: clr });
      p4.drawText(row[2], { x: 350, y, size: 11, font: useFont, color: clr });
      p4.drawText(row[3], { x: 450, y, size: 11, font: useFont, color: clr });
      y -= 20;
      if (isHeader) {
        p4.drawLine({
          start: { x: 50, y: y + 12 }, end: { x: 520, y: y + 12 },
          thickness: 1, color: rgb(0.8, 0.8, 0.8),
        });
      }
    }

    // ─── PAGE 5: Wettbewerbs-Analyse ───
    const p5 = pdf.addPage([595, 842]);
    y = 780;
    p5.drawText("Wettbewerbs-Analyse", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    y -= 40;
    p5.drawText("Top 5 Konkurrenten nach Erwähnungshäufigkeit:", {
      x: 50, y, size: 12, font, color: rgb(0.3, 0.3, 0.3),
    });
    y -= 30;

    for (let i = 0; i < Math.min(5, competitors.length); i++) {
      if (y < 80) break;
      p5.drawText(`${i + 1}. ${competitors[i]}`, {
        x: 50, y, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12),
      });
      y -= 25;
    }

    // ─── PAGE 6: Handlungsempfehlungen ───
    const p6 = pdf.addPage([595, 842]);
    y = 780;
    p6.drawText("Handlungsempfehlungen", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    y -= 40;

    const recommendations = [
      { title: "1. llms.txt anlegen", body: "Strukturierte Datei für KI-Systeme mit Kerninformationen über das Weingut." },
      { title: "2. Schema.org implementieren", body: "LocalBusiness/Produkt-Daten für bessere Auffindbarkeit." },
      { title: "3. FAQ-Seiten erstellen", body: "Direkte Antworten auf häufige Fragen (BLUF-Prinzip)." },
      { title: "4. Verzeichnisse nutzen", body: "Einträge in zitierten Weinführern und Presseportalen." },
      { title: "5. Google Business Profile", body: "Vollständige Pflege mit Fotos, Öffnungszeiten, Events." },
    ];

    for (const rec of recommendations) {
      if (y < 80) break;
      p6.drawText(rec.title, {
        x: 50, y, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12),
      });
      y -= 18;
      p6.drawText(rec.body, {
        x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3),
      });
      y -= 30;
    }

    // ─── PAGE 7: Angebot ───
    const p7 = pdf.addPage([595, 842]);
    y = 780;
    p7.drawText("GEO-Monitoring Angebot", {
      x: 50, y, size: 20, font: fontBold, color: rgb(0.12, 0.12, 0.12),
    });
    y -= 40;
    const offerLines = [
      "Möchten Sie Ihre Sichtbarkeit in KI-Systemen",
      "dauerhaft steigern und überwachen?",
      "",
      "Unser GEO-Monitoring Service umfasst:",
      "",
      "• Monatlicher Re-Check mit Delta-Analyse",
      "• Aktualisierung der KI-Antworten",
      "• Handlungsempfehlungen bei Veränderungen",
      "• Wettbewerbs-Tracking",
      "",
      "Preis: 129 EUR / Monat",
      "",
      "Kontakt:",
      "info@elkiosk.ai",
      "elkiosk.ai",
    ];
    for (const line of offerLines) {
      if (y < 80) break;
      p7.drawText(line, {
        x: 50, y, size: 12, font, color: rgb(0.2, 0.2, 0.2),
      });
      y -= 20;
    }

    // Serialize PDF
    const pdfBytes = await pdf.save();

    // Return PDF as response
    return new NextResponse(pdfBytes, {
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
