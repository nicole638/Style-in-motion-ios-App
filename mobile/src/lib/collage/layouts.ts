// Cell coordinates are normalized [0, 1]. applyLayoutToCutouts converts x/y to
// 1080-space for cutout layers; scale stays as a unit fraction.

export interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

export type LayoutItemCount = 1 | 2 | 3 | 4 | 5 | 6;

export interface LayoutTemplate {
  id: string;
  itemCount: LayoutItemCount;
  kind: 'curated' | 'algorithmic';
  name: string;
  cells: LayoutCell[];
}

// ─── Mulberry32 PRNG ────────────────────────────────────────────────────────
// Same implementation as web canonical — must produce identical sequences.
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Binary-partition layout generator ──────────────────────────────────────
// Produces normalized [0,1] rects so algorithmic layouts share the same
// coordinate space as curated ones.
interface Rect { x: number; y: number; w: number; h: number }

function partitionCells(count: number, rng: () => number): Rect[] {
  // Work in [0,1] space; gap is 1.5% of canvas
  const GAP = 0.015;
  const rects: Rect[] = [{ x: 0, y: 0, w: 1, h: 1 }];
  while (rects.length < count) {
    let largest = 0;
    for (let i = 1; i < rects.length; i++) {
      if (rects[i].w * rects[i].h > rects[largest].w * rects[largest].h) largest = i;
    }
    const r = rects[largest];
    const ratio = 0.35 + rng() * 0.3;
    let a: Rect, b: Rect;
    if (r.w >= r.h) {
      const split = r.w * ratio;
      a = { x: r.x, y: r.y, w: split - GAP / 2, h: r.h };
      b = { x: r.x + split + GAP / 2, y: r.y, w: r.w - split - GAP / 2, h: r.h };
    } else {
      const split = r.h * ratio;
      a = { x: r.x, y: r.y, w: r.w, h: split - GAP / 2 };
      b = { x: r.x, y: r.y + split + GAP / 2, w: r.w, h: r.h - split - GAP / 2 };
    }
    rects.splice(largest, 1, a, b);
  }
  return rects;
}

export function generateAlgorithmicLayouts(
  itemCount: LayoutItemCount,
  seed: number,
): LayoutTemplate[] {
  const layouts: LayoutTemplate[] = [];
  for (let i = 0; i < 5; i++) {
    const layoutSeed = (seed * 31 + itemCount * 1009 + i * 7919) >>> 0;
    const rng = mulberry32(layoutSeed);
    const cells = partitionCells(itemCount, rng);
    layouts.push({
      id: `algo-${itemCount}-${seed}-${i}`,
      itemCount,
      kind: 'algorithmic',
      name: `Layout ${i + 1}`,
      cells,
    });
  }
  return layouts;
}

// ─── applyLayoutToCutouts ────────────────────────────────────────────────────
// Cells are in normalized [0,1] space. Cutout x/y are in 1080-space (matches
// the shared looks.collage_layout JSONB convention used by web and iOS).
// scale stays as a unit fraction — the canvas renderer handles the multiplier.
const CANVAS_SIZE = 1080;

export interface CutoutLayoutResult {
  itemId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

export function applyLayoutToCutouts(
  layout: LayoutTemplate,
  cutoutIds: string[],
): CutoutLayoutResult[] {
  return cutoutIds.map((itemId, i) => {
    const cell = layout.cells[i % layout.cells.length];
    const scale = Math.min(cell.w, cell.h) * 0.95;
    const cx = (cell.x + cell.w / 2) * CANVAS_SIZE;
    const cy = (cell.y + cell.h / 2) * CANVAS_SIZE;
    return {
      itemId,
      x: cx,
      y: cy,
      scale,
      rotation: cell.rotation ?? 0,
      zIndex: i + 1,
    };
  });
}

// ─── 30 Curated templates — canonical web values (verbatim) ─────────────────
export const CURATED_LAYOUTS: LayoutTemplate[] = [
  // ─── 1 item ───
  { id: 'curated-1-full', itemCount: 1, kind: 'curated', name: 'Full bleed',
    cells: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { id: 'curated-1-portrait', itemCount: 1, kind: 'curated', name: 'Portrait',
    cells: [{ x: 0.18, y: 0.04, w: 0.64, h: 0.92 }] },
  { id: 'curated-1-square-center', itemCount: 1, kind: 'curated', name: 'Square center',
    cells: [{ x: 0.15, y: 0.15, w: 0.7, h: 0.7 }] },
  { id: 'curated-1-tilted', itemCount: 1, kind: 'curated', name: 'Tilted square',
    cells: [{ x: 0.16, y: 0.16, w: 0.68, h: 0.68, rotation: -4 }] },
  { id: 'curated-1-tall-left', itemCount: 1, kind: 'curated', name: 'Tall left',
    cells: [{ x: 0.05, y: 0.05, w: 0.55, h: 0.9 }] },

  // ─── 2 items ───
  { id: 'curated-2-split-horizontal', itemCount: 2, kind: 'curated', name: 'Split horizontal',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ] },
  { id: 'curated-2-split-vertical', itemCount: 2, kind: 'curated', name: 'Split vertical',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ] },
  { id: 'curated-2-large-small', itemCount: 2, kind: 'curated', name: 'Hero + companion',
    cells: [
      { x: 0, y: 0, w: 0.65, h: 1 },
      { x: 0.65, y: 0.22, w: 0.35, h: 0.56 },
    ] },
  { id: 'curated-2-stacked-narrow', itemCount: 2, kind: 'curated', name: 'Stacked centered',
    cells: [
      { x: 0.15, y: 0.04, w: 0.7, h: 0.46 },
      { x: 0.15, y: 0.5, w: 0.7, h: 0.46 },
    ] },
  { id: 'curated-2-overlap-tilt', itemCount: 2, kind: 'curated', name: 'Overlap + tilt',
    cells: [
      { x: 0.04, y: 0.1, w: 0.55, h: 0.78, rotation: -3 },
      { x: 0.45, y: 0.18, w: 0.5, h: 0.66, rotation: 4 },
    ] },

  // ─── 3 items ───
  { id: 'curated-3-three-across', itemCount: 3, kind: 'curated', name: 'Three across',
    cells: [
      { x: 0, y: 0.13, w: 1 / 3, h: 0.74 },
      { x: 1 / 3, y: 0.13, w: 1 / 3, h: 0.74 },
      { x: 2 / 3, y: 0.13, w: 1 / 3, h: 0.74 },
    ] },
  { id: 'curated-3-three-stacked', itemCount: 3, kind: 'curated', name: 'Three stacked',
    cells: [
      { x: 0.13, y: 0, w: 0.74, h: 1 / 3 },
      { x: 0.13, y: 1 / 3, w: 0.74, h: 1 / 3 },
      { x: 0.13, y: 2 / 3, w: 0.74, h: 1 / 3 },
    ] },
  { id: 'curated-3-feature-plus-pair', itemCount: 3, kind: 'curated', name: 'Feature + pair',
    cells: [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 0.5 },
      { x: 0.6, y: 0.5, w: 0.4, h: 0.5 },
    ] },
  { id: 'curated-3-l-shape', itemCount: 3, kind: 'curated', name: 'L-shape',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ] },
  { id: 'curated-3-pinwheel', itemCount: 3, kind: 'curated', name: 'Pinwheel',
    cells: [
      { x: 0.05, y: 0.05, w: 0.55, h: 0.55, rotation: -3 },
      { x: 0.5, y: 0.18, w: 0.45, h: 0.5, rotation: 3 },
      { x: 0.18, y: 0.55, w: 0.6, h: 0.4, rotation: -2 },
    ] },

  // ─── 4 items ───
  { id: 'curated-4-grid-2x2', itemCount: 4, kind: 'curated', name: '2 × 2 grid',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ] },
  { id: 'curated-4-strip-tall', itemCount: 4, kind: 'curated', name: 'Four across',
    cells: [
      { x: 0, y: 0.18, w: 0.25, h: 0.64 },
      { x: 0.25, y: 0.18, w: 0.25, h: 0.64 },
      { x: 0.5, y: 0.18, w: 0.25, h: 0.64 },
      { x: 0.75, y: 0.18, w: 0.25, h: 0.64 },
    ] },
  { id: 'curated-4-hero-plus-three', itemCount: 4, kind: 'curated', name: 'Hero + three',
    cells: [
      { x: 0, y: 0, w: 0.65, h: 1 },
      { x: 0.65, y: 0, w: 0.35, h: 1 / 3 },
      { x: 0.65, y: 1 / 3, w: 0.35, h: 1 / 3 },
      { x: 0.65, y: 2 / 3, w: 0.35, h: 1 / 3 },
    ] },
  { id: 'curated-4-cross', itemCount: 4, kind: 'curated', name: 'Cross',
    cells: [
      { x: 0.3, y: 0, w: 0.4, h: 0.35 },
      { x: 0, y: 0.3, w: 0.35, h: 0.4 },
      { x: 0.65, y: 0.3, w: 0.35, h: 0.4 },
      { x: 0.3, y: 0.65, w: 0.4, h: 0.35 },
    ] },
  { id: 'curated-4-staggered', itemCount: 4, kind: 'curated', name: 'Staggered',
    cells: [
      { x: 0.04, y: 0.04, w: 0.46, h: 0.5 },
      { x: 0.5, y: 0.04, w: 0.46, h: 0.4 },
      { x: 0.04, y: 0.54, w: 0.46, h: 0.42 },
      { x: 0.5, y: 0.44, w: 0.46, h: 0.52 },
    ] },

  // ─── 5 items ───
  { id: 'curated-5-2-over-3', itemCount: 5, kind: 'curated', name: '2 over 3',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    ] },
  { id: 'curated-5-hero-strip', itemCount: 5, kind: 'curated', name: 'Hero + strip',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.65 },
      { x: 0, y: 0.65, w: 0.25, h: 0.35 },
      { x: 0.25, y: 0.65, w: 0.25, h: 0.35 },
      { x: 0.5, y: 0.65, w: 0.25, h: 0.35 },
      { x: 0.75, y: 0.65, w: 0.25, h: 0.35 },
    ] },
  { id: 'curated-5-cluster', itemCount: 5, kind: 'curated', name: 'Cluster',
    cells: [
      { x: 0, y: 0, w: 0.25, h: 0.5 },
      { x: 0.75, y: 0, w: 0.25, h: 0.5 },
      { x: 0.25, y: 0.05, w: 0.5, h: 0.45 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ] },
  { id: 'curated-5-cross-center', itemCount: 5, kind: 'curated', name: 'Plus sign',
    cells: [
      { x: 0.3, y: 0, w: 0.4, h: 0.3 },
      { x: 0, y: 0.3, w: 0.3, h: 0.4 },
      { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
      { x: 0.7, y: 0.3, w: 0.3, h: 0.4 },
      { x: 0.3, y: 0.7, w: 0.4, h: 0.3 },
    ] },
  { id: 'curated-5-zigzag', itemCount: 5, kind: 'curated', name: 'Zigzag',
    cells: [
      { x: 0, y: 0, w: 0.55, h: 0.4 },
      { x: 0.55, y: 0, w: 0.45, h: 0.3 },
      { x: 0.45, y: 0.3, w: 0.55, h: 0.4 },
      { x: 0, y: 0.4, w: 0.45, h: 0.3 },
      { x: 0, y: 0.7, w: 1, h: 0.3 },
    ] },

  // ─── 6 items ───
  { id: 'curated-6-grid-3x2', itemCount: 6, kind: 'curated', name: '3 × 2 grid',
    cells: [
      { x: 0, y: 0, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    ] },
  { id: 'curated-6-grid-2x3', itemCount: 6, kind: 'curated', name: '2 × 3 tall',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 1 / 3, w: 0.5, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
    ] },
  { id: 'curated-6-hero-plus-five', itemCount: 6, kind: 'curated', name: 'Hero + five',
    cells: [
      { x: 0, y: 0, w: 0.6, h: 0.7 },
      { x: 0.6, y: 0, w: 0.4, h: 0.35 },
      { x: 0.6, y: 0.35, w: 0.4, h: 0.35 },
      { x: 0, y: 0.7, w: 1 / 3, h: 0.3 },
      { x: 1 / 3, y: 0.7, w: 1 / 3, h: 0.3 },
      { x: 2 / 3, y: 0.7, w: 1 / 3, h: 0.3 },
    ] },
  { id: 'curated-6-magazine', itemCount: 6, kind: 'curated', name: 'Magazine spread',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.25, h: 0.5 },
      { x: 0.75, y: 0, w: 0.25, h: 0.5 },
      { x: 0, y: 0.5, w: 0.25, h: 0.5 },
      { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ] },
  { id: 'curated-6-asymmetric', itemCount: 6, kind: 'curated', name: 'Asymmetric',
    cells: [
      { x: 0, y: 0, w: 0.4, h: 0.6 },
      { x: 0.4, y: 0, w: 0.6, h: 0.3 },
      { x: 0.4, y: 0.3, w: 0.3, h: 0.3 },
      { x: 0.7, y: 0.3, w: 0.3, h: 0.3 },
      { x: 0, y: 0.6, w: 0.6, h: 0.4 },
      { x: 0.6, y: 0.6, w: 0.4, h: 0.4 },
    ] },
];

// ─── Public helpers ──────────────────────────────────────────────────────────

export function getCuratedLayouts(itemCount: LayoutItemCount): LayoutTemplate[] {
  return CURATED_LAYOUTS.filter(l => l.itemCount === itemCount);
}

export function getAllLayouts(itemCount: LayoutItemCount, seed: number): LayoutTemplate[] {
  return [
    ...getCuratedLayouts(itemCount),
    ...generateAlgorithmicLayouts(itemCount, seed),
  ];
}
