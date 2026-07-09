import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import useFirstLookStore from '@/lib/state/firstLookStore';

const AESTHETIC_TAGS: string[] = [
  'coquette',
  'minimalist',
  'streetwear',
  'classic',
  'y2k',
  'clean girl',
  'cottagecore',
  'old money',
];

/**
 * Step 2 of the "First 5 Minutes" creator activation flow. Pick 1–3 aesthetic
 * tags; the next screen (pick-three) loads an aesthetic-tailored, rotating set
 * of real, collage-ready pieces to choose from (via get_picker_items). No
 * closet seeding happens here anymore — pick-three copies only the pieces the
 * creator actually selects into their closet.
 */
export default function OnboardingAestheticScreen() {
  const setAestheticTags = useFirstLookStore((s) => s.setAestheticTags);
  const [selected, setSelected] = useState<string[]>([]);
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  const toggleTag = useCallback((tag: string) => {
    setSelected((prev) => {
      if (prev.includes(tag)) {
        Haptics.selectionAsync().catch(() => {});
        return prev.filter((t) => t !== tag);
      }
      if (prev.length >= 3) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return prev;
      }
      Haptics.selectionAsync().catch(() => {});
      return [...prev, tag];
    });
  }, []);

  const handleContinue = useCallback(() => {
    const final = selected.length === 0 ? ['minimalist'] : selected;
    setAestheticTags(final);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push('/onboarding/pick-three' as any);
  }, [selected, setAestheticTags]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView
      className="flex-1 bg-[#F7F4F0]"
      edges={['top', 'bottom']}
      testID="onboarding-aesthetic-screen"
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-white items-center justify-center mb-5 active:opacity-80"
          style={{ shadowColor: '#1A1210', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
          hitSlop={8}
          testID="onboarding-aesthetic-back"
        >
          <ArrowLeft size={20} color="#1A1210" />
        </Pressable>
        <Text
          className="text-[28px] text-[#1A1210]"
          style={{ fontFamily: 'DMSans_700Bold', lineHeight: 34 }}
          testID="onboarding-aesthetic-title"
        >
          Pick your aesthetic
        </Text>
        <Text
          className="text-[16px] text-[#6B5E58] mt-2"
          style={{ fontFamily: 'DMSans_400Regular', lineHeight: 22 }}
          testID="onboarding-aesthetic-subtitle"
        >
          Tap up to 3. We{`'`}ll tailor your starter pieces to match.
        </Text>

        <View className="flex-row flex-wrap mt-8" style={{ gap: 10 }}>
          {AESTHETIC_TAGS.map((tag) => {
            const isSelected = selected.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                className={
                  isSelected
                    ? 'bg-[#B87063] rounded-full px-4 py-2.5 active:opacity-85'
                    : 'bg-white rounded-full px-4 py-2.5 border-[1.5px] border-[#1A1210] active:opacity-85'
                }
                testID={`aesthetic-chip-${tag.replace(/\s+/g, '-')}`}
              >
                <Text
                  className={
                    isSelected
                      ? 'text-white text-[14px]'
                      : 'text-[#1A1210] text-[14px]'
                  }
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View className="px-6 pb-4">
        <Pressable
          onPress={handleContinue}
          className="bg-[#B87063] rounded-full flex-row items-center justify-center active:opacity-85"
          style={{
            height: 52,
            shadowColor: '#1A1210',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
          testID="onboarding-aesthetic-continue"
        >
          <Text
            className="text-white text-[15px]"
            style={{ fontFamily: 'DMSans_500Medium' }}
          >
            Continue
          </Text>
          <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
