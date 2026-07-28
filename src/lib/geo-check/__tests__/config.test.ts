import { describe, it, expect } from "vitest";
import {
  extractBusinessDescriptor,
  buildOtherPrompts,
  OTHER_TEMPLATES,
} from "../config";

// ─── Helper: normalize for guard (mirrors normalizeForGuard in config.ts) ───
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

// ─── A1: No prompt may contain brand or domain tokens ───
describe("A1: promptsUsed must not contain brand or domain", () => {
  const testCases = [
    { domain: "lammsbraeu.de", brandName: "Neumarkter Lammsbräu", region: "Bayern" },
    { domain: "christmann.de", brandName: "Christmann", region: "Pfalz" },
    { domain: "dm.de", brandName: "dm-drogerie markt", region: "Deutschland" },
    { domain: "buerklin-wolf.de", brandName: "Weingut Dr. Bürklin-Wolf", region: "Pfalz" },
  ];

  for (const { domain, brandName, region } of testCases) {
    it(`rejects brand in prompts for ${domain}`, () => {
      const { descriptor } = extractBusinessDescriptor(
        `${brandName} - Bio-Bier aus Bayern`,
        null,
        domain,
        brandName,
      );

      // If descriptor is null, C2 fires — no prompts generated, test passes
      if (!descriptor) return;

      const prompts = buildOtherPrompts(descriptor, region);
      const domainToken = normalize(domain.split(".")[0]);
      const brandNorm = normalize(brandName);

      for (const prompt of prompts) {
        const promptNorm = normalize(prompt);
        // Prompt must not contain the full brand name
        expect(promptNorm).not.toContain(brandNorm);
        // Prompt must not contain the domain token
        expect(promptNorm).not.toContain(domainToken);
      }
    });
  }
});

// ─── Mandatory test case: lammsbraeu guard ───
describe("Brand guard: lammsbraeu mandatory test case", () => {
  it("rejects 'neumarkter lammsbräu' when domain is lammsbraeu.de", () => {
    const { descriptor } = extractBusinessDescriptor(
      "Neumarkter Lammsbräu - Bio-Bier aus Bayern",
      null,
      "lammsbraeu.de",
      "Neumarkter Lammsbräu",
    );

    // The brand guard should reject "neumarkter lammsbräu" because it contains "lammsbrau"
    // The function should either return null (C2) or a descriptor that doesn't overlap
    if (descriptor) {
      const descriptorNorm = normalize(descriptor);
      const domainToken = normalize("lammsbraeu");
      expect(descriptorNorm).not.toContain(domainToken);
    }
  });
});

// ─── C2: fallback when no valid descriptor ───
describe("C2: fallback for empty/generic titles", () => {
  it("returns null for 'Home' title", () => {
    const { descriptor } = extractBusinessDescriptor("Home", null, "example.de", "Example");
    expect(descriptor).toBeNull();
  });

  it("returns null for 'Willkommen' title", () => {
    const { descriptor } = extractBusinessDescriptor("Willkommen", null, "example.de", "Example");
    expect(descriptor).toBeNull();
  });

  it("returns null for brand-only title", () => {
    const { descriptor } = extractBusinessDescriptor("Neumarkter Lammsbräu", null, "lammsbraeu.de", "Neumarkter Lammsbräu");
    // Brand guard should reject this — the whole title is the brand
    expect(descriptor).toBeNull();
  });
});

// ─── Descriptor extraction: real cases ───
describe("Descriptor extraction: real German businesses", () => {
  it("extracts 'Bio-Bier aus Bayern' from lammsbraeu.de title", () => {
    const { descriptor } = extractBusinessDescriptor(
      "Neumarkter Lammsbräu - Bio-Bier aus Bayern",
      null,
      "lammsbraeu.de",
      "Neumarkter Lammsbräu",
    );
    expect(descriptor).toBeTruthy();
    // The brand guard rejects "neumarkter lammsbräu", so the function
    // should extract from the second segment ("bio-bier aus bayern")
    // or find a valid non-brand descriptor
    const norm = normalize(descriptor!);
    expect(norm).not.toContain(normalize("Neumarkter Lammsbräu"));
    expect(norm).not.toContain(normalize("lammsbraeu"));
  });

  it("extracts business type from christmann.de title", () => {
    const { descriptor } = extractBusinessDescriptor(
      "Weingut Christmann - Biowein aus der Pfalz",
      null,
      "christmann.de",
      "Christmann",
    );
    expect(descriptor).toBeTruthy();
    // Should not be the brand name
    expect(normalize(descriptor!)).not.toContain(normalize("Christmann"));
  });
});
