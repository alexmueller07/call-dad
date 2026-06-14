'use server';

// Account self-service actions. Deleting uses the admin client (the user can't
// remove their own auth row via RLS) and cascades their profile/contacts/calls.
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // Clear the now-orphaned session cookie.
  const supabase = await createClient();
  await supabase.auth.signOut();
  return { ok: true };
}

export async function goHome() {
  redirect('/');
}
