'use server';

// TEST-ONLY time purchase. Stands in for Stripe until it's wired: "buying" a
// pack instantly grants the call time. Runs with the service-role (admin)
// client because users can't write their own balance (RLS). The server
// recomputes minutes + price from the chosen pack so the client can't forge a
// cheaper/bigger purchase. Gated behind ENABLE_TEST_TOPUP.
import { requireUser } from '@/lib/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  PACKAGES,
  CUSTOM_MIN_MINUTES,
  CUSTOM_MAX_MINUTES,
  customPriceCents,
} from '@/lib/pricing';

const ENABLED = process.env.ENABLE_TEST_TOPUP === 'true';

export type BuyInput = { packageId?: string; customMinutes?: number };

export async function buyTime(input: BuyInput): Promise<{ ok: boolean; error?: string }> {
  if (!ENABLED) return { ok: false, error: 'Purchases are disabled.' };

  let minutes: number;
  let priceCents: number;

  if (input.packageId) {
    const pkg = PACKAGES.find((p) => p.id === input.packageId);
    if (!pkg) return { ok: false, error: 'Unknown package.' };
    minutes = pkg.minutes;
    priceCents = pkg.priceCents;
  } else {
    const m = Math.floor(input.customMinutes ?? 0);
    if (m < CUSTOM_MIN_MINUTES || m > CUSTOM_MAX_MINUTES) {
      return { ok: false, error: `Custom amount must be ${CUSTOM_MIN_MINUTES}–${CUSTOM_MAX_MINUTES} minutes.` };
    }
    minutes = m;
    priceCents = customPriceCents(m);
  }

  const user = await requireUser();
  const admin = createAdminClient();

  const { data: profile, error: readErr } = await admin
    .from('profiles')
    .select('balance_seconds')
    .eq('id', user.id)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const addSeconds = minutes * 60;
  const next = (profile?.balance_seconds ?? 0) + addSeconds;

  const { error: updErr } = await admin
    .from('profiles')
    .update({ balance_seconds: next })
    .eq('id', user.id);
  if (updErr) return { ok: false, error: updErr.message };

  await admin
    .from('top_ups')
    .insert({ user_id: user.id, amount_cents: priceCents, seconds_added: addSeconds });

  return { ok: true };
}
