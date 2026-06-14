// POST /api/call-status?uid=<user>&sig=<hmac> — Twilio calls this when a dialed
// call completes. It's the AUTHORITATIVE meter: subtract the real call duration
// from the caller's time balance and log the call. The HMAC sig (see
// server-sign) proves the request really came from a call we set up, so nobody
// can drain a stranger's balance by forging events.
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyUid } from '@/lib/server-sign';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid') ?? '';
  const sig = url.searchParams.get('sig');

  if (!uid || !verifyUid(uid, sig)) {
    return new Response('forbidden', { status: 403 });
  }

  const form = await request.formData();
  const status = String(form.get('CallStatus') ?? '');
  const duration = parseInt(String(form.get('CallDuration') ?? '0'), 10) || 0;
  const to = String(form.get('To') ?? '');

  if (status === 'completed' && duration > 0) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('profiles')
      .select('balance_seconds')
      .eq('id', uid)
      .single();
    const remaining = Math.max(0, (data?.balance_seconds ?? 0) - duration);
    await admin.from('profiles').update({ balance_seconds: remaining }).eq('id', uid);
    await admin.from('calls').insert({ user_id: uid, to_number: to, seconds: duration });
  }

  // Twilio only needs a 2xx; no body required.
  return new Response('', { status: 200 });
}
