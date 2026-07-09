import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, Heart } from 'lucide-react-native';
import PillButton from '@/components/PillButton';
import useAuthStore from '@/lib/state/authStore';
import useLikeStore from '@/lib/state/likeStore';
import useLookStore, { Look, AlternateItem, ClothingItem, ItemCategory } from '@/lib/state/lookStore';
import { supabase } from '@/lib/supabase';
import { ItemListSheet } from '@/components/ItemListSheet';

type ViewStatus = 'loading' | 'ready' | 'notfound';

const CATEGORY_EMOJI: Record<string, string> = {
  Top: '👕',
  Pants: '👖',
  Dress: '👗',
  Shoes: '👟',
  Bag: '👜',
  Jewelry: '💎',
  Accessory: '🧣',
  Outerwear: '🧥',
  Intimates: '🩲',
  Swimwear: '👙',
  Other: '🛍️',
};

function emojiForCategory(category: string): string {
  return CATEGORY_EMOJI[category] ?? '🛍️';
}

// Mirror of lookStore.rowToLook — kept local so the fallback fetch
// returns the exact shape ItemListSheet expects.
function rowToLook(row: any): Look {
  const joins = Array.isArray(row.look_items) ? row.look_items : [];
  return {
    id: row.id,
    title: row.title,
    photoUri: row.cover_photo_url,
    layout: row.layout,
    caption: row.caption,
    hashtags: row.hashtags ?? [],
    createdAt: row.created_at,
    clicks: row.clicks ?? 0,
    creatorId: row.creator_id,
    category: row.category ?? undefined,
    tags: row.tags ?? [],
    occasion: row.occasion ?? [],
    season: row.season ?? [],
    style_vibe: row.style_vibe ?? [],
    color_palette: row.color_palette ?? [],
    clothing_type: row.clothing_type ?? [],
    creator_tags: row.creator_tags ?? [],
    archived: row.archived ?? false,
    items: joins
      .filter((li: any) => li.creator_items && !(li.creator_items.archived ?? false))
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((li: any): ClothingItem => {
        const item = li.creator_items;
        const alternates: AlternateItem[] = Array.isArray(item.alternates) ? [...item.alternates] : [];
        if (alternates.length === 0 && item.alternate_link) {
          alternates.push({
            brand: item.alternate_brand ?? null,
            category: item.alternate_category ?? null,
            label: item.alternate_label ?? null,
            link: item.alternate_link,
            name: item.alternate_name ?? null,
            photo_url: item.alternate_photo_url ?? null,
            price: item.alternate_price ?? null,
          });
        }
        return {
          id: item.id,
          lookItemId: li.id,
          sortOrder: li.sort_order ?? 0,
          wornSize: li.worn_size ?? null,
          defaultWornSize: item.default_worn_size ?? null,
          category: item.category,
          name: item.name,
          price: item.price,
          link: item.url,
          emoji: emojiForCategory(item.category),
          photoUri: item.photo_url,
          brand: item.brand,
          alternates,
          primaryNote: item.primary_note || undefined,
          alternateLink: item.alternate_link || undefined,
          alternateLabel: item.alternate_label || undefined,
          affiliate_url: item.affiliate_url || undefined,
          affiliate_provider: item.affiliate_provider || undefined,
        };
      }),
  };
}

export default function LookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const userType = useAuthStore((s) => s.userType);

  const cachedLooks = useLookStore((s) => s.looks);

  // Like state — subscribed eagerly so the header heart fills/empties on tap.
  const toggleLike = useLikeStore((s) => s.toggleLike);
  const likedLookIds = useLikeStore((s) => s.likedLookIds);

  const [look, setLook] = useState<Look | null>(null);
  const [status, setStatus] = useState<ViewStatus>('loading');

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  // Auth gate — run first. If not signed in, bounce to /welcome.
  useEffect(() => {
    if (!hasHydrated) return;
    const signedIn = isLoggedIn && (userType === 'creator' || userType === 'audience');
    if (!signedIn) {
      router.replace('/welcome' as any);
    }
  }, [hasHydrated, isLoggedIn, userType]);

  // Seed the like-count store from the look row so the optimistic heart toggle
  // starts from the real base (initCounts merges; preserves any in-flight delta).
  useEffect(() => {
    if (look) {
      useLikeStore.getState().initCounts({ [look.id]: look.likesCount ?? 0 });
    }
  }, [look]);

  // Resolve the look: store-first, Supabase fallback.
  useEffect(() => {
    let cancelled = false;

    async function resolveLook() {
      if (!id || typeof id !== 'string' || id.trim() === '') {
        if (!cancelled) setStatus('notfound');
        return;
      }

      // 1. Cache hit in store
      const fromStore = cachedLooks.find((l) => l.id === id);
      if (fromStore) {
        if (!cancelled) {
          setLook(fromStore);
          setStatus('ready');
        }
        return;
      }

      // 2. Supabase fallback — match the shape rowToLook expects
      try {
        const { data, error } = await supabase
          .from('looks')
          .select('*, look_items(id, sort_order, worn_size, creator_items(*))')
          .eq('id', id)
          .not('published_at', 'is', null)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setStatus('notfound');
          return;
        }
        setLook(rowToLook(data));
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('notfound');
      }
    }

    // Only attempt to resolve once the auth store has hydrated and the user is signed in.
    if (hasHydrated && isLoggedIn) {
      resolveLook();
    }

    return () => {
      cancelled = true;
    };
  }, [id, cachedLooks, hasHydrated, isLoggedIn]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(public-tabs)/feed' as any);
    }
  };

  const handleBrowseLooks = () => {
    router.replace('/(public-tabs)/feed' as any);
  };

  // Blank view while fonts load or auth is hydrating / redirecting
  if (!fontsLoaded || !hasHydrated || !isLoggedIn) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'bottom']}
      testID="look-detail-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="look-detail-back-button"
        >
          <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.wordmark}>Styled in Motion</Text>
        {look ? (
          <Pressable
            onPress={() => toggleLike(look.id)}
            hitSlop={12}
            style={({ pressed }) => [styles.headerActionButton, pressed && { opacity: 0.6 }]}
            testID="look-detail-like-button"
          >
            <Heart
              size={22}
              color={likedLookIds.includes(look.id) ? '#B87063' : '#1A1210'}
              fill={likedLookIds.includes(look.id) ? '#B87063' : 'transparent'}
              strokeWidth={1.8}
            />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {status === 'loading' ? (
        <View style={styles.centered} testID="look-detail-loading">
          <ActivityIndicator size="large" color="#1A1210" />
        </View>
      ) : null}

      {status === 'notfound' ? (
        <View style={styles.centered} testID="look-detail-notfound">
          <Text style={styles.notFoundTitle}>This look isn&apos;t available anymore.</Text>
          <PillButton
            label="Browse Looks"
            variant="primary"
            onPress={handleBrowseLooks}
            testID="look-detail-browse-button"
          />
        </View>
      ) : null}

      {status === 'ready' && look ? (
        <ItemListSheet
          look={look}
          onClose={handleBack}
          testIDPrefix="look-detail-item-sheet"
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerSpacer: {
    width: 40,
  },
  headerActionButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  notFoundTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#B87063',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
