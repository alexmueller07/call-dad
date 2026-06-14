// Dashboard (Server Component): verifies the session, loads balance + recent
// activity, then renders the account UI and the client <Dialer>.
import { getProfile, getRecentActivity, formatBalance } from '@/lib/dal';
import { signOut } from './login/actions';
import { addTestCredit } from './actions/billing';
import { Dialer } from './dialer';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default async function Home() {
  const [profile, activity] = await Promise.all([getProfile(), getRecentActivity()]);
  const testTopupEnabled = process.env.ENABLE_TEST_TOPUP === 'true';
  const hasActivity = activity.topups.length > 0 || activity.calls.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-5">
      {/* Header */}
      <header className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">📞</span>
          <span className="font-bold tracking-tight">CallMom</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="max-w-[10rem] truncate text-muted" title={profile.email ?? ''}>
            {profile.email}
          </span>
          <form action={signOut}>
            <button className="rounded-full border border-border px-3 py-1 transition hover:bg-foreground/5">
              Log out
            </button>
          </form>
        </div>
      </header>

      {/* Balance card */}
      <section className="rounded-3xl border border-border bg-gradient-to-br from-accent to-emerald-700 p-6 text-white shadow-lg shadow-emerald-900/20">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white/80">Your balance</p>
          {testTopupEnabled && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              Test mode
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-5xl font-bold tabular-nums">
          {formatBalance(profile.balance_cents)}
        </p>

        {testTopupEnabled && (
          <form action={addTestCredit} className="mt-5">
            <button className="w-full rounded-xl bg-white px-4 py-2.5 font-semibold text-emerald-700 shadow-sm transition hover:bg-white/90 active:scale-[0.99]">
              + Add $1 (test)
            </button>
          </form>
        )}
        <p className="mt-2 text-center text-xs text-white/70">
          {testTopupEnabled
            ? 'Stripe card payments coming soon — this is a test credit.'
            : 'Add funds to start calling.'}
        </p>
      </section>

      {/* Call card */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-1 text-center text-lg font-semibold">Call home</h2>
        <p className="mb-5 text-center text-sm text-muted">
          Rings their normal phone — no app needed on their end.
        </p>
        <Dialer />
      </section>

      {/* Activity */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-muted">Recent activity</h2>
        {!hasActivity ? (
          <p className="py-4 text-center text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {activity.topups.map((t, i) => (
              <li key={`t${i}`} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-base">💵</span> Top-up
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-accent">
                    +{formatBalance(t.amount_cents)}
                  </span>
                  <span className="text-xs text-muted">{fmtDate(t.created_at)}</span>
                </span>
              </li>
            ))}
            {activity.calls.map((c, i) => (
              <li key={`c${i}`} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-base">📞</span> {c.to_number} · {fmtDuration(c.seconds)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-foreground/80">
                    -{formatBalance(c.cost_cents)}
                  </span>
                  <span className="text-xs text-muted">{fmtDate(c.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pb-4 text-center text-xs text-muted">
        Talk as long as you want, for cents a minute.
      </footer>
    </main>
  );
}
