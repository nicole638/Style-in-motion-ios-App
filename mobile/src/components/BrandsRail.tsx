// Featured brands horizontal rail — discoverability surface for the public
// feed. Renders the active partner brand storefronts as logo circles +
// brand name; each item routes to /storefront/<slug>.
//
// Renders NULL when there are zero active partner brands so the feed
// layout collapses cleanly. The query is cheap (one indexed read) and
// 5-minute cached, so we don't worry about the cost.

import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useActiveStorefronts } from '@/lib/queries/storefront';
import { COLORS, FONTS } from '@/constants/theme';

export default function BrandsRail() {
  const { data: brands } = useActiveStorefronts();
  const onPress = useCallback((slug: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/storefront/${slug}` as never);
  }, []);

  if (!brands || brands.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Featured brands</Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push('/(public-tabs)/brands' as never);
          }}
          hitSlop={8}
        >
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {brands.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => onPress(b.slug)}
            style={styles.item}
            testID={`brands-rail-${b.slug}`}
          >
            {b.logoUrl ? (
              <Image source={{ uri: b.logoUrl }} style={styles.logo} contentFit="cover" />
            ) : (
              <View style={[styles.logo, styles.logoFallback]}>
                <Text style={styles.logoInitial}>{b.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={2}>
              {b.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  heading: { fontFamily: FONTS.serif, fontSize: 20, color: COLORS.ink },
  seeAll: { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.rose },
  scroller: { paddingHorizontal: 12, gap: 14 },
  item: {
    width: 72,
    alignItems: 'center',
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.bgAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  logoInitial: { fontFamily: FONTS.serif, fontSize: 22, color: COLORS.inkMid },
  name: {
    marginTop: 6,
    fontFamily: FONTS.bodyMedium,
    fontSize: 11,
    color: COLORS.ink,
    textAlign: 'center',
  },
});
