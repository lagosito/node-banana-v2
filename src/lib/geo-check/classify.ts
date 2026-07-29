// GEO Check — Descriptor classifier (1 LLM call, long-tail only)
// Classifies raw text descriptors into a German business type noun.

export async function classifyDescriptor(
  rawDescriptor: string,
  title: string,
  description: string | null,
): Promise<{ descriptor: string; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { descriptor: rawDescriptor, confidence: 0.5 };

  const prompt = `Du bist ein Branchen-Klassifizierer. Extrahiere den Geschäftstyp als einzelnes deutsches Substantiv (oder zusammengesetztes Substantiv).

Regeln:
- Ein einziges deutsches Substantiv oder Kompositum (z.B. "Sektkellerei", "Reinigungsdienst", "Schmuckgeschäft")
- Immer auf Deutsch, auch wenn die Quelle Englisch ist
- Geschäftstyp, nicht Markenname
- Kein Satz, nur der Begriff
- Kein "und" oder Aufzählung

Beispiele:
- "Handmade Jewelry – Handcut golden silhouette pendants" → "Schmuckgeschäft"
- "Konterfey - Handmade Jewelry" → "Schmuckgeschäft"
- "Rotkäpchen - Sekt und Champagner" → "Sektkellerei"
- "Organic Skincare & Wellness Products" → "Kosmetikgeschäft"
- "Premium Craft Beer Brewery" → "Brauerei"
- "Fine Wine & Spirits" → "Weinhandel"
- "Italian Restaurant & Pizza" → "Restaurant"
- "Home Cleaning Services" → "Reinigungsdienst"
- "Weingut Dr. Bürklin-Wolf - Biowein aus der Pfalz" → "Weingut"

Titel: ${title}
Beschreibung: ${description || "(keine)"}
Rohdeskriptor: ${rawDescriptor}

Geschäftstyp (ein deutsches Substantiv):`;

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
    if (cleaned.length >= 2) {
      return { descriptor: cleaned, confidence: 0.8 };
    }
    return { descriptor: rawDescriptor, confidence: 0.5 };
  } catch {
    return { descriptor: rawDescriptor, confidence: 0.5 };
  }
}
