import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react-native';
import {
  useClosetMoneyOnTable,
  swapSuggestion,
  dismissAffiliateSuggestion,
  moneyOnTableKey,
  formatPct,
  type MoneyOnTableItem,
  type MoneyOnTableRow,
} from '@/lib/queries/affiliateSuggestions';

interface MoneyOnTableStripProps {
  creatorId: string | null;
}

/**
 * Surface 2 — the "Money on the table" strip at the top of Studio. Renders the
 * precomputed get_closet_money_on_table feed (one card per closet item that
 * could be earning). Swap & earn calls the swap-suggestion edge function with
 * the suggestion_id; Dismiss tombstones the item's suggestions.
 */
export function MoneyOnTableStrip({ creatorId }: MoneyOnTableStripProps) {
  const { data } = useClosetMoneyOnTable(creatorId);
  const queryClient = useQueryClient();

  // Optimistic local removal so a swapped/dismissed card vanishes instantly,
  // before the query refetch lands.
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chooser, setChooser] = useState<MoneyOnTableItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const items = useMemo(
    () => (data ?? []).filter((it) => !hiddenIds.includes(it.creatorItemId)),
    [data, hiddenIds],
  );

  if (!creatorId || items.length === 0) return null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: moneyOnTableKey(creatorId) });

  const hide = (creatorItemId: string) =>
    setHiddenIds((prev) => (prev.includes(creatorItemId) ? prev : [...prev, creatorItemId]));

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const doSwap = async (item: MoneyOnTableItem, merchant: MoneyOnTableRow) => {
    if (busyId) return;
    setBusyId(item.creatorItemId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const res = await swapSuggestion({
      creatorId,
      creatorItemId: item.creatorItemId,
      productUrl: merchant.productUrl ?? '',
      suggestionId: merchant.suggestionId,
    });
    setBusyId(null);
    if (res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      hide(item.creatorItemId);
      refresh();
    } else {
      flashToast("Couldn't swap that one just yet — try again in a sec.");
    }
  };

  const onSwapPress = (item: MoneyOnTableItem) => {
    if (item.merchants.length > 1) {
      setChooser(item);
    } else {
      void doSwap(item, item.merchants[0]);
    }
  };

  const onDismiss = async (item: MoneyOnTableItem) => {
    if (busyId) return;
    setBusyId(item.creatorItemId);
    Haptics.selectionAsync().catch(() => {});
    // Tombstone every suggestion for this item so the card doesn't reappear via
    // a different merchant on the next sweep.
    await Promise.all(
      item.merchants
        .map((m) => m.suggestionId)
        .filter(Boolean)
        .map((id) => dismissAffiliateSuggestion(id)),
    );
    setBusyId(null);
    hide(item.creatorItemId);
    refresh();
  };

  const count = items.length;

  const renderCard = ({ item }: { item: MoneyOnTableItem }) => {
    const best = item.merchants[0];
    const busy = busyId === item.creatorItemId;
    return (
      <View style={styles.card} testID={`money-card-${item.creatorItemId}`}>
        {item.itemPhotoUrl ? (
          <Image source={{ uri: item.itemPhotoUrl }} style={styles.cardPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
            <Text style={{ fontSize: 30 }}>🧥</Text>
          </View>
        )}
        <Text style={styles.cardItemName} numberOfLines={1}>
          {item.itemName ?? 'Your piece'}
        </Text>
        <Text style={styles.cardEarn} numberOfLines={2}>
          Earn at <Text style={styles.cardEarnStrong}>{best.merchantName}</Text>
          {best.commissionMax != null ? (
            <Text style={styles.cardEarnStrong}> — {formatPct(best.commissionMax)}% back</Text>
          ) : null}
        </Text>

        <Pressable
          onPress={() => onSwapPress(item)}
          disabled={busy}
          className="w-full rounded-full py-2.5 flex-row items-center justify-center bg-[#B87063] active:opacity-85 mt-2"
          style={{ opacity: busy ? 0.6 : 1 }}
          testID={`money-swap-${item.creatorItemId}`}
        >
          <Text
            className="text-white text-[14px]"
            style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
          >
            {busy ? 'Working…' : 'Swap & earn'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onDismiss(item)}
          disabled={busy}
          className="w-full py-2 items-center justify-center active:opacity-70"
          testID={`money-dismiss-${item.creatorItemId}`}
        >
          <Text className="text-[#6B5E58] text-[13px]" style={{ fontFamily: 'DMSans_500Medium' }}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.wrap} testID="money-on-table-strip">
      <Text style={styles.title}>Money on the table 💸</Text>
      <Text style={styles.subtitle}>
        <Text style={styles.subtitleStrong}>
          {count} {count === 1 ? 'item' : 'items'}
        </Text>{' '}
        in your closet could be earning. Swap the link, same piece, you get paid.
      </Text>

      <FlatList
        horizontal
        data={items}
        keyExtractor={(it) => it.creatorItemId}
        renderItem={renderCard}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.row}
      />

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {/* Merchant chooser when an item is carried by 2+ merchants. */}
      <Modal visible={!!chooser} transparent animationType="fade" onRequestClose={() => setChooser(null)}>
        <Pressable style={styles.chooserBackdrop} onPress={() => setChooser(null)}>
          <View style={styles.chooserCard}>
            <View style={styles.chooserHead}>
              <Text style={styles.chooserTitle}>Where to earn</Text>
              <Pressable onPress={() => setChooser(null)} hitSlop={8} testID="money-chooser-close">
                <X size={18} color="#6B5E58" strokeWidth={2.5} />
              </Pressable>
            </View>
            {chooser?.merchants.map((m, i) => (
              <Pressable
                key={`${m.suggestionId}-${i}`}
                onPress={() => {
                  const item = chooser;
                  setChooser(null);
                  if (item) void doSwap(item, m);
                }}
                style={styles.chooserRow}
                testID={`money-chooser-merchant-${i}`}
              >
                <View style={styles.chooserDot}>
                  <Check size={12} color="#B87063" strokeWidth={3} />
                </View>
                <Text style={styles.chooserMerchant} numberOfLines={1}>
                  {m.merchantName}
                </Text>
                {m.price != null ? <Text style={styles.chooserPrice}>${m.price}</Text> : null}
                <Text style={styles.chooserPct}>
                  {m.commissionMax != null ? `${formatPct(m.commissionMax)}% back` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const CARD_W = 184;

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
    marginBottom: 18,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(184,112,99,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(184,112,99,0.22)',
    borderRadius: 20,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 23,
    color: '#1A1210',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13.5,
    lineHeight: 19,
    color: '#6B5E58',
    marginBottom: 14,
  },
  subtitleStrong: { fontFamily: 'DMSans_500Medium', color: '#B87063' },
  row: { gap: 12, paddingRight: 4 },
  card: {
    width: CARD_W,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFE3DE',
    padding: 10,
  },
  cardPhoto: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    backgroundColor: '#EFE7E1',
    marginBottom: 8,
  },
  cardPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardItemName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
    marginBottom: 2,
  },
  cardEarn: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 17,
    color: '#6B5E58',
    minHeight: 34,
  },
  cardEarnStrong: { fontFamily: 'DMSans_500Medium', color: '#1A1210' },
  toast: {
    marginTop: 12,
    backgroundColor: '#FBEDEA',
    borderWidth: 1,
    borderColor: '#E8C4BC',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  toastText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#B5483A' },
  chooserBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  chooserCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
  },
  chooserHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  chooserTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  chooserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1EAE5',
  },
  chooserDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(184,112,99,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooserMerchant: {
    flex: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14.5,
    color: '#1A1210',
  },
  chooserPrice: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E58' },
  chooserPct: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    minWidth: 62,
    textAlign: 'right',
  },
});
