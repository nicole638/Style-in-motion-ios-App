// Shopper-facing brands directory — every active partner brand storefront.
//
// Route: /(public-tabs)/brands. Reached from: (a) the tab bar, (b) the
// "See all" link on the Featured Brands rail on /feed. Each card routes
// to /storefront/<slug>.
//
// Two-column grid so newer entries always fit above the fold. The query
// (`useActiveStorefronts`) is shared with BrandsRail so the cache is hot
// when shoppers tap "See all" coming off the feed.

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFonts, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as Haptics from 'expo-haptics';
import { useActiveStorefronts } from '@/lib/queries/storefront';
import { COLORS, FONTS } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 16;
const GRID_GAP = 12;
const COL_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

export default function BrandsDirectoryScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const query = useActiveStorefronts();
  const brands = query.data ?? [];

  const onPress = useCallback((slug: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/storefront/${slug}` as never);
  }, []);

  if (!fontsLoaded) return <View style={styles.container} />;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="brands-directory-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && brands.length > 0 ? true : false}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.rose}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.heading}>Brands</Text>
          <Text style={styles.sub}>
            Shop directly from our partner brands. Each storefront is curated
            by a Styled in Motion stylist.
          </Text>
        </View>

        {query.isLoading ? (
          <View style={styles.loadingFill}>
            <ActivityIndicator color={COLORS.rose} />
          </View>
        ) : brands.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No brands yet.</Text>
            <Text style={styles.emptyCopy}>
              Our first partner brand storefronts launch soon. Check back to
              browse curated drops, promo codes, and stylist-built looks.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {brands.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => onPress(b.slug)}
                style={[styles.card, { width: COL_WIDTH }]}
                testID={`brands-card-${b.slug}`}
              >
                {b.logoUrl ? (
                  <Image
                    source={{ uri: b.logoUrl }}
                    style={styles.cardImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.cardImage, styles.cardImageFallback]}>
                    <Text style={styles.cardInitial}>{b.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={styles.cardName} numberOfLines={2}>
                  {b.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  heading: { fontFamily: FONTS.serif, fontSize: 34, color: COLORS.ink },
  sub: {
    marginTop: 8,
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.inkMid,
    lineHeight: 20,
  },
  loadingFill: { paddingTop: 60, alignItems: 'center' },
  empty: {
    marginHorizontal: GRID_PADDING,
    padding: 22,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: { fontFamily: FONTS.serif, fontSize: 20, color: COLORS.ink },
  emptyCopy: {
    marginTop: 8,
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.inkMid,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    alignItems: 'center',
  },
  cardImage: {
    width: COL_WIDTH - 64,
    height: COL_WIDTH - 64,
    borderRadius: (COL_WIDTH - 64) / 2,
    backgroundColor: COLORS.bgAlt,
  },
  cardImageFallback: { alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontFamily: FONTS.serif, fontSize: 28, color: COLORS.inkMid },
  cardName: {
    marginTop: 12,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
    color: COLORS.ink,
    textAlign: 'center',
  },
});
