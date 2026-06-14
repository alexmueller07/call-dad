// Next 16 renamed Middleware to "Proxy" (same mechanism, runs before requests).
// We delegate to the Supabase session-refresh helper. The matcher skips API
// routes (Twilio webhooks have no user cookie and must not be redirected),
// Next internals, and static assets.
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
