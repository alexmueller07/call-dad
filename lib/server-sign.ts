import 'server-only';
import { createHmac } from 'node:crypto';

// The call-status webhook is a public URL Twilio POSTs to. We can't validate
// Twilio's own signature (we use API keys, not the account Auth Token), so we
// stamp the callback URL with an HMAC of the user id. That stops anyone from
// POSTing fake "call completed" events to drain someone else's balance.
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dev-key';

export function signUid(uid: string): string {
  return createHmac('sha256', KEY).update(uid).digest('hex').slice(0, 32);
}

export function verifyUid(uid: string, sig: string | null): boolean {
  return !!sig && signUid(uid) === sig;
}
