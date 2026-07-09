import { Redirect } from 'expo-router';
import useAuthStore from '@/lib/state/authStore';

export default function Index() {
  const hasHydrated = useAuthStore(s => s._hasHydrated);
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const userType = useAuthStore(s => s.userType);

  if (!hasHydrated) return null;

  if (!isLoggedIn) return <Redirect href="/welcome" />;
  if (userType === 'creator') return <Redirect href="/(tabs)" />;
  if (userType === 'audience') return <Redirect href="/(public-tabs)/feed" />;

  return <Redirect href="/welcome" />;
}
