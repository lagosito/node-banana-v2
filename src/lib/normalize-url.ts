// GEO Check — URL normalization helper
// Normalizes user-supplied URLs so the same site typed different ways
// produces the same Supabase key and crawler input.

/**
 * Normalize a user-supplied URL string.
 *
 * Behaviour:
 *  - trim + strip all whitespace
 *  - collapse malformed/duplicated protocols (https//, http:/, https://https://) into one
 *  - if no protocol, prepend https://
 *  - parse with WHATWG URL constructor; return null if it throws
 *  - require hostname to contain a dot, and not start/end with a dot
 *  - lowercase hostname, preserve path, drop bare trailing "/"
 *  - return origin + path
 */
export function normalizeUrl(input: string): string | null {
  if (!input) return null;

  // 1. Trim and strip ALL whitespace (inside the string too)
  let s = input.replace(/\s+/g, "");

  if (!s) return null;

  // 2. Collapse malformed/duplicated protocols into a single canonical one
  //    e.g. "https//", "http:/", "https://https://", "https:////" → "https://"
  s = s.replace(/^(?:https?:?\/\/+|https?:\/\/https?:\/\/+|https?:\/\/)+/i, (match) => {
    // Decide whether the user intended http or https
    return /https/i.test(match) ? "https://" : "http://";
  });

  // 3. If still no protocol, prepend https://
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    s = "https://" + s;
  }

  // 4. Parse with WHATWG URL
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }

  // 5. Require a valid protocol (http or https only)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // 6. Require hostname to contain a dot, not start/end with a dot
  if (!hostname.includes(".") || hostname.startsWith(".") || hostname.endsWith(".")) {
    return null;
  }

  // 7. Build origin + path; drop bare trailing "/"
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return parsed.origin.toLowerCase() + path;
}
