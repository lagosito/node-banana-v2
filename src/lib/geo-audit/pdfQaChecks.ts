// GEO Audit — Post-render QA via text width measurement
// Checks for actual truncation issues (words too long for line width).

import type { ResultsJSON } from "@/lib/geo-audit/runner";

interface Finding {
  title: string;
  lines: string[];
}

interface TruncationCheck {
  passed: boolean;
  details: string[];
}

/**
 * Check if a single word fits within a given width.
 * Returns true if the word fits, false if it would be truncated.
 */
function wordFits(word: string, font: any, fontSize: number, maxWidth: number): boolean {
  if (!word) return true;
  const width = font.widthOfTextAtSize(word, fontSize);
  return width <= maxWidth;
}

/**
 * Build a text representation of what the PDF will contain.
 * Used as the "source" for QA comparison.
 */
export function buildPdfTextRepresentation(data: ResultsJSON, findings: Finding[]): string {
  const { brand, vertical, region, score, breakdown, providerTable, topCompetitors, citedDomains, totalRuns } = data;
  const mentionCount = Math.round(totalRuns * score.mentionRate / 100);

  return [
    `GEO-Audit für ${brand}`,
    `Score: ${Math.round(score.total)}/100`,
    `Zusammenfassung: Score ${score.total}, Mention Rate ${score.mentionRate}%, ${mentionCount} Erwähnungen von ${totalRuns}`,
    `Ergebnisse: GEO Score ${score.total}/100`,
    ...breakdown.map((b) => `${b.component}: Rohwert ${b.raw}, Gewicht ${b.weight}, Punkte ${b.points}`),
    `Ergebnisse nach KI-Modell:`,
    ...providerTable.map((p) => `${p.name}: ${p.mentions}/${p.runs}, Position ${p.avgPosition}, Zitiert ${p.cited}`),
    `Wettbewerb: ${topCompetitors.map((c) => `${c.name} (${c.count} Erwähnungen)`).join(", ")}`,
    `Zitierte Quellen: ${citedDomains.join(", ")}`,
    `Handlungsempfehlungen:`,
    ...findings.map((f) => `${f.title}: ${f.lines.join(" ")}`),
  ].join("\n");
}

/**
 * Check for text truncation in PDF rendering.
 * Only flags critical issues: words too long for line width.
 * Text wrapping is handled by the PDF renderer.
 */
export function checkPdfTruncation(
  data: ResultsJSON,
  findings: Finding[],
  font: any,
  fontBold: any,
): TruncationCheck {
  const details: string[] = [];
  const maxWidth = 495; // 595 - 50 - 50 margins

  // Check if any single word is too long to fit on a line
  const checkText = (text: string, f: any, size: number, label: string) => {
    const words = text.split(" ");
    for (const word of words) {
      if (!wordFits(word, f, size, maxWidth)) {
        details.push(`${label} has word too long: "${word.slice(0, 30)}..."`);
      }
    }
  };

  // Check cover page
  checkText(`GEO-Audit für ${data.brand}`, fontBold, 28, "Cover title");

  // Check findings
  for (const finding of findings) {
    checkText(finding.title, fontBold, 11, "Finding title");
    for (const line of finding.lines) {
      checkText(line, font, 10, "Finding line");
    }
  }

  return {
    passed: details.length === 0,
    details,
  };
}
