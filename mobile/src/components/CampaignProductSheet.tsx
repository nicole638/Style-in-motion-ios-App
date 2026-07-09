import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { ShoppingBag, Plus, Check, X } from 'lucide-react-native';
import type { ProductInfoByAsin } from '@/lib/queries/productInfoByAsins';
import { addAmazonCampaignProductToCloset } from '@/lib/amazon/addCampaignProductToCloset';
import useContextStore from '@/lib/state/contextStore';
import { CLICK_SOURCE } from '@/lib/analytics/source';

interface CampaignProductSheetProps {
  visible: boolean;
  asin: string | null;
  product: ProductInfoByAsin | null;
  brandName: string;
  creatorId: string | null;
  onClose: () => void;
}

type AddState = 'idle' | 'adding' | 'added' | 'error';

/**
 * Lightweight tappable preview for a single Amazon campaign product. Renders a
 * large image, the product name (brand fallback), price, and two pills:
 *   - Shop on Amazon → /api/shop?url=… (creator-tagged redirect + click log)
 *   - Add to closet  → inserts THIS asin via addAmazonCampaignProductToCloset
 *
 * Deliberately NOT routed through ItemDetailSheet — that component is closet/
 * look-specific and far heavier than this read-only preview needs.
 */
export function CampaignProductSheet({
  visible,
  asin,
  product,
  brandName,
  creatorId,
  onClose,
}: CampaignProductSheetProps) {
  const [addState, setAddState] = useState<AddState>('idle');

  // Reset the add state whenever a different product is shown.
  React.useEffect(() => {
    setAddState('idle');
  }, [asin]);

  const title = product?.product_name ?? brandName;
  const imageUrl = product?.image_url ?? null;
  const price = product?.price ?? null;

  const handleShop = useCallback(async () => {
    if (!asin) return;
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    const productUrl = product?.product_url ?? `https://www.amazon.com/dp/${asin}`;
    // Always go through /api/shop so the redirect carries the creator tag and
    // logs the click server-side. Never build a direct amazon.com link.
    const shopUrl = `${baseUrl}/api/shop?url=${encodeURIComponent(productUrl)}&source=${CLICK_SOURCE}${
      creatorId ? `&creatorId=${encodeURIComponent(creatorId)}` : ''
    }`;
    await WebBrowser.openBrowserAsync(shopUrl, {
      toolbarColor: '#B87063',
      controlsColor: '#FFFFFF',
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
      dismissButtonStyle: 'done',
    });
  }, [asin, product, creatorId]);

  const handleAdd = useCallback(async () => {
    if (!asin || addState === 'adding' || addState === 'added') return;
    const writeAs = useContextStore.getState().getWriteAsCreatorId() ?? creatorId;
    if (!writeAs) {
      setAddState('error');
      return;
    }
    setAddState('adding');
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    const res = await addAmazonCampaignProductToCloset({
      creatorId: writeAs,
      asin,
      product: {
        asin,
        product_name: product?.product_name ?? null,
        image_url: product?.image_url ?? null,
        product_url: product?.product_url ?? `https://www.amazon.com/dp/${asin}`,
      },
    });
    if (res.ok) {
      setAddState('added');
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    } else {
      setAddState('idle');
    }
  }, [asin, product, creatorId, addState]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="campaign-product-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />
          <Pressable
            style={styles.closeX}
            onPress={onClose}
            hitSlop={10}
            testID="campaign-product-close"
          >
            <X size={20} color="#6B5E58" />
          </Pressable>

          <View style={styles.previewWrap}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.preview} contentFit="cover" />
            ) : (
              <View style={[styles.preview, styles.previewPlaceholder]} />
            )}
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.brand}>{brandName}</Text>
          {price !== null ? <Text style={styles.price}>${price}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={handleShop}
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
              testID="campaign-product-shop"
            >
              <ShoppingBag size={16} color="#FFFFFF" />
              <Text className="ml-2 text-white text-[15px]" style={{ fontFamily: 'DMSans_500Medium' }}>
                Shop on Amazon
              </Text>
            </Pressable>

            <Pressable
              onPress={handleAdd}
              disabled={addState === 'adding' || addState === 'added'}
              className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              style={addState === 'adding' || addState === 'added' ? { opacity: 0.6 } : null}
              testID="campaign-product-add"
            >
              {addState === 'adding' ? (
                <ActivityIndicator size="small" color="#1A1210" />
              ) : addState === 'added' ? (
                <Check size={16} color="#1A1210" strokeWidth={2.5} />
              ) : (
                <Plus size={16} color="#1A1210" />
              )}
              <Text className="ml-2 text-[#1A1210] text-[15px]" style={{ fontFamily: 'DMSans_500Medium' }}>
                {addState === 'added' ? 'Added to closet' : 'Add to closet'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginBottom: 8,
  },
  closeX: {
    position: 'absolute',
    top: 14,
    right: 16,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F0EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewWrap: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  preview: {
    width: 220,
    height: 220,
    borderRadius: 16,
    backgroundColor: '#F5F0EC',
  },
  previewPlaceholder: {
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    textAlign: 'center',
    lineHeight: 26,
  },
  brand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    marginTop: 4,
  },
  price: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#B87063',
    textAlign: 'center',
    marginTop: 6,
  },
  actions: {
    marginTop: 20,
    gap: 12,
  },
});
