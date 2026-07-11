import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  Linking,
  Modal,
  TextInput,
  Share,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import * as MediaLibrary from 'expo-media-library';
import { savePhotoToLibrary } from '@/lib/utils/savePhotoToLibrary';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useFocusForegroundRefresh } from '@/lib/hooks/useFocusForegroundRefresh';
import { Search, X, Archive as ArchiveIcon, Copy, Instagram, Pencil, Trash2, Share2, Check, Plus } from 'lucide-react-native';
import PillButton from '@/components/PillButton';
import { ActionRow } from '@/components/ActionRow';
import { ItemDetailSheet } from '@/components/ItemDetailSheet';
import StarterPill from '@/components/StarterPill';
import ConfirmModal from '@/components/ConfirmModal';
import useLookStore, { Look, ClothingItem, ItemCategory, closetRowToItem } from '@/lib/state/lookStore';
import CategoryChips from '@/components/CategoryChips';
import { filterClosetItems } from '@/lib/utils/filterClosetItems';
import { supabase } from '@/lib/supabase';
import { openShopLink } from '@/lib/analytics/openShopLink';
import { buildShareText, savePhotosToAlbum, shareLook, buildLookShareUrl } from '@/lib/utils/shareLook';
import { shareToTikTok } from '@/lib/utils/shareToTikTok';
import { TikTokPostShareNudge } from '@/components/TikTokPostShareNudge';
import { ShareActionsBlock } from '@/components/ShareActionsBlock';
import { MoneyOnTableStrip } from '@/components/MoneyOnTableStrip';
import useProfileStore from '@/lib/state/profileStore';
import useAuthStore from '@/lib/state/authStore';
import useDraftLookStore from '@/lib/state/draftLookStore';
import useAwinMerchantsStore from '@/lib/state/awinMerchantsStore';
import { useActiveAwinOffersMap, shortOfferBadge } from '@/lib/queries/awinOffers';
import { useCreatorEarnings, formatEarnings } from '@/lib/queries/creatorEarnings';
import { hostFromUrl } from '@/lib/awin/wrap';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const GRID_GAP = 16;
const GRID_PADDING = 16;
const CARD_WIDTH = (screenWidth - GRID_PADDING * 2 - GRID_GAP) / 2;

export default function ShopScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const allLooks = useLookStore((s) => s.looks);
  const updateLook = useLookStore((s) => s.updateLook);
  const creatorId = useAuthStore((s) => s.creatorId);
  // Shopper mode: audience users with an opted-in shopper closet. Gates the
  // "Build a collage" affordance and the upgrade-to-creator banner. Creators
  // (accountType !== 'shopper') never see either.
  const accountType = useAuthStore((s) => s.accountType);
  const isShopper = accountType === 'shopper';
  const promoteToCreator = useAuthStore((s) => s.promoteToCreator);
  const looks = allLooks.filter(l => (l.creatorId ?? '') === creatorId);
  // Per-look earnings ({lookId -> sum(creator_share)}); React Query caches 5 min.
  const { data: earningsByLook } = useCreatorEarnings(creatorId);
  const deleteLook = useLookStore((s) => s.deleteLook);
  const archiveLook = useLookStore((s) => s.archiveLook);
  const unarchiveLook = useLookStore((s) => s.unarchiveLook);
  const incrementClicks = useLookStore((s) => s.incrementClicks);
  const archivedByCreator = useLookStore((s) => s.archivedLooksByCreator);
  const archivedLooks = archivedByCreator[creatorId ?? ''] ?? [];
  const closetItems = useLookStore((s) => s.closetItems);
  const archivedClosetItems = useLookStore((s) => s.archivedClosetItems);

  // Awin offers — overlay rose badges on closet cards when a merchant has an active offer
  const awinFetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  const awinLoaded = useAwinMerchantsStore((s) => s.loaded);
  const awinFindByHost = useAwinMerchantsStore((s) => s.findByHost);
  const offersQuery = useActiveAwinOffersMap();
  const offersMap = offersQuery.data ?? new Map();

  useEffect(() => {
    if (!awinLoaded) void awinFetchActive();
  }, [awinLoaded, awinFetchActive]);

  useEffect(() => {
    if (creatorId) {
      useLookStore.getState().fetchLooksByCreator(creatorId);
      useLookStore.getState().fetchArchivedLooksByCreator(creatorId);
      useLookStore.getState().loadClosetItems(creatorId);
      useLookStore.getState().loadArchivedClosetItems(creatorId);
    }
  }, [creatorId]);

  // Reconcile the closet whenever this screen regains focus, or the app returns
  // to the foreground while it's focused. The mount effect above loads once and
  // the realtime channel below covers live edits, but an item added via the iOS
  // Share Extension lands while the app is backgrounded — that realtime INSERT
  // is easily missed, and this tab does not remount on a tab switch, so without
  // this the shared item wouldn't appear until something else forced a reload.
  // loadClosetItems is a full, idempotent refetch. See useFocusForegroundRefresh.
  const refreshCloset = useCallback(() => {
    if (!creatorId) return;
    useLookStore.getState().loadClosetItems(creatorId);
  }, [creatorId]);
  useFocusForegroundRefresh(refreshCloset);

  // Realtime subscription for live closet updates (pending→complete, new inserts, deletes)
  useEffect(() => {
    if (!creatorId) return;
    const channelName = `closet_items:${creatorId}`;
    // Remove any stale channel with this name before subscribing (avoids "after subscribe()" error on re-mount)
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
          if (payload.eventType === 'INSERT') {
            store.realtimeUpsertClosetItem(closetRowToItem(payload.new as any));
          } else if (payload.eventType === 'UPDATE') {
            store.realtimeUpsertClosetItem(closetRowToItem(payload.new as any));
          } else if (payload.eventType === 'DELETE') {
            store.realtimeRemoveClosetItem((payload.old as any).id);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [creatorId]);

  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [detailPhotoAspect, setDetailPhotoAspect] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<(ClothingItem & { lookId?: string }) | null>(null);
  const [savedPhotosCount, setSavedPhotosCount] = useState<number | null>(null);
  const [igCaptionCopied, setIgCaptionCopied] = useState<boolean>(false);
  const [storyShareMessage, setStoryShareMessage] = useState<string | null>(null);
  const [tikTokNudgeUrl, setTikTokNudgeUrl] = useState<string | null>(null);
  const [renamingLookId, setRenamingLookId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Shoppers land on the closet GRID (items/closet view), never the collage
  // builder or the creator "Looks" tab. Creators keep the default "Looks" view.
  // The ?view=closet deep-link from (public-tabs)/closet.tsx reinforces this on
  // focus; this initializer covers a direct/cold entry into the shop tab.
  const [view, setView] = useState<'looks' | 'items' | 'closet' | 'archives'>(
    () => (isShopper ? 'closet' : 'looks'),
  );

  // Deep-link entry: callers (e.g. "Back to closet" after saving a collage)
  // navigate here with ?view=closet. Apply it on focus, then clear the param so
  // it only fires once per navigation and never fights a manual tab switch.
  const params = useLocalSearchParams<{ view?: string }>();
  useFocusEffect(
    useCallback(() => {
      const v = params.view;
      if (v === 'looks' || v === 'items' || v === 'closet' || v === 'archives') {
        setView(v);
        router.setParams({ view: undefined } as any);
      }
    }, [params.view])
  );
  const [closetCategory, setClosetCategory] = useState<ItemCategory | null>(null);
  const [archiveSubView, setArchiveSubView] = useState<'looks' | 'items'>('looks');
  const [shopLinkCopied, setShopLinkCopied] = useState<boolean>(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInputRef = useRef<TextInput>(null);
  const searchInputRef = useRef<TextInput>(null);

  // Shopper upgrade gate: count this shopper's saved collages (drafts →
  // published_at NULL, tags contains 'collage'). shop.tsx doesn't load drafts,
  // so a lightweight count query is the safe path. Only runs for shoppers.
  const [shopperCollageCount, setShopperCollageCount] = useState<number>(0);
  const [promoting, setPromoting] = useState<boolean>(false);
  const [showCreatorModal, setShowCreatorModal] = useState<boolean>(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  useEffect(() => {
    if (!isShopper || !creatorId) return;
    let cancelled = false;
    (async () => {
      try {
        const { count, error } = await supabase
          .from('looks')
          .select('id', { count: 'exact', head: true })
          .eq('creator_id', creatorId)
          .is('published_at', null)
          .contains('tags', ['collage']);
        if (!cancelled && !error) setShopperCollageCount(count ?? 0);
      } catch (e) {
        console.warn('[shop] shopper collage count failed:', e);
      }
    })();
    return () => { cancelled = true; };
    // Re-count when returning to the closet view (a new draft may have been saved).
  }, [isShopper, creatorId, view]);

  // First tap only opens the confirm modal — a single accidental tap can never
  // convert the account. The actual conversion runs from the modal's explicit
  // "Become a creator" button (handleConfirmBecomeCreator).
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
      router.replace('/onboarding/welcome' as any);
    } else {
      setPromoteError(res.error ?? 'Something went wrong. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [promoting, promoteToCreator]);

  useEffect(() => {
    setDetailPhotoAspect(null);
  }, [selectedLook?.id]);

  const insets = useSafeAreaInsets();
  const profileUsername = useProfileStore((s) => s.username);
  const displayName = profileUsername.trim() || 'you';
  const profileInitials = displayName.slice(0, 2).toUpperCase();

  const shopSlug = profileUsername.trim().toLowerCase().replace(/\s+/g, '') || 'yourname';

  // Filtered looks based on search query
  const filteredLooks = useMemo(() => {
    const seen = new Set<string>();
    const deduped = looks.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
    if (!searchQuery.trim()) return deduped;
    const q = searchQuery.toLowerCase().trim();
    return deduped.filter(look => {
      if (look.title?.toLowerCase().includes(q)) return true;
      if (look.caption?.toLowerCase().includes(q)) return true;
      if (look.items.some(item => item.name?.toLowerCase().includes(q))) return true;
      if (look.items.some(item => item.brand?.toLowerCase().includes(q))) return true;
      if (look.items.some(item => item.category?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [looks, searchQuery]);

  const filteredArchivedLooks = useMemo(() => {
    const seen = new Set<string>();
    const deduped = archivedLooks.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
    if (!searchQuery.trim()) return deduped;
    const q = searchQuery.toLowerCase().trim();
    return deduped.filter(look => {
      if (look.title?.toLowerCase().includes(q)) return true;
      if (look.caption?.toLowerCase().includes(q)) return true;
      if (look.items.some(item => item.name?.toLowerCase().includes(q))) return true;
      if (look.items.some(item => item.brand?.toLowerCase().includes(q))) return true;
      if (look.items.some(item => item.category?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [archivedLooks, searchQuery]);

  // Closet "All" view grouping. sort_order is uniformly 0 in the DB, so we
  // cluster by `category` at render in the canonical order (matches the
  // creator_items.category enum + the chips), newest-first within each group.
  const CATEGORY_ORDER: ItemCategory[] = [
    'Top', 'Pants', 'Dress', 'Shoes', 'Bag', 'Jewelry', 'Accessory', 'Outerwear', 'Other',
  ];
  const groupClosetByCategory = (items: ClothingItem[]) => {
    const rank = (c?: ItemCategory | null) => {
      const i = c ? CATEGORY_ORDER.indexOf(c) : -1;
      return i === -1 ? CATEGORY_ORDER.length : i; // unknown/null → after Other
    };
    const ts = (s?: string) => (s ? Date.parse(s) : 0);
    // A just-added item is `pending` (no name/category yet) — pin pending then
    // failed above settled items so it stays visible as "Fetching…" instead of
    // dropping into the Other bucket at the bottom. Once it scrapes to
    // complete/partial it falls into its real category group.
    const statusTier = (it: ClothingItem) =>
      it.fetchStatus === 'pending' ? 0 : it.fetchStatus === 'failed' ? 1 : 2;
    return [...items].sort((a, b) => {
      const tierA = statusTier(a);
      const tierB = statusTier(b);
      if (tierA !== tierB) return tierA - tierB; // pending → failed → settled
      if (tierA < 2) return ts(b.createdAt) - ts(a.createdAt); // unsettled: newest first
      const byCat = rank(a.category) - rank(b.category); // settled: group by category
      if (byCat !== 0) return byCat;
      return ts(b.createdAt) - ts(a.createdAt); // newest first within category
    });
  };

  // Active closet items (Items tab) — canonical, one row per creator_items.id
  const filteredItems = useMemo(() => {
    const base = !searchQuery.trim()
      ? closetItems
      : closetItems.filter(item => {
          const q = searchQuery.toLowerCase().trim();
          return (
            item.name?.toLowerCase().includes(q) ||
            item.brand?.toLowerCase().includes(q) ||
            item.category?.toLowerCase().includes(q)
          );
        });
    return groupClosetByCategory(base);
  }, [closetItems, searchQuery]);

  // Closet items (Closet tab) — same data as Items, separate view. Search box
  // (name/brand/category) AND category chip combine via filterClosetItems.
  const filteredClosetItems = useMemo(() => {
    return groupClosetByCategory(filterClosetItems(closetItems, searchQuery, closetCategory));
  }, [closetItems, searchQuery, closetCategory]);

  // Archived closet items (Archives > Items sub-view)
  const filteredArchivedItems = useMemo(() => {
    if (!searchQuery.trim()) return archivedClosetItems;
    const q = searchQuery.toLowerCase().trim();
    return archivedClosetItems.filter(item =>
      item.name?.toLowerCase().includes(q) ||
      item.brand?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    );
  }, [archivedClosetItems, searchQuery]);

  // Stats — ITEMS now reflects canonical closet count, not per-look occurrences
  const totalItems = closetItems.length;
  const totalClicks = looks.reduce((sum, l) => sum + l.clicks, 0);

  const shopShareUrl = `https://app.styledinmotion.app/${shopSlug}`;

  const handleCopyShopLink = async () => {
    try {
      await Clipboard.setStringAsync(shopShareUrl);
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      setShopLinkCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setShopLinkCopied(false), 1800);
    } catch (err) {
      console.warn('[handleCopyShopLink] failed:', err);
    }
  };

  const handleShareShopLink = async () => {
    try {
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      await Share.share({
        message: shopShareUrl,
        url: shopShareUrl,
      });
    } catch (err) {
      console.warn('[handleShareShopLink] failed:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleStartRename = (look: Look) => {
    setRenamingLookId(look.id);
    setRenameValue(look.title || '');
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  const handleCommitRename = (lookId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      const look = looks.find(l => l.id === lookId);
      if (look) updateLook({ ...look, title: trimmed });
    }
    setRenamingLookId(null);
  };

  const handleShopItem = (link: string, item?: ClothingItem, look?: Look | null) => {
    if (!link) return;
    // Route through /api/shop so the affiliate tag is stamped and the click row
    // is written server-side (source=ios). Prefer look/item ids for attribution;
    // fall back to the closet-item id, else the raw url.
    const hasLookContext = !!(look?.id && item?.lookItemId);
    void openShopLink({
      lookId: hasLookContext ? look!.id : undefined,
      itemId: hasLookContext ? item!.lookItemId : undefined,
      creatorItemId: !hasLookContext ? item?.id : undefined,
      creatorId: look?.creatorId ?? creatorId ?? undefined,
      url: !hasLookContext && !item?.id ? link : undefined,
    });
  };

  const handleEditLook = useCallback((look: Look) => {
    setSelectedLook(null);
    // Phase 2 collage edit — looks tagged 'collage' with a saved layout edit
    // in the collage builder. Pre-Phase-2 collage looks have NULL layout and
    // are filtered out before the edit button is shown.
    if (look.tags?.includes('collage') && look.collageLayout) {
      setTimeout(() => {
        router.push({
          pathname: '/collage-builder',
          params: { lookId: look.id },
        });
      }, 300);
      return;
    }
    useDraftLookStore.getState().setEditingLookId(look.id);
    setTimeout(() => {
      router.push({
        pathname: '/(tabs)/create',
        params: { editLookId: look.id },
      });
    }, 300);
  }, []);

  const handleShareLook = useCallback(async (look: Look) => {
    await shareLook({
      id: look.id,
      caption: look.caption,
      items: look.items,
      hashtags: look.hashtags,
    });
  }, []);

  const handleToggleArchive = useCallback(async (look: Look) => {
    setSelectedLook(null);
    setSavedPhotosCount(null);
    setIgCaptionCopied(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (look.archived) {
      await unarchiveLook(look.id);
    } else {
      await archiveLook(look.id);
    }
  }, [archiveLook, unarchiveLook]);

  const handleSaveAllPhotos = async (look: Look) => {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') return;
    let count = 0;
    if (look.photoUri) {
      if (await savePhotoToLibrary(look.photoUri)) count++;
    }
    for (const item of look.items) {
      if (item.photoUri) {
        if (await savePhotoToLibrary(item.photoUri)) count++;
      }
    }
    setSavedPhotosCount(count);
  };

  const handleShareInstagram = async (look: Look) => {
    const shareText = buildShareText({
      caption: look.caption || '',
      items: look.items,
      hashtags: look.hashtags,
    });

    await Clipboard.setStringAsync(shareText);
    setIgCaptionCopied(true);
    setTimeout(() => setIgCaptionCopied(false), 3000);

    let photoCount = 0;
    try {
      photoCount = await savePhotosToAlbum({
        coverPhotoUri: look.photoUri,
        items: look.items,
      });
    } catch (error) {
      console.warn('Photo save failed:', error);
    }

    const message = photoCount > 0
      ? `${photoCount} photo${photoCount !== 1 ? 's' : ''} saved to your Styled in Motion album. Caption copied!\n\nIn Instagram, tap + and select your photos for a carousel post.`
      : `Caption copied to clipboard! Paste it into your Instagram post.`;
    Linking.openURL('instagram://app').catch(() => {});
    setTimeout(() => {
      Alert.alert('Caption Copied!', message, [{ text: 'Got it' }]);
    }, 500);
  };

  const handleShareToStory = useCallback(async (look: Look) => {
    const shareUrl = buildLookShareUrl(look.id);
    if (!shareUrl) return;
    try { await Clipboard.setStringAsync(shareUrl); } catch {}
    let photoSaved = true;
    try { await savePhotosToAlbum({ coverPhotoUri: look.photoUri, items: [] }); } catch { photoSaved = false; }
    setStoryShareMessage(
      photoSaved
        ? 'Link copied! In Instagram: tap + \u2192 Story \u2192 pick this look\'s cover photo \u2192 add a Link sticker \u2192 paste.'
        : 'Link copied, but we couldn\'t save the cover photo. You can still open Instagram and share manually.'
    );
    setTimeout(() => setStoryShareMessage(null), 5000);
    Linking.openURL('instagram://app').catch(() => {
      setStoryShareMessage('Instagram not installed. Cover photo saved to your Photos app, link copied \u2014 share manually.');
      setTimeout(() => setStoryShareMessage(null), 5000);
    });
  }, []);

  const handleShareTikTok = useCallback(async (look: Look) => {
    if (!look.photoUri) {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
      return;
    }
    const outcome = await shareToTikTok({
      id: look.id,
      title: look.title || look.caption || 'New look',
      caption: look.caption,
      shortCode: look.shortCode ?? null,
      hashtags: look.hashtags,
      photoUri: look.photoUri,
    });

    if (outcome.stage === 'shared' || outcome.stage === 'cancelled') {
      setTikTokNudgeUrl(outcome.clipboardUrl);
    } else if (outcome.stage === 'sdk-unavailable') {
      Linking.openURL('tiktok://').catch(() => {});
    } else if (outcome.stage === 'missing-photo') {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
    } else if (outcome.stage === 'error') {
      console.warn('[handleShareTikTok] error:', outcome.message);
      Alert.alert('TikTok share failed', outcome.message || 'Please try again.');
    }
  }, []);

  // Per-closet-item usage count — how many of the creator's published looks
  // reference each item. Derived from in-memory `allLooks` (which is already
  // the creator's published, non-archived looks via fetchLooksByCreator).
  const itemUsageMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const look of allLooks) {
      for (const it of look.items) {
        map[it.id] = (map[it.id] ?? 0) + 1;
      }
    }
    return map;
  }, [allLooks]);

  const renderItemCard = useCallback(({ item }: { item: ClothingItem }) => {
    const isPending = item.fetchStatus === 'pending';
    const isFailed = item.fetchStatus === 'failed';
    const isPartial = item.fetchStatus === 'partial';
    const usageCount = itemUsageMap[item.id] ?? 0;
    // Starter pill — only render on the creator's own Closet view, never on
    // Items/Archives, never on Discover/Feed (which renders looks, not items).
    const showStarterPill = view === 'closet' && item.fromStarterPack === true;
    // Awin coupon badge lookup: match by URL host -> awin merchant -> active offer
    let badgeText: string | null = null;
    if (item.link) {
      const host = hostFromUrl(item.link);
      if (host) {
        const m = awinFindByHost(host);
        if (m) {
          const offer = offersMap.get(m.id);
          badgeText = shortOfferBadge(offer);
        }
      }
    }
    return (
      <Pressable
        style={({ pressed }) => [styles.itemGridCard, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedItem(item);
        }}
        testID={`shop-item-card-${item.id}`}
      >
        <View style={{ position: 'relative' }}>
          {item.photoUri ? (
            <Image source={{ uri: item.photoUri }} style={styles.itemGridImage} contentFit="contain" />
          ) : (
            <View style={[styles.itemGridImage, styles.itemGridPlaceholder]}>
              <Text style={{ fontSize: 32 }}>{item.emoji}</Text>
            </View>
          )}
          {isPending ? (
            <View style={styles.fetchOverlay} testID={`item-fetch-pending-${item.id}`}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.fetchOverlayText}>Fetching…</Text>
            </View>
          ) : null}
          {badgeText ? (
            <View style={styles.couponBadge} testID={`item-coupon-badge-${item.id}`}>
              <Text style={styles.couponBadgeText} numberOfLines={1}>{`\uD83D\uDD25 ${badgeText}`}</Text>
            </View>
          ) : null}
          {showStarterPill ? (
            <View style={styles.starterPillOverlay} pointerEvents="none">
              <StarterPill />
            </View>
          ) : null}
        </View>
        <View style={styles.itemGridInfo}>
          <Text style={styles.itemGridName} numberOfLines={1}>{decodeHtmlEntities(item.name) || item.category}</Text>
          {item.brand ? (
            <Text style={styles.itemGridBrand} numberOfLines={1}>{decodeHtmlEntities(item.brand)}</Text>
          ) : null}
          {item.price ? (
            <Text style={styles.itemGridPrice}>${item.price}</Text>
          ) : null}
          {usageCount > 0 ? (
            <Text style={styles.itemUsageBadge} testID={`item-usage-${item.id}`}>
              {`In ${usageCount} look${usageCount === 1 ? '' : 's'}`}
            </Text>
          ) : null}
          {isFailed ? (
            <Text style={styles.fetchErrorBadge} testID={`item-fetch-failed-${item.id}`}>⚠ Fetch failed</Text>
          ) : null}
          {isPartial ? (
            <Text style={styles.fetchPartialHint} testID={`item-fetch-partial-${item.id}`}>Some details missing</Text>
          ) : null}
        </View>
      </Pressable>
    );
  }, [itemUsageMap]);

  const renderGridCard = useCallback(({ item: look, index }: { item: Look; index: number }) => {
    const isRenaming = renamingLookId === look.id;
    return (
      <Pressable
        style={({ pressed }) => [styles.gridCard, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
        onPress={() => setSelectedLook(look)}
        onLongPress={() => handleStartRename(look)}
        testID={`shop-look-${look.id}`}
      >
        {look.photoUri ? (
          <Image
            source={{ uri: look.photoUri }}
            style={styles.gridCardPhoto}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.gridCardPhoto, styles.gridCardPhotoPlaceholder]}>
            <Text style={{ fontSize: 36 }}>👗</Text>
          </View>
        )}
        <View style={styles.gridCardFooter}>
          {isRenaming ? (
            <TextInput
              ref={renameInputRef}
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              cursorColor="#1A1210"
              selectionColor="rgba(26,18,16,0.3)"
              onBlur={() => handleCommitRename(look.id)}
              onSubmitEditing={() => handleCommitRename(look.id)}
              returnKeyType="done"
              testID={`rename-input-${look.id}`}
            />
          ) : (
            <Text style={styles.gridCardTitle} numberOfLines={2} ellipsizeMode="tail">
              {look.title || `Look #${index + 1}`}
            </Text>
          )}
          <View style={styles.gridCardMeta}>
            <View style={styles.gridItemsBadge}>
              <Text style={styles.gridItemsBadgeText}>{look.items.length} items</Text>
            </View>
            {look.clicks > 0 ? (
              <Text style={styles.gridCardClicks}>{look.clicks} taps</Text>
            ) : null}
            {(look.likesCount ?? 0) > 0 ? (
              <Text style={styles.gridCardClicks}>{'♥ '}{look.likesCount}</Text>
            ) : null}
            {(earningsByLook?.[look.id] ?? 0) > 0 ? (
              <Text style={styles.gridCardEarned} testID={`shop-look-earned-${look.id}`}>
                {formatEarnings(earningsByLook![look.id])}
              </Text>
            ) : null}
          </View>
          <Text style={styles.gridCardDate}>
            {new Date(look.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        </View>
      </Pressable>
    );
  }, [renamingLookId, renameValue]);

  const ListHeader = useCallback(() => (
    <View>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Studio</Text>
        <View style={styles.urlRow}>
          <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
            app.styledinmotion.app/{shopSlug}
          </Text>
          <Pressable
            onPress={handleCopyShopLink}
            style={({ pressed }) => [styles.copyPill, pressed && styles.copyPillPressed]}
            hitSlop={8}
            testID="copy-shop-link"
          >
            {shopLinkCopied ? (
              <Check size={14} color="#2E7D32" strokeWidth={2.5} />
            ) : (
              <Copy size={14} color="#3D3330" strokeWidth={2} />
            )}
            <Text style={[styles.copyPillText, shopLinkCopied && styles.copyPillTextCopied]}>
              {shopLinkCopied ? 'Copied!' : 'Copy'}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleShareShopLink}
            style={({ pressed }) => [styles.copyPill, pressed && styles.copyPillPressed]}
            hitSlop={8}
            testID="share-shop-link"
          >
            <Share2 size={14} color="#3D3330" strokeWidth={2} />
            <Text style={styles.copyPillText}>Share</Text>
          </Pressable>
        </View>
      </View>

      {/* Surface 2 — "Money on the table" affiliate-match strip */}
      <MoneyOnTableStrip creatorId={creatorId} />

      {/* Stats row */}
      {looks.length > 0 ? (
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{looks.length}</Text>
            <Text style={styles.statLabel}>Looks</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{totalItems}</Text>
            <Text style={styles.statLabel}>Items</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{totalClicks}</Text>
            <Text style={styles.statLabel}>Clicks</Text>
          </View>
        </View>
      ) : null}

      {/* Search bar */}
      {looks.length > 0 ? (
        <View style={styles.searchBarContainer}>
          <View style={styles.searchBar}>
            <Search size={18} color="#8C8580" strokeWidth={2} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={view === 'looks' ? "Search looks, items, brands..." : "Search items, brands..."}
              placeholderTextColor="#8C8580"
              cursorColor="#1A1210"
              selectionColor="rgba(26,18,16,0.3)"
              returnKeyType="search"
              testID="shop-search-input"
            />
            {searchQuery.length > 0 ? (
              <Pressable
                onPress={() => setSearchQuery('')}
                hitSlop={8}
                testID="shop-search-clear"
              >
                <X size={18} color="#8C8580" strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Looks / Items / Closet / Archives Toggle */}
      <View style={styles.toggleRow} testID="shop-view-toggle">
        <Pressable
          onPress={() => setView('looks')}
          style={[styles.togglePill, view === 'looks' && styles.togglePillActive]}
          testID="shop-toggle-looks"
        >
          <Text style={[styles.togglePillText, view === 'looks' && styles.togglePillTextActive]}>
            Looks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('items')}
          style={[styles.togglePill, view === 'items' && styles.togglePillActive]}
          testID="shop-toggle-items"
        >
          <Text style={[styles.togglePillText, view === 'items' && styles.togglePillTextActive]}>
            Items
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('closet')}
          style={[styles.togglePill, view === 'closet' && styles.togglePillActive]}
          testID="shop-toggle-closet"
        >
          <Text style={[styles.togglePillText, view === 'closet' && styles.togglePillTextActive]}>
            Closet
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('archives')}
          style={[styles.togglePill, view === 'archives' && styles.togglePillActive]}
          testID="shop-toggle-archives"
        >
          <Text style={[styles.togglePillText, view === 'archives' && styles.togglePillTextActive]}>
            Archives
          </Text>
        </Pressable>
      </View>

      {/* Shopper upgrade banner (Feature 5): shown only to shoppers with ≥1
          saved collage. Creators never see it. */}
      {view === 'closet' && isShopper && shopperCollageCount >= 1 ? (
        <View style={styles.upgradeBanner} testID="shopper-upgrade-banner">
          <Text style={styles.upgradeBannerText}>
            Love styling? Publish looks and earn — become a creator.
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

      {/* Closet inline add button — guaranteed visible above the grid */}
      {view === 'closet' ? (
        <View style={styles.closetAddRowWrapper}>
          <PillButton
            label="Add Item to Closet"
            variant="outline"
            fullWidth
            icon={<Plus size={18} color="#B87063" />}
            onPress={() => router.push(isShopper ? '/add-closet-photos' : '/add-closet-item')}
            testID="closet-add-item-row"
          />
        </View>
      ) : null}

      {/* Shopper "Build a collage" entry (Feature 3): only for shoppers with
          ≥1 closet item. Creators reach the collage builder through their own
          create surfaces — this affordance is shopper-gated. */}
      {view === 'closet' && isShopper && closetItems.length >= 1 ? (
        <View style={styles.closetAddRowWrapper}>
          <PillButton
            label="Build a collage"
            variant="dark"
            fullWidth
            onPress={() => router.push('/collage-builder')}
            testID="shopper-build-collage"
          />
        </View>
      ) : null}

      {/* Shopper "My collages" entry: reopens saved collage drafts via the
          reused drafts.tsx list (which routes collage drafts back into the
          editor). Gated to shoppers with ≥1 saved collage. */}
      {view === 'closet' && isShopper && shopperCollageCount >= 1 ? (
        <View style={styles.closetAddRowWrapper}>
          <PillButton
            label="My collages"
            variant="outline"
            fullWidth
            onPress={() => router.push('/drafts')}
            testID="shopper-my-collages"
          />
        </View>
      ) : null}

      {/* Closet category chips — filter the grid by bucket (combines with search) */}
      {view === 'closet' ? (
        <CategoryChips
          selected={closetCategory}
          onSelect={setClosetCategory}
          style={styles.closetChips}
        />
      ) : null}

      {/* Archive sub-toggle: Looks / Items */}
      {view === 'archives' ? (
        <View style={styles.subToggleRow} testID="shop-archive-sub-toggle">
          <Pressable
            onPress={() => setArchiveSubView('looks')}
            style={[styles.subTogglePill, archiveSubView === 'looks' && styles.subTogglePillActive]}
            testID="shop-archive-sub-looks"
          >
            <Text style={[styles.subTogglePillText, archiveSubView === 'looks' && styles.subTogglePillTextActive]}>
              Looks
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setArchiveSubView('items')}
            style={[styles.subTogglePill, archiveSubView === 'items' && styles.subTogglePillActive]}
            testID="shop-archive-sub-items"
          >
            <Text style={[styles.subTogglePillText, archiveSubView === 'items' && styles.subTogglePillTextActive]}>
              Items
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  ), [shopSlug, looks.length, archivedLooks.length, closetItems.length, archivedClosetItems.length, totalItems, totalClicks, searchQuery, view, archiveSubView, isShopper, shopperCollageCount, promoting, handleBecomeCreator]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="shop-screen">
      <FlatList
        style={{ flex: 1, width: screenWidth }}
        data={
          view === 'looks'
            ? filteredLooks
            : view === 'closet'
              ? filteredClosetItems
              : view === 'archives'
                ? (archiveSubView === 'looks' ? filteredArchivedLooks : filteredArchivedItems)
                : filteredItems
        }
        renderItem={
          view === 'items' || view === 'closet' || (view === 'archives' && archiveSubView === 'items')
            ? (renderItemCard as any)
            : renderGridCard
        }
        keyExtractor={(item: any) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          looks.length === 0 && archivedLooks.length === 0 && closetItems.length === 0 && archivedClosetItems.length === 0 ? (
            <EmptyShopState />
          ) : view === 'items' && closetItems.length === 0 ? (
            <EmptyItemsState />
          ) : view === 'closet' && closetItems.length === 0 ? (
            <EmptyClosetState />
          ) : view === 'archives' && archiveSubView === 'looks' && archivedLooks.length === 0 ? (
            <EmptyArchivesState />
          ) : view === 'archives' && archiveSubView === 'items' && archivedClosetItems.length === 0 ? (
            <EmptyArchivedItemsState />
          ) : (
            <NoResultsState query={searchQuery} />
          )
        }
        showsVerticalScrollIndicator={false}
        testID={
          view === 'looks'
            ? 'shop-looks-grid'
            : view === 'closet'
              ? 'shop-closet-grid'
              : view === 'archives'
                ? (archiveSubView === 'looks' ? 'shop-archives-grid' : 'shop-archived-items-grid')
                : 'shop-items-grid'
        }
      />

      <Modal
        visible={selectedLook !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedLook(null)}
        testID="look-detail-modal"
      >
        <View style={styles.detailBackdrop}>
          <Pressable style={styles.detailBackdropTouch} onPress={() => setSelectedLook(null)} />
          <View style={[styles.detailSheet, { height: screenHeight * 0.88 }]}>
            <View style={styles.detailDragHandle} />

            {/* X close button */}
            <Pressable
              style={styles.detailXClose}
              onPress={() => {
                setSelectedLook(null);
                setSavedPhotosCount(null);
                setIgCaptionCopied(false);
              }}
              testID="detail-x-close"
            >
              <Text style={{ fontSize: 14, color: '#FFFFFF' }}>✕</Text>
            </Pressable>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.detailScrollContent}
            >
              {/* Look photo */}
              {selectedLook?.photoUri ? (
                <Image
                  source={{ uri: selectedLook.photoUri }}
                  style={[styles.detailPhoto, detailPhotoAspect ? { aspectRatio: detailPhotoAspect } : null]}
                  contentFit="cover"
                  onLoad={(e) => {
                    const w = e?.source?.width;
                    const h = e?.source?.height;
                    if (w && h && h > 0) setDetailPhotoAspect(w / h);
                  }}
                />
              ) : (
                <View style={[styles.detailPhoto, { backgroundColor: '#E0D8D0', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 40 }}>👗</Text>
                </View>
              )}

              {/* Meta: title + creator */}
              <View style={styles.detailMeta}>
                <Text style={styles.detailTitle}>Shop This Look</Text>
                <View style={styles.detailCreatorRow}>
                  <View style={styles.detailAvatar}>
                    <Text style={styles.detailAvatarText}>{profileInitials}</Text>
                  </View>
                  <Text style={styles.detailCreatorName}>by {displayName || 'you'}</Text>
                </View>
              </View>

              {/* Items list */}
              {(selectedLook?.items ?? []).map((item) => {
                const hasLink = item.link && item.link !== '#' && item.link !== '';
                const alternates = (item.alternates ?? []).filter(a => a?.link && a.link.trim());
                const hasAlternate = alternates.length > 0;
                return (
                  <View key={item.id}>
                    <Pressable
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedItem({ ...item, lookId: selectedLook!.id });
                      }}
                      testID={`shop-item-row-${item.id}`}
                    >
                      <View style={styles.detailItemRow}>
                        {item.photoUri ? (
                          <Image source={{ uri: item.photoUri }} style={styles.detailItemPhoto} contentFit="cover" />
                        ) : (
                          <View style={styles.detailItemPlaceholder}>
                            <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                          </View>
                        )}
                        <View style={styles.detailItemInfo}>
                          <Text style={styles.detailItemName} numberOfLines={1}>{decodeHtmlEntities(item.name) || item.category}</Text>
                          {item.brand ? (
                            <Text style={styles.detailItemBrand}>{decodeHtmlEntities(item.brand)}</Text>
                          ) : null}
                          {item.price ? <Text style={styles.detailItemPrice}>${item.price}</Text> : null}
                          {hasAlternate && item.primaryNote ? (
                            <Text style={{ fontSize: 11, color: '#6B5E58', marginTop: 2, fontStyle: 'italic' }}>{item.primaryNote}</Text>
                          ) : null}
                        </View>
                        {hasLink ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              incrementClicks(selectedLook!.id);
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              handleShopItem(item.link, item, selectedLook);
                            }}
                            hitSlop={8}
                            testID={`shop-item-${item.id}`}
                          >
                            <Text style={styles.detailShopLabel}>Shop →</Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.detailSoonLabel}>Soon</Text>
                        )}
                      </View>
                    </Pressable>
                    {alternates.map((alt, altIdx) => (
                      <Pressable
                        key={`${item.id}-alt-${altIdx}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        onPress={() => {
                          incrementClicks(selectedLook!.id);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          // Alternate link → route through /api/shop with the
                          // raw url plus look/item context for attribution.
                          void openShopLink({
                            url: alt.link,
                            lookId: selectedLook?.id ?? undefined,
                            itemId: item.lookItemId ?? undefined,
                            creatorId: selectedLook?.creatorId ?? creatorId ?? undefined,
                          });
                        }}
                        testID={`shop-alt-${item.id}-${altIdx}`}
                      >
                        <View style={styles.altCard}>
                          {alt.label ? (
                            <Text style={styles.altLabel}>{alt.label}</Text>
                          ) : null}
                          <View style={styles.altCardRow}>
                            {alt.photo_url ? (
                              <Image
                                source={{ uri: alt.photo_url }}
                                style={styles.altThumb}
                                contentFit="cover"
                              />
                            ) : null}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.altName} numberOfLines={1}>{alt.name || 'Alternative'}</Text>
                              {alt.brand ? (
                                <Text style={styles.altBrand}>{alt.brand}</Text>
                              ) : null}
                              {alt.price ? (
                                <Text style={styles.altPrice}>${alt.price}</Text>
                              ) : null}
                            </View>
                            <Text style={styles.detailShopLabel}>Shop →</Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                );
              })}

              {/* Share actions */}
              <View style={styles.detailActions}>
                <ShareActionsBlock
                  onShareLook={() => selectedLook && handleShareLook(selectedLook)}
                  onSaveAllPhotos={() => selectedLook && handleSaveAllPhotos(selectedLook)}
                  onShareToStory={() => selectedLook && handleShareToStory(selectedLook)}
                  onShareInstagram={() => selectedLook && handleShareInstagram(selectedLook)}
                  onShareTikTok={() => selectedLook && handleShareTikTok(selectedLook)}
                  savedPhotosCount={savedPhotosCount}
                  storyShareMessage={storyShareMessage}
                  testIDPrefix="detail"
                  variant="list"
                />
              </View>

              <View style={styles.detailActionList}>
                {selectedLook?.tags?.includes('collage') && !selectedLook.collageLayout ? null : (
                  <ActionRow
                    icon={Pencil}
                    label="Edit Look"
                    onPress={() => selectedLook && handleEditLook(selectedLook)}
                    testID="shop-detail-edit-button"
                  />
                )}
                <ActionRow
                  icon={ArchiveIcon}
                  label={selectedLook?.archived ? 'Unarchive Look' : 'Archive Look'}
                  onPress={() => selectedLook && handleToggleArchive(selectedLook)}
                  testID="shop-detail-archive-button"
                />
                <ActionRow
                  icon={Trash2}
                  label="Delete Look"
                  onPress={() => {
                    if (selectedLook) {
                      const lookId = selectedLook.id;
                      setSelectedLook(null);
                      setSavedPhotosCount(null);
                      setIgCaptionCopied(false);
                      deleteLook(lookId);
                    }
                  }}
                  variant="destructive"
                  isLast
                  testID="shop-detail-delete-button"
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ItemDetailSheet
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onItemRemoved={() => setSelectedItem(null)}
        testIDPrefix="shop-item-detail-sheet"
      />

      <TikTokPostShareNudge
        visible={tikTokNudgeUrl !== null}
        shopUrl={tikTokNudgeUrl}
        onDismiss={() => setTikTokNudgeUrl(null)}
      />
    </SafeAreaView>
  );
}

function EmptyShopState() {
  return (
    <View style={styles.emptyState} testID="shop-empty-state">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 40 }}>🛍️</Text>
      </View>
      <Text style={styles.emptyTitle}>No looks yet</Text>
      <Text style={styles.emptySubtitle}>
        Create your first look to build your studio.
      </Text>
    </View>
  );
}

function EmptyItemsState() {
  return (
    <View style={styles.emptyState} testID="shop-items-empty">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 36 }}>🧺</Text>
      </View>
      <Text style={styles.emptyTitle}>No items yet</Text>
      <Text style={styles.emptySubtitle}>
        Create a look to add items here.
      </Text>
    </View>
  );
}

function EmptyClosetState() {
  return (
    <View style={styles.emptyState} testID="shop-closet-empty">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 36 }}>{'👚'}</Text>
      </View>
      <Text style={styles.emptyTitle}>Your closet is empty.</Text>
      <Text style={styles.emptySubtitle}>
        {"Add a piece you own — paste a product link and we'll fill in the details."}
      </Text>
      <PillButton
        label="Add Item"
        variant="dark"
        icon={<Plus size={18} color="#FFFFFF" />}
        onPress={() => router.push('/add-closet-item')}
        testID="closet-empty-add-button"
      />
    </View>
  );
}

function EmptyArchivesState() {
  return (
    <View style={styles.emptyState} testID="shop-archives-empty">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 36 }}>🗄️</Text>
      </View>
      <Text style={styles.emptyTitle}>No archived looks yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap a look's detail screen to archive it.
      </Text>
    </View>
  );
}

function EmptyArchivedItemsState() {
  return (
    <View style={styles.emptyState} testID="shop-archived-items-empty">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 36 }}>🗄️</Text>
      </View>
      <Text style={styles.emptyTitle}>No archived items yet</Text>
      <Text style={styles.emptySubtitle}>
        Archive an item from its detail sheet to tuck it away here.
      </Text>
    </View>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <View style={styles.emptyState} testID="shop-no-results">
      <View style={styles.emptyIcon}>
        <Text style={{ fontSize: 36 }}>🔍</Text>
      </View>
      <Text style={styles.emptyTitle}>No matches</Text>
      <Text style={styles.emptySubtitle}>
        Nothing found for "{query}". Try a different search.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
    overflow: 'hidden',
  },
  gridContent: {
    paddingBottom: 120,
  },
  gridRow: {
    paddingHorizontal: GRID_PADDING,
    justifyContent: 'space-between',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    letterSpacing: 2,
    color: '#1A1210',
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  urlText: {
    flex: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
  copyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D4C8C2',
    backgroundColor: '#FFFFFF',
  },
  copyPillPressed: {
    backgroundColor: '#F7F4F0',
  },
  copyPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  copyPillTextCopied: {
    color: '#2E7D32',
  },
  // Stats row
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 12,
  },
  statPill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statValue: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 20,
    color: '#1A1210',
  },
  statLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Search bar
  searchBarContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
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
  // Looks / Items / Closet / Archives toggle
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 6,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4C8C2',
    minHeight: 38,
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
  // Archive sub-toggle (Looks / Items inside Archives)
  subToggleRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  subTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#F0EBE5',
    minHeight: 30,
  },
  subTogglePillActive: {
    backgroundColor: '#3D3330',
  },
  subTogglePillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
  },
  subTogglePillTextActive: {
    color: '#F7F4F0',
  },
  // Item grid cards (Items tab)
  itemGridCard: {
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
  itemGridImage: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: '#F7F4F0',
    padding: 6,
  },
  itemGridPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemGridInfo: {
    width: CARD_WIDTH,
    padding: 10,
    gap: 2,
    overflow: 'hidden',
  },
  itemGridName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  itemGridBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  itemGridPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
    marginTop: 2,
  },
  itemUsageBadge: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 3,
  },
  // Grid cards
  gridCard: {
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
  gridCardPhoto: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
  },
  gridCardPhotoPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCardFooter: {
    padding: 10,
    gap: 4,
    width: CARD_WIDTH,
    overflow: 'hidden',
  },
  gridCardTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 14,
    color: '#1A1210',
    maxWidth: CARD_WIDTH - 20,
  },
  gridCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gridItemsBadge: {
    backgroundColor: '#F0EBE5',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  gridItemsBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#6B5E58',
  },
  gridCardClicks: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: '#B87063',
  },
  gridCardEarned: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#B87063',
  },
  gridCardDate: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  renameInput: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 14,
    color: '#1A1210',
    borderBottomWidth: 1,
    borderBottomColor: '#B87063',
    paddingVertical: 2,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
  },
  emptySubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyAddButton: {
    marginTop: 20,
    backgroundColor: '#1A1210',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  emptyAddButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#FFFFFF',
  },
  closetAddRowWrapper: {
    paddingHorizontal: GRID_PADDING,
    marginBottom: 12,
  },
  upgradeBanner: {
    marginHorizontal: GRID_PADDING,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FAF1EE',
    borderWidth: 1,
    borderColor: '#EAD7D0',
  },
  upgradeBannerText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    lineHeight: 21,
    color: '#1A1210',
  },
  closetChips: {
    marginBottom: 12,
  },
  closetAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#D4C8C2',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  closetAddRowIcon: {
    fontSize: 18,
    color: '#1A1210',
    lineHeight: 20,
    fontWeight: '600',
  },
  closetAddRowText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
    letterSpacing: 0.2,
  },
  // Detail modal
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  detailBackdropTouch: {
    flex: 1,
  },
  detailSheet: {
    backgroundColor: '#F7F4F0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  detailDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 0,
  },
  detailXClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  detailScrollContent: {
    paddingBottom: 40,
  },
  detailPhoto: {
    width: '100%' as const,
    aspectRatio: 2 / 3,
    borderRadius: 16,
  },
  detailMeta: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  detailTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 6,
  },
  detailCreatorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  detailAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8C5A3A',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  detailAvatarText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  detailCreatorName: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginLeft: 8,
  },
  detailItemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  detailItemPhoto: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  detailItemPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#E0D8D0',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  detailItemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  detailItemName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#1A1210',
  },
  detailItemBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  detailItemPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    marginTop: 2,
  },
  detailShopLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#B87063',
    marginLeft: 12,
  },
  detailSoonLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginLeft: 12,
  },
  detailActions: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 10,
  },
  detailActionList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  detailActionBtnDark: {
    height: 48,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  detailActionBtnDarkText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#F7F4F0',
  },
  detailActionBtnLight: {
    height: 48,
    backgroundColor: '#F0EBE5',
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  detailActionBtnLightText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  altCard: {
    backgroundColor: '#F0EBE5',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    marginLeft: 56,
    marginRight: 20,
    marginBottom: 10,
  },
  altLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  altCardRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  altThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 8,
  },
  altName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  altBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  altPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#1A1210',
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1210',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: '#1A1210',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  fabIcon: {
    fontSize: 20,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  fabText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  captionCopiedBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 2,
  },
  captionCopiedText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#2E7D32',
    textAlign: 'center' as const,
  },
  instagramHint: {
    fontSize: 11,
    color: '#6B5E58',
    textAlign: 'center' as const,
  },
  fetchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,18,16,0.55)',
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
  },
  fetchOverlayText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
  },
  fetchErrorBadge: {
    fontSize: 11,
    color: '#B87063',
    fontFamily: 'DMSans_500Medium',
    marginTop: 2,
  },
  fetchPartialHint: {
    fontSize: 11,
    color: '#8C8580',
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
  },
  couponBadge: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    backgroundColor: '#B87063',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: CARD_WIDTH - 24,
    shadowColor: '#1A1210',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  couponBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  // Starter pill — top-right corner overlay on closet tiles, 6pt from edges.
  // Renders only when item.fromStarterPack is true AND view === 'closet'.
  starterPillOverlay: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
  },
});
