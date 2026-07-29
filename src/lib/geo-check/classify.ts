// GEO Check — Descriptor classifier (1 LLM call, long-tail only)
// Classifies raw text descriptors into a German business type noun.

export async function classifyDescriptor(
  rawDescriptor: string,
  title: string,
  description: string | null,
): Promise<{ descriptor: string; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { descriptor: rawDescriptor, confidence: 0.5 };

  const prompt = `Du bist ein Branchen-Klassifizierer. Antworte NUR mit einem einzigen deutschen Substantiv. Kein Satz, keine Erklärung, kein Englisch.

Aufgabe: Welcher deutsche Geschäftstyp beschreibt dieses Unternehmen?

Beispiele (NUR das Substantiv):
"Handmade Jewelry" → Schmuckgeschäft
"Konterfey - Handmade Jewelry" → Schmuckgeschäft
"Sekt und Champagner" → Sektkellerei
"Biowein aus der Pfalz" → Weingut
"Craft Beer Brewery" → Brauerei
"Italian Restaurant" → Restaurant
"Home Cleaning" → Reinigungsdienst
"Organic Skincare" → Kosmetikgeschäft

Titel: ${title}
Beschreibung: ${description || "(keine)"}

Antwort (NUR ein deutsches Substantiv):`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
        }),
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return { descriptor: rawDescriptor, confidence: 0.5 };
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    // Clean up: remove quotes, periods, take only the first line
    const cleaned = text
      .replace(/["'`]/g, "")
      .replace(/\.$/, "")
      .trim()
      .split("\n")[0]
      .trim();
    // Validate: must be reasonable length and not a sentence
    if (cleaned.length >= 2 && cleaned.length <= 60 && !cleaned.includes(" ")) {
      return { descriptor: cleaned, confidence: 0.8 };
    }
    // If it contains spaces, it might be a compound — allow if short enough
    if (cleaned.length >= 2 && cleaned.length <= 40) {
      return { descriptor: cleaned, confidence: 0.7 };
    }
    return { descriptor: rawDescriptor, confidence: 0.5 };
  } catch {
    return { descriptor: rawDescriptor, confidence: 0.5 };
  }
}
