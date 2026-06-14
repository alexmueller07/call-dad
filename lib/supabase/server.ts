// Server-side Supabase client, bound to the request's cookies so it can read
// and refresh the logged-in user's session. Use this in Server Components,
// Server Actions, and Route Handlers. Still uses the anon key + RLS, so it can
// only ever see/modify data the current user is allowed to.
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  // Next 16: cookies() is async and must be awaited.
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In Server Components cookies are read-only and this throws; that's
          // fine because proxy.ts refreshes the session cookie instead.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — ignore.
          }
        },
      },
    },
  );
}
