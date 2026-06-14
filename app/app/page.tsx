// The authenticated app lives at /app. Verifies session + loads the basics,
// then hands off to the client phone app.
import { requireUser, getProfile } from '@/lib/dal';
import { isCallerAllowed } from '@/lib/calling';
import { PhoneApp } from '../phone-app';

export default async function AppPage() {
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
