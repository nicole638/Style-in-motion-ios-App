import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import { Shirt, Search, X, Plus } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useLookStore, { ClothingItem, ItemCategory, closetRowToItem } from '@/lib/state/lookStore';
import { supabase } from '@/lib/supabase';
import { filterClosetItems } from '@/lib/utils/filterClosetItems';
import CategoryChips from '@/components/CategoryChips';
import PillButton from '@/components/PillButton';
import { ClosetItemCard, CLOSET_GRID_PADDING } from '@/components/closet/ClosetItemCard';
import { ItemDetailSheet } from '@/components/ItemDetailSheet';
import ConfirmModal from '@/components/ConfirmModal';
import { useFocusForegroundRefresh } from '@/lib/hooks/useFocusForegroundRefresh';

const { width: screenWidth } = Dimensions.get('window');

const CATEGORY_ORDER: ItemCategory[] = [
  'Top', 'Pants', 'Dress', 'Shoes', 'Bag', 'Jewelry', 'Accessory', 'Outerwear', 'Other',
];

/**
 * Shopper Closet screen — lives ENTIRELY inside the audience (public-tabs)
 * shell so a shopper never sees the creator tab bar or "My Studio" branding.
 *
 *  - Shopper (accountType==='shopper' + creatorId): renders the closet grid
 *    inline. Reuses the lookStore data layer (loadClosetItems, the realtime
 *    channel, closetRowToItem) and the shared ItemDetailSheet, with a lean
 *    shopper item card. Add / Build a collage / My collages / upgrade banner
 *    all route to root-level screens (which cover the tab bar) — the ONLY
 *    crossing into (tabs) is the explicit upgrade-to-creator.
 *  - Audience user who hasn't opted in: the friendly "Create my closet" intro,
 *    which calls ensureShopperCloset() and then STAYS in this screen (the grid
 *    renders once accountType flips to 'shopper').
 */
export default function ClosetTab() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const accountType = useAuthStore((s) => s.accountType);
  const creatorId = useAuthStore((s) => s.creatorId);
  const ensureShopperCloset = useAuthStore((s) => s.ensureShopperCloset);
  const promoteToCreator = useAuthStore((s) => s.promoteToCreator);

  const isShopper = accountType === 'shopper' && !!creatorId;

  const closetItems = useLookStore((s) => s.closetItems);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [closetCategory, setClosetCategory] = useState<ItemCategory | null>(null);
  const [selectedItem, setSelectedItem] = useState<(ClothingItem & { lookId?: string }) | null>(null);
  const [shopperCollageCount, setShopperCollageCount] = useState<number>(0);
  const [promoting, setPromoting] = useState<boolean>(false);
  const [showCreatorModal, setShowCreatorModal] = useState<boolean>(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  // Subscribe to realtime closet updates (same data layer the creator shop
  // screen uses). Mount-scoped so the channel persists across re-focuses; the
  // initial hydration load happens in the focus effect below.
  useEffect(() => {
    if (!isShopper || !creatorId) return;
    const channelName = `closet_items:${creatorId}`;
    supabase.getChannels().forEach((ch) => {
      if (ch.topic === `realtime:${channelName}`) supabase.removeChannel(ch);
    });
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'creator_items', filter: `creator_id=eq.${creatorId}` },
        (payload) => {
          const store = useLookStore.getState();
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            store.realtimeUpsertClosetItem(closetRowToItem(payload.new as any));
          } else if (payload.eventType === 'DELETE') {
            store.realtimeRemoveClosetItem((payload.old as any).id);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isShopper, creatorId]);

  // Count this shopper's saved collages (private drafts tagged 'collage') to
  // gate "My collages" + the upgrade banner.
  const refreshCollageCount = useCallback(async () => {
    if (!isShopper || !creatorId) return;
    try {
      const { count, error } = await supabase
        .from('looks')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', creatorId)
        .is('published_at', null)
        .contains('tags', ['collage']);
      if (!error) setShopperCollageCount(count ?? 0);
    } catch (e) {
      console.warn('[closet] shopper collage count failed:', e);
    }
  }, [isShopper, creatorId]);

  // Re-run the count + reload the closet on every focus AND whenever the app
  // returns to the foreground while this screen is focused. This screen is a
  // mounted tab, so returning from the collage builder / add flow does NOT
  // remount it — a focus effect is what refreshes "My collages"/the upgrade
  // banner after a first collage save (which doesn't change closetItems.length)
  // and reconciles the grid if a realtime event was missed while backgrounded.
  // The foreground path additionally covers an item added via the iOS Share
  // Extension (which runs while the app is backgrounded, onto an already-focused
  // closet) — see useFocusForegroundRefresh.
  const refreshCloset = useCallback(() => {
    if (!isShopper || !creatorId) return;
    void refreshCollageCount();
    useLookStore.getState().loadClosetItems(creatorId).catch(() => {});
  }, [isShopper, creatorId, refreshCollageCount]);
  useFocusForegroundRefresh(refreshCloset);

  const groupedItems = useMemo(() => {
    const filtered = filterClosetItems(closetItems, searchQuery, closetCategory);
    const rank = (c?: ItemCategory | null) => {
      const i = c ? CATEGORY_ORDER.indexOf(c) : -1;
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    const ts = (s?: string) => (s ? Date.parse(s) : 0);
    const statusTier = (it: ClothingItem) =>
      it.fetchStatus === 'pending' ? 0 : it.fetchStatus === 'failed' ? 1 : 2;
    return [...filtered].sort((a, b) => {
      const tierA = statusTier(a);
      const tierB = statusTier(b);
      if (tierA !== tierB) return tierA - tierB;
      if (tierA < 2) return ts(b.createdAt) - ts(a.createdAt);
      const byCat = rank(a.category) - rank(b.category);
      if (byCat !== 0) return byCat;
      return ts(b.createdAt) - ts(a.createdAt);
    });
  }, [closetItems, searchQuery, closetCategory]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await ensureShopperCloset();
      if (!res.success) throw new Error(res.error ?? 'Failed to create your closet.');
      return res;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // No navigation — accountType flips to 'shopper' and the grid renders here.
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
  });

  // First tap only opens the confirm modal — a single accidental tap can never
  // convert the account. The conversion runs from the modal's explicit confirm.
  const handleBecomeCreator = useCallback(() => {
    setPromoteError(null);
    setShowCreatorModal(true);
  }, []);

  const handleConfirmBecomeCreator = useCallback(async () => {
    if (promoting) return;
    setPromoting(true);
    setPromoteError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const res = await promoteToCreator();
    setPromoting(false);
    if (res.success) {
      setShowCreatorModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // The ONE allowed crossing: hand off to the creator shell.
      router.replace('/onboarding/welcome' as any);
    } else {
      setPromoteError(res.error ?? 'Something went wrong. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [promoting, promoteToCreator]);

  const renderCard = useCallback(
    ({ item }: { item: ClothingItem }) => (
      <ClosetItemCard item={item} onPress={(it) => setSelectedItem(it)} />
    ),
    [],
  );

  const ListHeader = useCallback(() => (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>My Closet</Text>
        <Text style={styles.subtitle}>Your pieces, ready to style.</Text>
      </View>

      {closetItems.length > 0 ? (
        <View style={styles.searchBarContainer}>
          <View style={styles.searchBar}>
            <Search size={18} color="#8C8580" strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search your closet..."
              placeholderTextColor="#8C8580"
              cursorColor="#1A1210"
              selectionColor="rgba(26,18,16,0.3)"
              returnKeyType="search"
              testID="closet-search-input"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8} testID="closet-search-clear">
                <X size={18} color="#8C8580" strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {shopperCollageCount >= 1 ? (
        <View style={styles.upgradeBanner} testID="shopper-upgrade-banner">
          <Text style={styles.upgradeBannerText}>
            Loving this? Share your looks and earn — become a creator.
          </Text>
          <Pressable
            className="bg-[#B87063] rounded-full py-2.5 px-4 flex-row items-center justify-center active:opacity-85 self-start"
            style={{ marginTop: 10 }}
            onPress={handleBecomeCreator}
            testID="shopper-upgrade-cta"
          >
            <Text className="text-white text-[14px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
              Become a creator
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <PillButton
          label="Add"
          variant="dark"
          fullWidth
          icon={<Plus size={18} color="#FFFFFF" />}
          onPress={() => router.push('/add-closet-photos')}
          testID="closet-add-button"
        />
      </View>

      {closetItems.length >= 1 ? (
        <View style={styles.actionRow}>
          <PillButton
            label="Build a collage"
            variant="outline"
            fullWidth
            onPress={() => router.push('/collage-builder')}
            testID="shopper-build-collage"
          />
        </View>
      ) : null}

      {shopperCollageCount >= 1 ? (
        <View style={styles.actionRow}>
          <PillButton
            label="My collages"
            variant="outline"
            fullWidth
            onPress={() => router.push('/drafts')}
            testID="shopper-my-collages"
          />
        </View>
      ) : null}

      {closetItems.length > 0 ? (
        <CategoryChips
          selected={closetCategory}
          onSelect={setClosetCategory}
          style={styles.chips}
        />
      ) : null}
    </View>
  ), [closetItems.length, searchQuery, closetCategory, shopperCollageCount, promoting, handleBecomeCreator]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  // Audience user who hasn't opted into a closet yet — friendly intro.
  if (!isShopper) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="closet-tab-screen">
        <View style={styles.introHeader}>
          <Text style={styles.title}>Closet</Text>
        </View>

        <View style={styles.center} testID="closet-tab-intro">
          <View style={styles.iconWrap}>
            <Shirt size={36} color="#B87063" strokeWidth={1.6} />
          </View>
          <Text style={styles.bigText}>Your digital closet</Text>
          <Text style={styles.body}>
            Snap your favorite pieces, and we'll cut them out so you can build and
            save styling collages — just for you.
          </Text>

          <Pressable
            className="bg-[#B87063] rounded-full py-3.5 px-6 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, marginTop: 24, opacity: createMutation.isPending ? 0.6 : 1 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
            testID="closet-create-button"
          >
            {createMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                Create my closet
              </Text>
            )}
          </Pressable>

          {createMutation.isError ? (
            <Text style={styles.errorText} testID="closet-create-error">
              Something went wrong. Please try again.
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  // Shopper: the closet grid, hosted inline in (public-tabs).
  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="closet-tab-screen">
      <FlatList
        style={{ flex: 1, width: screenWidth }}
        data={groupedItems}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          closetItems.length === 0 ? (
            <View style={styles.emptyState} testID="closet-empty-state">
              <View style={styles.emptyIcon}>
                <Text style={{ fontSize: 36 }}>{'👚'}</Text>
              </View>
              <Text style={styles.emptyTitle}>Your closet is empty.</Text>
              <Text style={styles.emptySubtitle}>
                Tap Add to snap a few pieces — we'll cut each one out for you.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState} testID="closet-no-results">
              <View style={styles.emptyIcon}>
                <Text style={{ fontSize: 32 }}>🔍</Text>
              </View>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptySubtitle}>Try a different search or filter.</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
        testID="closet-grid"
      />

      <ItemDetailSheet
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onItemRemoved={() => setSelectedItem(null)}
        testIDPrefix="closet-item-detail-sheet"
      />

      {/* Two-step guard for the shopper → creator conversion. Only the confirm
          button here runs promoteToCreator, so an accidental banner tap is safe. */}
      <ConfirmModal
        visible={showCreatorModal}
        title="Switch to a creator account?"
        body={
          "This turns your personal closet into a creator studio — you'll be able to publish looks, share them, and earn on your links. Your saved pieces come with you.\n\nYou can switch back to shopper mode anytime in Settings."
        }
        confirmLabel="Become a creator"
        cancelLabel="Not now"
        onConfirm={handleConfirmBecomeCreator}
        onCancel={() => setShowCreatorModal(false)}
        loading={promoting}
        error={promoteError}
        testID="become-creator-modal"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  introHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 34, color: '#1A1210' },
  subtitle: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#6B5E58', marginTop: 2 },
  searchBarContainer: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    height: 44,
  },
  actionRow: { paddingHorizontal: 16, marginBottom: 10 },
  chips: { marginTop: 2, marginBottom: 6 },
  upgradeBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#FBF3F0',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0DED8',
  },
  upgradeBannerText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
    lineHeight: 20,
  },
  gridContent: { paddingBottom: 120 },
  gridRow: { paddingHorizontal: CLOSET_GRID_PADDING, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3E7E3', marginBottom: 20,
  },
  bigText: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#1A1210', marginBottom: 10, textAlign: 'center' },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, color: '#6B5E58', textAlign: 'center' },
  errorText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#B4453C', marginTop: 14, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 48, gap: 12 },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F0EBE5',
  },
  emptyTitle: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 22, color: '#1A1210', textAlign: 'center' },
  emptySubtitle: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: '#6B5E58', textAlign: 'center' },
});
