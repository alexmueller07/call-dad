// Session refresh + optimistic auth redirect, run from the root proxy.ts on
// every page request. It keeps the Supabase auth cookie fresh and bounces
// signed-out visitors to /login. This is an OPTIMISTIC check only (it reads the
// cookie, not the DB) — real authorization still happens in each page/route via
// the data-access layer. See Next 16 "Proxy" + Supabase SSR docs.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Only these path prefixes require a session. Everything else (the landing
// page, /login, static) is public.
const PROTECTED_PREFIXES = ['/app'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser(), and do
  // not remove this call — it refreshes the token and prevents random logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  // Signed-out users can't reach the app.
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Signed-in users hitting /login go straight to the app.
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    return NextResponse.redirect(url);
  }

  return response;
}
