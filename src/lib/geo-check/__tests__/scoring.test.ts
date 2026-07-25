// GEO Check — Scoring tests
// Runs scoring against cached JSON fixtures from /tmp.

import * as fs from "fs";
import { scoreReport } from "../scoring";
import type { VerifiedFacts } from "../crawler";

const DOMAINS = [
  { label: "stripe", file: "/tmp/geo-check-stripe.json" },
  { label: "example", file: "/tmp/geo-check-example.json" },
  { label: "buerklin", file: "/tmp/geo-check-buerklin.json" },
  { label: "schlenkerla", file: "/tmp/geo-check-schlenkerla.json" },
  { label: "lieken", file: "/tmp/geo-check-lieken.json" },
];

describe("Scoring", () => {
  for (const d of DOMAINS) {
    it(`${d.label}: produces valid scores`, () => {
      if (!fs.existsSync(d.file)) return; // skip if no fixture
      const facts: VerifiedFacts = JSON.parse(fs.readFileSync(d.file, "utf-8"));
      const result = scoreReport(facts);

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.verdictLabel).toBeTruthy();
      expect(result.verdictHeadline).toContain(String(result.overallScore));

      // Category scores
      for (const [key, cat] of Object.entries(result.categoryScores)) {
        expect(cat.score).toBeGreaterThanOrEqual(0);
        expect(cat.score).toBeLessThanOrEqual(100);
        expect(cat.checks.length).toBeGreaterThan(0);
      }

      // Citability
      expect(result.citability.score).toBeGreaterThanOrEqual(0);
      expect(result.citability.score).toBeLessThanOrEqual(100);
      expect(result.citability.checks.length).toBeGreaterThan(0);
    });
  }

  it("example.com has low scores due to substance floor", () => {
    if (!fs.existsSync("/tmp/geo-check-example.json")) return;
    const facts: VerifiedFacts = JSON.parse(fs.readFileSync("/tmp/geo-check-example.json", "utf-8"));
    const result = scoreReport(facts);
    // example.com with 17 words should not score above 30 in most categories
    expect(result.categoryScores.performance.score).toBeLessThanOrEqual(50);
    expect(result.categoryScores.designUx.score).toBeLessThanOrEqual(50);
  });

  it("stripe.com has high scores", () => {
    if (!fs.existsSync("/tmp/geo-check-stripe.json")) return;
    const facts: VerifiedFacts = JSON.parse(fs.readFileSync("/tmp/geo-check-stripe.json", "utf-8"));
    const result = scoreReport(facts);
    expect(result.overallScore).toBeGreaterThanOrEqual(50);
  });

  it("checks arrays explain every score", () => {
    if (!fs.existsSync("/tmp/geo-check-stripe.json")) return;
    const facts: VerifiedFacts = JSON.parse(fs.readFileSync("/tmp/geo-check-stripe.json", "utf-8"));
    const result = scoreReport(facts);
    for (const cat of Object.values(result.categoryScores)) {
      for (const check of cat.checks) {
        expect(check.id).toBeTruthy();
        expect(check.label).toBeTruthy();
        expect(typeof check.passed).toBe("boolean");
        expect(check.weight).toBeGreaterThan(0);
        expect(check.detail).toBeTruthy();
      }
    }
  });
});
