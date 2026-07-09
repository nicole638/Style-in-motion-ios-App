// Display-only overrides for affiliate-merchant brand cards.
//
// These let us relabel and re-order a brand card in the Brands tab WITHOUT
// touching the underlying merchant row. The merchant's data (e.g. cj_merchants /
// cj_advertiser_id used for commission reconciliation) stays exactly as synced —
// this is purely cosmetic and client-side.
//
// Keyed by affiliate_merchants.id (the Supabase row PK, same id used to route to
// /brand/[id] and to JOIN affiliate_products.merchant_id).

export interface MerchantDisplayOverride {
  /** Title shown on the brand card + brand detail header, replacing merchant_name. */
  displayName?: string;
  /** Higher sorts earlier in the Brands tab. Unset / 0 = default ordering. */
  sortPriority?: number;
}

export const MERCHANT_DISPLAY_OVERRIDES: Record<string, MerchantDisplayOverride> = {
  // PartnerBoost – Amazon Marketplace (CJ advertiser 7096926). The catalog is real
  // Amazon products, so shoppers should just see "Amazon", pinned to the top.
  '5721595b-4c61-4839-9060-10e7e75cc94f': {
    displayName: 'Amazon',
    sortPriority: 1000,
  },
};

export function getMerchantDisplayOverride(
  id: string | null | undefined,
): MerchantDisplayOverride | undefined {
  if (!id) return undefined;
  return MERCHANT_DISPLAY_OVERRIDES[id];
}
