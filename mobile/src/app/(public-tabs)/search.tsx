import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  TextInput,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Search } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import useLookStore, {
  Look,
  LooksRow,
  LOOK_ITEMS_EMBED,
  rowToLook,
} from '@/lib/state/lookStore';
import { supabase } from '@/lib/supabase';
import useLikeStore from '@/lib/state/likeStore';
import useProfileStore from '@/lib/state/profileStore';
import useCategoryStore from '@/lib/state/categoryStore';
import { ItemListSheet } from '@/components/ItemListSheet';
import { FilterDropdown } from '@/components/FilterDropdown';
import useAnalyticsStore from '@/lib/state/analyticsStore';
import { useBrandIdentities } from '@/lib/queries/storefront';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 10;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

const OCCASION_OPTIONS = [
  'casual', 'work', 'date night', 'wedding guest', 'brunch',
  'party', 'vacation', 'formal', 'athletic', 'festival', 'holiday', 'everyday',
];

const STYLE_VIBE_OPTIONS = [
  'minimalist', 'romantic', 'edgy', 'classic', 'bohemian', 'sporty',
  'glamorous', 'streetwear', 'preppy', 'vintage', 'trendy', 'cozy',
];

const SEASON_OPTIONS = ['spring', 'summer', 'fall', 'winter', 'all-season'];

export default function SearchScreen() {
  // Discover owns its own GLOBAL look feed. We deliberately do NOT read
  // useLookStore.looks here: that array is shared/mutable and gets overwritten
  // by fetchLooksByCreator(...) elsewhere (collapsing Discover to a single
  // creator). This query pulls ALL published, non-archived looks directly,
  // reusing the store's embed + mapper so cards + the ItemListSheet keep full
  // data (including .items).
  const discoverLooksQuery = useQuery({
    queryKey: ['discover-global-looks'],
    queryFn: async (): Promise<Look[]> => {
      const { data, error } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .not('published_at', 'is', null)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => rowToLook(row as LooksRow));
    },
    staleTime: 60_000,
  });
  const looks = discoverLooksQuery.data ?? [];

  // Refetch on focus so navigating away/back can't leave Discover collapsed.
  useFocusEffect(
    useCallback(() => {
      discoverLooksQuery.refetch();
    }, [discoverLooksQuery.refetch])
  );

  const getLikeCount = useLikeStore((s) => s.getLikeCount);
  // Reactive subscription so the masonry re-renders as creator profiles
  // stream in from fetchProfilesForCreators — without this the cards keep
  // their initial snapshot (which is missing the data) until the next
  // unrelated state change.
  const profiles = useProfileStore((s) => s.profiles);
  const categories = useCategoryStore((s) => s.categories);
  const isLoadingCategories = useCategoryStore((s) => s.isLoading);
  const fetchCategories = useCategoryStore((s) => s.fetchCategories);

  const [searchText, setSearchText] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [activeBrand, setActiveBrand] = useState<string>('All');
  const [selectedOccasions, setSelectedOccasions] = useState<string[]>([]);
  const [selectedStyleVibes, setSelectedStyleVibes] = useState<string[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [itemSheetVisible, setItemSheetVisible] = useState<boolean>(false);

  // Extract unique brands from all look items
  const brands = useMemo(() => {
    const brandSet = new Set<string>();
    looks.forEach((look) => {
      look.items.forEach((item) => {
        if (item.brand && item.brand.trim()) {
          brandSet.add(item.brand.trim());
        }
      });
    });
    return Array.from(brandSet).sort();
  }, [looks]);

  useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  // Preload creator profiles for every look that will appear in the grid so
  // the masonry cards render real @handles + avatars instead of the literal
  // "@Creator" fallback. profileStore.fetchProfilesForCreators is a no-op
  // for ids it already has, so this stays cheap on re-renders.
  // Distinct creator_ids across every look the search view might render —
  // used both for the profile prefetch below AND for the batch brand-identity
  // lookup so cards published by partner_brand storefronts (Golden Bear
  // Garage etc.) swap the @username byline for the brand mark.
  const visibleCreatorIds = useMemo(() => {
    return Array.from(
      new Set(
        looks
          .map((l) => l.creatorId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }, [looks]);

  useEffect(() => {
    if (visibleCreatorIds.length === 0) return;
    useProfileStore.getState().fetchProfilesForCreators(visibleCreatorIds);
  }, [visibleCreatorIds]);

  // Brand-aware byline cache — { isPartnerBrand, brandName, brandLogoUrl,
  // brandSlug } per creator_id, batched in one query and 5-min cached.
  const brandIdentitiesQuery = useBrandIdentities(visibleCreatorIds);

  const hasActiveFilters = selectedOccasions.length > 0 || selectedStyleVibes.length > 0 || selectedSeasons.length > 0;

  const filteredLooks = useMemo(() => {
    let results = looks;

    // Smart text search — AND across words, OR across fields
    if (searchText.trim()) {
      const searchWords = searchText.toLowerCase().trim().split(/\s+/).filter(Boolean);
      results = results.filter((look) => {
        const searchableText = [
          look.title ?? '',
          look.caption ?? '',
          ...(look.hashtags ?? []),
          ...(look.occasion ?? []),
          ...(look.season ?? []),
          ...(look.style_vibe ?? []),
          ...(look.color_palette ?? []),
          ...(look.clothing_type ?? []),
          ...(look.creator_tags ?? []),
          ...(look.tags ?? []),
          ...(look.items ?? []).map((i) => `${i.name} ${i.brand ?? ''} ${i.category}`),
        ].join(' ').toLowerCase();

        return searchWords.every((word) => searchableText.includes(word));
      });
    }

    // Category filter
    if (activeCategory !== 'All') {
      results = results.filter((look) => look.category === activeCategory);
    }

    // Brand filter
    if (activeBrand !== 'All') {
      results = results.filter((look) =>
        look.items.some((item) => item.brand?.trim() === activeBrand)
      );
    }

    // Occasion filter (OR within dimension)
    if (selectedOccasions.length > 0) {
      results = results.filter((look) =>
        (look.occasion ?? []).some((o) => selectedOccasions.includes(o))
      );
    }

    // Style vibe filter (OR within dimension)
    if (selectedStyleVibes.length > 0) {
      results = results.filter((look) =>
        (look.style_vibe ?? []).some((v) => selectedStyleVibes.includes(v))
      );
    }

    // Season filter (OR within dimension)
    if (selectedSeasons.length > 0) {
      results = results.filter((look) =>
        (look.season ?? []).some((s) => selectedSeasons.includes(s))
      );
    }

    return results;
  }, [looks, searchText, activeCategory, activeBrand, selectedOccasions, selectedStyleVibes, selectedSeasons]);

  const toggleFilter = useCallback(
    (value: string, selected: string[], setSelected: React.Dispatch<React.SetStateAction<string[]>>) => {
      if (selected.includes(value)) {
        setSelected(selected.filter((v) => v !== value));
      } else {
        setSelected([...selected, value]);
      }
    },
    []
  );

  const clearAllFilters = useCallback(() => {
    setSelectedOccasions([]);
    setSelectedStyleVibes([]);
    setSelectedSeasons([]);
  }, []);

  const handleOpenSheet = useCallback((look: Look) => {
    setSelectedLook(look);
    setItemSheetVisible(true);
    useAnalyticsStore.getState().trackView(look.id, look.creatorId ?? '', 'discover');
  }, []);

  const handleCloseSheet = useCallback(() => {
    setItemSheetVisible(false);
    setSelectedLook(null);
  }, []);

  const renderCard = ({ item }: { item: Look }) => {
    const likeCount = getLikeCount(item.id);
    const creatorId = item.creatorId ?? null;
    const creatorProfile = creatorId ? profiles[creatorId] : undefined;
    const brandIdentity = creatorId ? brandIdentitiesQuery.data?.[creatorId] : undefined;
    const isBrand = brandIdentity?.isPartnerBrand === true;
    // Brand-aware byline:
    //   - Partner brand → brand name (e.g. "Golden Bear Garage") + brand logo,
    //     tap routes to /storefront/<slug> (the shopper landing page).
    //   - Regular creator → @username + creator photo, tap to /creator-profile.
    //   - Fallback: real name (e.g. "Reilly Rose") if username isn't loaded yet
    //     so we never render "@Creator".
    const fullName = creatorProfile?.firstName
      ? `${creatorProfile.firstName}${creatorProfile.lastName ? ` ${creatorProfile.lastName}` : ''}`
      : '';
    const displayHandle = isBrand
      ? (brandIdentity?.brandName ?? '')
      : creatorProfile?.username
        ? `@${creatorProfile.username}`
        : fullName || '';
    const creatorPhoto = isBrand
      ? (brandIdentity?.brandLogoUrl ?? '')
      : (creatorProfile?.photoUri || '');
    const initialSeed =
      (isBrand ? brandIdentity?.brandName : null) ||
      creatorProfile?.username ||
      fullName ||
      creatorProfile?.firstName ||
      'S';
    const creatorInitial = initialSeed.toString().charAt(0).toUpperCase();
    const onBylinePress = () => {
      if (isBrand && brandIdentity?.brandSlug) {
        router.push(`/storefront/${brandIdentity.brandSlug}` as never);
      } else if (creatorId) {
        router.push({ pathname: '/creator-profile', params: { creatorId } });
      }
    };

    return (
      <Pressable
        style={styles.gridCard}
        onPress={() => handleOpenSheet(item)}
        testID={`search-card-${item.id}`}
      >
        <View style={styles.cardImageWrapper}>
          <Image
            source={{ uri: item.photoUri }}
            style={styles.gridImage}
            contentFit="cover"
          />
          {/* Creator / brand overlay at bottom */}
          <Pressable
            style={styles.creatorOverlay}
            onPress={onBylinePress}
            testID={`creator-link-${item.id}`}
            hitSlop={4}
          >
            {creatorPhoto ? (
              <Image source={{ uri: creatorPhoto }} style={styles.creatorAvatar} contentFit="cover" />
            ) : (
              <View style={styles.creatorAvatar}>
                <Text style={styles.creatorAvatarText}>{creatorInitial}</Text>
              </View>
            )}
            {displayHandle ? (
              <Text style={styles.creatorName} numberOfLines={1}>
                {displayHandle}
              </Text>
            ) : null}
          </Pressable>
        </View>
        {item.title ? (
          <Text style={styles.gridTitle} numberOfLines={1}>
            {item.title}
          </Text>
        ) : null}
        <View style={styles.gridMeta}>
          <Text style={styles.gridMetaText}>{item.items.length} items</Text>
          {likeCount > 0 ? (
            <Text style={styles.gridMetaText}>{'\u2665'} {likeCount}</Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderEmpty = () => {
    if (searchText.trim()) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>Nothing matched “{searchText}.”</Text>
          <Text style={styles.emptyCopy}>
            Try a shorter search, swap an occasion chip, or clear all
            filters to see everything in the catalog.
          </Text>
        </View>
      );
    }
    if (activeCategory !== 'All' || hasActiveFilters) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>Nothing in this slice yet.</Text>
          <Text style={styles.emptyCopy}>
            Try a different category or clear your filters — new looks land
            every week.
          </Text>
        </View>
      );
    }
    return null;
  };

  const renderFilterChipRow = (
    label: string,
    options: string[],
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
    testIdPrefix: string,
  ) => (
    <View style={styles.filterSection}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipRow}
        style={{ flexGrow: 0 }}
      >
        <Pressable
          onPress={() => setSelected([])}
          testID={`${testIdPrefix}-chip-all`}
          style={[
            styles.filterChip,
            selected.length === 0 ? styles.filterChipActive : styles.filterChipInactive,
          ]}
        >
          <Text
            style={selected.length === 0 ? styles.filterChipTextActive : styles.filterChipTextInactive}
          >
            All
          </Text>
        </Pressable>
        {options.map((option) => {
          const isActive = selected.includes(option);
          return (
            <Pressable
              key={option}
              onPress={() => toggleFilter(option, selected, setSelected)}
              testID={`${testIdPrefix}-chip-${option.replace(/\s+/g, '-')}`}
              style={[
                styles.filterChip,
                isActive ? styles.filterChipActive : styles.filterChipInactive,
              ]}
            >
              <Text style={isActive ? styles.filterChipTextActive : styles.filterChipTextInactive}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="search-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchBar}>
          <Search size={18} color="#6B5E58" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search looks, brands, items..."
            placeholderTextColor="#6B5E58"
            cursorColor="#2C2C2C"
            selectionColor="rgba(44, 44, 44, 0.3)"
            value={searchText}
            onChangeText={setSearchText}
            testID="search-input"
          />
        </View>
      </View>

      {/* Consolidated Filter Dropdowns */}
      {isLoadingCategories ? (
        <View style={{ paddingVertical: 12, alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#B87063" />
        </View>
      ) : (
        <View style={styles.dropdownRowWrapper} testID="filter-dropdowns-row">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dropdownRowContent}
            style={{ flexGrow: 0 }}
          >
            <FilterDropdown
              label="Category"
              mode="single"
              options={categories.map((c) => ({ id: c.name, name: c.name }))}
              selected={activeCategory === 'All' ? 'all' : activeCategory}
              onChange={(v) => setActiveCategory(v === 'all' ? 'All' : v)}
              testID="filter-category"
            />
            {brands.length > 0 ? (
              <FilterDropdown
                label="Brands"
                mode="single"
                options={brands.map((b) => ({ id: b, name: b }))}
                selected={activeBrand === 'All' ? 'all' : activeBrand}
                onChange={(v) => setActiveBrand(v === 'all' ? 'All' : v)}
                testID="filter-brand"
              />
            ) : null}
            <FilterDropdown
              label="Occasion"
              mode="multi"
              options={OCCASION_OPTIONS.map((o) => ({ id: o, name: o }))}
              selected={selectedOccasions}
              onChange={setSelectedOccasions}
              testID="filter-occasion"
            />
            <FilterDropdown
              label="Style"
              mode="multi"
              options={STYLE_VIBE_OPTIONS.map((o) => ({ id: o, name: o }))}
              selected={selectedStyleVibes}
              onChange={setSelectedStyleVibes}
              testID="filter-style"
            />
            <FilterDropdown
              label="Season"
              mode="multi"
              options={SEASON_OPTIONS.map((o) => ({ id: o, name: o }))}
              selected={selectedSeasons}
              onChange={setSelectedSeasons}
              testID="filter-season"
            />
          </ScrollView>
        </View>
      )}

      {/* Results Grid */}
      {discoverLooksQuery.isLoading && looks.length === 0 ? (
        <View style={{ paddingTop: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#B87063" testID="discover-loading-indicator" />
        </View>
      ) : (
      <FlatList
        data={filteredLooks}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListEmptyComponent={renderEmpty}
        // extraData forces a re-render when the profile store fills in
        // new entries so masonry cards swap @Creator → real @handle live.
        extraData={profiles}
        showsVerticalScrollIndicator={false}
        testID="search-results-list"
      />
      )}

      {/* Item List Sheet */}
      {itemSheetVisible ? (
        <ItemListSheet
          look={selectedLook}
          onClose={handleCloseSheet}
          testIDPrefix="search-item-sheet"
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#1A1210',
    height: 44,
  },
  // Dropdown row
  dropdownRowWrapper: {
    paddingVertical: 10,
  },
  dropdownRowContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Filter chip rows
  filterSection: {
    paddingBottom: 6,
  },
  filterLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  filterChipRow: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: '#B87063',
  },
  filterChipInactive: {
    backgroundColor: '#F0EBE5',
  },
  filterChipTextActive: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
  },
  filterChipTextInactive: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  // Active filter pills
  activeFiltersRow: {
    paddingVertical: 6,
  },
  activePill: {
    backgroundColor: '#B87063',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  activePillText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#FFFFFF',
  },
  clearAllText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
    textDecorationLine: 'underline',
  },
  // Grid
  gridContent: {
    paddingHorizontal: CARD_PADDING,
    paddingBottom: 20,
  },
  gridRow: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  gridCard: {
    width: CARD_WIDTH,
  },
  cardImageWrapper: {
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
  },
  gridImage: {
    width: '100%',
    aspectRatio: 2 / 3,
  },
  creatorOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  creatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#8C5A3A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  creatorAvatarText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#FFFFFF',
  },
  creatorName: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#FFFFFF',
    flex: 1,
  },
  gridTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#1A1210',
    marginTop: 6,
  },
  gridMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  gridMetaText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 6,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
  },
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 8,
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
});
