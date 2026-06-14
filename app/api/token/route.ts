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

// Tokens depend on secrets + must never be cached/prerendered.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Calling allowlist. Until the guarded "any number" dialer + per-minute
  // billing ships, restrict who can actually place calls so a public deploy
  // can't let strangers ring our fixed contacts on our Twilio balance. If
  // ALLOWED_CALLER_EMAILS is empty/unset, everyone may call (dev default). No
  // token = no call, so gating here is the single choke point.
  const allow = (process.env.ALLOWED_CALLER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes((user.email ?? '').toLowerCase())) {
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
