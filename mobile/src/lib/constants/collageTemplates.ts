import {
  CollageSlot,
  SlotCategory,
  shapeForCategory,
} from './collageSlots';
import type { TextLayerItem } from '@/lib/state/lookStore';

export type CollageTemplateId =
  | 'style-journal'
  | 'editorial'
  | 'grid'
  | 'editorial-cover'
  | 'dupe-drop'
  | 'whats-in-my-bag';

export interface TemplateDecoration {
  type: 'text' | 'line' | 'badge';
  /** For text + badge decorations. */
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  letterSpacing?: number;
  /** For line decorations. */
  thickness?: number;
  /** For badge decorations: circle radius + fill (x/y are the CENTER). */
  radius?: number;
  fill?: string;
  /** Stacking order within the canvas. Items use 1..N; use a high value to
   *  float a badge above items, omit/low to sit a shape behind them. */
  z?: number;
  /** Common positioning (canvas coords). */
  x: number;
  y: number;
  w?: number;
  h?: number;
  align?: 'left' | 'center' | 'right';
  /** When true, creator can tap to override the text per-look. */
  editable?: boolean;
  /** Faded copy shown when editable && override is empty. */
  placeholder?: string;
  /** Allow newlines / wrapping when true. Defaults to false. */
  multiline?: boolean;
  /** Minimum block height (canvas coords) when multiline. */
  minHeight?: number;
}

export interface SelfieSlot {
  /** Center X (canvas coords). */
  x: number;
  /** Center Y (canvas coords). */
  y: number;
  /** Diameter of the circular selfie. */
  size: number;
}

/**
 * Baked-in editable text the template seeds onto the canvas as real, movable
 * TextLayerItems when the creator taps the template in the picker. Distinct
 * from `decorations` (which are fixed, non-movable). `fontToken` maps to a real
 * font family in canvasShared.tsx. x/y are the text CENTER (canvas coords).
 */
export interface TemplateTextLayer {
  text: string;
  fontToken: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
  rotation?: number;
  letterSpacing?: number;
  backgroundColor?: string;
  opacity?: number;
  zIndex?: number;
}

/** Two-tone split background (e.g. Dupe Drop: blush left, cream right). */
export interface BackgroundSplit {
  /** Canvas-x where the left color ends and the right color begins. */
  atX: number;
  left: string;
  right: string;
}

export interface CollageTemplate {
  id: CollageTemplateId;
  name: string;
  description: string;
  bgColor: string;
  slots: CollageSlot[];
  selfieSlot?: SelfieSlot;
  decorations?: TemplateDecoration[];
  /** Optional two-tone background, rendered behind items (unless the creator
   *  picks their own backdrop, which overrides it). */
  backgroundSplit?: BackgroundSplit;
  /** Editable baked-in text seeded on manual template tap. */
  defaultTextLayers?: TemplateTextLayer[];
  /** When true, omit from automatic best-fit ranking — picker-tap only. */
  excludeFromAutoRank?: boolean;
}

/**
 * Style Journal — magazine-style cream paper layout. Shape mix:
 * 1 tall (hero) + 1 square (paired piece) + 2 wide (shoes/bag) + 2 small
 * (accessory satellites). Items have transparent cutouts so editorial
 * overlap reads as layered, not crammed.
 */
const STYLE_JOURNAL: CollageTemplate = {
  id: 'style-journal',
  name: 'Style journal',
  description: 'Warm cream paper',
  bgColor: '#F1E9DB',
  // All slot centers chosen so extents stay within an ~80–1000 safe band on
  // each side, leaving the canvas a clear "magazine page" margin.
  slots: [
    // Slot 0 — hero (tall: dress / outerwear)
    { shape: 'tall', x: 380, y: 540, rotation: -4, z: 2 },
    // Slot 1 — paired piece (square: top / bottom), mid-right
    { shape: 'square', x: 720, y: 700, rotation: 3, z: 1 },
    // Slot 2 — wide accent (shoes / bag), lower-left
    { shape: 'wide', x: 320, y: 840, rotation: -2, z: 3 },
    // Slot 3 — wide accent (shoes / bag), upper-right
    { shape: 'wide', x: 740, y: 380, rotation: 5, z: 4 },
    // Slot 4 — small accessory satellite, upper-mid (overlaps hero edge)
    { shape: 'small', x: 540, y: 350, rotation: -3, z: 5 },
    // Slot 5 — small accessory satellite, mid-left
    { shape: 'small', x: 230, y: 780, rotation: 6, z: 6 },
  ],
  selfieSlot: { x: 870, y: 900, size: 180 },
  decorations: [
    {
      type: 'text',
      text: 'STYLE JOURNAL',
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 50,
      color: '#1A1210',
      letterSpacing: 6,
      x: 120,
      y: 95,
      w: 840,
      align: 'center',
    },
    {
      type: 'line',
      x: 120,
      y: 200,
      w: 840,
      thickness: 1,
      color: '#1A1210',
    },
  ],
};

/**
 * Editorial — large central hero with smaller satellites. Shape mix:
 * 1 tall (hero) + 5 small (accessory-sized satellites orbiting the hero).
 */
const EDITORIAL: CollageTemplate = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Crisp white — one featured piece, others orbiting',
  bgColor: '#FAFAF7',
  slots: [
    // Slot 0 — hero (tall, centered)
    { shape: 'tall', x: 540, y: 540, z: 1 },
    // Slot 1 — top-right satellite
    { shape: 'small', x: 870, y: 230, rotation: 4, z: 2 },
    // Slot 2 — bottom-left satellite
    { shape: 'small', x: 200, y: 880, rotation: -3, z: 3 },
    // Slot 3 — bottom-right satellite
    { shape: 'small', x: 870, y: 870, rotation: 2, z: 4 },
    // Slot 4 — left-mid satellite (sits clear of hero left edge)
    { shape: 'small', x: 160, y: 540, rotation: -5, z: 5 },
    // Slot 5 — right-mid satellite (sits clear of hero right edge)
    { shape: 'small', x: 920, y: 540, rotation: 3, z: 6 },
  ],
  selfieSlot: { x: 200, y: 220, size: 220 },
  decorations: [
    {
      type: 'text',
      text: 'EDITORIAL',
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 40,
      color: '#1A1210',
      letterSpacing: 8,
      x: 60,
      y: 1000,
      w: 960,
      align: 'center',
    },
  ],
};

/**
 * Grid — clean 2-column × 3-row layout. Slots use `auto` so each cell sizes
 * itself to the item's preferred shape. Caveat: tall items (460×640) will
 * bleed past the row guide lines — that's intentional, the lines are
 * compositional guides rather than hard cell borders.
 */
const GRID: CollageTemplate = {
  id: 'grid',
  name: 'Grid',
  description: 'Soft warm gray — clean 2×N catalog',
  bgColor: '#E8E5E0',
  slots: [
    // Row 1 (y:240)
    { shape: 'auto', x: 300, y: 240, z: 1 },
    { shape: 'auto', x: 780, y: 240, z: 1 },
    // Row 2 (y:540)
    { shape: 'auto', x: 300, y: 540, z: 1 },
    { shape: 'auto', x: 780, y: 540, z: 1 },
    // Row 3 (y:840)
    { shape: 'auto', x: 300, y: 840, z: 1 },
    { shape: 'auto', x: 780, y: 840, z: 1 },
  ],
  decorations: [
    // Vertical center line
    {
      type: 'line',
      x: 540,
      y: 60,
      w: 1,
      h: 960,
      color: '#E8E0D8',
    },
    // Horizontal guide between row 1 and row 2
    {
      type: 'line',
      x: 60,
      y: 390,
      w: 960,
      h: 1,
      color: '#E8E0D8',
    },
    // Horizontal guide between row 2 and row 3
    {
      type: 'line',
      x: 60,
      y: 690,
      w: 960,
      h: 1,
      color: '#E8E0D8',
    },
  ],
};

/**
 * Editorial Cover — magazine-style cover. Anchored by a full-body lookCover
 * photo upper-left, an editable italic-serif headline upper-right, and
 * cutouts (cap, sunglasses, jacket, bag, jeans, mules) layered around them.
 */
const EDITORIAL_COVER: CollageTemplate = {
  id: 'editorial-cover',
  name: 'Editorial cover',
  description: 'Blush full-bleed — centerpiece + look-photo',
  bgColor: '#F4D8CD',
  slots: [
    // Slot 0 — full-body model photo (lookCover), upper-left
    { kind: 'lookCover', shape: 'tall', x: 290, y: 540, width: 460, height: 720, rotation: 0, z: 1 },
    // Slot 1 — hero garment cutout (windbreaker/jacket), centered
    { shape: 'tall', x: 700, y: 560, rotation: 0, z: 4 },
    // Slot 2 — accessory (cap), upper-right
    { shape: 'small', x: 920, y: 380, rotation: 8, z: 5 },
    // Slot 3 — accessory (sunglasses), mid-right
    { shape: 'small', x: 940, y: 600, rotation: -6, z: 6 },
    // Slot 4 — bag, lower-left of hero
    { shape: 'square', x: 580, y: 800, rotation: 4, z: 3 },
    // Slot 5 — pants/jeans, lower-center
    { shape: 'tall', x: 760, y: 880, rotation: -2, z: 2 },
    // Slot 6 — shoes/mules, lower-right
    { shape: 'wide', x: 530, y: 940, rotation: 0, z: 7 },
  ],
  decorations: [
    // Editable italic-serif headline, upper-right of canvas
    {
      type: 'text',
      editable: true,
      multiline: true,
      text: '90s INSPIRED SPRING OUTFITS',
      placeholder: 'Tap to add your headline',
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 32,
      color: '#1A1210',
      x: 600,
      y: 200,
      w: 460,
      minHeight: 220,
      align: 'left',
    },
  ],
};

/**
 * Dupe Drop — "splurge vs steal" two-up. Split blush/cream background, a fixed
 * `vs` badge between two big item halves, and baked-in editable text (header,
 * the two labels, the two price chips, footer). The creator drops the designer
 * piece left, the dupe right.
 */
const DUPE_DROP: CollageTemplate = {
  id: 'dupe-drop',
  name: 'Dupe Drop',
  description: 'Splurge vs steal — two-up comparison',
  bgColor: '#EFE7DA',
  backgroundSplit: { atX: 540, left: '#F4D8CD', right: '#EFE7DA' },
  excludeFromAutoRank: true,
  slots: [
    // Left half — the splurge.
    { shape: 'square', x: 270, y: 530, width: 440, height: 560, z: 2 },
    // Right half — the steal.
    { shape: 'square', x: 810, y: 530, width: 440, height: 560, z: 2 },
  ],
  decorations: [
    // Fixed "vs" badge on a dark circle, floated above the item halves.
    {
      type: 'badge',
      text: 'vs',
      x: 540,
      y: 535,
      radius: 75,
      fill: '#211C18',
      color: '#FFFFFF',
      fontFamily: 'PlayfairDisplay_400Regular_Italic',
      fontSize: 52,
      z: 100,
    },
  ],
  defaultTextLayers: [
    { text: 'DUPE DROP', fontToken: 'bebas', fontSize: 84, color: '#2C231E', x: 540, y: 125, letterSpacing: 2, zIndex: 60 },
    { text: 'THE SPLURGE', fontToken: 'playfair-italic', fontSize: 35, color: '#9C7D4F', x: 270, y: 250, letterSpacing: 2, zIndex: 61 },
    { text: 'THE STEAL', fontToken: 'playfair-italic', fontSize: 35, color: '#6B5D52', x: 810, y: 250, letterSpacing: 2, zIndex: 62 },
    // Price bubbles are NOT seeded here — collage-builder generates one per placed
    // item (bound to itemId) so 3+ items each get a bubble. See the dupe-drop
    // price-bubble reconciler in src/app/collage-builder.tsx.
    { text: 'STYLED IN MOTION', fontToken: 'bebas', fontSize: 26, color: '#2C231E', opacity: 0.42, letterSpacing: 3, x: 540, y: 1040, zIndex: 65 },
  ],
};

/**
 * What's in my bag — handwritten title up top, a hero (the bag) in the middle,
 * and six "contents" cutouts orbiting it. Single warm-cream background.
 */
const WHATS_IN_MY_BAG: CollageTemplate = {
  id: 'whats-in-my-bag',
  name: "What's in my bag",
  description: 'The daily carry — hero bag + 6 contents',
  bgColor: '#F1E7D8',
  excludeFromAutoRank: true,
  slots: [
    // Hero — the bag, centered and large.
    { shape: 'square', x: 540, y: 620, width: 380, height: 430, z: 4 },
    // Six contents around it.
    { shape: 'small', x: 240, y: 360, width: 230, height: 230, z: 3 },
    { shape: 'small', x: 872, y: 365, width: 230, height: 230, z: 3 },
    { shape: 'small', x: 197, y: 710, width: 230, height: 230, z: 3 },
    { shape: 'small', x: 880, y: 700, width: 230, height: 230, z: 3 },
    { shape: 'small', x: 356, y: 905, width: 230, height: 230, z: 3 },
    { shape: 'small', x: 818, y: 925, width: 230, height: 230, z: 3 },
  ],
  defaultTextLayers: [
    { text: "what's in my bag? 👜", fontToken: 'caveat', fontSize: 113, color: '#2F2620', x: 540, y: 160, rotation: -3, zIndex: 60 },
    { text: 'THE DAILY CARRY', fontToken: 'playfair-italic', fontSize: 32, color: '#322820', opacity: 0.5, letterSpacing: 2, x: 540, y: 1045, zIndex: 61 },
  ],
};

export const COLLAGE_TEMPLATES: CollageTemplate[] = [STYLE_JOURNAL, EDITORIAL, GRID, EDITORIAL_COVER, DUPE_DROP, WHATS_IN_MY_BAG];

export function getTemplate(id: CollageTemplateId): CollageTemplate {
  const t = COLLAGE_TEMPLATES.find(t => t.id === id);
  if (!t) return STYLE_JOURNAL;
  return t;
}

/**
 * Score a template against a list of items. Higher = better fit.
 *
 * Each item resolves to a preferred shape via shapeForCategory. We then walk
 * the slots looking for an unused slot with that shape (score 1), or an
 * `auto` slot (score 0.5), or any leftover slot (score 0 — overflow).
 */
export function scoreTemplate(
  template: CollageTemplate,
  itemCategories: string[]
): number {
  // lookCover slots don't take closet items — they hold the model photo.
  const used = new Set<number>();
  for (let i = 0; i < template.slots.length; i++) {
    if (template.slots[i].kind === 'lookCover') used.add(i);
  }
  let score = 0;
  for (const cat of itemCategories) {
    const preferred = shapeForCategory(cat);
    let idx = -1;
    // Pass 1 — exact shape match
    for (let i = 0; i < template.slots.length; i++) {
      if (used.has(i)) continue;
      if (template.slots[i].shape === preferred) {
        idx = i;
        score += 1;
        break;
      }
    }
    if (idx === -1) {
      // Pass 2 — auto slot fallback
      for (let i = 0; i < template.slots.length; i++) {
        if (used.has(i)) continue;
        if (template.slots[i].shape === 'auto') {
          idx = i;
          score += 0.5;
          break;
        }
      }
    }
    if (idx === -1) {
      // Pass 3 — overflow into any unused slot (no score)
      for (let i = 0; i < template.slots.length; i++) {
        if (!used.has(i)) {
          idx = i;
          break;
        }
      }
    }
    if (idx !== -1) used.add(idx);
  }
  return score;
}

/** Rank templates from best fit to worst, given the item categories. Templates
 *  flagged excludeFromAutoRank (the richer editorial ones) are picker-tap only,
 *  so they never get auto-selected on a fresh build and never seed their text
 *  without a deliberate tap. */
export function rankTemplates(itemCategories: string[]): CollageTemplate[] {
  return COLLAGE_TEMPLATES.filter(t => !t.excludeFromAutoRank).sort(
    (a, b) => scoreTemplate(b, itemCategories) - scoreTemplate(a, itemCategories)
  );
}

export interface SlotAssignment {
  slot: CollageSlot;
  slotIndex: number;
  itemIndex: number;
}

/**
 * Assign items to slots for a given template, driven by shape preference.
 * Items whose preferred shape isn't represented (or whose shape slot is
 * already taken) fall back to `auto` slots, then to any leftover slot.
 */
export function assignItemsToSlots(
  template: CollageTemplate,
  itemCategories: string[]
): SlotAssignment[] {
  const used = new Set<number>();
  // lookCover slots are reserved for the model photo, not closet items.
  for (let i = 0; i < template.slots.length; i++) {
    if (template.slots[i].kind === 'lookCover') used.add(i);
  }
  const assignments: SlotAssignment[] = [];
  const unmatched: number[] = [];

  for (let itemIdx = 0; itemIdx < itemCategories.length; itemIdx++) {
    const preferred = shapeForCategory(itemCategories[itemIdx]);
    let slotIdx = -1;
    // Pass 1 — preferred shape match
    for (let i = 0; i < template.slots.length; i++) {
      if (used.has(i)) continue;
      if (template.slots[i].shape === preferred) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx === -1) {
      // Pass 2 — auto slot
      for (let i = 0; i < template.slots.length; i++) {
        if (used.has(i)) continue;
        if (template.slots[i].shape === 'auto') {
          slotIdx = i;
          break;
        }
      }
    }
    if (slotIdx !== -1) {
      used.add(slotIdx);
      assignments.push({
        slot: template.slots[slotIdx],
        slotIndex: slotIdx,
        itemIndex: itemIdx,
      });
    } else {
      unmatched.push(itemIdx);
    }
  }

  // Overflow — leftover items dropped into leftover slots in selection order.
  for (const itemIdx of unmatched) {
    for (let i = 0; i < template.slots.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      assignments.push({
        slot: template.slots[i],
        slotIndex: i,
        itemIndex: itemIdx,
      });
      break;
    }
  }

  return assignments.sort((a, b) => (a.slot.z ?? 0) - (b.slot.z ?? 0));
}

/**
 * Phase 2 helper — returns the seed layout (canvas-space center coords +
 * scale=1 + zIndex from slot.z) for each item in a template, using the same
 * slot assignment logic as static rendering. Items not assigned to a slot
 * fall back to the canvas center.
 */
export function defaultLayoutFor(
  template: CollageTemplate,
  items: { id: string; category: string }[]
): { itemId: string; x: number; y: number; scale: number; rotation: number; zIndex: number }[] {
  const assignments = assignItemsToSlots(template, items.map(i => i.category));
  const byItemIndex = new Map<number, { slot: CollageSlot; slotIndex: number }>();
  for (const a of assignments) {
    byItemIndex.set(a.itemIndex, { slot: a.slot, slotIndex: a.slotIndex });
  }
  return items.map((item, idx) => {
    const a = byItemIndex.get(idx);
    if (!a) {
      return { itemId: item.id, x: 540, y: 540, scale: 1, rotation: 0, zIndex: idx + 1 };
    }
    return {
      itemId: item.id,
      x: a.slot.x,
      y: a.slot.y,
      scale: 1,
      rotation: a.slot.rotation ?? 0,
      zIndex: a.slot.z ?? 1,
    };
  });
}

/**
 * Build the editable baked-in TextLayerItems for a template. Seeded onto the
 * canvas ONLY on a deliberate picker tap (handleSelectTemplate). Ids are
 * `tpl-<templateId>-<i>` so a later template switch can swap them out while
 * keeping the creator's own "Aa Text" layers, and so a reopen restores the
 * edited copies (never re-seeds defaults over the creator's work).
 */
export function defaultTextLayersFor(template: CollageTemplate): TextLayerItem[] {
  return (template.defaultTextLayers ?? []).map((t, i) => ({
    id: `tpl-${template.id}-${i}`,
    text: t.text,
    fontSize: t.fontSize,
    color: t.color,
    fontFamily: t.fontToken,
    x: t.x,
    y: t.y,
    scale: 1,
    rotation: t.rotation ?? 0,
    zIndex: t.zIndex ?? 60 + i,
    letterSpacing: t.letterSpacing,
    backgroundColor: t.backgroundColor,
    opacity: t.opacity,
  }));
}

// Re-exported for downstream consumers that already imported from this file.
export type { SlotCategory };
