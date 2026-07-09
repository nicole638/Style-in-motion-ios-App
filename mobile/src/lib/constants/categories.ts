import type { ItemCategory } from '@/lib/state/lookStore';

/**
 * Canonical closet category taxonomy — the single source of truth for the
 * label↔value mapping, display order, and emoji used everywhere a category is
 * shown (the add/edit category selector AND the collage item picker sections).
 *
 * The array order doubles as the section order in the collage picker.
 *
 * Label↔value notes (the DB stores free text in creator_items.category):
 *  - "Dresses & Skirts" is the display label for the stored value `Dress`.
 *    Skirts are intentionally folded into `Dress` — there is NO `Skirt` value.
 *  - `Intimates` (bras / bralettes / lingerie) and `Swimwear` (bathing suits /
 *    bikinis / cover-ups) are first-class buckets.
 *  - `Other` is the catch-all and is always shown last.
 */
export interface CategoryDef {
  /** Display label shown in the UI. */
  label: string;
  /** Stored creator_items.category value. */
  value: ItemCategory;
  emoji: string;
}

export const CATEGORIES: CategoryDef[] = [
  { label: 'Top', value: 'Top', emoji: '👕' },
  { label: 'Pants', value: 'Pants', emoji: '👖' },
  { label: 'Dresses & Skirts', value: 'Dress', emoji: '👗' },
  { label: 'Outerwear', value: 'Outerwear', emoji: '🧥' },
  { label: 'Shoes', value: 'Shoes', emoji: '👟' },
  { label: 'Bag', value: 'Bag', emoji: '👜' },
  { label: 'Accessory', value: 'Accessory', emoji: '🧣' },
  { label: 'Jewelry', value: 'Jewelry', emoji: '💎' },
  { label: 'Intimates', value: 'Intimates', emoji: '🩲' },
  { label: 'Swimwear', value: 'Swimwear', emoji: '👙' },
  { label: 'Other', value: 'Other', emoji: '🛍️' },
];

export const CATEGORY_EMOJI: Record<ItemCategory, string> = {
  Top: '👕',
  Pants: '👖',
  Dress: '👗',
  Outerwear: '🧥',
  Shoes: '👟',
  Bag: '👜',
  Accessory: '🧣',
  Jewelry: '💎',
  Intimates: '🩲',
  Swimwear: '👙',
  Other: '🛍️',
};

/** Display label for a stored category value (e.g. `Dress` → "Dresses & Skirts"). */
export function categoryLabel(value: ItemCategory): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function emojiForCategory(c: ItemCategory): string {
  return CATEGORY_EMOJI[c] ?? '🛍️';
}
