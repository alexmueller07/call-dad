// Public About page — the story behind CallDad.
import Link from 'next/link';

export const metadata = {
  title: 'About — CallDad',
  description: 'Why CallDad exists.',
};

export default function About() {
  return (
    <div className="landing-bg min-h-screen text-white">
      <header className="flex items-center justify-between px-5 py-4 md:px-10">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-white">
            <Phone className="h-4 w-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">CallDad</span>
        </Link>
        <Link href="/login" className="rounded-full bg-accent px-5 py-2 font-semibold text-white transition hover:brightness-110">
          Get started
        </Link>
      </header>

      <article className="mx-auto max-w-2xl px-6 py-16 md:py-24">
        <p className="font-semibold text-accent">Our story</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight md:text-5xl">
          It started with a call to my dad.
        </h1>

        <div className="mt-8 space-y-5 text-lg leading-relaxed text-white/80">
          <p>
            I moved halfway around the world to South Korea. The first few weeks were a blur —
            new city, new language, new everything. Then about a month in, the newness wore off
            and I just missed home.
          </p>
          <p>
            So I called my dad. And then my grandpa. Hearing their voices from seven thousand
            miles away did something I didn&apos;t expect — the distance shrank. For a few minutes
            it felt like I was back at the kitchen table.
          </p>
          <p>
            The only problem was the cost. Calling internationally the normal way is expensive,
            and my grandpa isn&apos;t about to install some app to take a call. I wanted something
            dead simple: open my laptop, dial his regular phone, talk as long as I want, and pay
            almost nothing.
          </p>
          <p>
            That&apos;s CallDad. It&apos;s the thing I wished existed when I was sitting alone in a
            new country wanting to hear a familiar voice. If you&apos;re far from the people who
            raised you, I hope it shrinks the distance for you too.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-white/80">
            Call any phone — landline, cell, or flip phone — for cents a minute. No app for them,
            no subscription for you.
          </p>
          <Link
            href="/login"
            className="press mt-4 inline-block rounded-full bg-accent px-6 py-2.5 font-semibold text-white transition hover:brightness-110"
          >
            Make your first call
          </Link>
        </div>

        <p className="mt-10">
          <Link href="/" className="text-accent hover:underline">← Back home</Link>
        </p>
      </article>
    </div>
  );
}

function Phone({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" />
    </svg>
  );
}
