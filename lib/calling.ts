// Shared calling helpers used by route handlers (server) and the phone UI.

// True if this user may PLACE calls. ALLOWED_CALLER_EMAILS is a comma-separated
// allowlist; empty/unset = everyone may call (dev default). Until the metered
// "any number" billing ships, this keeps a public deploy from letting strangers
// run up our Twilio balance. Reads a non-public env var, so only call this on
// the server.
export function isCallerAllowed(email: string | null | undefined): boolean {
  const allow = (process.env.ALLOWED_CALLER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return true;
  return allow.includes((email ?? '').toLowerCase());
}

// Strict E.164 check: "+" then 8–15 digits, first digit non-zero. Pure — safe
// to use on the client for input validation too.
export function isValidE164(n: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(n);
}

// Best-effort normalization of user input to E.164. Bare 10-digit numbers are
// assumed US (+1); 11 digits starting with 1 get a "+"; anything already in
// "+…" form is kept. Returns "" if there's nothing usable.
export function normalizeNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits ? '+' + digits : '';
}
