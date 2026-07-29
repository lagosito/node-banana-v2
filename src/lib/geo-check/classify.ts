// GEO Check — Descriptor classifier (1 LLM call, long-tail only)
// Classifies raw text descriptors into max 2-word German business types.

export async function classifyDescriptor(
  rawDescriptor: string,
  title: string,
  description: string | null,
): Promise<{ descriptor: string; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { descriptor: rawDescriptor, confidence: 0.5 };

  const prompt = `Du bist ein Branchen-Klassifizierer. Extrahiere den Geschäftstyp aus den folgenden Informationen und gib ihn als maximal 2-Wörter auf Deutsch zurück.

Regeln:
- Maximal 2 Wörter
- Immer auf Deutsch, auch wenn die Quelle Englisch ist
- Geschäftstyp, nicht Markenname
- Keine Beschreibung, nur der Begriff

Beispiele:
- "Handmade Jewelry – Handcut golden silhouette pendants" → "Schmuck"
- "Organic Skincare & Wellness Products" → "Kosmetik"
- "Premium Craft Beer Brewery" → "Brauerei"
- "Fine Wine & Spirits" → "Weinhandel"
- "Italian Restaurant & Pizza" → "Restaurant"
- "Home Cleaning Services" → "Reinigungsdienst"

Titel: ${title}
Beschreibung: ${description || "(keine)"}
Rohdeskriptor: ${rawDescriptor}

Geschäftstyp (nur 1-2 Wörter auf Deutsch):`;

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
    // Clean up: remove quotes, periods, extra words
    const cleaned = text.replace(/["'`]/g, "").replace(/\.$/, "").trim();
    // Take first 2 words max
    const words = cleaned.split(/\s+/).slice(0, 2).join(" ");
    if (words.length >= 2) {
      return { descriptor: words, confidence: 0.8 };
    }
    return { descriptor: rawDescriptor, confidence: 0.5 };
  } catch {
    return { descriptor: rawDescriptor, confidence: 0.5 };
  }
}
