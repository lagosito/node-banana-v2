/**
 * providers.ts
 *
 * Thin client wrappers around OpenAI, Perplexity, and Gemini that all return
 * the same normalised shape: { text, citations, raw }.
 */

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getConfig } from './config';
import { child } from './logger';
import { Citation, ModelName, VisibilityError } from './types';

const log = child({ module: 'providers' });

export interface ProviderResponse {
  text: string;
  citations: Citation[];
  raw: Record<string, unknown>;
}

export interface ProviderClient {
  readonly name: ModelName;
  ask(prompt: string, signal: AbortSignal): Promise<ProviderResponse>;
}

// ============================================================================
// ChatGPT (OpenAI direct)
// ============================================================================

export class ChatGPTClient implements ProviderClient {
  readonly name = 'chatgpt' as const;
  private client: OpenAI;
  private model: string;

  constructor() {
    const cfg = getConfig();
    if (!cfg.OPENAI_API_KEY) throw new VisibilityError('OPENAI_API_KEY not set', 'MISSING_KEY', false);
    this.client = new OpenAI({
      apiKey: cfg.OPENAI_API_KEY,
      timeout: cfg.REQUEST_TIMEOUT_MS,
    });
    this.model = cfg.OPENAI_MODEL;
  }

  async ask(prompt: string, signal: AbortSignal): Promise<ProviderResponse> {
    // Responses API with web_search_preview tool for comparable citations
    const response = await this.client.responses.create(
      {
        model: this.model,
        input: prompt,
        tools: [{ type: 'web_search_preview' }],
      },
      { signal },
    );

    let text = '';
    const citations: Citation[] = [];

    for (const item of response.output ?? []) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text') {
            text += part.text;
            const annotations = (part as { annotations?: unknown[] }).annotations ?? [];
            for (const a of annotations) {
              const ann = a as {
                type?: string;
                url?: string;
                title?: string;
                url_citation?: { url?: string; title?: string };
              };
              const url = ann.url ?? ann.url_citation?.url;
              const title = ann.title ?? ann.url_citation?.title;
              if (url) citations.push({ url, title });
            }
          }
        }
      }
    }

    if (!text) {
      const anyResp = response as unknown as { output_text?: string };
      text = anyResp.output_text ?? '';
    }

    if (!text) {
      throw new VisibilityError('OpenAI returned empty text', 'OPENAI_EMPTY', true);
    }

    return { text, citations: dedupeCitations(citations), raw: response as unknown as Record<string, unknown> };
  }
}

// ============================================================================
// Perplexity (Sonar API)
// ============================================================================

export class PerplexityClient implements ProviderClient {
  readonly name = 'perplexity' as const;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor() {
    const cfg = getConfig();
    if (!cfg.PERPLEXITY_API_KEY) throw new VisibilityError('PERPLEXITY_API_KEY not set', 'MISSING_KEY', false);
    this.apiKey = cfg.PERPLEXITY_API_KEY;
    this.model = cfg.PERPLEXITY_MODEL;
    this.timeoutMs = cfg.REQUEST_TIMEOUT_MS;
  }

  async ask(prompt: string, signal: AbortSignal): Promise<ProviderResponse> {
    const timeoutCtl = new AbortController();
    const timeout = setTimeout(() => timeoutCtl.abort(), this.timeoutMs);
    const onAbort = () => timeoutCtl.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          return_citations: true,
          return_related_questions: false,
        }),
        signal: timeoutCtl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const retriable = res.status === 429 || res.status >= 500;
        throw new VisibilityError(
          `Perplexity ${res.status}: ${body.slice(0, 200)}`,
          res.status === 429 ? 'PERPLEXITY_RATE_LIMIT' : 'PERPLEXITY_HTTP',
          retriable,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        citations?: string[];
        search_results?: Array<{ url?: string; title?: string; snippet?: string }>;
      };

      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new VisibilityError('Perplexity returned empty text', 'PERPLEXITY_EMPTY', true);

      let citations: Citation[] = [];
      if (Array.isArray(data.search_results)) {
        citations = data.search_results
          .filter((r): r is { url: string; title?: string; snippet?: string } => typeof r.url === 'string')
          .map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
      } else if (Array.isArray(data.citations)) {
        citations = data.citations.map((url) => ({ url }));
      }

      return { text, citations: dedupeCitations(citations), raw: data as Record<string, unknown> };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

// ============================================================================
// Gemini (native API + googleSearch tool)
// ============================================================================

export class GeminiClient implements ProviderClient {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;
  private model: string;

  constructor() {
    const cfg = getConfig();
    this.client = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
    this.model = cfg.GEMINI_MODEL;
  }

  async ask(prompt: string, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        abortSignal: signal,
      },
    });

    const text = response.text ?? '';
    if (!text) throw new VisibilityError('Gemini returned empty text', 'GEMINI_EMPTY', true);

    const citations: Citation[] = [];
    const candidate = response.candidates?.[0];
    const grounding = candidate?.groundingMetadata as
      | { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> }
      | undefined;
    for (const chunk of grounding?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      const title = chunk.web?.title;
      if (url) citations.push({ url, title });
    }

    return { text, citations: dedupeCitations(citations), raw: response as unknown as Record<string, unknown> };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function dedupeCitations(cites: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of cites) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

export function buildAllProviders(): ProviderClient[] {
  const clients: ProviderClient[] = [];
  try { clients.push(new ChatGPTClient()); } catch (err) { log.error({ err: String(err) }, 'failed to init ChatGPT client'); }
  try { clients.push(new PerplexityClient()); } catch (err) { log.error({ err: String(err) }, 'failed to init Perplexity client'); }
  try { clients.push(new GeminiClient()); } catch (err) { log.error({ err: String(err) }, 'failed to init Gemini client'); }
  return clients;
}
