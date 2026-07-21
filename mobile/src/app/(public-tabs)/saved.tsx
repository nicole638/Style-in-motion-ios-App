import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Bookmark } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import useLookStore, { Look } from '@/lib/state/lookStore';
import useSavedItemsStore, { SavedItem } from '@/lib/state/savedItemsStore';
import useSavedLooksStore, { SavedLook } from '@/lib/state/savedLooksStore';
import { ItemListSheet } from '@/components/ItemListSheet';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { logClickEvent } from '@/lib/analytics/clickEvents';
import { CLICK_SOURCE } from '@/lib/analytics/source';
import { isShoppable, NOT_SHOPPABLE_LABEL } from '@/lib/shoppable';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 8;
const GRID_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// ─── Saved Screen ────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const fetchLookById = useLookStore((s) => s.fetchLookById);
  // Looks the shopper bookmarked from the Shop This Look sheet — DB-backed,
  // hydrated on auth, and self-contained: each carries its own byline + cover
  // snapshot so it renders without depending on lookStore.looks (which only
  // holds the creator's OWN looks — the reason shopper-saved looks used to
  // vanish from here).
  const savedLooks = useSavedLooksStore((s) => s.savedLooks);
  const removeSavedLook = useSavedLooksStore((s) => s.removeSavedLook);
  // Items the shopper bookmarked — DB-backed too.
  const savedItems = useSavedItemsStore((s) => s.savedItems);
  const removeSavedItem = useSavedItemsStore((s) => s.removeSavedItem);

  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [itemSheetVisible, setItemSheetVisible] = useState<boolean>(false);
  const [openingLookId, setOpeningLookId] = useState<string | null>(null);
  const [view, setView] = useState<'looks' | 'items'>('looks');

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const handleUnsave = useCallback(async (lookId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void removeSavedLook(lookId);
  }, [removeSavedLook]);

  const handleUnsaveItem = useCallback(async (itemId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void removeSavedItem(itemId);
  }, [removeSavedItem]);

  // A saved look only carries a cover/byline snapshot — fetch its full items
  // on demand (fetchLookById) before opening the Shop This Look sheet.
  const handleOpenSavedLook = useCallback(async (lookId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setOpeningLookId(lookId);
    try {
      const full = await fetchLookById(lookId);
      if (full) {
        setSelectedLook(full);
        setItemSheetVisible(true);
      }
    } finally {
      setOpeningLookId(null);
    }
  }, [fetchLookById]);

  const handleCloseSheet = useCallback(() => {
    setItemSheetVisible(false);
    setSelectedLook(null);
  }, []);

  const handleShopItem = useCallback(async (item: SavedItem) => {
    // Linkless piece (vintage/personal) — card isn't pressable for these, but
    // guard anyway so /api/shop is never called without a usable URL.
    if (!isShoppable({ link: item.link, affiliate_url: item.affiliateUrl })) return;
    const link = (item.link ?? '').trim() ? item.link! : item.affiliateUrl!;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    const useEf = !!(baseUrl && item.lookItemId && item.lookId);
    const url = useEf
      ? `${baseUrl}/api/shop?lookId=${encodeURIComponent(item.lookId!)}&itemId=${encodeURIComponent(item.lookItemId!)}&source=${CLICK_SOURCE}`
      : link;
    // When going through /api/shop the backend writes the click row (with full
    // 3-tier Amazon tag resolution + source='ios' from the query param above).
    // Only log directly from the client on the bypass path. creatorId rides on
    // the saved row's denormalized snapshot, so no look lookup is needed.
    if (!useEf) {
      void logClickEvent({
        lookId: item.lookId ?? null,
        itemId: item.lookItemId ?? null,
        creatorId: item.creatorId ?? null,
        itemUrl: link,
        redirectUrl: url,
        wasAffiliated: !!item.affiliateUrl,
        affiliateNetwork: null,
      });
    }
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: '#B87063',
      controlsColor: '#FFFFFF',
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
      dismissButtonStyle: 'done',
    });
  }, []);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  // Build look card grid rows (2 columns)
  const lookRows: SavedLook[][] = [];
  for (let i = 0; i < savedLooks.length; i += 2) {
    lookRows.push(savedLooks.slice(i, i + 2));
  }

  // Build item card grid rows (2 columns) from the shopper's bookmarked items.
  const itemRows: SavedItem[][] = [];
  for (let i = 0; i < savedItems.length; i += 2) {
    itemRows.push(savedItems.slice(i, i + 2));
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="saved-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved</Text>
      </View>

      {/* Looks / Items Toggle */}
      <View style={styles.toggleRow} testID="saved-view-toggle">
        <Pressable
          onPress={() => setView('looks')}
          style={[styles.togglePill, view === 'looks' && styles.togglePillActive]}
          testID="saved-toggle-looks"
        >
          <Text
            style={[styles.togglePillText, view === 'looks' && styles.togglePillTextActive]}
          >
            Looks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('items')}
          style={[styles.togglePill, view === 'items' && styles.togglePillActive]}
          testID="saved-toggle-items"
        >
          <Text
            style={[styles.togglePillText, view === 'items' && styles.togglePillTextActive]}
          >
            Items
          </Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        testID="saved-scroll"
      >
        {view === 'looks' ? (
          savedLooks.length === 0 ? (
            <View style={styles.emptyCard} testID="saved-looks-empty">
              <Text style={styles.emptyHeading}>Build your own collection.</Text>
              <Text style={styles.emptyCopy}>
                Open any look and tap "Save this look" in the Shop This Look sheet
                to keep it here. Every piece stays one tap from shopping,
                synced across your devices.
              </Text>
              <Pressable
                onPress={() => router.push('/(public-tabs)/feed' as never)}
                style={styles.emptyCta}
              >
                <Text style={styles.emptyCtaText}>Browse the Feed</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.grid} testID="saved-looks-grid">
              {lookRows.map((row, rowIdx) => (
                <View key={`look-row-${rowIdx}`} style={styles.gridRow}>
                  {row.map((saved) => {
                    const bylineName = saved.creatorName;
                    const bylineAvatar = saved.creatorPhotoUrl;
                    const bylineInitial = (bylineName ?? 'C')
                      .replace(/^@/, '')[0]
                      ?.toUpperCase() ?? 'C';
                    const handleBylinePress = () => {
                      Haptics.selectionAsync().catch(() => {});
                      if (saved.isBrand && saved.brandSlug) {
                        router.push(`/storefront/${saved.brandSlug}` as any);
                      } else if (saved.creatorId) {
                        router.push({
                          pathname: '/creator-profile' as any,
                          params: { creatorId: saved.creatorId },
                        });
                      }
                    };
                    const opening = openingLookId === saved.id;
                    return (
                      <Pressable
                        key={saved.id}
                        style={[styles.lookCard, opening && { opacity: 0.6 }]}
                        onPress={() => handleOpenSavedLook(saved.id)}
                        disabled={opening}
                        testID={`saved-card-${saved.id}`}
                      >
                        <View style={{ position: 'relative' }}>
                          {saved.coverPhotoUri ? (
                            <Image
                              source={{ uri: saved.coverPhotoUri }}
                              style={styles.lookImage}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={[styles.lookImage, styles.lookImagePlaceholder]} />
                          )}
                          <Pressable
                            style={styles.unsaveButton}
                            onPress={() => handleUnsave(saved.id)}
                            hitSlop={8}
                            testID={`unsave-button-${saved.id}`}
                          >
                            <Bookmark size={16} color="#FFFFFF" fill="#FFFFFF" />
                          </Pressable>
                          {opening ? (
                            <View style={styles.openingOverlay}>
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            </View>
                          ) : null}
                        </View>
                        {saved.title ? (
                          <Text style={styles.lookTitle} numberOfLines={1}>
                            {saved.title}
                          </Text>
                        ) : null}
                        {/* Creator/brand byline \u2014 tappable, routes to the right
                            profile/storefront surface (from the saved snapshot,
                            no live lookup needed). */}
                        {bylineName ? (
                          <Pressable
                            onPress={handleBylinePress}
                            hitSlop={4}
                            style={styles.savedByline}
                            testID={`saved-byline-${saved.id}`}
                          >
                            {bylineAvatar ? (
                              <Image
                                source={{ uri: bylineAvatar }}
                                style={styles.savedBylineAvatar}
                                contentFit="cover"
                              />
                            ) : (
                              <View style={[styles.savedBylineAvatar, styles.savedBylineAvatarFallback]}>
                                <Text style={styles.savedBylineInitial}>{bylineInitial}</Text>
                              </View>
                            )}
                            <Text style={styles.savedBylineName} numberOfLines={1}>
                              {bylineName}
                            </Text>
                          </Pressable>
                        ) : null}
                        <View style={styles.lookMeta}>
                          <Text style={styles.lookMetaText}>
                            {saved.itemCount} {saved.itemCount === 1 ? 'item' : 'items'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {row.length === 1 ? <View style={{ width: CARD_WIDTH }} /> : null}
                </View>
              ))}
            </View>
          )
        ) : savedItems.length === 0 ? (
          <View style={styles.emptyCard} testID="saved-items-empty">
            <Text style={styles.emptyHeading}>No saved items yet.</Text>
            <Text style={styles.emptyCopy}>
              Tap the bookmark icon next to any item in a look to save it here —
              your own shoppable wishlist, synced across your devices.
            </Text>
          </View>
        ) : (
          <View style={styles.grid} testID="saved-items-grid">
            {itemRows.map((row, rowIdx) => (
              <View key={`item-row-${rowIdx}`} style={styles.gridRow}>
                {row.map((item) => {
                  const shoppable = isShoppable({ link: item.link, affiliate_url: item.affiliateUrl });
                  const cardInner = (
                    <>
                    <View style={{ position: 'relative' }}>
                      {item.photoUri ? (
                        <Image
                          source={{ uri: item.photoUri }}
                          style={styles.itemImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.itemImage, styles.itemEmojiPlaceholder]}>
                          <Text style={{ fontSize: 28 }}>{item.emoji ?? '\u{1F6CD}'}</Text>
                        </View>
                      )}
                      <Pressable
                        style={styles.unsaveButton}
                        onPress={() => handleUnsaveItem(item.id)}
                        hitSlop={8}
                        testID={`unsave-item-${item.id}`}
                      >
                        <Bookmark size={16} color="#FFFFFF" fill="#FFFFFF" />
                      </Pressable>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={1}>{decodeHtmlEntities(item.name)}</Text>
                      {item.brand ? (
                        <Text style={styles.itemBrand} numberOfLines={1}>{decodeHtmlEntities(item.brand)}</Text>
                      ) : null}
                      {!shoppable ? (
                        <Text style={styles.notShoppableLabel} numberOfLines={1}>{NOT_SHOPPABLE_LABEL}</Text>
                      ) : item.price ? (
                        <Text style={styles.itemPrice} numberOfLines={1}>${item.price}</Text>
                      ) : null}
                    </View>
                    </>
                  );
                  return shoppable ? (
                    <Pressable
                      key={item.id}
                      style={styles.itemCard}
                      onPress={() => handleShopItem(item)}
                      testID={`saved-item-${item.id}`}
                    >
                      {cardInner}
                    </Pressable>
                  ) : (
                    // Linkless (vintage/personal) piece — visible, dimmed, not
                    // tappable. The unsave bookmark inside still works.
                    <View
                      key={item.id}
                      style={[styles.itemCard, styles.itemCardUnshoppable]}
                      testID={`saved-item-${item.id}`}
                    >
                      {cardInner}
                    </View>
                  );
                })}
                {row.length === 1 ? <View style={{ width: CARD_WIDTH }} /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Item List Sheet */}
      {itemSheetVisible ? (
        <ItemListSheet
          look={selectedLook}
          onClose={handleCloseSheet}
          testIDPrefix="saved-item-sheet"
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  // Looks / Items toggle (matches FilterDropdown pill styling)
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4C8C2',
    minHeight: 36,
  },
  togglePillActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  togglePillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  togglePillTextActive: {
    color: '#FFFFFF',
  },
  // Section headers
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1210',
  },
  divider: {
    height: 1,
    backgroundColor: '#E8E0D8',
    marginHorizontal: 16,
    marginTop: 16,
  },
  // Grid
  grid: {
    paddingHorizontal: GRID_PADDING,
  },
  gridRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  // Look cards
  lookCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
  },
  lookImage: {
    width: '100%',
    aspectRatio: 2 / 3,
  },
  lookImagePlaceholder: {
    backgroundColor: '#F0EBE5',
  },
  openingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  unsaveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#1A1210',
    marginTop: 6,
    marginHorizontal: 8,
  },
  lookMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
    marginHorizontal: 8,
  },
  lookMetaText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  // Tappable creator/brand byline below the look title on saved cards
  savedByline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    marginHorizontal: 8,
  },
  savedBylineAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F0EBE5',
  },
  savedBylineAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  savedBylineInitial: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 9,
    color: '#6B5E58',
  },
  savedBylineName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#1A1210',
    flexShrink: 1,
  },
  // Item cards
  itemCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
  },
  itemImage: {
    width: '100%',
    aspectRatio: 1,
  },
  itemEmojiPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    padding: 8,
  },
  itemName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  itemBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 2,
  },
  itemPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
    marginTop: 3,
  },
  notShoppableLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 3,
  },
  // Web parity: linkless cards render at opacity-70 — visible, deliberate,
  // not an error state.
  itemCardUnshoppable: {
    opacity: 0.7,
  },
  // Empty states
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  // Polished empty-state card — feels intentional, not "no data."
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 16,
    padding: 22,
  },
  emptyHeading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  emptyCopy: {
    marginTop: 8,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
  },
  emptyCta: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: '#1A1210',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
});
