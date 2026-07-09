/**
 * Slot definitions for outfit collage templates. All coordinates are in the
 * 1080×1080 canvas coordinate space — components scale them to whatever the
 * on-screen render size is.
 *
 * Slots declare a `shape` label (tall / square / wide / small / auto) rather
 * than explicit width/height. Dimensions are resolved at render time via
 * SHAPE_DIMENSIONS, with `auto` slots picking a shape from the item being
 * rendered (CATEGORY_SLOT_SHAPE).
 */

export const CANVAS_SIZE = 1080;

export type SlotCategory =
  | 'top'
  | 'bottom'
  | 'dress'
  | 'outerwear'
  | 'shoes'
  | 'bag'
  | 'accessory'
  | 'any';

export type SlotShape = 'tall' | 'square' | 'wide' | 'small' | 'auto';

/**
 * Concrete pixel dimensions for each named shape (in canvas coords). `auto`
 * is omitted on purpose — it has no fixed dimensions and must be resolved
 * via the item being rendered.
 */
export const SHAPE_DIMENSIONS: Record<Exclude<SlotShape, 'auto'>, { w: number; h: number }> = {
  tall: { w: 460, h: 640 },
  square: { w: 460, h: 460 },
  wide: { w: 460, h: 320 },
  small: { w: 280, h: 280 },
};

/**
 * Preferred slot shape per normalized category. Unknown items resolve to
 * `any`, which maps to `square` — that is the documented default for
 * unrecognized categories.
 */
export const CATEGORY_SLOT_SHAPE: Record<SlotCategory, Exclude<SlotShape, 'auto'>> = {
  dress: 'tall',
  outerwear: 'tall',
  top: 'square',
  bottom: 'square',
  bag: 'wide',
  shoes: 'wide',
  accessory: 'small',
  any: 'square',
};

export interface CollageSlot {
  /** Shape label — drives item-to-slot matching and pixel dimensions. */
  shape: SlotShape;
  /** X position of slot center, in canvas coords (0..1080). */
  x: number;
  /** Y position of slot center, in canvas coords (0..1080). */
  y: number;
  /** Optional rotation in degrees, applied around center. */
  rotation?: number;
  /** Optional Z-index — higher values render on top. */
  z?: number;
  /**
   * Slot source. Defaults to 'item' (a closet item cutout). 'lookCover' uses
   * the look's full-body photo at the slot's explicit width/height with no
   * mask or transparency — see editorial-cover template.
   */
  kind?: 'item' | 'lookCover';
  /** Explicit width (canvas coords). Honored for lookCover slots and for item
   *  slots that want a precise footprint instead of the shape default. */
  width?: number;
  /** Explicit height (canvas coords). Honored for lookCover slots and for item
   *  slots that want a precise footprint instead of the shape default. */
  height?: number;
}

/**
 * Maps the in-app `ItemCategory` (Top, Pants, etc.) to our normalized slot
 * category vocabulary.
 */
export function normalizeCategory(category: string | null | undefined): SlotCategory {
  const c = (category ?? '').toLowerCase();
  if (c === 'top') return 'top';
  if (c === 'pants' || c === 'bottom' || c === 'skirt' || c === 'shorts') return 'bottom';
  if (c === 'dress' || c === 'jumpsuit') return 'dress';
  if (c === 'outerwear' || c === 'jacket' || c === 'coat') return 'outerwear';
  if (c === 'shoes' || c === 'shoe') return 'shoes';
  if (c === 'bag' || c === 'purse') return 'bag';
  if (c === 'accessory' || c === 'jewelry' || c === 'hat' || c === 'sunglasses' || c === 'belt' || c === 'scarf') return 'accessory';
  return 'any';
}

/** Preferred shape for an item, looked up via its category. */
export function shapeForCategory(category: string | null | undefined): Exclude<SlotShape, 'auto'> {
  return CATEGORY_SLOT_SHAPE[normalizeCategory(category)];
}

/**
 * Resolve a slot's pixel dimensions. `auto` slots derive their shape from the
 * item being rendered; all other shapes use the static SHAPE_DIMENSIONS map.
 */
export function resolveShapeDimensions(
  shape: SlotShape,
  itemCategory?: string | null
): { w: number; h: number } {
  if (shape === 'auto') {
    return SHAPE_DIMENSIONS[shapeForCategory(itemCategory)];
  }
  return SHAPE_DIMENSIONS[shape];
}

/**
 * Footprint for an item slot: explicit slot.width/height when provided
 * (templates that need a precise size, e.g. Dupe Drop's two big halves or the
 * What's-in-my-bag hero), otherwise the shape default. Used by both the static
 * and interactive render paths so the seeded layout matches the preview.
 */
export function slotItemDimensions(
  slot: CollageSlot,
  itemCategory?: string | null
): { w: number; h: number } {
  const base = resolveShapeDimensions(slot.shape, itemCategory);
  return { w: slot.width ?? base.w, h: slot.height ?? base.h };
}
