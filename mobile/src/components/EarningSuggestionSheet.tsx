import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import {
  swapSuggestion,
  formatPct,
  type AffiliateMatch,
} from '@/lib/queries/affiliateSuggestions';

interface EarningSuggestionSheetProps {
  visible: boolean;
  creatorId: string;
  creatorItemId: string;
  itemName: string | null;
  itemBrand: string | null;
  itemPhotoUri: string | null;
  // Already filtered to high/medium, ranked best-first.
  matches: AffiliateMatch[];
  // Called for both "Use this link" (after success) and "Keep mine".
  onDone: () => void;
}

/**
 * Surface 1 — the add-time "You could be earning on this" card. Shown right
 * after a creator saves a NON-monetized closet item that the live matcher
 * recognizes. Confidence drives the copy. "Use this link" calls the
 * swap-suggestion edge function (no suggestion_id — these are live matches).
 */
export function EarningSuggestionSheet({
  visible,
  creatorId,
  creatorItemId,
  itemName,
  itemBrand,
  itemPhotoUri,
  matches,
  onDone,
}: EarningSuggestionSheetProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const top = matches[0];
  if (!top) return null;

  const selected = matches[selectedIdx] ?? top;
  const isHigh = top.confidence === 'high';
  const pieceLabel = itemName?.trim() || 'piece';
  const brandLabel = itemBrand?.trim() || selected.merchantName;

  const headline = isHigh
    ? '💸 You could be earning on this'
    : `Looks like your ${pieceLabel} — and these pay`;

  const handleUseThis = async () => {
    if (swapping) return;
    setError(null);
    setSwapping(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const res = await swapSuggestion({
      creatorId,
      creatorItemId,
      productUrl: selected.productUrl ?? '',
      // add-time: NO suggestion_id (live match, no stored row)
    });
    setSwapping(false);
    if (res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDone();
    } else {
      // Soft fail — leave the card so they can retry or keep theirs.
      setError("Couldn't set up your link just yet — try again in a moment.");
    }
  };

  const showChooser = matches.length > 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDone}
      testID="earning-suggestion-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onDone} />
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />
          <Pressable
            onPress={onDone}
            style={styles.closeBtn}
            hitSlop={8}
            testID="earning-suggestion-close"
          >
            <X size={18} color="#6B5E58" strokeWidth={2.5} />
          </Pressable>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.headline}>{headline}</Text>

            {/* Side-by-side: their piece vs the matched product, so they can
                eyeball that it's the same item (matcher is brand+name+price). */}
            <View style={styles.photoRow}>
              <View style={styles.photoCol}>
                {itemPhotoUri ? (
                  <Image source={{ uri: itemPhotoUri }} style={styles.photo} contentFit="cover" />
                ) : (
                  <View style={[styles.photo, styles.photoPlaceholder]}>
                    <Text style={{ fontSize: 28 }}>🧥</Text>
                  </View>
                )}
                <Text style={styles.photoCap}>Yours</Text>
              </View>
              <Text style={styles.photoEquals}>≈</Text>
              <View style={styles.photoCol}>
                {selected.imageUrl ? (
                  <Image source={{ uri: selected.imageUrl }} style={styles.photo} contentFit="cover" />
                ) : (
                  <View style={[styles.photo, styles.photoPlaceholder]}>
                    <Text style={{ fontSize: 28 }}>🛍️</Text>
                  </View>
                )}
                <Text style={styles.photoCap} numberOfLines={1}>
                  {selected.merchantName}
                </Text>
              </View>
            </View>

            <Text style={styles.body}>
              Same {brandLabel} over at <Text style={styles.bodyStrong}>{selected.merchantName}</Text> —
              swap to your link and you get paid when someone shops it.
              {selected.commissionMax != null ? (
                <Text style={styles.bodyStrong}> ({formatPct(selected.commissionMax)}% back)</Text>
              ) : null}
            </Text>

            {/* Merchant chooser when 2–3 carry it. */}
            {showChooser ? (
              <View style={styles.chooser}>
                {matches.map((m, i) => {
                  const active = i === selectedIdx;
                  return (
                    <Pressable
                      key={`${m.merchantName}-${i}`}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setSelectedIdx(i);
                      }}
                      style={[styles.chooserRow, active && styles.chooserRowActive]}
                      testID={`earning-suggestion-merchant-${i}`}
                    >
                      <View
                        style={[styles.radio, active ? styles.radioOn : styles.radioOff]}
                      >
                        {active ? <Check size={12} color="#FFFFFF" strokeWidth={3} /> : null}
                      </View>
                      <Text style={styles.chooserMerchant} numberOfLines={1}>
                        {m.merchantName}
                      </Text>
                      {m.price != null ? (
                        <Text style={styles.chooserPrice}>${m.price}</Text>
                      ) : null}
                      <Text style={styles.chooserPct}>
                        {m.commissionMax != null ? `${formatPct(m.commissionMax)}% back` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBanner} testID="earning-suggestion-error">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleUseThis}
              disabled={swapping}
              className="w-full rounded-full py-4 flex-row items-center justify-center bg-[#B87063] active:opacity-85 mt-1"
              style={{
                shadowColor: '#1A1210',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
                opacity: swapping ? 0.6 : 1,
              }}
              testID="earning-suggestion-use-link"
            >
              <Text
                className="text-white text-[16px]"
                style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
              >
                {swapping ? 'Setting up…' : 'Use this link'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onDone}
              disabled={swapping}
              className="w-full py-3 items-center justify-center active:opacity-70 mt-1"
              testID="earning-suggestion-keep-mine"
            >
              <Text
                className="text-[#6B5E58] text-sm"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Keep mine
              </Text>
            </Pressable>
          </ScrollView>
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
    maxHeight: '88%',
    overflow: 'hidden',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36 },
  headline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
    marginBottom: 18,
    paddingRight: 28,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 18,
  },
  photoCol: { alignItems: 'center', width: 120 },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 16,
    backgroundColor: '#EFE7E1',
  },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoCap: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 6,
    maxWidth: 120,
  },
  photoEquals: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 22,
    color: '#B87063',
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14.5,
    lineHeight: 21,
    color: '#3D3330',
    marginBottom: 18,
  },
  bodyStrong: {
    fontFamily: 'DMSans_500Medium',
    color: '#1A1210',
  },
  chooser: {
    borderWidth: 1,
    borderColor: '#EFE3DE',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 18,
  },
  chooserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  chooserRowActive: { backgroundColor: 'rgba(184,112,99,0.06)' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: '#B87063' },
  radioOff: { borderWidth: 1.5, borderColor: '#C9BDB6', backgroundColor: '#FFFFFF' },
  chooserMerchant: {
    flex: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  chooserPrice: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  chooserPct: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    minWidth: 64,
    textAlign: 'right',
  },
  errorBanner: {
    backgroundColor: '#FBEDEA',
    borderWidth: 1,
    borderColor: '#E8C4BC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  errorText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B5483A',
  },
});
