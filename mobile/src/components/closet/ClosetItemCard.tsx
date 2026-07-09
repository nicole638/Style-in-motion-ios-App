import React from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { ClothingItem } from '@/lib/state/lookStore';
import { decodeHtmlEntities } from '@/lib/decode-entities';

const { width: screenWidth } = Dimensions.get('window');
const GRID_GAP = 16;
const GRID_PADDING = 16;
const CARD_WIDTH = (screenWidth - GRID_PADDING * 2 - GRID_GAP) / 2;

/**
 * Lean, shopper-facing closet item card. Reuses the same lookStore ClothingItem
 * shape and photo/pending rendering as the creator grid in (tabs)/shop.tsx, but
 * drops creator-only overlays (usage counts, starter pills, Awin coupon badges,
 * shop-link language). Personal-closet framing only.
 */
export function ClosetItemCard({
  item,
  onPress,
  testID,
}: {
  item: ClothingItem;
  onPress: (item: ClothingItem) => void;
  testID?: string;
}) {
  const isPending = item.fetchStatus === 'pending';
  const isFailed = item.fetchStatus === 'failed';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress(item);
      }}
      testID={testID ?? `closet-item-card-${item.id}`}
    >
      <View style={{ position: 'relative' }}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={styles.image} contentFit="contain" />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <Text style={{ fontSize: 32 }}>{item.emoji}</Text>
          </View>
        )}
        {isPending ? (
          <View style={styles.fetchOverlay} testID={`closet-item-pending-${item.id}`}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.fetchOverlayText}>Adding…</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {decodeHtmlEntities(item.name) || item.category}
        </Text>
        {item.brand ? (
          <Text style={styles.brand} numberOfLines={1}>{decodeHtmlEntities(item.brand)}</Text>
        ) : null}
        {isFailed ? (
          <Text style={styles.errorBadge} testID={`closet-item-failed-${item.id}`}>⚠ Couldn't add</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const CLOSET_CARD_WIDTH = CARD_WIDTH;
export const CLOSET_GRID_GAP = GRID_GAP;
export const CLOSET_GRID_PADDING = GRID_PADDING;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    marginBottom: GRID_GAP,
  },
  image: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: '#F7F4F0',
    padding: 6,
  },
  placeholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    width: CARD_WIDTH,
    padding: 10,
    gap: 2,
    overflow: 'hidden',
  },
  name: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  brand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  errorBadge: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#B4453C',
    marginTop: 3,
  },
  fetchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26,18,16,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fetchOverlayText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#FFFFFF',
  },
});
