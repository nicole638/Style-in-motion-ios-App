import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import useAwinMerchantsStore, { type AwinMerchant } from '@/lib/state/awinMerchantsStore';
import { buildAwinUrl, hostFromUrl, isAwinWrapped } from '@/lib/awin/wrap';
import { useActiveAwinOffersMap } from '@/lib/queries/awinOffers';

interface Props {
  url: string;
  creatorId: string | null | undefined;
  onAutoWrap?: (wrappedUrl: string, merchant: AwinMerchant) => void;
}

function isAmazonHost(host: string | null): boolean {
  if (!host) return false;
  return /(^|\.)(amazon\.[a-z.]+|a\.co|amzn\.to)$/i.test(host);
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

function formatCommissionRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (min === max) return `${fmtPct(min)} commission`;
    return `${fmtPct(min)}–${fmtPct(max)} commission`;
  }
  const v = (min ?? max) as number;
  return `${fmtPct(v)} commission`;
}

/**
 * Shown below the URL field on Add Item when the pasted URL matches an active
 * Awin merchant. Auto-swaps the URL field to the awin1.com/cread.php form via
 * `onAutoWrap` so the click attributes back to this creator on /api/shop.
 *
 * Mirrors creators-web/components/closet/AwinMatchBanner.tsx.
 */
export function AwinMatchBanner({ url, creatorId, onAutoWrap }: Props) {
  const fetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  const loaded = useAwinMerchantsStore((s) => s.loaded);
  const findByHost = useAwinMerchantsStore((s) => s.findByHost);
  const offersQuery = useActiveAwinOffersMap();
  const offersMap = offersQuery.data ?? new Map();

  useEffect(() => {
    if (!loaded) void fetchActive();
  }, [loaded, fetchActive]);

  // Debounce 350ms so we don't thrash on every keystroke.
  const debouncedUrl = useDebouncedValue(url, 350);

  const match = useMemo<{ merchant: AwinMerchant; wrapped: string } | null>(() => {
    const trimmed = (debouncedUrl ?? '').trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    if (isAwinWrapped(trimmed)) return null;
    const host = hostFromUrl(trimmed);
    if (!host || isAmazonHost(host)) return null;
    if (!creatorId) return null;
    const merchant = findByHost(host);
    if (!merchant) return null;
    const wrapped = buildAwinUrl({
      awinmid: merchant.awinmid,
      clickref: creatorId,
      productUrl: trimmed,
    });
    return { merchant, wrapped };
  }, [debouncedUrl, creatorId, findByHost]);

  // Fire the auto-wrap callback exactly once per (url, merchant) pair so we
  // don't loop when the parent updates the field to the wrapped value.
  const lastSwappedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match || !onAutoWrap) return;
    const key = `${match.merchant.awinmid}|${(debouncedUrl ?? '').trim()}`;
    if (lastSwappedRef.current === key) return;
    lastSwappedRef.current = key;
    onAutoWrap(match.wrapped, match.merchant);
  }, [match, debouncedUrl, onAutoWrap]);

  if (!match) return null;

  const { merchant } = match;
  const commissionLabel = formatCommissionRange(merchant.commissionMinPct, merchant.commissionMaxPct);
  const epcLabel = merchant.epc != null && merchant.epc > 0
    ? `$${merchant.epc.toFixed(2)} EPC`
    : null;
  const convLabel = merchant.conversionRate != null && merchant.conversionRate > 0
    ? `${fmtPct(merchant.conversionRate)} CR`
    : null;
  const metaParts = [commissionLabel, epcLabel, convLabel].filter(Boolean);

  const activeOffer = offersMap.get(merchant.id);
  const offerLine = activeOffer
    ? activeOffer.voucherCode
      ? `Active offer: code ${activeOffer.voucherCode} — ${activeOffer.title || 'limited-time'}`
      : `Active offer: ${activeOffer.title || 'limited-time deal'}`
    : null;

  return (
    <View style={styles.banner} testID="awin-match-banner">
      <View style={styles.icon}>
        <Sparkles size={16} color="#B87063" strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>
          <Text style={styles.brand}>{merchant.name}</Text>
          {' is on Awin. We swapped your link to the tracked URL so this click earns commission.'}
        </Text>
        {metaParts.length > 0 ? (
          <Text style={styles.meta}>{metaParts.join('  \u00B7  ')}</Text>
        ) : null}
        {offerLine ? (
          <Text style={styles.offer} testID="awin-match-banner-offer">{offerLine}</Text>
        ) : null}
      </View>
    </View>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(184, 112, 99, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(184, 112, 99, 0.4)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(184, 112, 99, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  body: {
    flex: 1,
  },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
    lineHeight: 18,
  },
  brand: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 15,
    color: '#1A1210',
  },
  meta: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 4,
  },
  offer: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
    marginTop: 6,
  },
});
