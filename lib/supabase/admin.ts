// PRIVILEGED server-only client using the service-role key. It BYPASSES row-
// level security, so never import it into anything that reaches the browser.
// Used for server-trusted writes the user must not control directly — e.g.
// crediting a balance after a Stripe top-up, or debiting it after a call ends
// (the Twilio status webhook has no user session, so it needs this).
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
