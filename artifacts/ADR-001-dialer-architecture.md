# ADR-001 — "Call any (US/CA) number" dialer architecture

Status: Accepted (2026-06-14)
Project: callhome (CallMom.com), Next.js 16 + Twilio Voice + Vercel

## Context

Today the app dials a fixed `dad`/`grandpa` whitelist (`lib/twilio-config.ts`
CONTACTS, consumed by `app/api/voice/route.ts`). We want signed-in users to type
**any number** and call it. The whitelist was the only thing bounding the bill,
so removing it makes abuse control the core design problem.

This refines, not contradicts, the earlier locked decision. We still REJECT the
"anyone, anonymously, calls anywhere on Earth, we charge strangers" model
(toll-fraud / IRSF, high-risk payments, telecom regulation). What we are
building is the safe version: **signed-in user + prepaid balance + destination
allowlist (US/Canada to start)**, with Stripe in TEST mode until LLC + ToS.

## Decisions

| Area | Choice |
|---|---|
| Auth | **Account required** (email login) — needed for balance, rate-limit, ban |
| Payment | **Prepaid top-ups** via Stripe (test mode) — balance = the fraud cap; avoids the 30¢/txn fee that guts pay-per-call |
| Telephony | Twilio Voice (keep); single caller ID `+16503000315` for everyone |
| Hosting | Vercel serverless (`/api/*` route handlers are stateless) |
| Data | Supabase (bundles email auth + Postgres) — leaning this over Neon+DIY auth |

## Concurrency — "can two people call from one number at once?"

Yes. A Twilio number used as caller ID has **no busy state**; one number can be
the caller ID on many simultaneous outbound calls. Limits are account-level
(CPS default ~1/sec, raisable; concurrent-call cap generous on a paid account),
never the number. Twilio account is already UPGRADED/paid (~$18.75 calling
credit as of 2026-06-14), so trial restrictions do not apply. The route handlers
are stateless, so concurrent `/api/token` and `/api/voice` requests don't collide.

Note: Twilio (paid) and Stripe (still TEST mode until LLC + ToS) are separate
accounts — the Twilio upgrade does not change the Stripe-test-mode rule.

## Required changes vs current code

1. **Unique Voice identity per user.** Today `app/api/token/route.ts:18` hardcodes
   `identity: 'web-caller'` for everyone. Issue the token only to an authenticated
   user and use their user id as the identity.
2. **Replace the CONTACTS whitelist with guarded arbitrary dialing** in
   `app/api/voice/route.ts`. On each call the server must:
   - Parse + validate the target as E.164.
   - Enforce a destination allowlist (Twilio Voice Geographic Permissions +
     reject premium/satellite prefixes: 1-900, +882/+883).
   - Look up the caller's balance; reject if below a minimum.
   - Set `<Dial timeLimit=…>` = `balance / per-minute-rate` so the call ends
     before the balance goes negative.
3. **Pass the authenticated user, not just a number, to `/api/voice`.** Trust the
   token identity for *who*; validate the *number* server-side. Never bill based
   on a value the browser could forge.
4. **Authoritative billing via Twilio `statusCallback`.** On call completion,
   read final duration, compute cost (Twilio cost + markup), decrement balance in
   the DB. This webhook — not the browser timer — is the source of truth.
5. **Dedicated TwiML App for callhome** (currently shares
   `AP4aa389214a950ee4c4651505ced537d2` with the legacy call-dad tool). Point its
   Voice URL at `https://<vercel-domain>/api/voice` permanently — no tunnel.

## Data model (MVP)

- `users(id, email, auth_*, balance_cents, created_at)`
- `top_ups(id, user_id, stripe_payment_intent, amount_cents, created_at)`
- `calls(id, user_id, to_number, country, seconds, cost_cents, twilio_call_sid, created_at)`

## Open sub-decisions (not blocking)

- Supabase vs Neon+own auth (leaning Supabase).
- Markup % over Twilio's ~1.3–2¢/min (pricing idea ~5¢/min).
- Minimum top-up amount + low-balance UX.
