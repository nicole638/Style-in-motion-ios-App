// Shopper-facing partner brand storefront landing page.
//
// Route: /storefront/<slug> (e.g. /storefront/golden-bear-garage).
// Reached from: (a) the Featured Brands rail on (public-tabs)/feed.tsx,
// (b) the (public-tabs)/brands.tsx directory tab, (c) a tap on a brand
// byline on any look card across the discover feed.
//
// Section order: brand header (logo + name + brand_story) → fulfillment
// chips (Etsy / eBay / Shopify CTAs from brand_storefronts.fulfillment) →
// promo code banner (if set) → "Looks by <brand>" grid (2-col, same
// dimensions as saved.tsx so the visual rhythm matches).
//
// Empty state: when the brand hasn't published yet (zero looks), the
// page still loads cleanly with the header + fulfillment, and the looks
// section shows a soft "New collection coming soon" placeholder rather
// than a hard 404. This means we can ship the surface BEFORE Kerri does
// the first GBG publish without breaking the shopper UX.

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, ExternalLink, Tag } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useFonts, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import {
  useStorefrontBySlug,
  useStorefrontLooks,
  type StorefrontLookSummary,
} from '@/lib/queries/storefront';
import { COLORS, FONTS } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 8;
const GRID_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// Display label for each fulfillment channel. Falls back to the raw key
// when a future channel slips through that we don't have copy for yet.
const CHANNEL_LABEL: Record<string, string> = {
  etsy: 'Shop on Etsy',
  ebay: 'Shop on eBay',
  shopify: 'Visit shop',
};

export default function StorefrontScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const storefrontQuery = useStorefrontBySlug(slug ?? null);
  const looksQuery = useStorefrontLooks(
    storefrontQuery.data?.storefrontCreatorId ?? null,
  );

  const openFulfillment = useCallback(async (url: string) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch (e) {
      console.warn('[storefront] openBrowserAsync failed:', e);
    }
  }, []);

  const openLook = useCallback((lookId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(`/look/${lookId}` as never);
  }, []);

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

  // Loading
  if (storefrontQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centeredFill}>
          <ActivityIndicator color={COLORS.rose} />
        </View>
      </SafeAreaView>
    );
  }

  // 404 — unknown slug or non-active storefront
  if (!storefrontQuery.data) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <TopBar />
        <View style={styles.centeredFill}>
          <Text style={styles.notFoundTitle}>Brand not found.</Text>
          <Text style={styles.notFoundCopy}>
            This storefront may have moved or paused. Try the Brands tab to
            see who&apos;s currently shoppable.
          </Text>
          <Pressable
            onPress={() => router.replace('/(public-tabs)/brands' as never)}
            style={styles.notFoundCta}
          >
            <Text style={styles.notFoundCtaText}>Browse brands</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const sf = storefrontQuery.data;
  const looks = looksQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          {sf.logoUrl ? (
            <Image
              source={{ uri: sf.logoUrl }}
              style={styles.heroLogo}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.heroLogo, styles.heroLogoFallback]}>
              <Text style={styles.heroLogoInitial}>
                {sf.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.heroName}>{sf.name}</Text>
          {sf.brandStory ? (
            <Text style={styles.heroStory}>{sf.brandStory}</Text>
          ) : null}
        </View>

        {/* Promo code */}
        {sf.promoCode ? (
          <View style={styles.promoCard}>
            <Tag size={16} color={COLORS.rose} />
            <Text style={styles.promoLabel}>Promo code</Text>
            <Text style={styles.promoCode}>{sf.promoCode}</Text>
          </View>
        ) : null}

        {/* Fulfillment buttons */}
        {sf.fulfillment.length > 0 ? (
          <View style={styles.fulfillmentRow}>
            {sf.fulfillment.map((f) => (
              <Pressable
                key={`${f.channel}-${f.url}`}
                onPress={() => openFulfillment(f.url)}
                style={styles.fulfillmentBtn}
              >
                <Text style={styles.fulfillmentBtnText}>
                  {CHANNEL_LABEL[f.channel.toLowerCase()] ?? `Shop on ${f.channel}`}
                </Text>
                <ExternalLink size={14} color={COLORS.ink} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Looks section */}
        <View style={styles.looksHeader}>
          <Text style={styles.looksHeading}>Looks by {sf.name}</Text>
        </View>

        {looksQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={COLORS.inkMid} />
          </View>
        ) : looks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>New collection coming soon</Text>
            <Text style={styles.emptyCopy}>
              {sf.name} is curating their first looks. Check back shortly — or
              tap a fulfillment shop above to browse their inventory now.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {looks.map((look) => (
              <LookCard key={look.id} look={look} onPress={openLook} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar() {
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(public-tabs)/feed' as never))}
        hitSlop={12}
        style={styles.topBarBack}
      >
        <ChevronLeft size={22} color={COLORS.ink} />
      </Pressable>
    </View>
  );
}

function LookCard({
  look,
  onPress,
}: {
  look: StorefrontLookSummary;
  onPress: (id: string) => void;
}) {
  if (!look.coverPhotoUrl) return null;
  return (
    <Pressable
      onPress={() => onPress(look.id)}
      style={[styles.card, { width: CARD_WIDTH }]}
      testID={`storefront-look-${look.id}`}
    >
      <Image
        source={{ uri: look.coverPhotoUrl }}
        style={{ width: CARD_WIDTH, aspectRatio: 0.78, backgroundColor: COLORS.bgAlt }}
        contentFit="cover"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centeredFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  topBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  topBarBack: { padding: 4 },
  hero: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 8, paddingBottom: 20 },
  heroLogo: { width: 110, height: 110, borderRadius: 55, backgroundColor: COLORS.bgAlt },
  heroLogoFallback: { alignItems: 'center', justifyContent: 'center' },
  heroLogoInitial: { fontSize: 36, fontFamily: FONTS.serif, color: COLORS.inkMid },
  heroName: {
    fontSize: 28,
    fontFamily: FONTS.serif,
    color: COLORS.ink,
    marginTop: 14,
    textAlign: 'center',
  },
  heroStory: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.inkMid,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
  },
  promoCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.roseSoft,
    flexDirection: 'row',
    alignItems: 'center',
  },
  promoLabel: {
    fontSize: 12,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.rose,
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  promoCode: {
    marginLeft: 'auto',
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.ink,
    letterSpacing: 1.4,
  },
  fulfillmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  fulfillmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  fulfillmentBtnText: { fontSize: 13, fontFamily: FONTS.bodyMedium, color: COLORS.ink },
  looksHeader: { paddingHorizontal: 16, marginBottom: 12 },
  looksHeading: {
    fontSize: 22,
    fontFamily: FONTS.serif,
    color: COLORS.ink,
  },
  loadingRow: { paddingVertical: 40, alignItems: 'center' },
  emptyCard: {
    marginHorizontal: 16,
    padding: 18,
    borderRadius: 14,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.ink,
  },
  emptyCopy: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.inkMid,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
  },
  notFoundTitle: {
    fontSize: 22,
    fontFamily: FONTS.serif,
    color: COLORS.ink,
    marginBottom: 8,
  },
  notFoundCopy: {
    fontSize: 14,
    color: COLORS.inkMid,
    textAlign: 'center',
    fontFamily: FONTS.body,
    lineHeight: 20,
  },
  notFoundCta: {
    marginTop: 20,
    backgroundColor: COLORS.ink,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
  },
  notFoundCtaText: {
    color: COLORS.card,
    fontFamily: FONTS.bodyMedium,
  },
});
