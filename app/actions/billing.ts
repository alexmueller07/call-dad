'use server';

// TEST-ONLY top-up. Stands in for Stripe until it's wired: clicking the button
// credits $1 to the signed-in user. It runs with the service-role (admin)
// client because users have NO write access to their own balance by design
// (RLS) — money only moves server-side. Gated behind ENABLE_TEST_TOPUP so it
// can be switched off in production with one env var.
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/dal';
import { createAdminClient } from '@/lib/supabase/admin';

const ENABLED = process.env.ENABLE_TEST_TOPUP === 'true';
const STEP_CENTS = 100; // $1 per click
const MAX_TEST_BALANCE_CENTS = 5000; // $50 cap so the test button can't mint silly balances

export async function addTestCredit() {
  if (!ENABLED) throw new Error('Test top-up is disabled.');

  const user = await requireUser();
  const admin = createAdminClient();

  const { data: profile, error: readErr } = await admin
    .from('profiles')
    .select('balance_cents')
    .eq('id', user.id)
    .single();
  if (readErr || !profile) throw new Error(`Could not read balance: ${readErr?.message}`);

  const current = profile.balance_cents as number;
  if (current >= MAX_TEST_BALANCE_CENTS) {
    revalidatePath('/');
    return; // already at the test cap
  }

  const next = Math.min(current + STEP_CENTS, MAX_TEST_BALANCE_CENTS);
  const delta = next - current;

  // NOTE: read-modify-write is fine for a single-user test button. Real Stripe
  // top-ups will use an atomic DB function keyed off the webhook event id.
  const { error: updErr } = await admin
    .from('profiles')
    .update({ balance_cents: next })
    .eq('id', user.id);
  if (updErr) throw new Error(`Could not update balance: ${updErr.message}`);

  // Mirror the audit row a real top-up will write (stripe_payment_intent null = test).
  await admin.from('top_ups').insert({ user_id: user.id, amount_cents: delta });

  revalidatePath('/');
}
