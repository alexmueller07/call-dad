// GET /api/token — issues a short-lived Twilio access token so the browser's
// Voice SDK can register. The VoiceGrant points at our TwiML App, so when the
// browser places a call, Twilio knows to hit /api/voice for dial instructions.
//
// The token's identity is the authenticated user's id. Twilio echoes it back to
// /api/voice as `From=client:<id>`, giving that webhook a SERVER-TRUSTED caller
// id to bill — the browser can't forge who it is.
import twilio from 'twilio';
import { requireTwilioConfig } from '@/lib/twilio-config';
import { createClient } from '@/lib/supabase/server';
import { isCallerAllowed } from '@/lib/calling';

// Tokens depend on secrets + must never be cached/prerendered.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Who may PLACE calls (no token = no call, so this is the single choke point).
  if (!isCallerAllowed(user.email)) {
    return new Response('Calling is not enabled for this account yet.', { status: 403 });
  }

  const config = requireTwilioConfig();

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(config.accountSid, config.apiKey, config.apiSecret, {
    identity: user.id,
    ttl: 3600,
  });
  token.addGrant(
    new VoiceGrant({ outgoingApplicationSid: config.twimlAppSid, incomingAllow: false }),
  );

  return Response.json({ token: token.toJwt() });
}
