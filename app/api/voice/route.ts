// POST /api/voice — Twilio calls this back when the browser places a call. We:
//   1. read who's calling (From=client:<userId>, set in /api/token) and the
//      destination (To param, validated as E.164),
//   2. look up their remaining call time,
//   3. dial with timeLimit = remaining seconds so a call can never exceed what
//      they bought, and attach a signed status callback so /api/call-status can
//      meter the actual duration when the call ends.
import twilio from 'twilio';
import { requireTwilioConfig } from '@/lib/twilio-config';
import { isValidE164 } from '@/lib/calling';
import { createAdminClient } from '@/lib/supabase/admin';
import { signUid } from '@/lib/server-sign';

export const dynamic = 'force-dynamic';

const TWILIO_MAX_TIME_LIMIT = 86400; // 24h, Twilio's ceiling for <Dial timeLimit>

export async function POST(request: Request) {
  const form = await request.formData();
  const to = String(form.get('To') ?? '').trim();
  const from = String(form.get('From') ?? '');
  const uid = from.startsWith('client:') ? from.slice('client:'.length) : '';

  const { VoiceResponse } = twilio.twiml;
  const response = new VoiceResponse();

  // How much time does this caller have?
  let balanceSeconds = 0;
  if (uid) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('profiles')
      .select('balance_seconds')
      .eq('id', uid)
      .single();
    balanceSeconds = data?.balance_seconds ?? 0;
  }

  if (!isValidE164(to)) {
    response.say('Sorry, that number is not valid. Goodbye.');
    response.hangup();
  } else if (balanceSeconds <= 0) {
    response.say('You are out of call time. Please buy more and try again.');
    response.hangup();
  } else {
    const { callerId } = requireTwilioConfig();
    const timeLimit = Math.min(balanceSeconds, TWILIO_MAX_TIME_LIMIT);
    const origin = new URL(request.url).origin;
    const statusCallback = `${origin}/api/call-status?uid=${encodeURIComponent(uid)}&sig=${signUid(uid)}`;

    const dial = response.dial({ callerId, timeLimit });
    dial.number(
      {
        statusCallback,
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST',
      },
      to,
    );
  }

  return new Response(response.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
