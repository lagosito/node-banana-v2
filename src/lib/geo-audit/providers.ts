// GEO Audit — AI Providers (Gemini + Perplexity via OpenRouter)

import type { ProviderResponse, ProviderName } from "./types";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ─── Gemini (direct API with Google Search grounding) ───

async function callGemini(prompt: string): Promise<ProviderResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";

  // Extract citations from grounding metadata
  const grounding = candidate?.groundingMetadata;
  const citations: string[] = [];
  if (grounding?.groundingChunks) {
    for (const chunk of grounding.groundingChunks) {
      const uri = chunk?.web?.uri;
      if (uri) citations.push(uri);
    }
  }

  return { text, citations, groundingMetadata: grounding };
}

// ─── Perplexity (via OpenRouter, sonar model with citations) ───

async function callPerplexity(prompt: string): Promise<ProviderResponse> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://elkiosk.ai",
      "X-Title": "GEO Audit",
    },
    body: JSON.stringify({
      model: "perplexity/sonar",
      messages: [{ role: "user", content: prompt }],
      // Perplexity returns citations in response
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Perplexity ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";

  // Perplexity sonar returns citations in the response object
  const citations: string[] = data.citations || [];

  return { text, citations };
}

// ─── OpenAI (structured Responses API — DISABLED until key arrives) ───

async function callOpenAI(_prompt: string): Promise<ProviderResponse> {
  // TODO: Implement with native OpenAI key + web_search tool
  // For now, skip silently
  throw new Error("OpenAI provider disabled — awaiting native API key");
}

// ─── Dispatcher ───

const PROVIDERS: Record<ProviderName, (prompt: string) => Promise<ProviderResponse>> = {
  gemini: callGemini,
  perplexity: callPerplexity,
  openai: callOpenAI,
};

export async function callProvider(
  name: ProviderName,
  prompt: string,
  retries = 2,
  delayMs = 1000,
): Promise<ProviderResponse> {
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`Unknown provider: ${name}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(prompt);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error("unreachable");
}

export function isProviderEnabled(name: ProviderName): boolean {
  if (name === "openai") return false; // disabled until key
  if (name === "gemini") return !!GEMINI_API_KEY;
  if (name === "perplexity") return !!OPENROUTER_API_KEY;
  return false;
}

export function getActiveProviders(): ProviderName[] {
  return (["gemini", "perplexity", "openai"] as ProviderName[]).filter(isProviderEnabled);
}
