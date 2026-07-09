import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';
import useFirstLookStore from '@/lib/state/firstLookStore';
import useProfileStore from '@/lib/state/profileStore';
import CompleteProfileSheet, { COMPLETE_PROFILE_SHEET_KEY_PREFIX } from '@/components/CompleteProfileSheet';

const AUTO_DISMISS_MS = 4000;

interface LookCover {
  id: string;
  coverPhotoUrl: string | null;
}

async function fetchLookCover(lookId: string): Promise<LookCover | null> {
  const { data, error } = await supabase
    .from('looks')
    .select('id, cover_photo_url')
    .eq('id', lookId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    coverPhotoUrl: (data as any).cover_photo_url ?? null,
  };
}

/**
 * Live count of non-seed creator profiles. Used in the "joined N creators"
 * line on the celebration screen. Falls back to a hard-coded 100 on failure.
 */
async function fetchRealCreatorCount(): Promise<number> {
  const { count, error } = await supabase
    .from('creator_profiles')
    .select('creator_id', { count: 'exact', head: true })
    .eq('is_seed', false);
  if (error || count === null || count === undefined) {
    return 100;
  }
  return count;
}

export default function OnboardingCelebrationScreen() {
  const params = useLocalSearchParams<{ lookId?: string }>();
  const lookId = params.lookId ?? null;
  const resetFirstLook = useFirstLookStore((s) => s.reset);
  const isFoundingCreator = useProfileStore((s) => s.isFoundingCreator);
  const creatorId = useAuthStore((s) => s.creatorId);

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  const { data: lookCover } = useQuery({
    queryKey: ['firstLookCelebrationCover', lookId],
    queryFn: () => fetchLookCover(lookId!),
    enabled: !!lookId,
    staleTime: 1000 * 60,
  });

  const { data: creatorCount } = useQuery({
    queryKey: ['realCreatorCount'],
    queryFn: fetchRealCreatorCount,
    staleTime: 1000 * 60 * 5,
  });

  // Confetti-style haptic on mount.
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  // Pending route target — set when a CTA / auto-dismiss fires. We then
  // present the CompleteProfileSheet (if eligible) and route on sheet
  // dismiss. If the sheet has already been seen for this creator, we skip
  // straight to navigation.
  const [pendingTarget, setPendingTarget] = useState<'home' | 'profile' | 'closet' | null>(null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const dismissedRef = useRef(false);

  const navigateNow = (target: 'home' | 'profile' | 'closet') => {
    resetFirstLook();
    if (target === 'home') {
      router.replace('/(tabs)' as any);
    } else if (target === 'profile') {
      router.replace('/creator-account' as any);
    } else {
      router.replace('/(tabs)/create' as any);
    }
  };

  // Triggered by every exit: CTAs + 4s auto-dismiss. Presents the sheet
  // first (only if not already seen for this creator); otherwise routes
  // directly.
  const handleExit = async (target: 'home' | 'profile' | 'closet') => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setPendingTarget(target);
    if (!creatorId) {
      navigateNow(target);
      return;
    }
    try {
      const seen = await AsyncStorage.getItem(`${COMPLETE_PROFILE_SHEET_KEY_PREFIX}${creatorId}`);
      if (seen === 'true') {
        navigateNow(target);
        return;
      }
    } catch (e) {
      console.warn('[celebration] AsyncStorage read failed:', e);
    }
    setSheetVisible(true);
  };

  const handleSheetClose = () => {
    setSheetVisible(false);
    const target = pendingTarget ?? 'home';
    setPendingTarget(null);
    navigateNow(target);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      handleExit('home');
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const displayCount = typeof creatorCount === 'number' && creatorCount > 0 ? creatorCount : 100;

  return (
    <SafeAreaView
      className="flex-1 bg-[#F7F4F0]"
      edges={['top', 'bottom']}
      testID="onboarding-celebration-screen"
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* Tap-to-skip — covers the whole screen behind the content. */}
      <Pressable
        onPress={() => handleExit('home')}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        testID="celebration-skip-overlay"
      />

      <View
        pointerEvents="box-none"
        className="flex-1 px-6 items-center justify-center"
      >
        <Text
          className="text-[28px] text-[#1A1210] text-center"
          style={{ fontFamily: 'DMSans_700Bold', lineHeight: 34 }}
          testID="celebration-title"
        >
          Your first look is live{` `}
          <Text style={{ color: '#B87063' }}>🖤</Text>
        </Text>

        {/* Founding Creator identity line — surfaces only for accounts whose
            is_founding_creator flag is true. Reinforces the lifetime title
            on the first celebration moment. */}
        {isFoundingCreator ? (
          <Text
            className="text-[14px] text-[#B87063] text-center mt-3 px-4"
            style={{ fontFamily: 'DMSans_500Medium', lineHeight: 20 }}
            testID="celebration-founding-line"
          >
            You{`'`}re a Founding Creator 🖤 The first 50 creators on SiM. That title is yours permanently.
          </Text>
        ) : null}

        {lookCover?.coverPhotoUrl ? (
          <View
            className="mt-8 rounded-2xl overflow-hidden bg-white"
            style={{ width: 140, height: 140 }}
            testID="celebration-cover-thumb"
          >
            <Image
              source={{ uri: lookCover.coverPhotoUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={300}
            />
          </View>
        ) : null}

        <Text
          className="text-[16px] text-[#6B5E58] text-center mt-6"
          style={{ fontFamily: 'DMSans_400Regular', lineHeight: 24 }}
          testID="celebration-subtitle"
        >
          You{`'`}ve joined {displayCount} Styled in Motion creators.
        </Text>
      </View>

      <View className="px-6 pb-4" pointerEvents="box-none" style={{ gap: 10 }}>
        <Pressable
          onPress={() => handleExit('profile')}
          className="bg-[#B87063] rounded-full flex-row items-center justify-center active:opacity-85"
          style={{
            height: 52,
            shadowColor: '#1A1210',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
          testID="celebration-see-profile-cta"
        >
          <Text
            className="text-white text-[15px]"
            style={{ fontFamily: 'DMSans_500Medium' }}
          >
            See it on my profile
          </Text>
          <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
        </Pressable>
        <Pressable
          onPress={() => handleExit('closet')}
          className="bg-white rounded-full flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
          style={{ height: 52 }}
          testID="celebration-add-more-cta"
        >
          <Text
            className="text-[#1A1210] text-[15px]"
            style={{ fontFamily: 'DMSans_500Medium' }}
          >
            Add more items
          </Text>
          <ArrowRight size={18} color="#1A1210" style={{ marginLeft: 6 }} />
        </Pressable>
      </View>

      {/* Post-first-look profile completion sheet. Auto-shown once per
          creator. After dismissal we route to the originally requested
          target (home / profile / closet). */}
      <CompleteProfileSheet
        visible={sheetVisible}
        onClose={handleSheetClose}
        triggerSource="auto"
        testIDPrefix="celebration-complete-profile-sheet"
      />
    </SafeAreaView>
  );
}
