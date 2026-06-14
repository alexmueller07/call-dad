// Combined log-in / sign-up page. One form, two buttons: each submit button
// targets a different server action via `formAction`. Errors and notices come
// back as query params (set by the actions' redirects).
import { login, signup } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-xl shadow-black/5">
        <div className="mb-7 text-center">
          <div className="mb-2 text-4xl">📞</div>
          <h1 className="text-2xl font-bold tracking-tight">CallMom</h1>
          <p className="mt-1 text-sm text-muted">
            Cheap calls to the people back home.
          </p>
        </div>

        <form className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Email"
            required
            className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password (8+ characters)"
            required
            minLength={8}
            className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
          />

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              {message}
            </p>
          )}

          <button
            formAction={login}
            className="mt-1 rounded-xl bg-accent px-6 py-2.5 font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.99]"
          >
            Log in
          </button>
          <button
            formAction={signup}
            className="rounded-xl border border-border px-6 py-2.5 font-semibold transition hover:bg-foreground/5 active:scale-[0.99]"
          >
            Create account
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-muted">Talk as long as you want, for cents a minute.</p>
    </main>
  );
}
