// Tests for normalizeUrl helper
// Run: npx vitest run src/lib/geo-check/__tests__/normalize-url.test.ts

import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../../normalize-url";

describe("normalizeUrl", () => {
  // ─── Valid inputs ───

  it("preserves https:// on www.babyzeit.hamburg", () => {
    expect(normalizeUrl("https://www.babyzeit.hamburg")).toBe(
      "https://www.babyzeit.hamburg"
    );
  });

  it("prepends https:// to bare babyzeit.hamburg", () => {
    expect(normalizeUrl("babyzeit.hamburg")).toBe(
      "https://babyzeit.hamburg"
    );
  });

  it("preserves http:// on example.de", () => {
    expect(normalizeUrl("http://example.de")).toBe("http://example.de");
  });

  it("normalizes HTTPS://Example.DE to lowercase", () => {
    expect(normalizeUrl("HTTPS://Example.DE")).toBe(
      "https://example.de"
    );
  });

  it("strips whitespace padding", () => {
    expect(normalizeUrl("  https://example.de  ")).toBe(
      "https://example.de"
    );
  });

  it("handles internal whitespace", () => {
    expect(normalizeUrl("https://exam ple.de")).toBe(
      "https://example.de"
    );
  });

  it("collapses https//example.de", () => {
    expect(normalizeUrl("https//example.de")).toBe(
      "https://example.de"
    );
  });

  it("collapses http://https://example.de", () => {
    expect(normalizeUrl("http://https://example.de")).toBe(
      "https://example.de"
    );
  });

  it("collapses https://https://example.de", () => {
    expect(normalizeUrl("https://https://example.de")).toBe(
      "https://example.de"
    );
  });

  it("collapses https:////example.de", () => {
    expect(normalizeUrl("https:////example.de")).toBe(
      "https://example.de"
    );
  });

  it("handles www. prefix", () => {
    expect(normalizeUrl("www.example.de")).toBe("https://www.example.de");
  });

  it("drops bare trailing slash", () => {
    expect(normalizeUrl("https://example.de/")).toBe("https://example.de");
  });

  it("preserves path", () => {
    expect(normalizeUrl("https://example.de/kontakt")).toBe(
      "https://example.de/kontakt"
    );
  });

  it("preserves path with trailing slash", () => {
    expect(normalizeUrl("https://example.de/kontakt/")).toBe(
      "https://example.de/kontakt/"
    );
  });

  it("handles .hamburg TLD", () => {
    expect(normalizeUrl("www.babyzeit.hamburg")).toBe(
      "https://www.babyzeit.hamburg"
    );
  });

  it("handles new TLDs like .shop", () => {
    expect(normalizeUrl("myshop.shop")).toBe("https://myshop.shop");
  });

  it("prepends https:// to bare domain with path", () => {
    expect(normalizeUrl("example.de/about")).toBe(
      "https://example.de/about"
    );
  });

  it("handles http:// protocol", () => {
    expect(normalizeUrl("http://example.de")).toBe("http://example.de");
  });

  // ─── Rejects ───

  it("rejects localhost (no dot in hostname)", () => {
    expect(normalizeUrl("localhost")).toBeNull();
  });

  it("rejects test (no dot)", () => {
    expect(normalizeUrl("test")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(normalizeUrl("")).toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("rejects hostname starting with dot", () => {
    expect(normalizeUrl(".example.de")).toBeNull();
  });

  it("rejects hostname ending with dot", () => {
    expect(normalizeUrl("example.de.")).toBeNull();
  });
});
