// Browser-side Supabase client. Safe to import in Client Components — it only
// uses the PUBLIC anon key. The anon key is meant to be exposed; row-level
// security (RLS) in the database is what actually protects each user's data.
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
