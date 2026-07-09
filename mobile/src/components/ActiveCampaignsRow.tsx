import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X } from 'lucide-react-native';
import useCampaignsStore, { type Campaign } from '@/lib/state/campaignsStore';
import { useProductInfoByAsins, type ProductInfoByAsin } from '@/lib/queries/productInfoByAsins';
import { CampaignProductSheet } from '@/components/CampaignProductSheet';
import useAuthStore from '@/lib/state/authStore';
import { supabase } from '@/lib/supabase';

const TIP_SEEN_CAMPAIGN_ADD = 'tip:seen:campaign-add';

// How many products per campaign we preview (with thumbnails) in the card.
const ASINS_PREVIEW = 6;

const TYPE_LABEL: Record<Campaign['campaignType'], string> = {
  affiliate_plus: 'Affiliate+',
  sponsored_products: 'Sponsored',
};

function daysUntil(isoDate: string): number | null {
  try {
    const end = new Date(`${isoDate}T23:59:59`);
    const ms = end.getTime() - Date.now();
    if (ms < 0) return null;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Horizontal scroll of active brand campaigns the platform has opted into.
 * Same data source as the creator-web dashboard widget — admins enter once
 * via /admin/campaigns and both surfaces render the same campaigns. Renders
 * nothing when no active campaigns exist (clean dashboard during quiet weeks).
 */
interface SelectedCampaignProduct {
  asin: string;
  product: ProductInfoByAsin | null;
  brandName: string;
}

export function ActiveCampaignsRow() {
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const fetchActive = useCampaignsStore((s) => s.fetchActive);
  const loaded = useCampaignsStore((s) => s.loaded);
  const creatorId = useAuthStore((s) => s.creatorId);
  const [selected, setSelected] = useState<SelectedCampaignProduct | null>(null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);

  const handleSelectProduct = useCallback((sel: SelectedCampaignProduct) => {
    setSelected(sel);
    setSheetVisible(true);
  }, []);

  // Tip: "Tap to tag this campaign product" — shown once, then permanently dismissed.
  // Defaults to true (seen) to avoid flash while AsyncStorage loads.
  const [campaignAddTipSeen, setCampaignAddTipSeen] = useState<boolean>(true);
  const markCampaignAddTipSeen = useCallback(() => {
    setCampaignAddTipSeen(true);
    void AsyncStorage.setItem(TIP_SEEN_CAMPAIGN_ADD, '1');
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(TIP_SEEN_CAMPAIGN_ADD);
      if (stored === '1') { setCampaignAddTipSeen(true); return; }
      // Veteran check: already saved campaign items → seed as seen.
      try {
        const { data } = await supabase
          .from('creator_items')
          .select('id')
          .ilike('url', '%campaignId=%')
          .limit(1);
        if (data && data.length > 0) {
          await AsyncStorage.setItem(TIP_SEEN_CAMPAIGN_ADD, '1');
          setCampaignAddTipSeen(true);
          return;
        }
      } catch { /* ignore */ }
      setCampaignAddTipSeen(false);
    })();
  }, []);

  useEffect(() => {
    fetchActive();
  }, [fetchActive]);

  // Category tiebreak — within the same bonus %, order by the server-computed
  // category_priority (0=clothing, 1=shoes, 2=jewelry, 3=other; null treated as
  // 3). The bucket is computed nightly via infer_department(), so this stays
  // consistent with the Brands tab and the web dashboard — no on-device
  // derivation. Effective key: commission_rate_pct DESC, COALESCE(priority,3)
  // ASC, end_date ASC.
  const sortedCampaigns = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      // 1) Highest bonus % first — unchanged primary sort.
      if (b.commissionRatePct !== a.commissionRatePct) {
        return b.commissionRatePct - a.commissionRatePct;
      }
      // 2) Category priority — clothing → shoes → jewelry → other (null = 3).
      const pa = a.categoryPriority ?? 3;
      const pb = b.categoryPriority ?? 3;
      if (pa !== pb) return pa - pb;
      // 3) Soonest end date first — existing tertiary sort (ISO dates sort
      //    lexicographically).
      return a.endDate.localeCompare(b.endDate);
    });
  }, [campaigns]);

  if (!loaded || campaigns.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>BRAND CAMPAIGNS THIS WEEK</Text>
        <Text style={styles.title}>Earn bonus commission.</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={{ flexGrow: 0 }}
        testID="active-campaigns-row"
      >
        {sortedCampaigns.map((c, cIdx) => (
          <CampaignCard
            key={c.id}
            campaign={c}
            showFirstProductTip={cIdx === 0 && !campaignAddTipSeen}
            onFirstProductTipDismiss={markCampaignAddTipSeen}
            onSelectProduct={handleSelectProduct}
          />
        ))}
      </ScrollView>

      <CampaignProductSheet
        visible={sheetVisible}
        asin={selected?.asin ?? null}
        product={selected?.product ?? null}
        brandName={selected?.brandName ?? ''}
        creatorId={creatorId}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

function CampaignCard({
  campaign,
  showFirstProductTip,
  onFirstProductTipDismiss,
  onSelectProduct,
}: {
  campaign: Campaign;
  showFirstProductTip: boolean;
  onFirstProductTipDismiss: () => void;
  onSelectProduct: (sel: SelectedCampaignProduct) => void;
}) {
  const daysLeft = daysUntil(campaign.endDate);
  const urgent = daysLeft !== null && daysLeft <= 7;
  const asinsPreview = campaign.asins.slice(0, ASINS_PREVIEW);
  const remaining = campaign.asins.length - asinsPreview.length;
  const productQuery = useProductInfoByAsins(asinsPreview);
  const productMap = productQuery.data ?? new Map<string, ProductInfoByAsin>();
  const isLoading = productQuery.isLoading;

  const handleCardPress = () => {
    if (campaign.campaignUrl) {
      Linking.openURL(campaign.campaignUrl).catch(() => {});
    }
  };

  return (
    <Pressable style={styles.card} onPress={handleCardPress} testID={`campaign-card-${campaign.id}`}>
      {/* Existing header content */}
      <View style={styles.cardTopRow}>
        {campaign.brandLogoUrl ? (
          <Image source={{ uri: campaign.brandLogoUrl }} style={styles.brandMark} contentFit="cover" />
        ) : (
          <View style={[styles.brandMark, styles.brandMarkFallback]}>
            <Text style={styles.brandMarkLetter}>{campaign.brandName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.bonusPill}>
          <Text style={styles.bonusText}>+{campaign.commissionRatePct}%</Text>
        </View>
      </View>
      <Text style={styles.brandName} numberOfLines={1}>{campaign.brandName}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaType}>{TYPE_LABEL[campaign.campaignType]}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaCount}>
          {campaign.asins.length} product{campaign.asins.length === 1 ? '' : 's'}
        </Text>
      </View>
      <Text style={[styles.daysLeft, urgent && styles.daysLeftUrgent]}>
        {daysLeft === null
          ? `Ends ${campaign.endDate}`
          : daysLeft === 0
            ? 'Ends today'
            : daysLeft === 1
              ? 'Ends tomorrow'
              : `${daysLeft} days left`}
      </Text>

      {/* Featured Products section */}
      {asinsPreview.length > 0 ? (
        <View style={styles.productsSection}>
          <View style={styles.productsDivider} />
          <Text style={styles.productsLabel}>Featured products</Text>
          {asinsPreview.map((asin, asinIdx) => {
            const product = productMap.get(asin) ?? null;
            return (
              <ProductRow
                key={asin}
                asin={asin}
                product={product}
                isLoading={isLoading}
                brandName={campaign.brandName}
                showTip={asinIdx === 0 && showFirstProductTip}
                onTipDismiss={onFirstProductTipDismiss}
                onPress={() =>
                  onSelectProduct({ asin, product, brandName: campaign.brandName })
                }
              />
            );
          })}
          {remaining > 0 ? (
            <Text style={styles.moreProducts}>
              +{remaining} more product{remaining === 1 ? '' : 's'} in this campaign
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function ProductRow({
  asin,
  product,
  isLoading,
  brandName,
  showTip,
  onTipDismiss,
  onPress,
}: {
  asin: string;
  product: ProductInfoByAsin | null;
  isLoading: boolean;
  brandName: string;
  showTip: boolean;
  onTipDismiss: () => void;
  onPress: () => void;
}) {
  const resolvedTitle = product?.product_name ?? null;

  // Existing "+ Add" behavior — routes to the tag flow. Unchanged.
  const handleAdd = () => {
    onTipDismiss();
    router.push({
      pathname: '/add-closet-item',
      params: { campaignAsin: asin },
    });
  };

  // Tapping the row body opens the preview sheet.
  const handleRowPress = () => {
    onTipDismiss();
    onPress();
  };

  return (
    <View>
      <Pressable
        style={styles.productRow}
        onPress={handleRowPress}
        testID={`product-row-${asin}`}
      >
        {/* Thumbnail */}
        {isLoading ? (
          <View style={styles.productThumbPlaceholder}>
            <ActivityIndicator size="small" color="#B87063" />
          </View>
        ) : product?.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={styles.productThumb}
            contentFit="cover"
          />
        ) : (
          <View style={styles.productThumbPlaceholder} />
        )}

        {/* Title — never the raw ASIN */}
        <View style={styles.productInfo}>
          <Text style={styles.productTitle} numberOfLines={2}>
            {resolvedTitle ?? (isLoading ? 'Loading…' : 'View on Amazon')}
          </Text>
        </View>

        {/* Add affordance — keeps the existing routing behavior */}
        <Pressable
          style={styles.addButton}
          onPress={handleAdd}
          hitSlop={6}
          testID={`product-row-add-${asin}`}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </Pressable>
      </Pressable>

      {showTip ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8E5E0', borderColor: '#E8C9C1', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, marginTop: 6 }}>
          <Text style={{ flex: 1, fontSize: 12, color: '#B87063', lineHeight: 16, fontFamily: 'DMSans_400Regular' }}>
            Tap to tag this campaign product
          </Text>
          <Pressable onPress={onTipDismiss} hitSlop={8} testID="campaign-add-tip-dismiss">
            <X size={12} color="#B87063" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginVertical: 16,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  eyebrow: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    letterSpacing: 1.6,
    color: '#B87063',
    marginBottom: 4,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  card: {
    width: 260,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F0EBE5',
  },
  brandMarkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  brandMarkLetter: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#B87063',
  },
  bonusPill: {
    backgroundColor: '#B87063',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  bonusText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#FFFFFF',
  },
  brandName: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  metaType: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  metaDot: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  metaCount: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  daysLeft: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  daysLeftUrgent: {
    color: '#B53D2A',
  },
  productsSection: {
    marginTop: 10,
  },
  productsDivider: {
    height: 1,
    backgroundColor: '#F0EBE5',
    marginBottom: 8,
  },
  productsLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#B87063',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  productThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F5F0EC',
    flexShrink: 0,
  },
  productThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F5F0EC',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productAsinLast4: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#8C8580',
    letterSpacing: 0.5,
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productTitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#1A1210',
    lineHeight: 15,
  },
  productAsinFull: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#8C8580',
    letterSpacing: 0.3,
  },
  addButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#FBF7F4',
    borderWidth: 1,
    borderColor: '#E8D8D3',
    flexShrink: 0,
  },
  addButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#B87063',
  },
  moreProducts: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: '#8C8580',
    marginTop: 4,
    fontStyle: 'italic',
  },
});
