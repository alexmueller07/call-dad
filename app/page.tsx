// Public landing page (marketing). Anyone can see it; the actual app is at /app.
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PACKAGES, formatPrice, ratePerMinCents } from '@/lib/pricing';

export default async function Landing() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const loggedIn = !!user;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-5 py-4 backdrop-blur md:px-10">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-white">
            <PhoneGlyph className="h-4 w-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">CallMom</span>
        </Link>
        <nav className="flex items-center gap-2">
          {loggedIn ? (
            <Link href="/app" className="rounded-full bg-accent px-5 py-2 font-semibold text-white transition hover:brightness-110">
              Open app
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-4 py-2 font-semibold text-foreground/70 transition hover:text-foreground">
                Log in
              </Link>
              <Link href="/login" className="rounded-full bg-accent px-5 py-2 font-semibold text-white transition hover:brightness-110">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-5 py-20 text-center md:py-28">
        <div className="mx-auto max-w-3xl animate-fade-in">
          <span className="inline-block rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-muted">
            📞 Calls from your browser — nothing to install for them
          </span>
          <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Call home for{' '}
            <span className="bg-gradient-to-br from-accent to-emerald-600 bg-clip-text text-transparent">cents</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
            Talk to family on any phone — landline, cell, even a flip phone — straight from your laptop.
            Buy call time once, dial anyone, and only pay for the minutes you use.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={loggedIn ? '/app' : '/login'} className="press rounded-full bg-accent px-7 py-3 text-lg font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110">
              {loggedIn ? 'Open the app' : 'Start calling'}
            </Link>
            <Link href="#pricing" className="press rounded-full border border-border px-7 py-3 text-lg font-semibold transition hover:bg-foreground/5">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">No subscription. As low as 10¢/min.</p>
        </div>
      </section>

      {/* How it works */}
      <section className="px-5 py-16 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { n: '1', t: 'Create an account', d: 'Sign up in seconds with just an email — no card to start.' },
              { n: '2', t: 'Buy call time', d: 'Pick a time pack. The more you buy, the cheaper per minute.' },
              { n: '3', t: 'Call anyone', d: 'Dial any number or save contacts. Their phone just rings normally.' },
            ].map((s) => (
              <div key={s.n} className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-lg font-bold text-accent">{s.n}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 px-5 py-16 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold">Simple, bulk-friendly pricing</h2>
          <p className="mt-2 text-center text-muted">Buy call time in packs — bigger packs cost less per minute.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {PACKAGES.map((p, i) => (
              <div
                key={p.id}
                className={`rounded-3xl border bg-card p-6 text-center shadow-sm ${i === 1 ? 'border-accent ring-2 ring-accent/20' : 'border-border'}`}
              >
                {i === 1 && <span className="mb-2 inline-block rounded-full bg-accent/10 px-3 py-0.5 text-xs font-semibold text-accent">Most popular</span>}
                <p className="text-4xl font-bold">{formatPrice(p.priceCents)}</p>
                <p className="mt-1 font-semibold">{p.label}</p>
                <p className="mt-1 text-sm text-muted">{ratePerMinCents(p.priceCents, p.minutes)}¢ per minute</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted">Need more than 2 hours? It’s a flat 10¢/min.</p>
        </div>
      </section>

      {/* Why */}
      <section className="px-5 py-16 md:px-10">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
          {[
            { icon: '🌍', t: 'Works across borders', d: 'Living abroad? Call family back home without insane roaming bills.' },
            { icon: '📟', t: 'No app for them', d: 'They answer a normal call on whatever phone they already have.' },
            { icon: '⏱️', t: 'Pay per second', d: 'Time is billed by the second while you talk — never round-ups or surprises.' },
          ].map((f) => (
            <div key={f.t} className="rounded-3xl border border-border bg-card p-6">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 text-lg font-semibold">{f.t}</h3>
              <p className="mt-1 text-sm text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-20 text-center">
        <div className="mx-auto max-w-2xl rounded-3xl bg-gradient-to-br from-accent to-emerald-700 p-10 text-white shadow-xl">
          <h2 className="text-3xl font-bold">Ready to call home?</h2>
          <p className="mt-2 text-white/80">Set up your account and make your first call in under a minute.</p>
          <Link href={loggedIn ? '/app' : '/login'} className="press mt-6 inline-block rounded-full bg-white px-7 py-3 text-lg font-semibold text-emerald-700 transition hover:bg-white/90">
            {loggedIn ? 'Open the app' : 'Get started free'}
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-sm text-muted">
        <p>CallMom — talk as long as you want, for cents a minute.</p>
      </footer>
    </div>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" />
    </svg>
  );
}
