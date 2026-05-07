import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
}

function getSupabaseKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function isSupabaseConfigured(): boolean {
  return !!getSupabaseUrl() && !!getSupabaseKey();
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    if (!url || !key) {
      throw new Error("Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}
