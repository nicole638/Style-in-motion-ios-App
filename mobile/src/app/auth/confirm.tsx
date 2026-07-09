import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import useCreatorStore from '@/lib/state/creatorStore';

/**
 * Email-confirmation LINK fallback. Signup emails deep-link
 * `styledinmotion://auth/confirm` with Supabase auth params appended. Because
 * the Supabase client is created with `detectSessionInUrl: false`, we consume
 * those params manually here (mirrors auth/reset.tsx). On success we hydrate the
 * stores via authStore.initialize() and route by the real account type — never
 * into /creator-login (the audience -> creator-signup bug class). Any failure or
 * stale/reused link falls to a friendly "You're all set!" state that just points
 * the user back to the type-neutral welcome landing.
 */
export default function AuthConfirmScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();

  const [working, setWorking] = useState(true);

  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });

  useEffect(() => {
    const run = async () => {
      const { code, token_hash, type, access_token, refresh_token, error } = params;

      // Stale/errored link, or nothing usable to act on → friendly state.
      const hasUsableParams = !!code || !!token_hash || (!!access_token && !!refresh_token);
      if (error || !hasUsableParams) {
        setWorking(false);
        return;
      }

      try {
        let sessionError: unknown = null;

        if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          sessionError = e;
        } else if (token_hash) {
          const { error: e } = await supabase.auth.verifyOtp({
            type: (type as any) ?? 'signup',
            token_hash,
          });
          sessionError = e;
        } else if (access_token && refresh_token) {
          const { error: e } = await supabase.auth.setSession({ access_token, refresh_token });
          sessionError = e;
        }

        if (sessionError) {
          console.warn('[auth/confirm] session establishment failed:', sessionError);
          setWorking(false);
          return;
        }

        // Hydrate stores + userType/creatorId/accountType from the fresh session.
        await useAuthStore.getState().initialize();

        const userType = useAuthStore.getState().userType;

        if (userType === 'audience') {
          router.replace('/(public-tabs)/feed' as any);
          return;
        }

        if (userType === 'creator') {
          const creatorId = useAuthStore.getState().creatorId;
          if (creatorId) {
            useProfileStore.getState().switchCreator(creatorId);
            const creatorName = useAuthStore.getState().creatorName;
            if (!useProfileStore.getState().username && creatorName) {
              useProfileStore.getState().setUsername(creatorName);
            }
            useCreatorStore.getState().switchCreator(creatorId);
          }
          router.replace('/onboarding/welcome' as any);
          return;
        }

        // Session set but no resolvable account type → friendly state.
        setWorking(false);
      } catch (err) {
        console.warn('[auth/confirm] unexpected error:', err);
        setWorking(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (working) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View
          testID="auth-confirm-loading"
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F4F0' }}
        >
          <ActivityIndicator color="#B87063" size="large" />
        </View>
      </>
    );
  }

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView className="flex-1 bg-[#F7F4F0]" edges={['top', 'bottom']} testID="auth-confirm-stale">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 px-6 justify-center items-center">
        <Text
          className="text-[28px] text-[#1A1210] text-center"
          style={{ fontFamily: 'DMSans_700Bold', lineHeight: 34 }}
        >
          You're all set!
        </Text>
        <Text
          className="text-[16px] text-[#6B5E58] mt-3 text-center"
          style={{ fontFamily: 'DMSans_400Regular', lineHeight: 24 }}
        >
          This confirmation link has already been used or expired. Just log in to continue.
        </Text>

        <View className="w-full mt-8">
          <Pressable
            onPress={() => router.replace('/welcome' as any)}
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
            testID="auth-confirm-login"
          >
            <Text className="text-white text-[15px]" style={{ fontFamily: 'DMSans_500Medium' }}>
              Log In
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
