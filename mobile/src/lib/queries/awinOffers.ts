import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AwinOffer {
  id: string;
  merchantId: string;        // FK → awin_merchants.id
  awinmid: number;
  type: 'promotion' | 'voucher';
  title: string;
  description: string | null;
  terms: string | null;
  voucherCode: string | null;
  campaign: string | null;
  startDate: string | null;
  endDate: string | null;
  urlTracking: string | null;
  exclusive: boolean;
}

function rowToOffer(row: any): AwinOffer {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    awinmid: Number(row.awinmid),
    type: row.type === 'voucher' ? 'voucher' : 'promotion',
    title: row.title ?? '',
    description: row.description ?? null,
    terms: row.terms ?? null,
    voucherCode: row.voucher_code ?? null,
    campaign: row.campaign ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    urlTracking: row.url_tracking ?? null,
    exclusive: row.exclusive === true,
  };
}

function isOfferActive(o: AwinOffer): boolean {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (o.startDate && o.startDate > todayISO) return false;
  if (o.endDate && o.endDate < todayISO) return false;
  return true;
}

/**
 * Active offers for one merchant. Used by /brand/[id] to show a banner.
 */
export function useAwinOffersByMerchant(merchantId: string | null | undefined) {
  return useQuery({
    queryKey: ['awin', 'offers', 'byMerchant', merchantId ?? ''],
    enabled: !!merchantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('awin_offers')
        .select('*')
        .eq('merchant_id', merchantId);
      if (error) {
        console.warn('[useAwinOffersByMerchant] error:', error.message);
        throw error;
      }
      return (data ?? []).map(rowToOffer).filter(isOfferActive);
    },
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Map of merchantId -> AwinOffer for ALL currently-active offers.
 * Drives the rose badge on closet cards.
 */
export function useActiveAwinOffersMap() {
  return useQuery({
    queryKey: ['awin', 'offers', 'activeMap'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('awin_offers')
        .select('*');
      if (error) {
        console.warn('[useActiveAwinOffersMap] error:', error.message);
        throw error;
      }
      const out = new Map<string, AwinOffer>();
      for (const r of data ?? []) {
        const o = rowToOffer(r);
        if (!isOfferActive(o)) continue;
        // Prefer voucher offers over promotion offers when both exist
        const existing = out.get(o.merchantId);
        if (!existing || (existing.type === 'promotion' && o.type === 'voucher')) {
          out.set(o.merchantId, o);
        }
      }
      return out;
    },
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Build a short, badge-sized snippet from an offer.
 * Returns something like "20% OFF" or "USE WELCOME10".
 */
export function shortOfferBadge(offer: AwinOffer | null | undefined): string | null {
  if (!offer) return null;
  if (offer.type === 'voucher' && offer.voucherCode) {
    return `USE ${offer.voucherCode}`;
  }
  // Extract a discount % or $ from the title if present
  const t = (offer.title ?? '').trim();
  const pctMatch = t.match(/(\d{1,2})\s*%\s*off/i);
  if (pctMatch) return `${pctMatch[1]}% OFF`;
  const dollarMatch = t.match(/\$(\d{1,3})\s*off/i);
  if (dollarMatch) return `$${dollarMatch[1]} OFF`;
  // Fallback to first 14 chars uppercased
  return t.slice(0, 14).toUpperCase() || 'OFFER';
}
