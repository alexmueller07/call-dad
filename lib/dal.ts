// Data Access Layer — the single place that answers "who is the current user
// and what's their account?". Centralizing it (per Next 16 auth guidance) means
// every page/route/action gets the same verified answer and we can't forget a
// check. cache() de-dupes the work within one server render pass.
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  email: string | null;
  balance_seconds: number;
};

// Returns the authenticated Supabase user or redirects to /login. Use this at
// the top of any protected page, action, or route handler.
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return user;
});

// The current user's profile row (balance lives here). RLS ensures a user can
// only ever read their own row.
export const getProfile = cache(async (): Promise<Profile> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, balance_seconds')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    // The signup trigger creates this row; a miss means the migration or
    // trigger hasn't run. Fail loud rather than show a wrong balance.
    throw new Error(`Profile not found for user ${user.id}: ${error?.message}`);
  }
  return data;
});
