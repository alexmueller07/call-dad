// GET /api/token — issues a short-lived Twilio access token so the browser's
// Voice SDK can register. The VoiceGrant points at our TwiML App, so when the
// browser places a call, Twilio knows to hit /api/voice for dial instructions.
import twilio from 'twilio';
import { requireTwilioConfig } from '@/lib/twilio-config';

// Tokens depend on secrets + must never be cached/prerendered.
export const dynamic = 'force-dynamic';

export async function GET() {
  const config = requireTwilioConfig();

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(config.accountSid, config.apiKey, config.apiSecret, {
    identity: 'web-caller',
    ttl: 3600,
  });
  token.addGrant(
    new VoiceGrant({ outgoingApplicationSid: config.twimlAppSid, incomingAllow: false }),
  );

  return Response.json({ token: token.toJwt() });
}
