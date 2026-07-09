import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import { ChevronLeft, Check, Plus } from 'lucide-react-native';
import PillButton from '@/components/PillButton';
import * as Haptics from 'expo-haptics';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { useActiveAmazonCampaigns, type AmazonCampaign } from '@/lib/queries/amazonCampaigns';
import { useProductInfoByAsins, type ProductInfoByAsin } from '@/lib/queries/productInfoByAsins';
import { addAmazonCampaignProductToCloset } from '@/lib/amazon/addCampaignProductToCloset';
import { CampaignProductSheet } from '@/components/CampaignProductSheet';
import useAuthStore from '@/lib/state/authStore';
import useContextStore from '@/lib/state/contextStore';

const AMAZON_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Amazon_logo.svg/2560px-Amazon_logo.svg.png';

const TYPE_LABEL: Record<AmazonCampaign['campaign_type'], string> = {
  affiliate_plus: 'Affiliate+',
  sponsored_products: 'Sponsored',
};

type AddState = 'idle' | 'adding' | 'added' | 'error';

function daysLeft(endDate: string | null): { text: string; urgent: boolean; veryUrgent: boolean } {
  if (!endDate) return { text: 'Ongoing', urgent: false, veryUrgent: false };
  const end = new Date(`${endDate}T23:59:59`);
  const ms = end.getTime() - Date.now();
  if (ms < 0) return { text: 'Ended', urgent: true, veryUrgent: true };
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return { text: '⏰ Ends today', urgent: true, veryUrgent: true };
  if (days === 1) return { text: '⏰ Ends tomorrow', urgent: true, veryUrgent: true };
  if (days <= 2) return { text: `⏰ ${days} days left`, urgent: true, veryUrgent: true };
  if (days <= 7) return { text: `${days} days left`, urgent: true, veryUrgent: false };
  return { text: `${days} days left`, urgent: false, veryUrgent: false };
}

const PRODUCTS_PREVIEW = 6;

export interface SelectedCampaignProduct {
  asin: string;
  product: ProductInfoByAsin | null;
  brandName: string;
}

function CampaignProductRow({
  asin,
  product,
  isLoading,
  brandName,
  onPress,
}: {
  asin: string;
  product: ProductInfoByAsin | null;
  isLoading: boolean;
  brandName: string;
  onPress: () => void;
}) {
  const resolvedTitle = product?.product_name ?? null;
  return (
    <Pressable
      style={styles.productRow}
      onPress={onPress}
      testID={`amazon-campaign-product-${asin}`}
    >
      {isLoading ? (
        <View style={[styles.productThumb, styles.productThumbPlaceholder, styles.productThumbCenter]}>
          <ActivityIndicator size="small" color="#B87063" />
        </View>
      ) : product?.image_url ? (
        <Image source={{ uri: product.image_url }} style={styles.productThumb} contentFit="cover" />
      ) : (
        <View style={[styles.productThumb, styles.productThumbPlaceholder]} />
      )}
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={2}>
          {resolvedTitle ?? (isLoading ? 'Loading…' : 'View on Amazon')}
        </Text>
        <Text style={styles.productSubtle}>{brandName}</Text>
      </View>
    </Pressable>
  );
}

function CampaignCard({
  campaign,
  addState,
  onAdd,
  onSelectProduct,
}: {
  campaign: AmazonCampaign;
  addState: AddState;
  onAdd: () => void;
  onSelectProduct: (sel: SelectedCampaignProduct) => void;
}) {
  const cd = daysLeft(campaign.end_date);
  const initial = (campaign.brand_name?.[0] ?? '?').toUpperCase();
  const productCount = campaign.asins.length;
  const previewAsins = campaign.asins.slice(0, PRODUCTS_PREVIEW);
  const productQuery = useProductInfoByAsins(previewAsins);
  const productMap = productQuery.data ?? new Map<string, ProductInfoByAsin>();
  const isLoading = productQuery.isLoading;
  const remaining = productCount - previewAsins.length;

  // If the brand has no logo, fall back to the first resolved product image.
  const firstProductImage = previewAsins
    .map((a) => productMap.get(a)?.image_url)
    .find((url): url is string => !!url) ?? null;
  const brandMarkImage = campaign.brand_logo_url ?? firstProductImage;

  return (
    <View style={styles.card} testID={`amazon-campaign-${campaign.id}`}>
      <View style={styles.cardTopRow}>
        {brandMarkImage ? (
          <Image source={{ uri: brandMarkImage }} style={styles.brandMark} contentFit="cover" />
        ) : (
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkLetter}>{initial}</Text>
          </View>
        )}
        <View style={styles.bonusPill}>
          <Text style={styles.bonusText}>+{campaign.commission_rate_pct}%</Text>
        </View>
      </View>

      <Text style={styles.brandName} numberOfLines={2}>{campaign.brand_name}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{TYPE_LABEL[campaign.campaign_type]}</Text>
        <Text style={styles.metaText}>·</Text>
        <Text style={styles.metaText}>
          {productCount} product{productCount === 1 ? '' : 's'}
        </Text>
      </View>

      <Text
        style={[
          styles.daysLeft,
          cd.urgent && styles.daysLeftUrgent,
          cd.veryUrgent && styles.daysLeftVeryUrgent,
        ]}
      >
        {cd.text}
      </Text>

      {previewAsins.length > 0 ? (
        <View style={styles.productsSection}>
          <View style={styles.productsDivider} />
          <View style={styles.productsHeaderRow}>
            <Text style={styles.productsLabel}>
              {previewAsins.length === 1 ? 'Featured product' : 'Featured products'}
            </Text>
            <PillButton
              label={addState === 'added' ? 'Added' : 'Add'}
              variant="outline"
              size="sm"
              loading={addState === 'adding'}
              disabled={addState === 'adding' || addState === 'added'}
              icon={addState === 'added' ? <Check size={14} color="#B87063" strokeWidth={2.5} /> : <Plus size={14} color="#B87063" />}
              onPress={onAdd}
              testID={`amazon-campaign-add-${campaign.id}`}
            />
          </View>
          {previewAsins.map((asin) => {
            const product = productMap.get(asin) ?? null;
            return (
              <CampaignProductRow
                key={asin}
                asin={asin}
                product={product}
                isLoading={isLoading}
                brandName={campaign.brand_name}
                onPress={() =>
                  onSelectProduct({ asin, product, brandName: campaign.brand_name })
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
    </View>
  );
}

export default function AmazonCampaignsScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const insets = useSafeAreaInsets();
  const query = useActiveAmazonCampaigns();
  const creatorId = useAuthStore((s) => s.creatorId);

  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedCampaignProduct | null>(null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  const handleAdd = useCallback(
    async (campaign: AmazonCampaign) => {
      if (!creatorId) {
        showToast('Sign in to add items');
        return;
      }
      setAddStates((s) => ({ ...s, [campaign.id]: 'adding' }));
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      // Add to the active context's closet (brand storefront when in storefront
      // mode, otherwise the human's own closet).
      const writeAs = useContextStore.getState().getWriteAsCreatorId() ?? creatorId;
      const res = await addAmazonCampaignProductToCloset({ campaign, creatorId: writeAs });
      if (res.ok) {
        setAddStates((s) => ({ ...s, [campaign.id]: 'added' }));
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
        showToast('Added to closet');
      } else {
        setAddStates((s) => ({ ...s, [campaign.id]: 'idle' }));
        showToast('Could not add — try again');
      }
    },
    [creatorId, showToast],
  );

  const handleSelectProduct = useCallback((sel: SelectedCampaignProduct) => {
    setSelected(sel);
    setSheetVisible(true);
  }, []);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  const campaigns = query.data?.campaigns ?? [];
  const isLoading = query.isLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="amazon-campaigns-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="amazon-campaigns-back">
          <ChevronLeft size={26} color="#B87063" />
        </Pressable>
        <View style={styles.topBarLogoWrap}>
          <Image
            source={{ uri: AMAZON_LOGO_URL }}
            style={{ width: 80, height: 24 }}
            contentFit="contain"
          />
        </View>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.header}>
        <Text style={styles.title}>Amazon Bonus Campaigns</Text>
        <Text style={styles.subtitle}>Brands running boosted commission on select items</Text>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={campaigns}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <CampaignCard
            campaign={item}
            addState={addStates[item.id] ?? 'idle'}
            onAdd={() => handleAdd(item)}
            onSelectProduct={handleSelectProduct}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 + insets.bottom, gap: 12 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#B87063" />
              <Text style={styles.loadingText}>Loading campaigns…</Text>
            </View>
          ) : (
            <View style={styles.empty} testID="amazon-campaigns-empty">
              <Text style={styles.emptyTitle}>No active campaigns</Text>
              <Text style={styles.emptyBody}>
                No active Amazon bonus campaigns right now. Check back soon.
              </Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
        testID="amazon-campaigns-list"
      />

      {toast ? (
        <View style={[styles.toast, { bottom: 32 + insets.bottom }]} testID="amazon-campaigns-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <CampaignProductSheet
        visible={sheetVisible}
        asin={selected?.asin ?? null}
        product={selected?.product ?? null}
        brandName={selected?.brandName ?? ''}
        creatorId={creatorId}
        onClose={() => setSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topBarLogoWrap: {
    flex: 1,
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
    letterSpacing: 0.8,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 14,
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
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
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  metaText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  daysLeft: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
  },
  daysLeftUrgent: {
    color: '#B53D2A',
  },
  daysLeftVeryUrgent: {
    color: '#8C3A2C',
  },
  productsSection: {
    marginTop: 12,
  },
  productsDivider: {
    height: 1,
    backgroundColor: '#F0EBE5',
    marginBottom: 10,
  },
  productsLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#B87063',
    textTransform: 'uppercase',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  productThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#F5F0EC',
    flexShrink: 0,
  },
  productThumbPlaceholder: {
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  productThumbCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productTitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#1A1210',
    lineHeight: 16,
  },
  productSubtle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 2,
  },
  productsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  moreProducts: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 6,
    fontStyle: 'italic',
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FBF7F4',
    borderWidth: 1,
    borderColor: '#E8D8D3',
    minWidth: 64,
  },
  addPillAdded: {
    borderColor: '#B87063',
    backgroundColor: '#FBF1ED',
  },
  addPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
  },
  addPillTextAdded: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
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
  empty: {
    marginHorizontal: 8,
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginBottom: 8,
  },
  emptyBody: {
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
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
  },
});
