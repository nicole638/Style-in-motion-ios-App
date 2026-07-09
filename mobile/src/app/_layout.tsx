import { useEffect, useRef } from 'react';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import useCreatorStore from '@/lib/state/creatorStore';
import useLookStore from '@/lib/state/lookStore';
import useAppMetadataStore from '@/lib/state/appMetadataStore';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { readSeenOnboarding, writeSeenOnboarding } from '@/lib/onboardingFlag';
import { pruneStalePickedPhotos } from '@/lib/utils/persistPickedPhoto';
import { COMPLETE_PROFILE_SHEET_KEY_PREFIX } from '@/components/CompleteProfileSheet';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(public-tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="creator-login" options={{ headerShown: false }} />
        <Stack.Screen name="public-signup" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding/welcome" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding/aesthetic" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding/pick-three" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding/celebration" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding-socials" options={{ headerShown: false }} />
        <Stack.Screen name="creator-profile" options={{ headerShown: false }} />
        <Stack.Screen name="creator-stats" options={{ headerShown: false }} />
        <Stack.Screen name="auth/reset" options={{ headerShown: false }} />
        <Stack.Screen name="auth/verify" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="terms-of-service" options={{ headerShown: false }} />
        <Stack.Screen name="privacy-policy" options={{ headerShown: false }} />
        <Stack.Screen name="look/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="brand/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="web-shop" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="amazon-campaigns" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="profile-setup" options={{ headerShown: false }} />
        <Stack.Screen name="drafts" options={{ headerShown: false }} />
        <Stack.Screen name="account-settings" options={{ headerShown: false }} />
        <Stack.Screen name="payments-payouts" options={{ headerShown: false }} />
        <Stack.Screen name="creator-account" options={{ headerShown: false }} />
        <Stack.Screen name="creator-analytics" options={{ headerShown: false }} />
        <Stack.Screen name="add-closet-item" options={{ headerShown: false, presentation: 'formSheet' }} />
        <Stack.Screen name="add-closet-photos" options={{ headerShown: false, presentation: 'formSheet' }} />
        <Stack.Screen name="founding-badge-info" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="try-on-flow" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="collage-builder" options={{ title: 'New Collage', headerBackTitle: 'Back' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const hasHydrated = useAuthStore(s => s._hasHydrated);
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const initializeRef = useRef(false);
  const onboardingCheckedRef = useRef(false);
  const router = useRouter();
  const segments = useSegments();

  // Handle deep links for email confirmation (styledinmotion://auth/confirm)
  useEffect(() => {
    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      console.warn('[deep-link] received url:', url);
      try {
        const parsed = Linking.parse(url);
        const isAuthLink = parsed.path === 'auth/confirm' || parsed.hostname === 'auth';
        if (!isAuthLink) {
          console.warn('[deep-link] not an auth link, path=', parsed.path, 'hostname=', parsed.hostname);
          return;
        }

        // auth/reset is handled by the file-based route (src/app/auth/reset.tsx),
        // which expo-router routes to directly. Skip it here to avoid double exchange.
        if (url.includes('auth/reset')) return;

        const params = parsed.queryParams ?? {};
        const linkType = (params.type as string | undefined) ?? 'signup';
        console.warn('[deep-link] auth link, type=', linkType, 'paramKeys=', Object.keys(params));

        // Three token formats from Supabase:
        //   PKCE authorization-code flow: ?code=...  (recovery emails via auth/reset)
        //   Implicit flow:                #access_token=...&refresh_token=...
        //   PKCE token_hash flow:         ?token_hash=...&type=...
        // expo-linking parses all of these into queryParams.
        const code = params.code as string | undefined;
        const accessToken = params.access_token as string | undefined;
        const refreshToken = params.refresh_token as string | undefined;
        const tokenHash = params.token_hash as string | undefined;

        let sessionError: any = null;
        if (code) {
          // PKCE authorization-code flow — exchange code for session
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          sessionError = error;
        } else if (accessToken && refreshToken) {
          // Implicit flow — set session directly
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          sessionError = error;
        } else if (tokenHash) {
          // PKCE flow — verify the OTP hash to establish session
          const otpType = linkType === 'recovery' ? 'recovery' : (linkType === 'signup' ? 'signup' : 'email');
          const { error } = await supabase.auth.verifyOtp({
            type: otpType as any,
            token_hash: tokenHash,
          });
          sessionError = error;
        } else {
          console.warn('[deep-link] no recognizable tokens in URL');
          return;
        }

        if (sessionError) {
          console.warn('[deep-link] session error:', sessionError.message);
          return;
        }

        // Route by link type or path. Recovery / reset path → reset-password
        // screen so user can pick a new password.
        if (linkType === 'recovery') {
          router.replace('/reset-password' as any);
        } else {
          // Signup / email confirmation: the session is now live. Hydrate the
          // auth store from it so the user is genuinely signed in (otherwise the
          // store stays logged-out and their next manual login attempt lands in
          // a half-authenticated limbo — the "first login failed" report), then
          // route by the account's real type. NEVER assume creator here:
          // audience users confirm through this exact same link.
          await useAuthStore.getState().initialize();
          const confirmedType = useAuthStore.getState().userType;
          if (confirmedType === 'creator') {
            router.replace('/(tabs)' as any);
          } else {
            router.replace('/(public-tabs)/feed' as any);
          }
        }
      } catch (err: any) {
        console.warn('[deep-link] handler exception:', err?.message || err);
      }
    };

    // Cold start: app opened from a link while not running
    Linking.getInitialURL().then(handleDeepLink);

    // Warm start: app is in background and opened via a link
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (!initializeRef.current) {
      initializeRef.current = true;
      useAuthStore.getState().initialize();
      useAppMetadataStore.getState().fetchAppMetadata();
      pruneStalePickedPhotos();
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    SplashScreen.hideAsync();
    // Restore the correct profile for whichever creator is logged in
    const { userType, creatorId } = useAuthStore.getState();
    if (userType === 'creator' && creatorId) {
      useProfileStore.getState().switchCreator(creatorId);
      useCreatorStore.getState().switchCreator(creatorId);
      useLookStore.getState().fetchLooksByCreator(creatorId);

      // One-time migration: any creator who already has >=3 published looks
      // before this build shipped should never see the auto-shown Complete
      // your profile sheet on their next celebration screen. Writes the
      // seen-key only if it's missing AND the creator qualifies, so first-
      // time creators (who SHOULD see it after their first publish) are
      // unaffected.
      (async () => {
        try {
          const key = `${COMPLETE_PROFILE_SHEET_KEY_PREFIX}${creatorId}`;
          const seen = await AsyncStorage.getItem(key);
          if (seen !== null) return; // already set — either true or false
          const { count, error } = await supabase
            .from('looks')
            .select('id', { count: 'exact', head: true })
            .eq('creator_id', creatorId)
            .not('published_at', 'is', null);
          if (error) {
            console.warn('[complete-profile-migration] count query failed:', error);
            return;
          }
          if ((count ?? 0) >= 3) {
            await AsyncStorage.setItem(key, 'true');
          }
        } catch (e) {
          console.warn('[complete-profile-migration] unexpected error:', e);
        }
      })();
    } else if (userType === 'audience') {
      useLookStore.getState().fetchLooks();
    }
  }, [hasHydrated]);

  // First-launch onboarding gate.
  // Runs once after auth hydration. Skips entirely when:
  //   - user is already logged in
  //   - the entry route is a deep link (look/* or auth/confirm) — in
  //     that case we also flip the flag so we don't pop onboarding
  //     on a later launch.
  useEffect(() => {
    if (!hasHydrated) return;
    if (onboardingCheckedRef.current) return;
    onboardingCheckedRef.current = true;

    const firstSegment = String(segments[0] ?? '');
    const joined = (segments as string[]).join('/');
    const isDeepLinkEntry =
      firstSegment === 'look' ||
      firstSegment === 'auth' ||
      joined.includes('auth/confirm');

    if (isDeepLinkEntry) {
      writeSeenOnboarding();
      return;
    }

    if (isLoggedIn) return;
    if (firstSegment === 'onboarding') return;

    readSeenOnboarding().then((seen) => {
      if (seen) return;
      router.replace('/onboarding' as any);
    });
  }, [hasHydrated, isLoggedIn, segments, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <RootLayoutNav />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
