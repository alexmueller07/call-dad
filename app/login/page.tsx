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
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">📞 Call Home</h1>
        <p className="mt-1 text-sm text-gray-500">Log in or create an account to call.</p>
      </div>

      <form className="flex w-full max-w-xs flex-col gap-3">
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          required
          className="rounded-lg border border-gray-300 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900"
        />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password (8+ characters)"
          required
          minLength={8}
          className="rounded-lg border border-gray-300 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        <button
          formAction={login}
          className="rounded-full bg-green-600 px-6 py-2.5 font-medium text-white transition hover:bg-green-700"
        >
          Log in
        </button>
        <button
          formAction={signup}
          className="rounded-full border border-green-600 px-6 py-2.5 font-medium text-green-700 transition hover:bg-green-50 dark:text-green-400 dark:hover:bg-gray-800"
        >
          Sign up
        </button>
      </form>
    </main>
  );
}
