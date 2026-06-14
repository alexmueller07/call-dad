// Home (Server Component): verify session + load the basics, then hand off to
// the client phone app. Contacts and recents are loaded client-side for a
// snappy, native-feeling experience.
import { requireUser, getProfile } from '@/lib/dal';
import { isCallerAllowed } from '@/lib/calling';
import { PhoneApp } from './phone-app';

export default async function Home() {
  const user = await requireUser();
  const profile = await getProfile();

  return (
    <PhoneApp
      userId={user.id}
      email={user.email ?? ''}
      initialBalanceSeconds={profile.balance_seconds}
      canCall={isCallerAllowed(user.email)}
      testTopupEnabled={process.env.ENABLE_TEST_TOPUP === 'true'}
    />
  );
}
