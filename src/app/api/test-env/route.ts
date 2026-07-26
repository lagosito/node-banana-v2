export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  // Mask URL: show scheme + last 8 chars of host
  const urlMasked = supabaseUrl
    ? `${supabaseUrl.slice(0, 8)}…${supabaseUrl.slice(-12)}`
    : "";
  const urlHasScheme = supabaseUrl.startsWith("http://") || supabaseUrl.startsWith("https://");
  const keyLength = supabaseKey.length;
  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon";

  return Response.json({
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SUPABASE_URL: !!supabaseUrl,
    supabase_url_masked: urlMasked,
    supabase_url_has_scheme: urlHasScheme,
    supabase_key_length: keyLength,
    supabase_key_type: keyType,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    DEBUG_SECRET: !!process.env.DEBUG_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
