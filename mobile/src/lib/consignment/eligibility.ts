import type { ItemCategory, ClothingItem } from '@/lib/state/lookStore';

// Payout ratios [min, max] as fractions of retail price, tuned by category.
// These remain a client-side estimate for the consign sheet headline. The
// eligibility GATE itself is now `creator_items.trr_eligible` (server-computed
// against the TheRealReal-accepted brand list) — no more hardcoded brand
// allowlist and no more $200 price floor in mobile code.
const PAYOUT_RATIOS: Record<string, [number, number]> = {
  Bag:        [0.65, 0.75],
  Shoes:      [0.55, 0.70],
  Jewelry:    [0.50, 0.65],
  Accessory:  [0.50, 0.65],
  Outerwear:  [0.55, 0.70],
  Dress:      [0.50, 0.65],
  Top:        [0.45, 0.60],
  Pants:      [0.45, 0.60],
  Other:      [0.45, 0.60],
};

export interface ConsignEligibility {
  eligible: true;
  payoutMinUsd: number;
  payoutMaxUsd: number;
}

export interface ConsignIneligible {
  eligible: false;
  reason: 'not_trr_eligible';
}

export type ConsignResult = ConsignEligibility | ConsignIneligible;

/**
 * Eligibility for the Consign with TheRealReal action.
 *
 * Gate: `item.trrEligible === true`. This is computed server-side by a trigger
 * on `creator_items` against TheRealReal's ~900-brand accepted list. The mobile
 * app does not maintain its own brand list and does not apply a price floor.
 *
 * Payout range is a category-based estimate of retail price for display only.
 */
export function consignEligibility(item: Pick<ClothingItem, 'trrEligible' | 'category' | 'price'>): ConsignResult {
  if (item.trrEligible !== true) {
    return { eligible: false, reason: 'not_trr_eligible' };
  }

  const numericPrice = parseFloat((item.price ?? '').replace(/[^0-9.]/g, ''));
  const safePrice = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : 0;

  const [minRatio, maxRatio] = PAYOUT_RATIOS[item.category as string] ?? PAYOUT_RATIOS['Other'];
  const payoutMinUsd = Math.round(safePrice * minRatio);
  const payoutMaxUsd = Math.round(safePrice * maxRatio);

  return { eligible: true, payoutMinUsd, payoutMaxUsd };
}
