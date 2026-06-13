// Server-only Twilio configuration + the allow-list of who can be dialed.
// Imported only by route handlers (never shipped to the browser), so the
// secrets stay on the server.

export const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  apiKey: process.env.TWILIO_API_KEY,
  apiSecret: process.env.TWILIO_API_SECRET,
  twimlAppSid: process.env.TWIML_APP_SID,
  callerId: process.env.TWILIO_CALLER_ID,
};

// The ONLY numbers this app can dial. The browser sends a key ("dad"),
// never a raw number, so a request can't run up the bill dialing anywhere.
// Phase 3 replaces this static map with per-user verified contacts in the DB.
export const CONTACTS: Record<string, string | undefined> = {
  dad: process.env.DAD_NUMBER,
  grandpa: process.env.GRANDPA_NUMBER,
};

// Throw a clear error if a required Twilio value is missing from the env.
export function requireTwilioConfig() {
  const missing = Object.entries(twilioConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing Twilio env vars: ${missing.join(', ')}`);
  }
  return twilioConfig as { [K in keyof typeof twilioConfig]: string };
}
