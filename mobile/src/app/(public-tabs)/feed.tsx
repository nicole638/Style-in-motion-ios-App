import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Search, Settings, LayoutDashboard, Heart, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';
import useLikeStore from '@/lib/state/likeStore';
import useFollowStore from '@/lib/state/followStore';
import BrandsRail from '@/components/BrandsRail';
import CreatorsToFollowRail from '@/components/CreatorsToFollowRail';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ──────────────────────────────────────────────────────────────────

interface LookByVibeRow {
  look_id: string;
  creator_id: string | null;
  creator_name: string | null;
  creator_username: string | null;
  creator_photo_url: string | null;
  creator_handle: string | null;
  cover_photo_url: string | null;
  short_code: string | null;
  title: string | null;
  caption: string | null;
  style_vibe: string[] | null;
  occasion: string[] | null;
  season: string[] | null;
  color_palette: string[] | null;
  clothing_type: string[] | null;
  likes_count: number;
  clicks: number;
  published_at: string | null;
  match_score: number | null;
  // Brand-aware byline fields (added by RPC migration
  // 20260605220000_get_looks_by_vibe_brand_aware.sql). When account_type is
  // 'partner_brand' AND brand_* is non-null, the card renders the brand mark
  // instead of @creator_username.
  account_type: 'creator' | 'partner_brand' | null;
  brand_name: string | null;
  brand_slug: string | null;
  brand_logo_url: string | null;
}

type Dimension = 'style_vibe' | 'occasion' | 'season' | 'color_palette' | 'clothing_type';

interface TaxonomyRow {
  dimension: Dimension;
  tag: string;
  use_count: number;
}

interface ActiveFilters {
  style_vibe: string[];
  occasion: string[];
  season: string[];
  color_palette: string[];
  clothing_type: string[];
}

const PAGE_SIZE = 50;

const EMPTY_FILTERS: ActiveFilters = {
  style_vibe: [],
  occasion: [],
  season: [],
  color_palette: [],
  clothing_type: [],
};

// ─── Queries ────────────────────────────────────────────────────────────────

async function fetchVibeTaxonomy(): Promise<TaxonomyRow[]> {
  const { data, error } = await supabase.rpc('get_vibe_taxonomy');
  if (error) {
    console.warn('[discover] get_vibe_taxonomy error:', error.message);
    return [];
  }
  return (data ?? []) as TaxonomyRow[];
}

function useVibeTaxonomy() {
  return useQuery({
    queryKey: ['vibe-taxonomy'],
    queryFn: fetchVibeTaxonomy,
    staleTime: 5 * 60 * 1000,
  });
}

async function fetchLooksByVibe(args: {
  filters: ActiveFilters;
  search: string;
  offset: number;
}): Promise<LookByVibeRow[]> {
  const { filters, search, offset } = args;
  const params = {
    p_style: filters.style_vibe.length ? filters.style_vibe : null,
    p_occasion: filters.occasion.length ? filters.occasion : null,
    p_season: filters.season.length ? filters.season : null,
    p_color: filters.color_palette.length ? filters.color_palette : null,
    p_clothing_type: filters.clothing_type.length ? filters.clothing_type : null,
    p_search: search.trim().length ? search.trim() : null,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  };
  const { data, error } = await supabase.rpc('get_looks_by_vibe', params);
  if (error) {
    console.warn('[discover] get_looks_by_vibe error:', error.message);
    return [];
  }
  return (data ?? []) as LookByVibeRow[];
}

function useLooksByVibe(filters: ActiveFilters, search: string) {
  return useInfiniteQuery({
    queryKey: ['looks-by-vibe', filters, search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchLooksByVibe({ filters, search, offset: (pageParam as number) * PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length,
    staleTime: 0,
  });
}

// Following feed — looks from creators the viewer follows. Same row shape as
// get_looks_by_vibe so the masonry + DiscoverLookCard render unchanged. The
// RPC reads auth.uid() internally so no creator_id arg needed.
async function fetchFollowingFeed(offset: number): Promise<LookByVibeRow[]> {
  const { data, error } = await supabase.rpc('get_following_feed', {
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });
  if (error) {
    console.warn('[feed] get_following_feed error:', error.message);
    return [];
  }
  return (data ?? []) as LookByVibeRow[];
}

function useFollowingFeed(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['following-feed'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchFollowingFeed((pageParam as number) * PAGE_SIZE),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length,
    staleTime: 30 * 1000,
    enabled,
  });
}

// ─── Chip Row ───────────────────────────────────────────────────────────────

interface ChipRowProps {
  dimension: Dimension;
  tags: TaxonomyRow[];
  active: string[];
  onToggle: (tag: string) => void;
}

function ChipRow({ dimension, tags, active, onToggle }: ChipRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={chipStyles.row}
      style={{ flexGrow: 0 }}
      testID={`discover-chip-row-${dimension}`}
    >
      {tags.map((t) => {
        const isActive = active.includes(t.tag);
        const testIdTag = t.tag.toLowerCase().replace(/\s+/g, '-');
        return (
          <Pressable
            key={t.tag}
            onPress={() => onToggle(t.tag)}
            className={
              isActive
                ? 'bg-[#B87063] rounded-full px-4 py-2 active:opacity-85'
                : 'bg-white rounded-full px-4 py-2 border border-[#E8E0D8] active:opacity-85'
            }
            testID={`discover-chip-${dimension}-${testIdTag}`}
          >
            <Text
              style={{
                fontFamily: 'DMSans_500Medium',
                fontSize: 13,
                color: isActive ? '#FFFFFF' : '#1A1210',
              }}
            >
              {t.tag}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const chipStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
});

// ─── Look Card ──────────────────────────────────────────────────────────────

interface DiscoverLookCardProps {
  look: LookByVibeRow;
  cardWidth: number;
}

function DiscoverLookCard({ look, cardWidth }: DiscoverLookCardProps) {
  const [aspect, setAspect] = useState<number>(0.75); // default 3:4 portrait

  // Like state — subscribed so heart fills/empties on tap and count updates optimistically.
  const toggleLike = useLikeStore((s) => s.toggleLike);
  const isLiked = useLikeStore((s) => s.likedLookIds.includes(look.look_id));
  const storeCount = useLikeStore((s) => s.likeCounts[look.look_id]);
  const displayCount = storeCount ?? look.likes_count ?? 0;

  // Seed initial count once per card so optimistic +/-1 starts from the real base.
  useEffect(() => {
    useLikeStore.getState().initCounts({ [look.look_id]: look.likes_count ?? 0 });
  }, [look.look_id, look.likes_count]);

  // Brand-aware byline: when the look's creator is a partner_brand account
  // (e.g. Golden Bear Garage), surface the brand name + brand logo instead of
  // @creator_username + creator avatar. The brand mark is the storefront's
  // brand identity, not the human stylist who built the look — the human's
  // credit lives in looks.authored_by for analytics, not on the public card.
  const isBrandLook =
    look.account_type === 'partner_brand' && !!look.brand_name;
  const displayHandle = isBrandLook
    ? (look.brand_name as string)
    : look.creator_username
      ? `@${look.creator_username}`
      : look.creator_name ?? 'Creator';
  const avatarUri = isBrandLook
    ? look.brand_logo_url ?? look.creator_photo_url
    : look.creator_photo_url;
  const initial = (
    (isBrandLook ? look.brand_name : null) ??
    look.creator_username ??
    look.creator_name ??
    'C'
  )[0].toUpperCase();

  const handleOpen = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(`/look/${look.look_id}` as any);
  }, [look.look_id]);

  const handleLikePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    toggleLike(look.look_id);
  }, [look.look_id, toggleLike]);

  // Byline tap routes:
  //   partner_brand + slug → /storefront/<slug>  (brand landing)
  //   regular creator       → /creator-profile?creatorId=<id>
  // Regular creators were previously non-tappable, which left shoppers
  // stuck with no path to view all of a creator's looks. Parity restored
  // 2026-06-08 to fix the "stuck on Feed" symptom Nicole reported.
  const handleBylinePress = useCallback(() => {
    if (isBrandLook && look.brand_slug) {
      Haptics.selectionAsync().catch(() => {});
      router.push(`/storefront/${look.brand_slug}` as any);
      return;
    }
    if (look.creator_id) {
      Haptics.selectionAsync().catch(() => {});
      router.push({
        pathname: '/creator-profile' as any,
        params: { creatorId: look.creator_id },
      });
    }
  }, [isBrandLook, look.brand_slug, look.creator_id]);

  if (!look.cover_photo_url) return null;

  return (
    <Pressable
      onPress={handleOpen}
      style={[cardStyles.card, { width: cardWidth }]}
      testID={`discover-look-card-${look.look_id}`}
    >
      <Image
        source={{ uri: look.cover_photo_url }}
        style={{ width: cardWidth, aspectRatio: aspect, backgroundColor: '#F0EBE5' }}
        contentFit="cover"
        onLoad={(event: any) => {
          const w = event?.source?.width;
          const h = event?.source?.height;
          if (w && h && w > 0 && h > 0) {
            // Clamp to avoid ultra-tall cards bombing the layout.
            const a = Math.min(1.6, Math.max(0.55, w / h));
            setAspect(a);
          }
        }}
      />
      {/* Single combined pill at bottom-left containing the byline AND the
          like affordance. v3 (2026-06-08): heart was previously a separate
          pill at top-right — Nicole reported it visually crowded the
          byline of adjacent cards in the masonry. Combined into one pill
          with two Pressable hit zones (byline → profile, heart → like)
          so the tap targets are obvious. `box-none` allows the inner
          Pressables to claim taps while bare overlay area still falls
          through to the card open. */}
      <View style={cardStyles.overlay} pointerEvents="box-none">
        <Pressable
          onPress={handleBylinePress}
          disabled={!look.creator_id}
          style={cardStyles.bylineHit}
          hitSlop={4}
          testID={
            isBrandLook
              ? `discover-brand-byline-${look.look_id}`
              : `discover-creator-byline-${look.look_id}`
          }
        >
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={cardStyles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={cardStyles.initialCircle}>
              <Text style={cardStyles.initialText}>{initial}</Text>
            </View>
          )}
          <Text style={cardStyles.handle} numberOfLines={1}>
            {displayHandle}
          </Text>
        </Pressable>
        {/* Inline like — divider + heart + count. Tap area lives inside the
            same pill chrome so there's no visual confusion with adjacent
            cards' overlays. */}
        <View style={cardStyles.overlayDivider} />
        <Pressable
          onPress={handleLikePress}
          hitSlop={6}
          style={({ pressed }) => [cardStyles.overlayLikeHit, pressed && { opacity: 0.6 }]}
          testID={`discover-like-${look.look_id}`}
          accessibilityLabel={isLiked ? 'Unlike look' : 'Like look'}
        >
          <Heart
            size={14}
            color={isLiked ? '#FF6B8A' : '#FFFFFF'}
            fill={isLiked ? '#FF6B8A' : 'transparent'}
            strokeWidth={2}
          />
          {displayCount > 0 ? (
            <Text style={cardStyles.handle}>{displayCount}</Text>
          ) : null}
        </Pressable>
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginBottom: 6,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  overlay: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 999,
    paddingLeft: 3,
    paddingRight: 10,
    paddingVertical: 3,
    gap: 6,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#C4A882',
  },
  initialCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#FFFFFF',
  },
  handle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#FFFFFF',
  },
  // Transparent inner Pressable that captures byline taps. Inherits the
  // dark-pill chrome from the surrounding `overlay` View; lays out avatar +
  // handle as a row internally.
  bylineHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // v3: like hit zone INSIDE the byline pill. Separated from byline by a
  // thin divider so the two tap zones read distinctly.
  overlayDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginHorizontal: 6,
  },
  overlayLikeHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  likesPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  likesPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#FFFFFF',
  },
});

// ─── Masonry ────────────────────────────────────────────────────────────────

const MASONRY_PADDING = 8;
const MASONRY_GAP = 6;
const COLUMN_WIDTH =
  (SCREEN_WIDTH - MASONRY_PADDING * 2 - MASONRY_GAP) / 2;

function distributeIntoColumns(rows: LookByVibeRow[]): [LookByVibeRow[], LookByVibeRow[]] {
  // Simple alternating distribution. True height-aware balancing requires
  // we know each image's aspect ratio up front; the RPC doesn't return it.
  // Alternation is "good enough" for most catalogs.
  const left: LookByVibeRow[] = [];
  const right: LookByVibeRow[] = [];
  rows.forEach((r, i) => {
    if (i % 2 === 0) left.push(r);
    else right.push(r);
  });
  return [left, right];
}

// ─── Discover Screen ────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const [search, setSearch] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  // Feed mode toggle: 'foryou' (algorithmic get_looks_by_vibe) vs 'following'
  // (get_following_feed — looks from creators the shopper follows). Following
  // is the surface Nicole wants to drive the feed; defaults to For You so a
  // brand-new shopper who follows nobody still sees content.
  const [feedMode, setFeedMode] = useState<'foryou' | 'following'>('foryou');

  // When a signed-in creator browses the public Feed/Discover tabs we show a
  // pill at the top of the screen that takes them back to their creator
  // dashboard. Lets creators see what others are posting without signing out.
  const userType = useAuthStore((s) => s.userType);
  const isCreatorBrowsing = userType === 'creator';

  const followedIds = useFollowStore((s) => s.followedIds);
  const taxonomyQuery = useVibeTaxonomy();
  const forYouQuery = useLooksByVibe(activeFilters, search);
  const followingQuery = useFollowingFeed(feedMode === 'following');
  // The query feeding the grid depends on the selected mode.
  const looksQuery = feedMode === 'following' ? followingQuery : forYouQuery;

  const toggleFilter = useCallback((dimension: Dimension, tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActiveFilters((prev) => {
      const list = prev[dimension];
      const next = list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];
      return { ...prev, [dimension]: next };
    });
  }, []);

  const styleVibes = useMemo(() => {
    const rows = (taxonomyQuery.data ?? []).filter((r) => r.dimension === 'style_vibe');
    return rows.slice(0, 12);
  }, [taxonomyQuery.data]);

  const occasions = useMemo(() => {
    const rows = (taxonomyQuery.data ?? []).filter((r) => r.dimension === 'occasion');
    return rows.slice(0, 12);
  }, [taxonomyQuery.data]);

  const allLooks: LookByVibeRow[] = useMemo(() => {
    if (!looksQuery.data) return [];
    return looksQuery.data.pages.flat();
  }, [looksQuery.data]);

  const [leftCol, rightCol] = useMemo(() => distributeIntoColumns(allLooks), [allLooks]);

  const handleRefresh = useCallback(() => {
    looksQuery.refetch();
  }, [looksQuery]);

  const handleEndReached = useCallback(() => {
    if (!looksQuery.isFetchingNextPage && looksQuery.hasNextPage) {
      looksQuery.fetchNextPage();
    }
  }, [looksQuery]);

  // Bridge the ~one-round-trip beat between optimistically following a creator
  // and the invalidated Following feed actually refetching. When the follow
  // count ticks up while on Following, snapshot the query's dataUpdatedAt and
  // treat the feed as "loading" until a *fresh* result lands (dataUpdatedAt
  // advances). Without this, the empty overlay flashes for a frame before the
  // refetch starts. Race-free: it keys off the result timestamp advancing, not
  // the optimistic follow flip.
  // MUST stay above the early return so hook order is stable across renders.
  const followCountRef = useRef(followedIds.length);
  const followBridgeAt = useRef<number | null>(null);
  useEffect(() => {
    if (feedMode === 'following' && followedIds.length > followCountRef.current) {
      followBridgeAt.current = followingQuery.dataUpdatedAt;
    }
    followCountRef.current = followedIds.length;
  }, [followedIds.length, feedMode, followingQuery.dataUpdatedAt]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const renderHeader = () => (
    <View>
      {/* Title */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>Feed</Text>
        <Pressable
          onPress={() => router.push('/profile')}
          style={styles.iconButton}
          testID="discover-profile-button"
        >
          <Settings size={20} color="#1A1210" />
        </Pressable>
      </View>

      {/* Reciprocal mode-switch pill: only appears when a signed-in creator
          is browsing the public feed. Taps back into their creator dashboard
          via the (tabs) layout. Hidden for audience/shopper users. */}
      {isCreatorBrowsing ? (
        // Full-width outlined pill — the reciprocal of the creator Home's
        // "See what shoppers see" button (same shape: white fill, 1.5px ink
        // border, leading icon, trailing chevron). Keeps the two surfaces
        // visually paired so a creator recognizes it's the way back.
        <View className="px-4 pt-2 pb-1">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.replace('/(tabs)' as any);
            }}
            className="bg-white rounded-full py-3 px-5 flex-row items-center justify-between border-[1.5px] border-[#1A1210] active:opacity-85"
            testID="feed-back-to-creator-dashboard"
          >
            <View className="flex-row items-center">
              <LayoutDashboard size={16} color="#1A1210" strokeWidth={1.8} />
              <Text
                className="ml-2 text-[#1A1210] text-[14px] font-semibold"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Back to my creator dashboard
              </Text>
            </View>
            <ChevronRight size={16} color="#1A1210" strokeWidth={1.8} />
          </Pressable>
        </View>
      ) : null}

      {/* Feed is now a clean look stream; search + vibe/occasion chips live
          only on Discover (the dedicated filter surface). 2026-06-08 — Nicole
          flagged the duplicate filtering UI between Feed and Discover and we
          consolidated by keeping Feed lean. The search state, chip rows, and
          activeFilters logic still live in the file because the underlying
          get_looks_by_vibe RPC + masonry render are shared with Discover. */}

      {/* For You / Following toggle. Following = looks from creators the
          shopper follows (DB-backed get_following_feed). */}
      <View style={styles.feedToggleRow}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setFeedMode('foryou');
          }}
          style={[styles.feedToggleChip, feedMode === 'foryou' && styles.feedToggleChipActive]}
          testID="feed-mode-foryou"
        >
          <Text style={[styles.feedToggleText, feedMode === 'foryou' && styles.feedToggleTextActive]}>
            For You
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setFeedMode('following');
          }}
          style={[styles.feedToggleChip, feedMode === 'following' && styles.feedToggleChipActive]}
          testID="feed-mode-following"
        >
          <Text style={[styles.feedToggleText, feedMode === 'following' && styles.feedToggleTextActive]}>
            Following
          </Text>
        </Pressable>
      </View>

      {/* For You only: Featured brands + Creators-to-follow discovery rails.
          Both render null when empty so this stays layout-safe. */}
      {feedMode === 'foryou' ? (
        <>
          <BrandsRail />
          <CreatorsToFollowRail />
        </>
      ) : null}

      {/* Section heading */}
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>
          {feedMode === 'foryou' ? 'For You' : 'Following'}
        </Text>
      </View>

      {/* Following empty state — shopper follows nobody yet. */}
      {feedMode === 'following' && followedIds.length === 0 ? (
        <View style={styles.followingEmptyCard}>
          <Text style={styles.followingEmptyTitle}>
            Follow creators to fill your feed.
          </Text>
          <Text style={styles.followingEmptyCopy}>
            Tap a creator&apos;s name on any look and hit Follow. Their newest
            looks will show up right here.
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setFeedMode('foryou');
            }}
            style={styles.followingEmptyCta}
          >
            <Text style={styles.followingEmptyCtaText}>Browse For You</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Suggestions inside the Following-empty state — one-tap follow to
          fill the feed without leaving the tab. */}
      {feedMode === 'following' && followedIds.length === 0 ? (
        <View style={{ marginTop: 16 }}>
          <CreatorsToFollowRail title="Start with these" />
        </View>
      ) : null}
    </View>
  );

  const renderColumn = (rows: LookByVibeRow[], colKey: 'left' | 'right') => (
    <View style={{ width: COLUMN_WIDTH }} testID={`discover-masonry-col-${colKey}`}>
      {rows.map((row) => (
        <DiscoverLookCard key={row.look_id} look={row} cardWidth={COLUMN_WIDTH} />
      ))}
    </View>
  );

  const followBridging =
    feedMode === 'following' &&
    followBridgeAt.current !== null &&
    followingQuery.dataUpdatedAt === followBridgeAt.current &&
    allLooks.length === 0;

  // Treat an in-flight fetch with nothing on screen as "loading" — covers the
  // beat right after you follow a creator, when the Following feed is
  // invalidated and refetching: show the spinner instead of a brief flash of
  // the empty state. (allLooks.length === 0 guards it so paginating an
  // already-populated grid never trips this.)
  const isLoadingInitial =
    (looksQuery.isLoading || looksQuery.isFetching || followBridging) &&
    allLooks.length === 0;
  const isEmpty = !isLoadingInitial && allLooks.length === 0;
  // The Following tab renders its own in-header empty card (with suggestions)
  // when you follow nobody, so suppress the generic floating overlay there —
  // otherwise "No looks found" stacks on top of that card (the bug in
  // Nicole's screenshot).
  const showEmptyOverlay =
    isEmpty && !(feedMode === 'following' && followedIds.length === 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="discover-screen">
      <FlatList
        data={[0]} // dummy; we render the masonry as a single item
        keyExtractor={(i) => String(i)}
        renderItem={() => (
          <View style={styles.masonry}>
            {renderColumn(leftCol, 'left')}
            <View style={{ width: MASONRY_GAP }} />
            {renderColumn(rightCol, 'right')}
          </View>
        )}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={
          looksQuery.isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color="#1A1210" />
            </View>
          ) : null
        }
        ListEmptyComponent={null}
        refreshControl={
          <RefreshControl
            refreshing={!!(looksQuery.isRefetching && !looksQuery.isFetchingNextPage)}
            onRefresh={handleRefresh}
            tintColor="#1A1210"
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={1.2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        testID="discover-feed-list"
      />

      {isLoadingInitial ? (
        <View style={styles.fullLoader} pointerEvents="none">
          <ActivityIndicator size="large" color="#1A1210" testID="discover-loading-indicator" />
        </View>
      ) : null}

      {showEmptyOverlay ? (
        <View style={styles.emptyState} testID="discover-empty-state">
          <Text style={styles.emptyTitle}>
            {feedMode === 'following' ? 'No looks yet' : 'No looks found'}
          </Text>
          <Text style={styles.emptySub}>
            {feedMode === 'following'
              ? 'The creators you follow haven’t posted any looks yet. Check back soon.'
              : 'Try removing a filter or clearing your search.'}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    color: '#1A1210',
  },
  iconButton: {
    padding: 6,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    padding: 0,
  },
  sectionHeading: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  // For You / Following segmented toggle
  feedToggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  feedToggleChip: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  feedToggleChipActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  feedToggleText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  feedToggleTextActive: {
    color: '#FFFFFF',
  },
  // Following empty state
  followingEmptyCard: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 16,
    padding: 22,
  },
  followingEmptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  followingEmptyCopy: {
    marginTop: 8,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
  },
  followingEmptyCta: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: '#1A1210',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  followingEmptyCtaText: {
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  masonry: {
    flexDirection: 'row',
    paddingHorizontal: MASONRY_PADDING,
  },
  footerLoader: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  fullLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    position: 'absolute',
    top: 240,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  emptySub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginTop: 6,
    textAlign: 'center',
  },
});
