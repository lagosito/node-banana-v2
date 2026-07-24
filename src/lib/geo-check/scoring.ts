// GEO Check — Deterministic Scoring (zero LLM cost)
// Converts VerifiedFacts into category scores, citability, and overall score.
// Every number has a check array explaining it.

import type { VerifiedFacts } from "./crawler";

// ─── Types ───

export interface ScoreCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
  evidence: string;
}

export interface CategoryScore {
  score: number; // 0-100
  checks: ScoreCheck[];
}

export interface CitabilityBreakdown {
  machineReadable: number; // 0-35
  answerStructure: number; // 0-35
  trust: number; // 0-30
}

export interface CitabilityScore {
  score: number; // 0-100
  breakdown: CitabilityBreakdown;
  checks: ScoreCheck[];
}

export interface ScoringResult {
  categoryScores: {
    technik: CategoryScore;
    aiReadiness: CategoryScore;
    content: CategoryScore;
    trust: CategoryScore;
    seo: CategoryScore;
    designUx: CategoryScore;
    performance: CategoryScore;
    aiVisibility: CategoryScore; // placeholder, filled by runner
  };
  citability: CitabilityScore;
  overallScore: number;
  verdictLabel: string; // "Exzellent" | "Gut" | "Befriedigend" | "Schwach" | "Kritisch"
  verdictHeadline: string;
}

// ─── Weights ───

export const SCORE_WEIGHTS = {
  categories: {
    technik: 0.15,
    aiReadiness: 0.20,
    content: 0.15,
    trust: 0.10,
    seo: 0.10,
    designUx: 0.10,
    performance: 0.10,
    aiVisibility: 0.10,
  },
  citability: {
    machineReadable: 35,
    answerStructure: 35,
    trust: 30,
  },
};

// ─── Substance Floor ───

/**
 * Confidence factor based on content volume.
 * Trivial sites (< 100 words, < 3 pages) get penalized.
 * This prevents example.com from scoring 100 in performance/designUx.
 */
function substanceFloor(facts: VerifiedFacts): number {
  const pages = facts.scannedUrls.length;
  const words = facts.content.wordCount;
  const images = facts.content.imagesTotal;
  const h2h3 = facts.content.h2Count + facts.content.h3Count;

  let score = 0;
  // Pages: 1=20, 2=40, 3+=60, 5+=80, 8+=100
  if (pages >= 8) score += 40;
  else if (pages >= 5) score += 32;
  else if (pages >= 3) score += 24;
  else if (pages >= 2) score += 16;
  else score += 8;

  // Words: <50=0, <200=20, <500=40, <1000=60, <3000=80, 3000+=100
  if (words >= 3000) score += 30;
  else if (words >= 1000) score += 24;
  else if (words >= 500) score += 18;
  else if (words >= 200) score += 12;
  else if (words >= 50) score += 6;
  else score += 0;

  // Headings + images: 0=0, 1-3=20, 4-7=40, 8+=60
  const contentBlocks = h2h3 + images;
  if (contentBlocks >= 8) score += 30;
  else if (contentBlocks >= 4) score += 20;
  else if (contentBlocks >= 1) score += 10;
  else score += 0;

  return Math.min(100, score);
}

// ─── Category Scorers ───

function scoreTechnik(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  // HTTPS (always true in our crawler, but check anyway)
  const https = facts.resolvedUrl.startsWith("https://");
  checks.push({ id: "technik-https", label: "HTTPS verschluesselt", passed: https, weight: 15, detail: https ? "Seite ist per HTTPS erreichbar" : "Keine HTTPS-Verschluesselung", evidence: facts.resolvedUrl });

  // Sitemap
  const sitemap = facts.sitemap.found;
  checks.push({ id: "technik-sitemap", label: "Sitemap vorhanden", passed: sitemap, weight: 20, detail: sitemap ? `Sitemap: ${facts.sitemap.urlCount} URLs (${facts.sitemap.source})` : "Keine Sitemap gefunden", evidence: facts.sitemap.url || "none" });

  // Canonical
  const canonical = !!facts.meta.canonical;
  checks.push({ id: "technik-canonical", label: "Canonical-Tag gesetzt", passed: canonical, weight: 15, detail: canonical ? `canonical: ${facts.meta.canonical}` : "Kein canonical-Tag", evidence: facts.meta.canonical || "none" });

  // Robots healthy (not blocking everything)
  const robotsHealthy = facts.crawlers.status === "unknown" || (facts.crawlers.allowed !== null && facts.crawlers.allowed > 0);
  checks.push({ id: "technik-robots", label: "Robots.txt erlaubt Zugriff", passed: robotsHealthy, weight: 20, detail: robotsHealthy ? `${facts.crawlers.allowed}/${facts.crawlers.total} Crawler erlaubt` : "Alle Crawler blockiert", evidence: facts.crawlers.blocked.join(", ") || "none" });

  // HTML size (not too large)
  const sizeOk = facts.perf.htmlSizeKb < 500;
  checks.push({ id: "technik-size", label: "HTML-Gruesse angemessen", passed: sizeOk, weight: 15, detail: `${facts.perf.htmlSizeKb}KB`, evidence: `${facts.perf.htmlSizeKb}KB` });

  // TTFB
  const ttfbOk = facts.perf.ttfbMs < 2000;
  checks.push({ id: "technik-ttfb", label: "TTFB unter 2s", passed: ttfbOk, weight: 15, detail: `${facts.perf.ttfbMs}ms`, evidence: `${facts.perf.ttfbMs}ms` });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreAiReadiness(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  // Crawlers allowed
  const crawlersOk = facts.crawlers.allowed !== null && facts.crawlers.allowed >= 15;
  checks.push({ id: "ai-crawlers", label: "KI-Crawler Zugang", passed: crawlersOk, weight: 25, detail: `${facts.crawlers.allowed ?? "?"}/${facts.crawlers.total} erlaubt`, evidence: facts.crawlers.blocked.join(", ") || "alle erlaubt" });

  // llms.txt
  const llmsTxt = facts.llmsTxt.found;
  checks.push({ id: "ai-llmstxt", label: "llms.txt vorhanden", passed: llmsTxt, weight: 15, detail: llmsTxt ? `${facts.llmsTxt.sizeBytes} Bytes` : "Keine llms.txt", evidence: facts.llmsTxt.url || "none" });

  // Schema
  const schema = facts.schema.jsonLdValid > 0;
  checks.push({ id: "ai-schema", label: "Strukturierte Daten (JSON-LD)", passed: schema, weight: 25, detail: `${facts.schema.jsonLdValid} gueltige Bloecke, Typen: ${facts.schema.types.join(", ") || "keine"}`, evidence: facts.schema.evidence.join("; ") || "none" });

  // Question headings
  const questions = facts.content.questionHeadings.length;
  const questionsOk = questions >= 2;
  checks.push({ id: "ai-questions", label: "Fragen als Ueberschriften", passed: questionsOk, weight: 15, detail: `${questions} Fragen in h2/h3`, evidence: facts.content.questionHeadings.slice(0, 3).join(", ") || "keine" });

  // FAQ
  const faq = facts.schema.hasFAQ || facts.content.hasFaqSection;
  checks.push({ id: "ai-faq", label: "FAQ-Sektion", passed: faq, weight: 20, detail: faq ? "FAQ erkannt" : "Keine FAQ-Sektion", evidence: faq ? "JSON-LD FAQPage oder Sektion gefunden" : "none" });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreContent(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  // Word count
  const words = facts.content.wordCount;
  const wordsOk = words >= 300;
  checks.push({ id: "content-words", label: "Genuegend Inhalt", passed: wordsOk, weight: 20, detail: `${words} Woerter`, evidence: `${words} Woerter auf ${facts.scannedUrls.length} Seiten` });

  // Heading hierarchy
  const hasH1 = facts.content.h1Count >= 1;
  const hasH2 = facts.content.h2Count >= 1;
  checks.push({ id: "content-hierarchy", label: "Ueberschriften-Hierarchie", passed: hasH1 && hasH2, weight: 20, detail: `h1=${facts.content.h1Count} h2=${facts.content.h2Count} h3=${facts.content.h3Count}`, evidence: `h1: ${facts.content.h1Count}, h2: ${facts.content.h2Count}, h3: ${facts.content.h3Count}` });

  // Bullets
  const bullets = facts.content.bulletPoints;
  const bulletsOk = bullets >= 3;
  checks.push({ id: "content-bullets", label: "Aufzaehlungen", passed: bulletsOk, weight: 15, detail: `${bullets} Listenpunkte`, evidence: `${bullets} <li>-Elemente` });

  // FAQ
  const faq = facts.content.hasFaqSection;
  checks.push({ id: "content-faq", label: "FAQ-Sektion im Content", passed: faq, weight: 15, detail: faq ? "FAQ-Sektion gefunden" : "Keine FAQ-Sektion", evidence: faq ? "FAQ-Header oder Klasse erkannt" : "none" });

  // Freshness
  const fresh = facts.freshness.freshnessScore >= 60;
  checks.push({ id: "content-fresh", label: "Aktualitaet", passed: fresh, weight: 15, detail: `${facts.freshness.freshnessScore}/100`, evidence: facts.freshness.daysSinceUpdate !== null ? `Letztes Update vor ${facts.freshness.daysSinceUpdate} Tagen` : "Kein Datums-Hinweis" });

  // Images with alt
  const imgTotal = facts.content.imagesTotal;
  const imgAlt = imgTotal > 0 ? ((imgTotal - facts.content.imagesMissingAlt) / imgTotal) : 1;
  const altOk = imgTotal === 0 || imgAlt >= 0.8;
  checks.push({ id: "content-alt", label: "Bilder mit Alt-Text", passed: altOk, weight: 15, detail: `${facts.content.imagesMissingAlt} von ${imgTotal} ohne Alt`, evidence: imgTotal > 0 ? `${Math.round(imgAlt * 100)}% haben Alt-Text` : "Keine Bilder" });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreTrust(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  // E-E-A-T trust score from crawler
  const trust = facts.eeat.trustScore;
  checks.push({ id: "trust-eeat", label: "E-E-A-T Vertrauen", passed: trust >= 50, weight: 40, detail: `${trust}/100`, evidence: [
    facts.eeat.hasAuthor ? "Autor vorhanden" : "Kein Autor",
    facts.eeat.hasImpressum ? "Impressum vorhanden" : "Kein Impressum",
    facts.eeat.hasPrivacy ? "Datenschutz vorhanden" : "Kein Datenschutz",
    facts.eeat.hasContact ? "Kontakt vorhanden" : "Kein Kontakt",
    facts.eeat.hasSocialLinks > 0 ? `${facts.eeat.hasSocialLinks} Social-Links` : "Keine Social-Links",
    facts.eeat.hasSourceLinks > 0 ? `${facts.eeat.hasSourceLinks} externe Quellen` : "Keine externen Quellen",
  ].filter(Boolean).join("; ") });

  // Impressum content validation
  const impressumValid = facts.eeat.impressumUrl !== null;
  checks.push({ id: "trust-impressum", label: "Impressum gueltig", passed: impressumValid, weight: 30, detail: impressumValid ? `URL: ${facts.eeat.impressumUrl}` : "Kein gueltiges Impressum", evidence: facts.eeat.impressumUrl || "none" });

  // Discovery mode
  const discoveryOk = facts.eeat.discovery === "link";
  checks.push({ id: "trust-discovery", label: "Rechtliche Seiten per Link gefunden", passed: discoveryOk, weight: 30, detail: `Discovery: ${facts.eeat.discovery}`, evidence: facts.eeat.discovery === "link" ? "Alle Seiten im Navigationssystem gefunden" : facts.eeat.discovery === "guess" ? "Teilweise geraten (geringere Qualitaet)" : "Nichts gefunden" });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreSeo(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  const hasTitle = !!facts.meta.title;
  checks.push({ id: "seo-title", label: "Title-Tag vorhanden", passed: hasTitle, weight: 20, detail: hasTitle ? facts.meta.title!.slice(0, 60) : "Kein Title", evidence: facts.meta.title || "none" });

  const hasDesc = !!facts.meta.description;
  checks.push({ id: "seo-desc", label: "Meta-Description vorhanden", passed: hasDesc, weight: 20, detail: hasDesc ? facts.meta.description!.slice(0, 60) : "Keine Description", evidence: facts.meta.description || "none" });

  const hasCanonical = !!facts.meta.canonical;
  checks.push({ id: "seo-canonical", label: "Canonical-Tag", passed: hasCanonical, weight: 15, detail: hasCanonical ? facts.meta.canonical! : "Kein Canonical", evidence: facts.meta.canonical || "none" });

  const hasOG = !!(facts.meta.ogTitle || facts.meta.ogDescription);
  checks.push({ id: "seo-og", label: "Open Graph Tags", passed: hasOG, weight: 15, detail: `og:title=${!!facts.meta.ogTitle} og:desc=${!!facts.meta.ogDescription} og:image=${!!facts.meta.ogImage}`, evidence: `og:title: ${facts.meta.ogTitle || "fehlt"}, og:description: ${facts.meta.ogDescription || "fehlt"}` });

  const singleH1 = facts.content.h1Count === 1;
  checks.push({ id: "seo-h1", label: "Einzelner H1", passed: singleH1, weight: 15, detail: `${facts.content.h1Count} H1-Tags`, evidence: `${facts.content.h1Count} H1` });

  const hasViewport = facts.meta.hasViewport;
  checks.push({ id: "seo-viewport", label: "Viewport-Meta", passed: hasViewport, weight: 15, detail: hasViewport ? "Viewport gesetzt" : "Kein Viewport", evidence: hasViewport ? "yes" : "no" });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreDesignUx(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  const hasViewport = facts.meta.hasViewport;
  checks.push({ id: "ux-viewport", label: "Mobile Viewport", passed: hasViewport, weight: 30, detail: hasViewport ? "Viewport gesetzt" : "Kein Viewport", evidence: hasViewport ? "yes" : "no" });

  // Images with alt (accessibility)
  const imgTotal = facts.content.imagesTotal;
  const imgAltRatio = imgTotal > 0 ? ((imgTotal - facts.content.imagesMissingAlt) / imgTotal) : 1;
  const imgOk = imgTotal === 0 || imgAltRatio >= 0.8;
  checks.push({ id: "ux-alt", label: "Bilder zugänglich (Alt-Text)", passed: imgOk, weight: 30, detail: `${Math.round(imgAltRatio * 100)}% haben Alt-Text`, evidence: `${facts.content.imagesMissingAlt} von ${imgTotal} ohne Alt` });

  // Heading hierarchy (readable structure)
  const hierarchy = facts.content.h1Count >= 1 && facts.content.h2Count >= 1;
  checks.push({ id: "ux-hierarchy", label: "Lesbare Struktur", passed: hierarchy, weight: 20, detail: `h1=${facts.content.h1Count} h2=${facts.content.h2Count} h3=${facts.content.h3Count}`, evidence: `Struktur: h1→h2→h3` });

  // Content volume (not trivial)
  const hasContent = facts.content.wordCount >= 100;
  checks.push({ id: "ux-content", label: "Genuegend Inhalte", passed: hasContent, weight: 20, detail: `${facts.content.wordCount} Woerter`, evidence: `${facts.content.wordCount} Woerter` });

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scorePerformance(facts: VerifiedFacts, floor: number): CategoryScore {
  const checks: ScoreCheck[] = [];

  // If PSI available, use it
  if (facts.perf.psi) {
    const psiScore = facts.perf.psi.performanceScore ?? 0;
    checks.push({ id: "perf-psi", label: "PageSpeed Insights Score", passed: psiScore >= 50, weight: 40, detail: `${psiScore}/100`, evidence: `LCP=${facts.perf.psi.lcp}ms CLS=${facts.perf.psi.cls} INP=${facts.perf.psi.inp}ms` });

    const lcpOk = (facts.perf.psi.lcp ?? 9999) < 2500;
    checks.push({ id: "perf-lcp", label: "LCP unter 2.5s", passed: lcpOk, weight: 30, detail: `${facts.perf.psi.lcp}ms`, evidence: `${facts.perf.psi.lcp}ms` });

    const clsOk = (facts.perf.psi.cls ?? 9999) < 0.1;
    checks.push({ id: "perf-cls", label: "CLS unter 0.1", passed: clsOk, weight: 30, detail: `${facts.perf.psi.cls}`, evidence: `${facts.perf.psi.cls}` });
  } else {
    // Fallback: TTFB
    const ttfbOk = facts.perf.ttfbMs < 1000;
    checks.push({ id: "perf-ttfb", label: "TTFB unter 1s", passed: ttfbOk, weight: 40, detail: `${facts.perf.ttfbMs}ms`, evidence: `${facts.perf.ttfbMs}ms` });

    // Load time
    const loadOk = facts.perf.loadTimeMs < 3000;
    checks.push({ id: "perf-load", label: "Ladezeit unter 3s", passed: loadOk, weight: 30, detail: `${facts.perf.loadTimeMs}ms`, evidence: `${facts.perf.loadTimeMs}ms` });

    // HTML size
    const sizeOk = facts.perf.htmlSizeKb < 200;
    checks.push({ id: "perf-size", label: "HTML unter 200KB", passed: sizeOk, weight: 30, detail: `${facts.perf.htmlSizeKb}KB`, evidence: `${facts.perf.htmlSizeKb}KB` });
  }

  const raw = weightedAverage(checks);
  const score = applyFloor(raw, floor);
  return { score, checks };
}

function scoreAiVisibility(_facts: VerifiedFacts, floor: number): CategoryScore {
  // Placeholder: aiVisibility comes from the runner (mention rate from Prompt Library)
  // Score is set externally after LLM queries complete
  const checks: ScoreCheck[] = [
    { id: "ai-vis-placeholder", label: "KI-Sichtbarkeit", passed: false, weight: 100, detail: "Wird nach KI-Abfragen berechnet", evidence: "Noch nicht ausgefuehrt" },
  ];
  return { score: 0, checks };
}

// ─── Citability ───

function scoreCitability(facts: VerifiedFacts): CitabilityScore {
  const checks: ScoreCheck[] = [];
  const breakdown: CitabilityBreakdown = { machineReadable: 0, answerStructure: 0, trust: 0 };

  // Machine Readiness (0-35)
  const schemaValid = facts.schema.jsonLdValid > 0;
  if (schemaValid) { breakdown.machineReadable += 10; checks.push({ id: "cit-schema", label: "Gueltige Datenstruktur", passed: true, weight: 10, detail: `${facts.schema.jsonLdValid} JSON-LD Bloecke`, evidence: facts.schema.types.join(", ") }); }
  else { checks.push({ id: "cit-schema", label: "Gueltige Datenstruktur", passed: false, weight: 10, detail: "Kein gueltiges JSON-LD", evidence: `${facts.schema.jsonLdInvalid} ungueltige Bloecke` }); }

  if (facts.schema.hasOrganization && facts.schema.organizationComplete.complete) { breakdown.machineReadable += 10; checks.push({ id: "cit-org", label: "Organization vollstaendig", passed: true, weight: 10, detail: "name+url+logo+sameAs vorhanden", evidence: `name=${facts.schema.organizationComplete.hasName} url=${facts.schema.organizationComplete.hasUrl} logo=${facts.schema.organizationComplete.hasLogo} sameAs=${facts.schema.organizationComplete.hasSameAs}` }); }
  else { checks.push({ id: "cit-org", label: "Organization vollstaendig", passed: false, weight: 10, detail: "Organization unvollstaendig oder fehlend", evidence: `has=${facts.schema.hasOrganization} complete=${facts.schema.organizationComplete.complete}` }); }

  if (facts.schema.hasFAQ || facts.content.hasFaqSection) { breakdown.machineReadable += 5; checks.push({ id: "cit-faq-struct", label: "FAQ strukturiert", passed: true, weight: 5, detail: "FAQ in JSON-LD oder HTML-Sektion", evidence: `hasFAQ=${facts.schema.hasFAQ} hasFaqSection=${facts.content.hasFaqSection}` }); }
  else { checks.push({ id: "cit-faq-struct", label: "FAQ strukturiert", passed: false, weight: 5, detail: "Keine FAQ", evidence: "none" }); }

  const types = facts.schema.types.length;
  if (types >= 3) breakdown.machineReadable += 10;
  else if (types >= 1) breakdown.machineReadable += 5;
  checks.push({ id: "cit-types", label: "Schema-Typen Vielfalt", passed: types >= 3, weight: 10, detail: `${types} Typen`, evidence: facts.schema.types.join(", ") || "keine" });

  // Answer Structure (0-35)
  const questions = facts.content.questionHeadings.length;
  if (questions >= 3) breakdown.answerStructure += 12;
  else if (questions >= 1) breakdown.answerStructure += 6;
  checks.push({ id: "cit-questions", label: "Fragen als Ueberschriften", passed: questions >= 3, weight: 12, detail: `${questions} Fragen`, evidence: facts.content.questionHeadings.slice(0, 3).join(", ") || "keine" });

  const bullets = facts.content.bulletPoints;
  if (bullets >= 10) breakdown.answerStructure += 8;
  else if (bullets >= 3) breakdown.answerStructure += 4;
  checks.push({ id: "cit-bullets", label: "Aufzaehlungen", passed: bullets >= 3, weight: 8, detail: `${bullets} Punkte`, evidence: `${bullets} <li>` });

  if (facts.content.hasFaqSection) { breakdown.answerStructure += 8; checks.push({ id: "cit-faq-content", label: "FAQ-Sektion", passed: true, weight: 8, detail: "FAQ-Sektion vorhanden", evidence: "FAQ-Header erkannt" }); }
  else { checks.push({ id: "cit-faq-content", label: "FAQ-Sektion", passed: false, weight: 8, detail: "Keine FAQ-Sektion", evidence: "none" }); }

  const words = facts.content.wordCount;
  if (words >= 500) breakdown.answerStructure += 7;
  else if (words >= 200) breakdown.answerStructure += 3;
  checks.push({ id: "cit-words", label: "Inhaltsumfang", passed: words >= 500, weight: 7, detail: `${words} Woerter`, evidence: `${words} Woerter` });

  // Trust (0-30)
  if (facts.eeat.hasAuthor) { breakdown.trust += 8; checks.push({ id: "cit-author", label: "Autor angegeben", passed: true, weight: 8, detail: "Autor vorhanden", evidence: "meta author oder Klasse" }); }
  else { checks.push({ id: "cit-author", label: "Autor angegeben", passed: false, weight: 8, detail: "Kein Autor", evidence: "none" }); }

  if (facts.eeat.hasImpressum) { breakdown.trust += 8; checks.push({ id: "cit-impressum", label: "Impressum", passed: true, weight: 8, detail: "Impressum vorhanden", evidence: facts.eeat.impressumUrl || "ja" }); }
  else { checks.push({ id: "cit-impressum", label: "Impressum", passed: false, weight: 8, detail: "Kein Impressum", evidence: "none" }); }

  if (facts.eeat.hasSourceLinks > 0) { breakdown.trust += 7; checks.push({ id: "cit-sources", label: "Externe Quellen", passed: true, weight: 7, detail: `${facts.eeat.hasSourceLinks} externe Links`, evidence: `${facts.eeat.hasSourceLinks} Links` }); }
  else { checks.push({ id: "cit-sources", label: "Externe Quellen", passed: false, weight: 7, detail: "Keine externen Quellen", evidence: "none" }); }

  if (facts.freshness.freshnessScore >= 60) { breakdown.trust += 7; checks.push({ id: "cit-fresh", label: "Aktualitaet", passed: true, weight: 7, detail: `${facts.freshness.freshnessScore}/100`, evidence: `Score: ${facts.freshness.freshnessScore}` }); }
  else { checks.push({ id: "cit-fresh", label: "Aktualitaet", passed: false, weight: 7, detail: `${facts.freshness.freshnessScore}/100`, evidence: `Score: ${facts.freshness.freshnessScore}` }); }

  const total = breakdown.machineReadable + breakdown.answerStructure + breakdown.trust;
  return { score: Math.round(total), breakdown, checks };
}

// ─── Helpers ───

function weightedAverage(checks: ScoreCheck[]): number {
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;
  const earned = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  return Math.round((earned / totalWeight) * 100);
}

function applyFloor(score: number, floor: number): number {
  return Math.min(score, floor);
}

function verdictFromScore(score: number): { label: string; headline: string } {
  if (score >= 80) return { label: "Exzellent", headline: `Ihre Website ist hervorragend fuer KI-Sichtbarkeit vorbereitet (${score}/100).` };
  if (score >= 60) return { label: "Gut", headline: `Ihre Website ist solide aufgestellt, mit einigen Optimierungsmoeglichkeiten (${score}/100).` };
  if (score >= 40) return { label: "Befriedigend", headline: `Ihre Website hat grundlegende Massnahmen, benoetigt aber wesentliche Verbesserungen (${score}/100).` };
  if (score >= 20) return { label: "Schwach", headline: `Ihre Website ist fuer KI-Sichtbarkeit schlecht aufgestellt (${score}/100).` };
  return { label: "Kritisch", headline: `Ihre Website ist fuer KI-Sichtbarkeit nicht vorbereitet (${score}/100).` };
}

// ─── Main Scoring Function ───

export function scoreReport(facts: VerifiedFacts): ScoringResult {
  const floor = substanceFloor(facts);

  const categoryScores = {
    technik: scoreTechnik(facts, floor),
    aiReadiness: scoreAiReadiness(facts, floor),
    content: scoreContent(facts, floor),
    trust: scoreTrust(facts, floor),
    seo: scoreSeo(facts, floor),
    designUx: scoreDesignUx(facts, floor),
    performance: scorePerformance(facts, floor),
    aiVisibility: scoreAiVisibility(facts, floor),
  };

  const citability = scoreCitability(facts);

  // Overall = weighted average of categories
  // aiVisibility excluded from average until Phase 2 fills it (score=0 means "pending")
  const w = SCORE_WEIGHTS.categories;
  const aiVisPending = categoryScores.aiVisibility.score === 0 && 
    categoryScores.aiVisibility.checks[0]?.id === "ai-vis-placeholder";
  
  // Build score array excluding aiVisibility if pending
  const catScores: number[] = [
    categoryScores.technik.score * w.technik,
    categoryScores.aiReadiness.score * w.aiReadiness,
    categoryScores.content.score * w.content,
    categoryScores.trust.score * w.trust,
    categoryScores.seo.score * w.seo,
    categoryScores.designUx.score * w.designUx,
    categoryScores.performance.score * w.performance,
  ];
  
  if (!aiVisPending) {
    catScores.push(categoryScores.aiVisibility.score * w.aiVisibility);
  }
  
  // Normalize: divide by sum of active weights
  const activeWeight = aiVisPending ? (1.0 - w.aiVisibility) : 1.0;
  const overallScore = Math.round(catScores.reduce((a, b) => a + b, 0) / activeWeight);

  const { label, headline } = verdictFromScore(overallScore);

  return {
    categoryScores,
    citability,
    overallScore,
    verdictLabel: label,
    verdictHeadline: headline,
  };
}
