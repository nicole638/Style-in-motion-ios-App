import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import useAwinMerchantsStore from '@/lib/state/awinMerchantsStore';
import { useActiveAwinOffersMap } from '@/lib/queries/awinOffers';
import { hostFromUrl } from '@/lib/awin/wrap';
import useClosetItemPreferencesStore from '@/lib/state/closetItemPreferencesStore';

interface Props {
  itemId: string | null | undefined;
  url: string | null | undefined;
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

/**
 * Shown on the Edit closet item screen when the item's URL host matches an
 * Awin merchant that currently has an active offer. Lets the creator opt-in
 * to auto-include the voucher code in any look's share caption.
 */
export function ActiveOfferPanel({ itemId, url }: Props) {
  const awinFetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  const awinLoaded = useAwinMerchantsStore((s) => s.loaded);
  const awinFindByHost = useAwinMerchantsStore((s) => s.findByHost);
  const offersQuery = useActiveAwinOffersMap();
  const offersMap = offersQuery.data ?? new Map();

  const hydratePrefs = useClosetItemPreferencesStore((s) => s.hydrate);
  const prefsHydrated = useClosetItemPreferencesStore((s) => s.hydrated);
  const getAutoIncludeOffer = useClosetItemPreferencesStore((s) => s.getAutoIncludeOffer);
  const setAutoIncludeOffer = useClosetItemPreferencesStore((s) => s.setAutoIncludeOffer);
  // Subscribe to prefs object so re-renders happen when toggle flips
  const prefs = useClosetItemPreferencesStore((s) => s.prefs);

  useEffect(() => {
    if (!awinLoaded) void awinFetchActive();
  }, [awinLoaded, awinFetchActive]);

  useEffect(() => {
    if (!prefsHydrated) void hydratePrefs();
  }, [prefsHydrated, hydratePrefs]);

  if (!url || !itemId) return null;
  const host = hostFromUrl(url);
  if (!host) return null;
  const merchant = awinFindByHost(host);
  if (!merchant) return null;
  const offer = offersMap.get(merchant.id);
  if (!offer) return null;

  const enabled = getAutoIncludeOffer(itemId);
  // Reading prefs above ensures this component subscribes — silence lint
  void prefs;
  const endsLabel = formatDate(offer.endDate);

  return (
    <View style={styles.panel} testID="active-offer-panel">
      <Text style={styles.title}>{`\uD83D\uDD25 Active offer: ${offer.title || 'Limited-time'}`}</Text>
      {offer.voucherCode ? (
        <Text style={styles.body}>
          Use code <Text style={styles.code}>{offer.voucherCode}</Text> at checkout
        </Text>
      ) : offer.description ? (
        <Text style={styles.body} numberOfLines={2}>{offer.description}</Text>
      ) : null}
      {endsLabel ? <Text style={styles.ends}>{`Ends ${endsLabel}`}</Text> : null}
      {offer.voucherCode ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Auto-include in caption</Text>
          <Switch
            value={enabled}
            onValueChange={(v) => setAutoIncludeOffer(itemId, v)}
            trackColor={{ false: '#E0D8D0', true: '#B87063' }}
            thumbColor="#FFFFFF"
            testID="active-offer-auto-include-toggle"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: 'rgba(184,112,99,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(184,112,99,0.35)',
    borderRadius: 14,
    padding: 14,
  },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#3D3330',
    marginTop: 4,
  },
  code: {
    fontFamily: 'DMSans_500Medium',
    color: '#B87063',
  },
  ends: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(184,112,99,0.25)',
  },
  toggleLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
});
