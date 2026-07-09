import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { router } from 'expo-router';
import { Search, X, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import useAwinMerchantsStore, { type AwinMerchant } from '@/lib/state/awinMerchantsStore';
import { useActiveAwinOffersMap, shortOfferBadge, type AwinOffer } from '@/lib/queries/awinOffers';
import { useActiveAmazonCampaigns } from '@/lib/queries/amazonCampaigns';
import { AmazonWordmark } from '@/components/AmazonWordmark';

type GridItem =
  | { kind: 'amazon'; bonusCount: number }
  | { kind: 'awin'; merchant: AwinMerchant };

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 14;
const GRID_PADDING = 14;
const TILE_W = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

function commissionLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (Math.abs(min - max) < 0.01) return `${formatPct(min)} commission`;
    return `${formatPct(min)}–${formatPct(max)} commission`;
  }
  const v = (min ?? max) as number;
  return `${formatPct(v)} commission`;
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

// Seven gradient pairs in the SiM rose/cream palette — same set as web
// (creators-web/app/(dashboard)/brands/BrandsGrid.tsx) so a brand shows the
// same color whether opened on web or iOS.
const BRAND_GRADIENTS: { bg: readonly [string, string]; fg: string }[] = [
  { bg: ['#fde8e8', '#f5b7b1'], fg: '#7a2a3a' },
  { bg: ['#fef3c7', '#fbbf77'], fg: '#7c4a14' },
  { bg: ['#e0e7ff', '#a5b4fc'], fg: '#312e81' },
  { bg: ['#ecfdf5', '#6ee7b7'], fg: '#065f46' },
  { bg: ['#fdf2f8', '#f9a8d4'], fg: '#831843' },
  { bg: ['#f5f5f4', '#d6d3d1'], fg: '#44403c' },
  { bg: ['#ede9fe', '#c4b5fd'], fg: '#4c1d95' },
];

// djb2-style hash so the same brand always lands in the same bucket (visual
// continuity across launches/devices/web⇄iOS). Math.imul keeps the multiply
// in 32-bit, mirroring the stable hash used elsewhere.
function brandGradientForName(name: string): { bg: readonly [string, string]; fg: string } {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 33) ^ name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % BRAND_GRADIENTS.length;
  return BRAND_GRADIENTS[idx];
}

function MerchantLogo({ merchant }: { merchant: AwinMerchant }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const gradient = useMemo(() => brandGradientForName(merchant.name ?? ''), [merchant.name]);
  const showFallback = !merchant.logoUrl || logoFailed;
  const letter = (merchant.name?.[0] ?? '?').toUpperCase();

  return (
    <View style={styles.logoFill}>
      {/* Gradient backdrop — always rendered. Full background when the logo is
          missing/failed; a faint surface behind a loaded logo otherwise. */}
      <LinearGradient
        colors={gradient.bg}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { opacity: showFallback ? 1 : 0.18 }]}
      />
      {showFallback ? (
        <Text style={[styles.logoFallbackText, { color: gradient.fg }]}>{letter}</Text>
      ) : (
        <View style={styles.logoImagePad}>
          <Image
            source={{ uri: merchant.logoUrl! }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            onError={() => setLogoFailed(true)}
          />
        </View>
      )}
    </View>
  );
}

function MerchantCard({
  merchant,
  offer,
  onPress,
}: {
  merchant: AwinMerchant;
  offer: AwinOffer | undefined;
  onPress: () => void;
}) {
  const cLabel = commissionLabel(merchant.commissionMinPct, merchant.commissionMaxPct);
  const badge = shortOfferBadge(offer);

  return (
    <Pressable
      onPress={onPress}
      testID={`brand-card-${merchant.id}`}
      style={styles.cardPressable}
    >
      <View style={styles.card}>
        <View style={styles.logoWrapper}>
          <MerchantLogo merchant={merchant} />
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.cardTitle} numberOfLines={2}>{merchant.name}</Text>
          {merchant.primarySector ? (
            <Text style={styles.cardSector} numberOfLines={1}>{merchant.primarySector}</Text>
          ) : null}
          {cLabel ? <Text style={styles.cardMeta} numberOfLines={1}>{cLabel}</Text> : null}
          {badge ? (
            <View style={styles.offerPill}>
              <Text style={styles.offerPillText} numberOfLines={2}>{`\uD83D\uDD25 ${badge} (live!)`}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function AmazonCard({ bonusCount, onPress }: { bonusCount: number; onPress: () => void }) {
  const chipText =
    bonusCount > 0
      ? `\uD83D\uDD25 ${bonusCount} bonus ${bonusCount === 1 ? 'campaign' : 'campaigns'}`
      : null;
  return (
    <Pressable onPress={onPress} testID="brand-card-amazon" style={styles.cardPressable}>
      <View style={styles.card}>
        <View style={styles.logoWrapper}>
          <View style={styles.logoInner}>
            <AmazonWordmark width={TILE_W - 64} />
          </View>
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.cardTitle} numberOfLines={2}>Amazon Bonuses</Text>
          <Text style={styles.cardSector} numberOfLines={1}>Bonus campaigns</Text>
          {chipText ? (
            <View style={styles.offerPill}>
              <Text style={styles.offerPillText} numberOfLines={2}>{chipText}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function BrandsScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const merchants = useAwinMerchantsStore((s) => s.merchants);
  const fetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  const loaded = useAwinMerchantsStore((s) => s.loaded);

  const offersQuery = useActiveAwinOffersMap();
  const offersMap = offersQuery.data ?? new Map();

  const amazonCampaignsQuery = useActiveAmazonCampaigns();
  const amazonBonusCount = amazonCampaignsQuery.data?.count ?? 0;

  useEffect(() => {
    if (!loaded) void fetchActive();
  }, [loaded, fetchActive]);

  const [brandSearch, setBrandSearch] = useState('');

  const sortedMerchants = useMemo(() => {
    return [...(merchants ?? [])].sort((a, b) => {
      // Pinned merchants (client-side sortPriority, e.g. Amazon) come first.
      const ap = a.sortPriority ?? 0;
      const bp = b.sortPriority ?? 0;
      if (bp !== ap) return bp - ap;
      const ai = a.awinIndex ?? -1;
      const bi = b.awinIndex ?? -1;
      if (bi !== ai) return bi - ai;
      const ae = a.epc ?? -1;
      const be = b.epc ?? -1;
      return be - ae;
    });
  }, [merchants]);

  const filteredMerchants = useMemo(() => {
    if (!brandSearch.trim()) return sortedMerchants;
    const q = brandSearch.trim().toLowerCase();
    return sortedMerchants.filter((m) => {
      const name = String(m?.name ?? '').toLowerCase();
      return name.includes(q);
    });
  }, [sortedMerchants, brandSearch]);

  const showAmazon = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return true;
    return 'amazon'.includes(q);
  }, [brandSearch]);

  const gridData = useMemo<GridItem[]>(() => {
    const items: GridItem[] = [];
    // Pinned merchants (e.g. the Amazon catalog) lead the grid — before the
    // Amazon bonus-campaigns card — so they sit at the very top.
    const pinned: AwinMerchant[] = [];
    const rest: AwinMerchant[] = [];
    for (const m of filteredMerchants) {
      if ((m.sortPriority ?? 0) > 0) pinned.push(m);
      else rest.push(m);
    }
    for (const m of pinned) items.push({ kind: 'awin', merchant: m });
    if (showAmazon) items.push({ kind: 'amazon', bonusCount: amazonBonusCount });
    for (const m of rest) items.push({ kind: 'awin', merchant: m });
    return items;
  }, [filteredMerchants, showAmazon, amazonBonusCount]);

  const hasSearch = brandSearch.trim().length > 0;
  const isEmpty = gridData.length === 0 && hasSearch;

  const handleOpenBrand = useCallback((m: AwinMerchant) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push({ pathname: '/brand/[id]', params: { id: m.id } });
  }, []);

  const handleOpenAmazon = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push('/amazon-campaigns' as any);
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="brands-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Brands</Text>
        <Text style={styles.subtitle}>Tap any brand to browse their full catalog</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={18} color="#8C8580" strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            value={brandSearch}
            onChangeText={setBrandSearch}
            placeholder="Search brands"
            placeholderTextColor="#8C8580"
            cursorColor="#1A1210"
            selectionColor="rgba(26,18,16,0.3)"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            testID="brands-search-input"
          />
          {brandSearch.length > 0 ? (
            <Pressable onPress={() => setBrandSearch('')} hitSlop={8} testID="brands-search-clear">
              <X size={18} color="#8C8580" strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={gridData}
        keyExtractor={(g) => (g.kind === 'amazon' ? 'amazon' : g.merchant.id)}
        numColumns={2}
        columnWrapperStyle={{ paddingHorizontal: GRID_PADDING, gap: GRID_GAP }}
        renderItem={({ item }) => (
          item.kind === 'amazon' ? (
            <AmazonCard bonusCount={item.bonusCount} onPress={handleOpenAmazon} />
          ) : (
            <MerchantCard
              merchant={item.merchant}
              offer={offersMap.get(item.merchant.id)}
              onPress={() => handleOpenBrand(item.merchant)}
            />
          )
        )}
        contentContainerStyle={{ paddingBottom: 140, gap: GRID_GAP }}
        ListEmptyComponent={
          isEmpty ? (
            <View style={styles.empty}>
              <Text style={styles.emptyNoMatch} testID="brands-no-match">
                No brands match &ldquo;{brandSearch}&rdquo;
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Sparkles size={36} color="#C4A882" strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>No brands yet</Text>
              <Text style={styles.emptySubtitle}>Brands will appear here once they sync.</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
        testID="brands-list"
      />
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
    paddingBottom: 8,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    color: '#1A1210',
    letterSpacing: 1.5,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 2,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    height: 44,
  },
  cardPressable: {
    width: TILE_W,
  },
  card: {
    width: TILE_W,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  logoWrapper: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F7F4F0',
  },
  logoInner: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImagePad: {
    ...StyleSheet.absoluteFillObject,
    padding: 16,
  },
  logoFallbackText: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 60,
  },
  textBlock: {
    padding: 12,
    gap: 2,
  },
  cardTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 16,
    lineHeight: 20,
    color: '#1A1210',
  },
  cardSector: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
  },
  cardMeta: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#3D3330',
    marginTop: 4,
  },
  offerPill: {
    alignSelf: 'stretch',
    backgroundColor: '#B87063',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
  },
  offerPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    gap: 8,
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
  emptyNoMatch: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
