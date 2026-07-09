import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Dimensions,
  StyleSheet,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Heart, Sparkles, Tag, ShoppingBag, ArrowRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { writeSeenOnboarding } from '@/lib/onboardingFlag';

const { width: SW, height: SH } = Dimensions.get('window');

// Hero image for panel 1 — replace with a real Reilly cover_photo_url later.
const HERO_URI = 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=80';

interface FeatureProps {
  Icon: typeof Heart;
  title: string;
  copy: string;
}

function Feature({ Icon, title, copy }: FeatureProps) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIconWrap}>
        <Icon size={22} color="#B87063" strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureCopy}>{copy}</Text>
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView | null>(null);
  const [page, setPage] = useState<number>(0);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const goToPage = useCallback((n: number) => {
    Haptics.selectionAsync();
    pagerRef.current?.setPage(n);
  }, []);

  const handleSkip = useCallback(async () => {
    Haptics.selectionAsync();
    await writeSeenOnboarding();
    router.replace('/welcome' as any);
  }, []);

  const handlePickShopper = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await writeSeenOnboarding();
    router.replace('/public-signup' as any);
  }, []);

  const handlePickCreator = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await writeSeenOnboarding();
    router.replace({ pathname: '/creator-login', params: { mode: 'signup' } } as any);
  }, []);

  const handleSignIn = useCallback(async () => {
    Haptics.selectionAsync();
    await writeSeenOnboarding();
    router.replace('/welcome' as any);
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: '#F7F4F0' }}
      edges={['top']}
      testID="onboarding-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header — Skip text link */}
      <View style={[styles.header, { paddingTop: 4 }]}>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={handleSkip}
          className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
          testID="onboarding-skip"
          hitSlop={8}
        >
          <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
            Skip
          </Text>
        </Pressable>
      </View>

      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={(e) => {
          const next = e.nativeEvent.position;
          setPage(next);
          Haptics.selectionAsync();
        }}
        testID="onboarding-pager"
      >
        {/* ─── Panel 1 — Welcome / promise ────────────────────────── */}
        <View key="p1" style={styles.panel} testID="onboarding-panel-1">
          <View style={styles.heroWrap}>
            <Image
              source={{ uri: HERO_URI }}
              style={styles.heroImage}
              contentFit="cover"
              transition={400}
            />
            <LinearGradient
              colors={['transparent', 'rgba(247,244,240,0.65)', '#F7F4F0']}
              style={styles.heroFade}
            />
          </View>
          <View style={styles.panelCopyBlock}>
            <Text style={styles.headline}>
              Outfits styled by real people. Every piece linked.
            </Text>
            <Text style={styles.subhead}>
              Styled in Motion turns the looks you love into looks you can shop.
            </Text>
          </View>
        </View>

        {/* ─── Panel 2 — What you can do ──────────────────────────── */}
        <View key="p2" style={styles.panel} testID="onboarding-panel-2">
          <View style={styles.panelHeader}>
            <Text style={styles.headline}>Three things you can do here.</Text>
            <Text style={styles.subhead}>
              Every look is real, every item is shoppable.
            </Text>
          </View>
          <View style={styles.featureList}>
            <Feature
              Icon={Heart}
              title="Save outfits you love"
              copy="Build a feed of looks from creators whose style matches yours."
            />
            <Feature
              Icon={Sparkles}
              title="Try anything on"
              copy="See yourself in any look with our virtual try-on."
            />
            <Feature
              Icon={Tag}
              title="Shop the look"
              copy="Tap any piece to go straight to the merchant — no hunt, no guess."
            />
          </View>
        </View>

        {/* ─── Panel 3 — Pick your path ───────────────────────────── */}
        <View key="p3" style={styles.panel} testID="onboarding-panel-3">
          <View style={styles.panelHeader}>
            <Text style={styles.headline}>How will you use Styled in Motion?</Text>
            <Text style={styles.subhead}>
              You can switch later — this just sets the vibe.
            </Text>
          </View>

          <View style={{ paddingHorizontal: 24, gap: 14 }}>
            <Pressable
              onPress={handlePickShopper}
              className="bg-white rounded-3xl py-6 px-5 border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="onboarding-shopper-cta"
            >
              <View style={styles.roleRow}>
                <View style={styles.roleIconWrap}>
                  <ShoppingBag size={22} color="#1A1210" strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleTitle}>I'm here to shop</Text>
                  <Text style={styles.roleCopy}>
                    Browse curated looks, save favorites, try them on.
                  </Text>
                </View>
                <ArrowRight size={18} color="#6B5E58" />
              </View>
            </Pressable>

            <Pressable
              onPress={handlePickCreator}
              className="bg-white rounded-3xl py-6 px-5 border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="onboarding-creator-cta"
            >
              <View style={styles.roleRow}>
                <View style={styles.roleIconWrap}>
                  <Sparkles size={22} color="#B87063" strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleTitle}>I'm here to create</Text>
                  <Text style={styles.roleCopy}>
                    Style looks, monetize your taste, grow your following.
                  </Text>
                </View>
                <ArrowRight size={18} color="#6B5E58" />
              </View>
            </Pressable>

            <Pressable
              onPress={handleSignIn}
              className="flex-row items-center justify-center gap-1.5 py-3 px-3 active:opacity-70"
              testID="onboarding-sign-in"
            >
              <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                Already have an account?{' '}
                <Text style={{ color: '#B87063', fontFamily: 'DMSans_500Medium' }}>Sign in</Text>
              </Text>
            </Pressable>
          </View>
        </View>
      </PagerView>

      {/* Footer — pagination dots + (panels 1/2 only) Continue pill */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.dotRow} testID="onboarding-dots">
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.dot, page === i ? styles.dotActive : null]}
            />
          ))}
        </View>

        {page < 2 ? (
          <Pressable
            onPress={() => goToPage(page + 1)}
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
            style={{
              shadowColor: '#1A1210',
              shadowOpacity: 0.12,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
              marginHorizontal: 24,
            }}
            testID="onboarding-continue"
          >
            <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
              {page === 0 ? 'Continue' : 'Next'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  panel: {
    flex: 1,
    width: SW,
  },
  panelHeader: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 8,
  },
  panelCopyBlock: {
    paddingHorizontal: 28,
    paddingTop: 12,
    gap: 10,
  },
  headline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 34,
    lineHeight: 40,
    color: '#1A1210',
  },
  subhead: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    lineHeight: 22,
    color: '#5A4F49',
  },
  // Panel 1 hero
  heroWrap: {
    width: SW,
    height: SH * 0.45,
    backgroundColor: '#FBF6EF',
  },
  heroImage: {
    width: SW,
    height: SH * 0.45,
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SH * 0.22,
  },
  // Panel 2 features
  featureList: {
    paddingHorizontal: 24,
    gap: 18,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FBF6EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    marginBottom: 2,
  },
  featureCopy: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#6B5E58',
  },
  // Panel 3 role cards
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  roleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FBF6EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
    marginBottom: 4,
  },
  roleCopy: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#6B5E58',
  },
  // Footer
  footer: {
    paddingTop: 12,
    gap: 14,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D4C8C2',
  },
  dotActive: {
    width: 18,
    backgroundColor: '#1A1210',
  },
});
