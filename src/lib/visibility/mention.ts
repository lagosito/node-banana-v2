/**
 * mention.ts
 *
 * Detects whether a brand name appears in an AI-generated answer, returns the
 * 1-based position of the first mention (counted by sentence), and tracks
 * which competitors are also mentioned.
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

export function brandRegex(name: string): RegExp {
  const escaped = name
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

export interface MentionResult {
  present: boolean;
  position: number | null; // 1-based sentence index of first mention
  count: number;
}

export function findMention(text: string, brandName: string): MentionResult {
  const re = brandRegex(brandName);
  const sentences = text.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);

  let position: number | null = null;
  let count = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const globalRe = new RegExp(re.source, 'giu');
    const matches = sentence.match(globalRe);
    if (matches && matches.length > 0) {
      count += matches.length;
      if (position === null) position = i + 1;
    }
  }

  return { present: position !== null, position, count };
}

export function findCompetitorMentions(
  text: string,
  competitors: string[],
): string[] {
  const found: string[] = [];
  for (const c of competitors) {
    if (!c.trim()) continue;
    if (brandRegex(c).test(text)) found.push(c);
  }
  return found;
}
