// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export function getServerSupabase() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_API_KEY!; // service role key côté serveur
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_API_KEY manquants");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
