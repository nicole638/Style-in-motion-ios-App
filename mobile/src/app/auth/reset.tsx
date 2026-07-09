import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AuthResetScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();

  useEffect(() => {
    // On any failure we don't yet know the account's type, so fall back to the
    // type-neutral welcome screen — never to /creator-login (that's the
    // authenticated-audience -> creator-signup bug class).
    if (!code) {
      router.replace('/welcome' as any);
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        console.warn('[auth/reset] code exchange failed:', error.message);
        router.replace('/welcome' as any);
      } else {
        router.replace('/reset-password' as any);
      }
    });
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        testID="auth-reset-loading"
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F4F0' }}
      >
        <ActivityIndicator color="#B87063" size="large" />
      </View>
    </>
  );
}
