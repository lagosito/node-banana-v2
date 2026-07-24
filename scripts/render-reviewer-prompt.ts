// Render the real reviewer prompt for schlenkerla.de
import { collectFacts } from '../src/lib/geo-check/crawler';
import { scoreReport } from '../src/lib/geo-check/scoring';

async function main() {
  const facts = await collectFacts('https://www.schlenkerla.de');
  const scores = scoreReport(facts);

  const findings: Array<{type:'finding'|'recommendation';text:string;category:string}> = [];
  for (const [key,cat] of Object.entries(scores.categoryScores)) {
    for (const check of cat.checks) {
      findings.push({
        type: check.passed ? 'recommendation' : 'finding',
        text: check.label + ': ' + check.detail,
        category: key,
      });
    }
  }

  const factsSummary = {
    meta: { title: facts.meta.title, description: facts.meta.description, canonical: facts.meta.canonical, htmlLang: facts.meta.htmlLang },
    schema: { jsonLdBlocks: facts.schema.jsonLdBlocks, jsonLdValid: facts.schema.jsonLdValid, types: facts.schema.types, hasOrganization: facts.schema.hasOrganization, organizationComplete: facts.schema.organizationComplete.complete, hasFAQ: facts.schema.hasFAQ },
    crawlers: { allowed: facts.crawlers.allowed, total: facts.crawlers.total, blocked: facts.crawlers.blocked },
    llmsTxt: facts.llmsTxt,
    sitemap: { found: facts.sitemap.found, urlCount: facts.sitemap.urlCount },
    eeat: { hasAuthor: facts.eeat.hasAuthor, hasImpressum: facts.eeat.hasImpressum, hasPrivacy: facts.eeat.hasPrivacy, hasContact: facts.eeat.hasContact, trustScore: facts.eeat.trustScore },
    content: { wordCount: facts.content.wordCount, h1Count: facts.content.h1Count, h2Count: facts.content.h2Count, questionHeadings: facts.content.questionHeadings, bulletPoints: facts.content.bulletPoints, hasFaqSection: facts.content.hasFaqSection },
    freshness: { freshnessScore: facts.freshness.freshnessScore, daysSinceUpdate: facts.freshness.daysSinceUpdate },
    perf: { ttfbMs: facts.perf.ttfbMs, htmlSizeKb: facts.perf.htmlSizeKb, psi: facts.perf.psi },
  };

  const scoresSummary: Record<string, number> = {};
  for (const [k,v] of Object.entries(scores.categoryScores)) { scoresSummary[k] = v.score; }

  const findingsText = findings.map((f,i) => `[${i}] (${f.type}) ${f.text}`).join('\n');

  const summary = `Ihre Website schlenkerla.de erreicht ${scores.overallScore}/100 Punkte. ${scores.verdictHeadline}`;

  const prompt = `Du bist ein Faktenpruefer. Deine Aufgabe: Pruefe jeden Finding und jede Empfehlung gegen die nachfolgenden VeraifiziertenFakten. Gib JEDEN Index zurueck mit einem Urteil.

REGELN:
1. Wenn ein Finding etwas behauptet, das NICHT in den VeraifiziertenFakten steht, ist es "drop" oder "weaken".
2. "Kein JSON-LD" ist nur gueltig wenn jsonLdBlocks === 0.
3. "Kein Impressum" ist nur gueltig wenn hasImpressum === false.
4. Zahlen im Summary und Headline muessen EXAKT mit den categoryScores uebereinstimmen.
5. Wenn ein Finding korrekt ist und durch die Fakten gestuetzt wird, ist es "keep".

VERIFIZIERTE FAKTEN:
${JSON.stringify(factsSummary, null, 2)}

CATEGORY SCORES:
${JSON.stringify(scoresSummary, null, 2)}

FINDINGS UND EMPFEHLUNGEN:
${findingsText}

ZUSAMMENFASSUNG:
${summary}

URTEILS-TITEL:
${scores.verdictHeadline}

Antworte mit einem JSON-Array. Fuer JEDEN Index (0 bis N-1):
{
  "index": 0,
  "verdict": "keep"|"weaken"|"drop",
  "reason": "Kurze Begruendung"
}

Fuer summary und headline:
{
  "index": "summary",
  "verdict": "keep"|"weaken"|"drop",
  "reason": "..."
}
{
  "index": "headline",
  "verdict": "keep"|"weaken"|"drop",
  "reason": "..."
}

Antworte NUR mit dem JSON-Array, kein extra Text.`;

  // Write to file for inspection
  const fs = await import('fs');
  fs.writeFileSync('/tmp/reviewer-prompt-rendered.txt', prompt);

  console.log('=== RENDERED PROMPT ===');
  console.log(prompt);
  console.log('=== STATS ===');
  console.log('chars:', prompt.length);
  console.log('estimated_tokens:', Math.ceil(prompt.length / 4));
  console.log('findings_count:', findings.length);
  console.log('overall_score:', scores.overallScore);
  console.log('verdict:', scores.verdictLabel);
}

main().catch(console.error);
