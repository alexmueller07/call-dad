// Home is a Server Component: it verifies the session (redirecting to /login if
// absent), reads the prepaid balance, then hands the call UI to the client
// <Dialer>. The proxy also guards this route, but checking here too keeps auth
// close to the data (defense in depth, per the Next 16 auth guidance).
import { getProfile, formatBalance } from '@/lib/dal';
import { signOut } from './login/actions';
import { Dialer } from './dialer';

export default async function Home() {
  const profile = await getProfile();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <header className="flex w-full max-w-md items-center justify-between text-sm text-gray-500">
        <span className="truncate">{profile.email}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-gray-700 dark:text-gray-200">
            Balance: {formatBalance(profile.balance_cents)}
          </span>
          <form action={signOut}>
            <button className="rounded-full border border-gray-300 px-3 py-1 transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="text-center">
        <h1 className="text-3xl font-semibold">📞 Call Home</h1>
        <p className="mt-1 text-sm text-gray-500">
          Talk to family on any phone, straight from your browser.
        </p>
      </div>

      <Dialer />
    </main>
  );
}
