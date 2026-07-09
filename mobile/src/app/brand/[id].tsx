import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, Search, X, Plus, Check, ExternalLink } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import useAwinMerchantsStore, { type AwinMerchant } from '@/lib/state/awinMerchantsStore';
import {
  useAwinProductsByMerchant,
  useBrandDepartments,
  type AwinProduct,
  type BrandDepartment,
} from '@/lib/queries/awinProducts';
import { useAwinOffersByMerchant, type AwinOffer } from '@/lib/queries/awinOffers';
import useAuthStore from '@/lib/state/authStore';
import useContextStore from '@/lib/state/contextStore';
import useLookStore from '@/lib/state/lookStore';
import { addAwinProductToCloset } from '@/lib/awin/addFromCatalog';
import { CLICK_SOURCE } from '@/lib/analytics/source';
import { cleanProductName, cleanBrandLabel } from '@/lib/awin/cleanProductName';
import { useBrandStarterPicks, type BrandStarterPick } from '@/lib/queries/brandStarters';
import { logClickEvent } from '@/lib/analytics/clickEvents';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 14;
const GRID_PADDING = 14;
const TILE_W = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// Stable key for the "already added" comparison between a catalog product and a
// closet item. Both sides store the same URL verbatim (add writes
// creator_items.url = product.productUrl), so we key on the FULL URL — host,
// path AND query string.
//
// The query string is essential: every Rakuten merchant (COUTR, Bloomingdale's,
// Zulily, Diesel US, Champion, Vera Bradley, Sam Edelman) wraps each product in
// an identical click.linksynergy.com/link URL that differs ONLY in the `offerid`
// query param. Dropping the query (matching by host/path/origin) collapsed every
// product in the brand to one key, so adding a single item marked the whole brand
// "Added". Query params are sorted so param-order differences never cause a false
// mismatch. Amazon/Awin/DTC URLs already differ by host+path, so they're
// unaffected — this is strictly more precise, never less.
function normalizeAddKey(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
    const params = new URLSearchParams(parsed.search);
    params.sort();
    const query = params.toString();
    return query ? `${host}${path}?${query}` : `${host}${path}`;
  } catch {
    return u.toLowerCase();
  }
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

function commissionLine(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (Math.abs(min - max) < 0.01) return `${formatPct(min)} commission`;
    return `${formatPct(min)}–${formatPct(max)} commission`;
  }
  const v = (min ?? max) as number;
  return `${formatPct(v)} commission`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function MerchantHeader({ merchant }: { merchant: AwinMerchant }) {
  const cLine = commissionLine(merchant.commissionMinPct, merchant.commissionMaxPct);
  const metaLine = cLine ?? '';
  return (
    <View style={styles.merchantHeader}>
      <View style={styles.logoBox}>
        {merchant.logoUrl ? (
          <Image source={{ uri: merchant.logoUrl }} style={styles.logoImg} contentFit="contain" />
        ) : (
          <Text style={styles.logoLetter}>{(merchant.name?.[0] ?? '?').toUpperCase()}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.merchantName} numberOfLines={1}>{merchant.name}</Text>
        {merchant.primarySector ? (
          <Text style={styles.merchantSector} numberOfLines={1}>{merchant.primarySector}</Text>
        ) : null}
        {metaLine ? <Text style={styles.merchantMeta} numberOfLines={2}>{metaLine}</Text> : null}
      </View>
    </View>
  );
}

function OfferBanner({ offer }: { offer: AwinOffer }) {
  const ends = formatDate(offer.endDate);
  return (
    <View style={styles.offerBanner} testID="brand-offer-banner">
      <Text style={styles.offerTitle}>{`\uD83D\uDD25 ${offer.title || 'Active offer'}`}</Text>
      {offer.voucherCode ? (
        <Text style={styles.offerBody}>
          Use code <Text style={styles.offerCode}>{offer.voucherCode}</Text> at checkout
        </Text>
      ) : offer.description ? (
        <Text style={styles.offerBody} numberOfLines={2}>{offer.description}</Text>
      ) : null}
      {ends ? <Text style={styles.offerEnds}>{`Ends ${ends}`}</Text> : null}
    </View>
  );
}

function BrandStartersRow({
  picks,
  onPress,
}: {
  picks: BrandStarterPick[];
  onPress: (pick: BrandStarterPick) => void;
}) {
  if (picks.length === 0) return null;
  return (
    <View style={styles.startersWrap} testID="brand-starters-row">
      <Text style={styles.startersLabel}>BRAND STARTERS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.startersScrollContent}
        style={styles.startersScroll}
      >
        {picks.map((p) => {
          const photo = p.primary_image_url ?? p.lifestyle_image_url ?? p.image_urls?.[0] ?? null;
          return (
            <Pressable
              key={p.product_id_in_feed}
              onPress={() => onPress(p)}
              style={styles.starterCard}
              testID={`brand-starter-tap-${p.product_id_in_feed}`}
            >
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={styles.starterImage}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.starterImage, styles.starterPlaceholder]}>
                  <Text style={{ fontSize: 24 }}>🛍️</Text>
                </View>
              )}
              {p.tier === 'lifestyle' ? (
                <View style={styles.starterTierBadge}>
                  <Text style={styles.starterTierText}>LIFESTYLE</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function DepartmentChipsRow({
  departments,
  selected,
  onSelect,
}: {
  departments: BrandDepartment[];
  selected: string | null;
  onSelect: (dept: string | null) => void;
}) {
  if (departments.length === 0) return null;
  const totalCount = departments.reduce((sum, d) => sum + (d.count ?? 0), 0);
  return (
    <View style={styles.chipsWrap} testID="brand-department-chips">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScrollContent}
        style={styles.chipsScroll}
      >
        <Pressable
          onPress={() => onSelect(null)}
          style={[styles.chip, selected === null && styles.chipActive]}
          testID="brand-department-chip-all"
        >
          <Text style={[styles.chipText, selected === null && styles.chipTextActive]}>
            {totalCount > 0 ? `All (${totalCount.toLocaleString()})` : 'All'}
          </Text>
        </Pressable>
        {departments.map((d) => {
          const active = selected === d.department;
          return (
            <Pressable
              key={d.department}
              onPress={() => onSelect(active ? null : d.department)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`brand-department-chip-${d.department.toLowerCase()}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {`${d.department} (${d.count.toLocaleString()})`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ProductTile({
  product,
  adding,
  added,
  brandLabel,
  displayName,
  onAdd,
  onOpen,
}: {
  product: AwinProduct;
  adding: boolean;
  added: boolean;
  brandLabel: string;
  displayName: string;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const rawPhoto = product.imageUrls?.[0];
  const photo = typeof rawPhoto === 'string' && rawPhoto.trim().length > 0 ? rawPhoto : null;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.92 }]}
      testID={`brand-product-tap-${product.id}`}
    >
      <View style={styles.imageWrapper}>
        {photo ? (
          <View style={styles.imageInner}>
            <Image
              source={{ uri: photo }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
            />
          </View>
        ) : (
          <View style={[styles.imageInner, styles.tilePlaceholder]}>
            <Text style={{ fontSize: 32 }}>🛍️</Text>
          </View>
        )}
        {adding ? (
          <View style={styles.tileOverlay}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.tileOverlayText}>Adding…</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.textBlock}>
        {brandLabel ? (
          <Text
            style={[styles.brandLabel, { fontFamily: 'DMSans_500Medium' }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {brandLabel}
          </Text>
        ) : null}
        <Text
          style={[styles.title, { fontFamily: 'DMSans_500Medium' }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {displayName}
        </Text>
        <View style={styles.bottomRow}>
          <Text style={[styles.price, { fontFamily: 'DMSans_400Regular' }]} numberOfLines={1}>
            {product.price != null ? `$${product.price.toFixed(2)}` : ' '}
          </Text>
          <Pressable
            onPress={onAdd}
            disabled={adding || added}
            hitSlop={8}
            className={
              added
                ? 'bg-white rounded-full px-3 py-1.5 flex-row items-center justify-center border border-[#B87063] active:opacity-85'
                : 'bg-[#B87063] rounded-full px-3 py-1.5 flex-row items-center justify-center active:opacity-85'
            }
            style={(adding || added) ? { opacity: 0.85 } : undefined}
            testID={`brand-product-add-${product.id}`}
          >
            {added ? (
              <>
                <Check size={12} color="#B87063" strokeWidth={2.5} />
                <Text
                  className="ml-1 text-[#B87063] text-[12px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Added
                </Text>
              </>
            ) : (
              <>
                <Plus size={12} color="#FFFFFF" strokeWidth={2.5} />
                <Text
                  className="ml-1 text-white text-[12px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Add
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

export default function BrandCatalogScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const merchantId = String(id ?? '');

  const merchants = useAwinMerchantsStore((s) => s.merchants);
  const fetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  const loaded = useAwinMerchantsStore((s) => s.loaded);
  const merchant = useMemo(() => merchants.find((m) => m.id === merchantId) ?? null, [merchants, merchantId]);
  const creatorId = useAuthStore((s) => s.creatorId);

  useEffect(() => {
    if (!loaded) void fetchActive();
  }, [loaded, fetchActive]);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const productsQuery = useAwinProductsByMerchant(merchantId, debouncedSearch, selectedDepartment);
  const offersQuery = useAwinOffersByMerchant(merchantId);
  const departmentsQuery = useBrandDepartments(merchantId);
  const departments = departmentsQuery.data ?? [];
  const startersQuery = useBrandStarterPicks(merchantId, 12);
  const starterPicks = startersQuery.data ?? [];

  const allProducts = useMemo(() => {
    const seen = new Set<string>();
    return (productsQuery.data?.pages ?? []).flat().filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [productsQuery.data]);

  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Build a Set of full-URL keys already in the creator's closet so we can flip
  // Add → Added without an extra round-trip. Keyed by normalizeAddKey (full URL
  // incl. query string) so Rakuten click-wrapped products — identical except for
  // the `offerid` query param — don't all collapse to one key.
  const closetItems = useLookStore((s) => s.closetItems);
  const closetUrlSet = useMemo(() => {
    const set = new Set<string>();
    for (const it of closetItems) {
      const key = normalizeAddKey(it.link);
      if (key) set.add(key);
    }
    return set;
  }, [closetItems]);

  const isProductAdded = useCallback((product: AwinProduct): boolean => {
    const key = normalizeAddKey(product.productUrl);
    return key ? closetUrlSet.has(key) : false;
  }, [closetUrlSet]);

  const clickThroughUrl = merchant?.clickThroughUrl ?? null;
  const handleVisitWebsite = useCallback(async () => {
    if (!clickThroughUrl) return;
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    void logClickEvent({
      lookId: null,
      itemId: null,
      creatorId: null,
      itemUrl: clickThroughUrl,
      redirectUrl: clickThroughUrl,
      wasAffiliated: true,
      affiliateNetwork: 'awin',
    });
    // Open the brand's site IN-APP (web-shop) with a pinned "Add to Closet"
    // button, instead of kicking out to Safari. The creator can browse and
    // one-tap save any product page — no copy/paste, no app switch.
    router.push({
      pathname: '/web-shop',
      params: { url: clickThroughUrl, brand: merchant?.name ?? '' },
    });
  }, [clickThroughUrl, merchant?.name]);

  const openInBrowser = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('[brand/[id]] openBrowserAsync failed:', e);
    }
  }, []);

  // Build the /api/shop URL for a brand-catalog product. We pass the RAW
  // merchant product URL (productUrl) — its host is an affiliate_merchants row,
  // so it clears the backend's open-redirect guard; the backend then logs the
  // click (look_id=null, source=ios) and wraps it to a commissionable deeplink.
  // (The wrapped deepLink host like awin1.com/linksynergy is NOT a merchant, so
  // sending it would fail the guard — always send the raw URL.)
  const buildShopUrl = useCallback((rawProductUrl: string | null | undefined): string | null => {
    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    if (!baseUrl || !rawProductUrl) return null;
    const creatorParam = creatorId ? `&creatorId=${encodeURIComponent(creatorId)}` : '';
    return `${baseUrl}/api/shop?url=${encodeURIComponent(rawProductUrl)}&source=${CLICK_SOURCE}${creatorParam}`;
  }, [creatorId]);

  const handleOpenProduct = useCallback((product: AwinProduct) => {
    const shopUrl = buildShopUrl(product.productUrl);
    if (shopUrl) {
      // Server-side logging happens in /api/shop — don't double-log here.
      void openInBrowser(shopUrl);
      return;
    }
    // Fallback (no backend URL / no raw product URL): open directly and log
    // the click on the client, matching the previous behavior.
    const originalUrl = product.productUrl ?? product.deepLink ?? null;
    const redirectUrl = product.deepLink ?? product.productUrl ?? null;
    if (!redirectUrl) return;
    void logClickEvent({
      lookId: null,
      itemId: null,
      creatorId: null,
      itemUrl: originalUrl ?? redirectUrl,
      redirectUrl,
      wasAffiliated: !!product.deepLink,
      affiliateNetwork: product.deepLink ? 'awin' : null,
    });
    void openInBrowser(redirectUrl);
  }, [openInBrowser, buildShopUrl]);

  const handleOpenStarter = useCallback((pick: BrandStarterPick) => {
    const shopUrl = buildShopUrl(pick.product_url);
    if (shopUrl) {
      void openInBrowser(shopUrl);
      return;
    }
    const originalUrl = pick.product_url ?? pick.awin_deep_link ?? null;
    const redirectUrl = pick.awin_deep_link ?? pick.product_url ?? null;
    if (!redirectUrl) return;
    void logClickEvent({
      lookId: null,
      itemId: null,
      creatorId: null,
      itemUrl: originalUrl ?? redirectUrl,
      redirectUrl,
      wasAffiliated: !!pick.awin_deep_link,
      affiliateNetwork: pick.awin_deep_link ? 'awin' : null,
    });
    void openInBrowser(redirectUrl);
  }, [openInBrowser, buildShopUrl]);

  const handleAdd = useCallback(async (product: AwinProduct) => {
    if (!merchant || !creatorId) {
      setToast('Sign in to add items');
      setTimeout(() => setToast(null), 1800);
      return;
    }
    // Already in closet — emit a haptic but skip the insert.
    if (isProductAdded(product)) {
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      setToast('Already in your closet');
      setTimeout(() => setToast(null), 1500);
      return;
    }
    setAdding((s) => ({ ...s, [product.id]: true }));
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    // Brand storefront context: when the stylist has switched into a brand,
    // Awin-catalog adds save under the brand's closet so commissions route
    // through the brand's affiliate clickref.
    const writeAs = useContextStore.getState().getWriteAsCreatorId() ?? creatorId;
    const res = await addAwinProductToCloset({ product, merchant, creatorId: writeAs });
    setAdding((s) => ({ ...s, [product.id]: false }));
    if (res.ok) {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      setToast('Added to closet');
    } else {
      setToast('Could not add — try again');
    }
    setTimeout(() => setToast(null), 1800);
  }, [merchant, creatorId, isProductAdded]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  if (!merchant) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="brand-screen">
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} testID="brand-back">
            <ChevronLeft size={26} color="#1A1210" />
          </Pressable>
          <Text style={styles.topBarTitle}>Brand</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <ActivityIndicator color="#B87063" />
          <Text style={{ marginTop: 12, fontFamily: 'DMSans_400Regular', color: '#6B5E58' }}>
            Loading brand…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const activeOffer = (offersQuery.data ?? [])[0] ?? null;
  const showEmptyState = !productsQuery.isLoading && allProducts.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="brand-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="brand-back">
          <ChevronLeft size={26} color="#1A1210" />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>{merchant.name}</Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={allProducts}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ paddingHorizontal: GRID_PADDING, gap: GRID_GAP }}
        contentContainerStyle={{ paddingBottom: 80 + insets.bottom, gap: GRID_GAP }}
        renderItem={({ item }) => (
          <ProductTile
            product={item}
            adding={!!adding[item.id]}
            added={isProductAdded(item)}
            brandLabel={cleanBrandLabel(item.brand, merchant.name)}
            displayName={cleanProductName(item.name)}
            onAdd={() => handleAdd(item)}
            onOpen={() => handleOpenProduct(item)}
          />
        )}
        ListHeaderComponent={
          <View>
            <MerchantHeader merchant={merchant} />
            {clickThroughUrl ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                <Pressable
                  onPress={handleVisitWebsite}
                  className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                  style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
                  testID="visit-merchant-website"
                >
                  <ExternalLink size={16} color="#FFFFFF" />
                  <Text
                    className="ml-2 text-white text-[15px] font-semibold"
                    style={{ fontFamily: 'DMSans_500Medium' }}
                  >
                    {`Visit ${merchant.name} website`}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {activeOffer ? <OfferBanner offer={activeOffer} /> : null}
            <DepartmentChipsRow
              departments={departments}
              selected={selectedDepartment}
              onSelect={setSelectedDepartment}
            />
            <View style={styles.searchWrap}>
              <View style={styles.searchBar}>
                <Search size={18} color="#8C8580" strokeWidth={2} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder={`Search ${merchant.name}…`}
                  placeholderTextColor="#8C8580"
                  cursorColor="#1A1210"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  testID="brand-search-input"
                />
                {search.length > 0 ? (
                  <Pressable onPress={() => setSearch('')} hitSlop={8} testID="brand-search-clear">
                    <X size={18} color="#8C8580" strokeWidth={2} />
                  </Pressable>
                ) : null}
              </View>
            </View>
            {starterPicks.length > 0 ? (
              <BrandStartersRow picks={starterPicks} onPress={handleOpenStarter} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          productsQuery.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#B87063" />
              <Text style={styles.loadingText}>Loading products…</Text>
            </View>
          ) : (selectedDepartment !== null || debouncedSearch.trim().length > 0) ? (
            <View style={styles.loading} testID="brand-filter-empty">
              <Text style={styles.emptyTitle}>No matching products</Text>
              <Text style={styles.emptySubtitle}>
                {`No matching products in ${selectedDepartment ?? 'this brand'}. Try a different department or clear search.`}
              </Text>
              <Pressable
                onPress={() => {
                  setSelectedDepartment(null);
                  setSearch('');
                }}
                className="bg-[#B87063] rounded-full py-3 px-5 flex-row items-center justify-center active:opacity-85 mt-3"
                testID="brand-clear-filters"
              >
                <Text
                  className="text-white text-[14px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Clear filters
                </Text>
              </Pressable>
            </View>
          ) : showEmptyState ? (
            <View style={styles.emptyCard} testID="merchant-empty-state">
              <Text style={styles.emptyEmoji}>{`\uD83D\uDECD\uFE0F`}</Text>
              <Text style={styles.emptyCardTitle}>
                {`${merchant.name} catalog isn't synced yet.`}
              </Text>
              <Text style={styles.emptyCardBody}>
                {`Tap 'Visit website' above to browse their site right here, then tap 'Add to Closet' on any piece you love — we'll pull in the details for you.`}
              </Text>
            </View>
          ) : (
            <View style={styles.loading}>
              <Text style={styles.emptyTitle}>No products</Text>
              <Text style={styles.emptySubtitle}>
                This brand doesn&apos;t have any in-stock products yet.
              </Text>
            </View>
          )
        }
        onEndReached={() => {
          if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage) {
            productsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          productsQuery.isFetchingNextPage ? (
            <View style={{ paddingVertical: 18 }}>
              <ActivityIndicator color="#B87063" />
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
        testID="brand-products-grid"
      />

      {toast ? (
        <View style={[styles.toast, { bottom: 32 + insets.bottom }]} testID="brand-toast">
          <Text style={styles.toastText}>{toast}</Text>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topBarTitle: {
    flex: 1,
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
  },
  merchantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EDE6DF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: 60, height: 60 },
  logoLetter: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 30,
    color: '#B87063',
  },
  merchantName: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  merchantSector: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  merchantMeta: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#3D3330',
    marginTop: 4,
  },
  // Offer banner
  offerBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(184,112,99,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(184,112,99,0.35)',
  },
  offerTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  offerBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#3D3330',
    marginTop: 4,
  },
  offerCode: {
    fontFamily: 'DMSans_500Medium',
    color: '#B87063',
  },
  offerEnds: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 4,
  },
  chipsWrap: {
    paddingTop: 4,
    paddingBottom: 10,
  },
  chipsScroll: {
    flexGrow: 0,
  },
  chipsScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  chipActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  chipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 42,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    height: 42,
  },
  // Tile grid — closet ItemCard-style
  tile: {
    width: TILE_W,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  imageWrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F7F4F0',
  },
  imageInner: {
    flex: 1,
    padding: 8,
  },
  tilePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0EBE5',
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,18,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tileOverlayText: {
    fontFamily: 'DMSans_500Medium',
    color: '#FFFFFF',
    fontSize: 12,
  },
  textBlock: {
    padding: 12,
  },
  brandLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: '#6B5E58',
  },
  title: {
    marginTop: 4,
    fontSize: 14,
    color: '#1A1210',
  },
  bottomRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: 12,
    color: '#6B5E58',
  },
  loading: {
    paddingTop: 60,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontFamily: 'DMSans_400Regular',
    color: '#6B5E58',
    fontSize: 13,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  emptySubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EDE6DF',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyCardTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyCardBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 19,
  },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(26,18,16,0.92)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startersWrap: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  startersLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#B87063',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  startersScroll: {
    flexGrow: 0,
    height: 144,
  },
  startersScrollContent: {
    paddingHorizontal: 16,
    gap: 12,
    alignItems: 'center',
  },
  starterCard: {
    width: 140,
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EDE6DF',
    backgroundColor: '#FFFFFF',
    position: 'relative',
  },
  starterImage: {
    width: '100%',
    height: '100%',
  },
  starterPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterTierBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(184,112,99,0.92)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  starterTierText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 9,
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
  },
});
