import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS, type SharedValue } from 'react-native-reanimated';
import { CANVAS_SIZE, slotItemDimensions } from '@/lib/constants/collageSlots';
import {
  CollageTemplate,
  TemplateDecoration,
  assignItemsToSlots,
} from '@/lib/constants/collageTemplates';
import type { ClothingItem, CollageLayoutItem, TextLayerItem, PhotoLayerItem } from '@/lib/state/lookStore';
import { InteractiveCanvasItem, MIN_SCALE, MAX_SCALE } from './InteractiveCanvasItem';
import { getAlphaMask, sampleAlpha, opaqueBounds, type AlphaMask } from '@/lib/collage/alphaHitMask';

/** One cutout's geometry + alpha mask, in canvas (0..1080) space, used for
 *  shape-accurate tap resolution. */
interface HitEntry {
  id: string;
  kind: 'item' | 'layer';
  /** Center in canvas units. */
  x: number;
  y: number;
  /** Base box dims in canvas units (pre-scale). */
  baseWidth: number;
  baseHeight: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  zIndex: number;
  /** Alpha mask, or null → opaque rectangle (text layers / failed decode). */
  mask: AlphaMask | null;
}

/**
 * Returns the cutout alpha (0..255) at a canvas-space tap for one entry,
 * accounting for the entry's rotation, scale, and `contentFit:"contain"`
 * letterboxing. Pure — no side effects. Returns 0 when the tap is outside the
 * box or over a transparent/letterbox pixel. (Recovered from the prior
 * alpha-mask hit-test; used ONLY for tap selection routing.)
 */
function hitAlpha(entry: HitEntry, px: number, py: number): number {
  const { x, y, baseWidth, baseHeight, scale: sc, rotation, mask } = entry;
  // Tap → local (undo translation then rotation).
  const dx = px - x;
  const dy = py - y;
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const halfW = (baseWidth * sc) / 2;
  const halfH = (baseHeight * sc) / 2;
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0; // outside box
  if (!mask) return 255; // opaque rectangle (text / failed decode)

  // Box-normalized 0..1 within the (scaled) box.
  const bu = (rx + halfW) / (baseWidth * sc);
  const bv = (ry + halfH) / (baseHeight * sc);

  // Account for contain-fit letterboxing of the image within the box.
  const imgAspect = mask.w / mask.h;
  const boxAspect = baseWidth / baseHeight;
  let drawnW: number;
  let drawnH: number;
  let offX: number;
  let offY: number;
  if (imgAspect > boxAspect) {
    drawnW = 1;
    drawnH = boxAspect / imgAspect;
    offX = 0;
    offY = (1 - drawnH) / 2;
  } else {
    drawnH = 1;
    drawnW = imgAspect / boxAspect;
    offX = (1 - drawnW) / 2;
    offY = 0;
  }
  const u = (bu - offX) / drawnW;
  const v = (bv - offY) / drawnH;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0; // letterbox = transparent
  return sampleAlpha(mask, u, v);
}

/** Normalized inset (0..1 fractions of the box) of a cutout's opaque bounds,
 *  used to shrink the selection frame to hug the garment. Returns null when
 *  there is no mask (fall back to the full-box frame). Accounts for the
 *  contain-fit letterboxing of the image within the item's box. */
export interface FrameInset {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function frameInsetFor(mask: AlphaMask | null, boxW: number, boxH: number): FrameInset | null {
  if (!mask) return null;
  const b = opaqueBounds(mask);
  // Opaque bounds are in the image's own 0..1 space. Map into the box, where the
  // image is contain-fit (letterboxed). imgAspect vs boxAspect decides the axis
  // that fills and the axis that is padded.
  const imgAspect = mask.w / mask.h;
  const boxAspect = boxW / boxH;
  let drawnW: number;
  let drawnH: number;
  let offX: number;
  let offY: number;
  if (imgAspect > boxAspect) {
    drawnW = 1;
    drawnH = boxAspect / imgAspect;
    offX = 0;
    offY = (1 - drawnH) / 2;
  } else {
    drawnH = 1;
    drawnW = imgAspect / boxAspect;
    offX = (1 - drawnW) / 2;
    offY = 0;
  }
  const left = offX + b.minU * drawnW;
  const right = offX + b.maxU * drawnW;
  const top = offY + b.minV * drawnH;
  const bottom = offY + b.maxV * drawnH;
  return {
    left: Math.max(0, Math.min(1, left)),
    top: Math.max(0, Math.min(1, top)),
    right: Math.max(0, Math.min(1, 1 - right)),
    bottom: Math.max(0, Math.min(1, 1 - bottom)),
  };
}

/** Display size on screen in points; canvas coords scale to this. */
export const CANVAS_DISPLAY_SIZE = 360;

/** Convert canvas-space length to display-space length. */
export const scale = (n: number) => (n * CANVAS_DISPLAY_SIZE) / CANVAS_SIZE;

/**
 * Map a TextLayerItem.fontFamily token to a real loaded font family. Legacy
 * saves used 'display' | 'body'; newer saves use the explicit tokens below.
 * The Dupe Drop / What's-in-my-bag templates add the condensed/elegant/
 * handwritten faces. Anything unknown falls back to DMSans Regular so old
 * looks still render.
 */
export function resolveFontFamily(token: string | undefined): string {
  switch (token) {
    case 'display':
    case 'serif':
      return 'CormorantGaramond_600SemiBold';
    case 'serif-italic':
      return 'CormorantGaramond_400Regular_Italic';
    case 'sans-bold':
      return 'DMSans_700Bold';
    case 'bebas':
      return 'BebasNeue_400Regular';
    case 'playfair-italic':
      return 'PlayfairDisplay_400Regular_Italic';
    case 'playfair-italic-semibold':
      return 'PlayfairDisplay_600SemiBold_Italic';
    case 'caveat':
      return 'Caveat_700Bold';
    case 'body':
    case 'sans':
    default:
      return 'DMSans_400Regular';
  }
}

export interface CanvasItem extends ClothingItem {
  /** Cutout photo URI from the background-removal step. May be the same as
   * photoUri if cutout failed. */
  cutout_photo_url?: string;
}

export interface CanvasProps {
  items: CanvasItem[];
  selfieUri?: string | null;
  template: CollageTemplate;
  /** Display size override — defaults to CANVAS_DISPLAY_SIZE. */
  size?: number;
}

export interface BaseCanvasProps extends CanvasProps {
  /**
   * Phase 2 — when present, renders items as draggable/pinchable widgets at
   * the supplied canvas-space coords instead of static template slots. Items
   * are looked up by id; missing items fall back to template slot positions.
   */
  layout?: CollageLayoutItem[] | null;
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string | null) => void;
  onCommitItem?: (
    itemId: string,
    next: { x: number; y: number; scale: number; rotation: number }
  ) => void;
  /** Source for any `kind: 'lookCover'` slot. */
  lookCoverPhotoUri?: string | null;
  /** Tap callback for the lookCover slot when no photo is set yet. */
  onPickLookCover?: () => void;
  /** Override map for editable decorations (key = decoration index as string). */
  textOverrides?: Record<string, string>;
  /** Tap callback for editable decorations. Receives the decoration index. */
  onEditDecoration?: (decorationIndex: number) => void;
  /** Free-floating text layers (web CollageLayoutJsonV1.text). */
  textLayers?: TextLayerItem[];
  /** Free-floating photo layers (web CollageLayoutJsonV1.photos). */
  photoLayers?: PhotoLayerItem[];
  /** Canvas background color override (overrides template.bgColor when set). */
  background?: string;
  /** Full-bleed cover-fit backdrop image (rendered behind everything, above bg color). */
  backgroundImage?: string;
  /** Unified select callback for text/photo layers (reuses selectedItemId state). */
  onSelectLayer?: (id: string | null) => void;
  /** Commit callback for text/photo layer transforms. */
  onCommitLayer?: (id: string, next: { x: number; y: number; scale: number; rotation: number }) => void;
  /** When true, hide editing-only overlays (template guide lines, selection box)
   *  so the export/view-shot snapshot shows only backdrop + item cutouts. */
  exporting?: boolean;
}

/**
 * Renders the background, decorations, slot images, and optional selfie for
 * a template. Items are assigned to slots via the assignItemsToSlots helper
 * unless an explicit `layout` is passed (Phase 2 freeform-within-template).
 */
export const BaseCanvas = React.forwardRef<View, BaseCanvasProps>(function BaseCanvas(
  {
    items,
    selfieUri,
    template,
    size = CANVAS_DISPLAY_SIZE,
    layout,
    selectedItemId,
    onSelectItem,
    onCommitItem,
    lookCoverPhotoUri,
    onPickLookCover,
    textOverrides,
    onEditDecoration,
    textLayers,
    photoLayers,
    background,
    backgroundImage,
    onSelectLayer,
    onCommitLayer,
    exporting,
  },
  ref
) {
  const ratio = size / CANVAS_SIZE;
  const s = (n: number) => n * ratio;

  const itemCategories = items.map(i => i.category);
  const assignments = assignItemsToSlots(template, itemCategories);

  const interactive = !!layout && !!onCommitItem;

  // ---- Canvas-level pinch & rotation for the selected item ----------------
  // Per-item pinch can't activate when the second finger lands outside that
  // item's view (empty canvas, the deselect overlay, or a neighbor) — which is
  // exactly what happens with a large hero piece in a corner. So we recognize
  // pinch/rotation on the canvas root (it always contains both fingers) and
  // apply them to whichever item/layer is selected. Pan/tap stay per-item.
  const selected = React.useMemo(() => {
    if (!interactive || !selectedItemId) return null;
    const li = layout?.find((l) => l.itemId === selectedItemId);
    if (li) return { id: li.itemId, x: li.x, y: li.y, scale: li.scale, rotation: li.rotation, kind: 'item' as const };
    const pl = (photoLayers ?? []).find((p) => p.id === selectedItemId);
    if (pl) return { id: pl.id, x: pl.x, y: pl.y, scale: pl.scale, rotation: pl.rotation, kind: 'layer' as const };
    const tl = (textLayers ?? []).find((t) => t.id === selectedItemId);
    if (tl) return { id: tl.id, x: tl.x, y: tl.y, scale: tl.scale, rotation: tl.rotation, kind: 'layer' as const };
    return null;
  }, [interactive, selectedItemId, layout, photoLayers, textLayers]);

  const liveScale = useSharedValue(1);
  const liveRotation = useSharedValue(0);
  const pinchActive = useSharedValue(false);
  const hasSelection = useSharedValue(false);
  const selScale = useSharedValue(1);
  const selRotation = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRotation = useSharedValue(0);

  // Keep the selected item's committed scale/rotation (and whether anything is
  // selected) in shared values so the gesture worklets can seed from them
  // without a stale JS closure.
  React.useEffect(() => {
    selScale.value = selected?.scale ?? 1;
    selRotation.value = selected?.rotation ?? 0;
    hasSelection.value = !!selected;
  }, [selected, selScale, selRotation, hasSelection]);

  const commitSelected = React.useCallback(
    (nScale: number, nRotation: number) => {
      if (!selected) return;
      const next = { x: selected.x, y: selected.y, scale: nScale, rotation: nRotation };
      if (selected.kind === 'item') onCommitItem?.(selected.id, next);
      else onCommitLayer?.(selected.id, next);
    },
    [selected, onCommitItem, onCommitLayer]
  );

  // When a two-finger gesture starts with nothing selected, target the topmost
  // (highest-zIndex) item/layer and seed the live values from it — so a creator
  // can pinch the hero piece directly without tapping to select it first.
  const selectTopAndSeed = React.useCallback(() => {
    if (!interactive) return;
    let top: { id: string; scale: number; rotation: number; kind: 'item' | 'layer' } | null = null;
    let topZ = -Infinity;
    for (const l of layout ?? []) {
      if (l.zIndex > topZ) { topZ = l.zIndex; top = { id: l.itemId, scale: l.scale, rotation: l.rotation, kind: 'item' }; }
    }
    for (const p of photoLayers ?? []) {
      if (p.zIndex > topZ) { topZ = p.zIndex; top = { id: p.id, scale: p.scale, rotation: p.rotation, kind: 'layer' }; }
    }
    for (const t of textLayers ?? []) {
      if (t.zIndex > topZ) { topZ = t.zIndex; top = { id: t.id, scale: t.scale, rotation: t.rotation, kind: 'layer' }; }
    }
    if (!top) return;
    if (top.kind === 'item') onSelectItem?.(top.id);
    else onSelectLayer?.(top.id);
    selScale.value = top.scale;
    selRotation.value = top.rotation;
    startScale.value = top.scale;
    startRotation.value = top.rotation;
    liveScale.value = top.scale;
    liveRotation.value = top.rotation;
    pinchActive.value = true;
  }, [interactive, layout, photoLayers, textLayers, onSelectItem, onSelectLayer, selScale, selRotation, startScale, startRotation, liveScale, liveRotation, pinchActive]);

  const canvasManipGesture = React.useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        'worklet';
        if (hasSelection.value) {
          startScale.value = selScale.value;
          liveScale.value = selScale.value;
          liveRotation.value = selRotation.value;
          pinchActive.value = true;
        } else {
          // No selection yet — pick the topmost item on the JS thread, which
          // also seeds startScale and flips pinchActive once ready.
          runOnJS(selectTopAndSeed)();
        }
      })
      .onUpdate((e) => {
        'worklet';
        if (!pinchActive.value) return;
        liveScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
      })
      .onEnd(() => {
        'worklet';
        pinchActive.value = false;
        runOnJS(commitSelected)(liveScale.value, liveRotation.value);
      });
    const rotate = Gesture.Rotation()
      .onStart(() => {
        'worklet';
        if (hasSelection.value) {
          startRotation.value = selRotation.value;
          if (!pinchActive.value) {
            liveScale.value = selScale.value;
            pinchActive.value = true;
          }
          liveRotation.value = selRotation.value;
        } else {
          runOnJS(selectTopAndSeed)();
        }
      })
      .onUpdate((e) => {
        'worklet';
        if (!pinchActive.value) return;
        // e.rotation is radians — convert to degrees and add to the start.
        liveRotation.value = startRotation.value + (e.rotation * 180) / Math.PI;
      })
      .onEnd(() => {
        'worklet';
        pinchActive.value = false;
        runOnJS(commitSelected)(liveScale.value, liveRotation.value);
      });
    return Gesture.Simultaneous(pinch, rotate);
    // Shared values are stable refs; the callbacks are the only tracked deps.
  }, [commitSelected, selectTopAndSeed, hasSelection, liveScale, liveRotation, pinchActive, selScale, selRotation, startScale, startRotation]);

  // ---- Alpha masks for shape-accurate TAP selection (no gesture changes) ---
  // Each cutout URI is decoded once into a tiny alpha map. The masks feed two
  // read-only concerns: (1) resolving which piece a tap actually landed on
  // (fall through transparent regions to the piece below), and (2) trimming a
  // cutout's selection frame to its opaque bounds. Neither touches pan/pinch/
  // scale or any scroll plumbing.
  const [masks, setMasks] = React.useState<Record<string, AlphaMask | null>>({});
  React.useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    const uris = new Set<string>();
    for (const it of items) {
      const u = it.cutout_photo_url || it.photoUri;
      if (u) uris.add(u);
    }
    for (const pl of photoLayers ?? []) {
      if (pl.url) uris.add(pl.url);
    }
    for (const u of uris) {
      if (u in masks) continue; // already loaded / loading resolved
      getAlphaMask(u).then((m) => {
        if (cancelled) return;
        setMasks((prev) => (u in prev ? prev : { ...prev, [u]: m }));
      });
    }
    return () => {
      cancelled = true;
    };
    // `masks` intentionally excluded — we guard with `u in masks` and merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, items, photoLayers]);

  // Absolute (window) origin of the canvas root, refreshed on layout & on each
  // gesture begin; used to convert a tap's absoluteX/Y → canvas units.
  const canvasOriginRef = React.useRef<{ pageX: number; pageY: number }>({ pageX: 0, pageY: 0 });
  const canvasMeasuredRef = React.useRef(false);
  const canvasRootRef = React.useRef<View | null>(null);
  const measureCanvasOrigin = React.useCallback(() => {
    const node = canvasRootRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((wx, wy, w, h) => {
      if ((w ?? 0) <= 0 && (h ?? 0) <= 0) return;
      canvasOriginRef.current = { pageX: wx, pageY: wy };
      canvasMeasuredRef.current = true;
    });
  }, []);

  // Re-measure the window origin across a few frames on mount so a first tap
  // (before layout settles) still maps to correct canvas coords.
  React.useEffect(() => {
    if (!interactive) return;
    let frame = 0;
    let raf: ReturnType<typeof requestAnimationFrame> | null = null;
    const tick = () => {
      measureCanvasOrigin();
      frame += 1;
      if (!canvasMeasuredRef.current && frame < 10) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [interactive, measureCanvasOrigin]);

  // Assemble hit-test entries (canvas units) for topmost-opaque tap routing.
  const hitEntries = React.useMemo<HitEntry[]>(() => {
    if (!interactive) return [];
    const entries: HitEntry[] = [];
    for (const li of layout ?? []) {
      const itemIdx = items.findIndex((i) => i.id === li.itemId);
      if (itemIdx === -1) continue;
      const item = items[itemIdx];
      const uri = item.cutout_photo_url || item.photoUri;
      if (!uri) continue;
      const a = assignments.find((x) => x.itemIndex === itemIdx);
      let w = 460;
      let h = 460;
      if (a) {
        const d = slotItemDimensions(a.slot, item.category);
        w = d.w;
        h = d.h;
      }
      entries.push({
        id: li.itemId,
        kind: 'item',
        x: li.x,
        y: li.y,
        baseWidth: w,
        baseHeight: h,
        scale: li.scale,
        rotation: li.rotation,
        zIndex: li.zIndex,
        mask: masks[uri] ?? null,
      });
    }
    for (const pl of photoLayers ?? []) {
      if (!pl.url) continue;
      const baseWidth = 600;
      const baseHeight = pl.aspectRatio && pl.aspectRatio > 0 ? baseWidth / pl.aspectRatio : 600;
      entries.push({
        id: pl.id,
        kind: 'layer',
        x: pl.x,
        y: pl.y,
        baseWidth,
        baseHeight,
        scale: pl.scale,
        rotation: pl.rotation,
        zIndex: pl.zIndex,
        mask: masks[pl.url] ?? null,
      });
    }
    // Text layers are opaque rectangles (no mask) — they keep the shipped
    // box-based selection behavior; including them here only lets a tap on a
    // text layer win over a transparent cutout region beneath it, matching the
    // visible z-order. Their frame/box sizing is unchanged.
    for (const tl of textLayers ?? []) {
      entries.push({
        id: tl.id,
        kind: 'layer',
        x: tl.x,
        y: tl.y,
        baseWidth: 800,
        baseHeight: 200,
        scale: tl.scale,
        rotation: tl.rotation,
        zIndex: tl.zIndex,
        mask: null,
      });
    }
    return entries;
  }, [interactive, layout, items, assignments, photoLayers, textLayers, masks]);

  const hitEntriesRef = React.useRef<HitEntry[]>(hitEntries);
  hitEntriesRef.current = hitEntries;
  const ratioRef = React.useRef(ratio);
  ratioRef.current = ratio;

  const selectItemRef = React.useRef(onSelectItem);
  selectItemRef.current = onSelectItem;
  const selectLayerRef = React.useRef(onSelectLayer);
  selectLayerRef.current = onSelectLayer;

  /** Convert a tap's window coords → canvas units, then walk entries z-index
   *  DESCENDING and return the first whose cutout alpha under the finger clears
   *  the ~5% threshold. Transparent regions fall through to the piece below.
   *  Returns null when nothing opaque is under the finger. */
  const resolveTapTarget = React.useCallback(
    (absX: number, absY: number): { id: string; kind: 'item' | 'layer' } | null => {
      const { pageX, pageY } = canvasOriginRef.current;
      const r = ratioRef.current || 1;
      const px = (absX - pageX) / r;
      const py = (absY - pageY) / r;
      const sorted = [...hitEntriesRef.current].sort((a, b) => b.zIndex - a.zIndex);
      for (const e of sorted) {
        // Threshold ~13/255 (~5%): thin/feathered edges register; near-transparent
        // anti-alias fringe falls through to the piece below.
        if (hitAlpha(e, px, py) > 13) return { id: e.id, kind: e.kind };
      }
      return null;
    },
    []
  );

  /** Tap resolver handed to each interactive item: select the topmost-opaque
   *  target under the finger, or deselect when the tap hits only transparency.
   *  This is the ONLY selection path that changed; pan/pinch are untouched. */
  const onResolveTapSelect = React.useCallback(
    (absX: number, absY: number) => {
      const t = resolveTapTarget(absX, absY);
      if (!t) {
        selectItemRef.current?.(null);
        selectLayerRef.current?.(null);
        return;
      }
      if (t.kind === 'item') selectItemRef.current?.(t.id);
      else selectLayerRef.current?.(t.id);
    },
    [resolveTapTarget]
  );

  // Build per-item dimensions based on slot assignment for interactive mode.
  const slotByItemIndex = new Map<number, { slotIndex: number; rotation: number; w: number; h: number }>();
  for (const a of assignments) {
    const item = items[a.itemIndex];
    if (!item) continue;
    const { w, h } = slotItemDimensions(a.slot, item.category);
    slotByItemIndex.set(a.itemIndex, {
      slotIndex: a.slotIndex,
      rotation: a.slot.rotation ?? 0,
      w,
      h,
    });
  }

  // Sort interactive items by zIndex so taps reorder visually.
  const sortedLayout = layout
    ? [...layout].sort((a, b) => a.zIndex - b.zIndex)
    : null;

  const handleCanvasPress = () => {
    if (interactive && onSelectItem) onSelectItem(null);
  };

  // Fan the forwarded ref out to a local ref too, so we can measureInWindow for
  // tap→canvas coordinate conversion without disturbing the export snapshot ref.
  const setCanvasRef = (node: View | null) => {
    canvasRootRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<View | null>).current = node;
  };

  const canvasNode = (
    <View
      ref={setCanvasRef}
      onLayout={measureCanvasOrigin}
      collapsable={false}
      style={[
        styles.canvas,
        {
          width: size,
          height: size,
          backgroundColor: background ?? template.bgColor,
        },
      ]}
      testID="collage-canvas"
    >
      {/* Two-tone split background (e.g. Dupe Drop). Sits directly on the canvas
       * bg, behind items. A creator-picked backdrop (solid `background` or
       * `backgroundImage`) overrides it. */}
      {template.backgroundSplit && !background && !backgroundImage ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="collage-bg-split">
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: s(template.backgroundSplit.atX),
              backgroundColor: template.backgroundSplit.left,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: s(template.backgroundSplit.atX),
              top: 0,
              right: 0,
              bottom: 0,
              backgroundColor: template.backgroundSplit.right,
            }}
          />
        </View>
      ) : null}

      {/* Full-bleed cover-fit backdrop image. Rendered above bg color but
       * below the deselect overlay so empty-canvas taps still deselect. */}
      {backgroundImage ? (
        <Image
          source={{ uri: backgroundImage }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          testID="collage-backdrop"
        />
      ) : null}

      {/* Canvas-blank tap area to deselect (interactive mode only).
       * Rendered FIRST so that decorations, lookCover, and items above can
       * still receive their own taps — empty-canvas taps fall through to here. */}
      {interactive ? (
        <Pressable
          onPress={handleCanvasPress}
          style={StyleSheet.absoluteFill}
          testID="collage-canvas-deselect"
        />
      ) : null}

      {/* Decorations rendered above the deselect overlay so editable text
       * decorations can receive taps. */}
      {(template.decorations ?? []).map((d, idx) => {
        if (exporting && d.type === 'line') return null;
        return (
          <Decoration
            key={`deco-${idx}`}
            decoration={d}
            scale={s}
            override={textOverrides?.[String(idx)]}
            onPress={d.editable && onEditDecoration ? () => onEditDecoration(idx) : undefined}
          />
        );
      })}

      {/* lookCover slots — rendered statically at template-defined dims. */}
      {template.slots.map((slot, slotIndex) => {
        if (slot.kind !== 'lookCover') return null;
        const w = slot.width ?? 460;
        const h = slot.height ?? 720;
        const left = s(slot.x - w / 2);
        const top = s(slot.y - h / 2);
        const transform = slot.rotation ? [{ rotate: `${slot.rotation}deg` }] : undefined;
        return (
          <View
            key={`lookcover-${slotIndex}`}
            style={{
              position: 'absolute',
              left,
              top,
              width: s(w),
              height: s(h),
              transform,
              zIndex: slot.z ?? 1,
            }}
            testID={`collage-lookcover-${slotIndex}`}
          >
            {lookCoverPhotoUri ? (
              <Pressable
                onPress={onPickLookCover}
                style={StyleSheet.absoluteFill}
                disabled={!onPickLookCover}
                testID="collage-lookcover-swap"
              >
                <Image
                  source={{ uri: lookCoverPhotoUri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={onPickLookCover}
                disabled={!onPickLookCover}
                style={{
                  flex: 1,
                  backgroundColor: '#F0EBE5',
                  borderWidth: 1.5,
                  borderColor: '#C7BDB4',
                  borderStyle: 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: s(20),
                }}
                testID="collage-lookcover-pick"
              >
                <Text
                  style={{
                    fontFamily: 'DMSans_500Medium',
                    fontSize: Math.max(10, s(28)),
                    color: '#6B5E58',
                    textAlign: 'center',
                  }}
                >
                  Tap to add{'\n'}your look photo
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {interactive && sortedLayout ? (
        // Phase 2 — interactive freeform within template
        sortedLayout.map((entry) => {
          const itemIdx = items.findIndex(i => i.id === entry.itemId);
          if (itemIdx === -1) return null;
          const item = items[itemIdx];
          const photoUri = item.cutout_photo_url || item.photoUri;
          if (!photoUri) return null;
          const dims = slotByItemIndex.get(itemIdx);
          // Fallback dimensions if item wasn't assigned a slot (overflow case).
          const w = dims?.w ?? 460;
          const h = dims?.h ?? 460;
          // Rotation is per-item now (user-modifiable). Slot rotation is only
          // used for static Phase 1 rendering below.
          const rot = entry.rotation;
          // Tighten the selection frame to the garment's opaque pixels (trim the
          // transparent PNG margins). Maps the mask's opaque bounds — which are
          // over the IMAGE, contain-fit inside the box — into box-fraction insets.
          const itemFrameInset = frameInsetFor(masks[photoUri] ?? null, w, h);
          return (
            <View
              key={`int-${entry.itemId}`}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                zIndex: entry.zIndex,
              }}
              pointerEvents="box-none"
            >
              <InteractiveCanvasItem
                itemId={entry.itemId}
                photoUri={photoUri}
                x={entry.x}
                y={entry.y}
                scale={entry.scale}
                baseWidth={w}
                baseHeight={h}
                rotation={rot}
                canvasSize={size}
                selected={selectedItemId === entry.itemId}
                exporting={exporting}
                onSelect={(id) => onSelectItem?.(id)}
                onCommit={(id, next) => onCommitItem?.(id, next)}
                onResolveTapSelect={onResolveTapSelect}
                onGestureBegin={measureCanvasOrigin}
                frameInset={itemFrameInset}
                showSelectionBox={false}
                liveScale={liveScale}
                liveRotation={liveRotation}
                pinchActive={pinchActive}
                testID={`collage-item-${entry.itemId}`}
              />
            </View>
          );
        })
      ) : (
        // Phase 1 — static slot rendering (already z-sorted by assignItemsToSlots)
        assignments.map(({ slot, slotIndex, itemIndex }) => {
          const item = items[itemIndex];
          if (!item) return null;
          const photoUri = item.cutout_photo_url || item.photoUri;
          if (!photoUri) return null;
          const { w, h } = slotItemDimensions(slot, item.category);
          const left = s(slot.x - w / 2);
          const top = s(slot.y - h / 2);
          return (
            <View
              key={`slot-${slotIndex}`}
              style={{
                position: 'absolute',
                left,
                top,
                width: s(w),
                height: s(h),
                transform: slot.rotation ? [{ rotate: `${slot.rotation}deg` }] : undefined,
              }}
              testID={`collage-slot-${slotIndex}`}
            >
              <Image
                source={{ uri: photoUri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            </View>
          );
        })
      )}

      {/* Free-floating photo layers */}
      {interactive ? (photoLayers ?? []).map((pl) => {
        // Skip layers with no url. Empty-string URIs on web resolve to the
        // current page (Metro bundler) and trigger "No host header was found".
        if (!pl.url) return null;
        // Size the bounding box from the photo's aspect_ratio so portrait
        // virtual-model outputs aren't clipped at the top by a square slot.
        // Width stays at 600 in canvas space; height grows for taller-than-wide.
        const baseWidth = 600;
        const baseHeight = pl.aspectRatio && pl.aspectRatio > 0
          ? baseWidth / pl.aspectRatio
          : 600;
        const layerFrameInset = frameInsetFor(masks[pl.url] ?? null, baseWidth, baseHeight);
        return (
          <View
            key={`photo-layer-${pl.id}`}
            style={{ position: 'absolute', left: 0, top: 0, zIndex: pl.zIndex }}
            pointerEvents="box-none"
          >
            <InteractiveCanvasItem
              itemId={pl.id}
              x={pl.x}
              y={pl.y}
              scale={pl.scale}
              baseWidth={baseWidth}
              baseHeight={baseHeight}
              rotation={pl.rotation}
              canvasSize={size}
              selected={selectedItemId === pl.id}
              exporting={exporting}
              onSelect={(id) => onSelectLayer?.(id)}
              onCommit={(id, next) => onCommitLayer?.(id, next)}
              onResolveTapSelect={onResolveTapSelect}
              onGestureBegin={measureCanvasOrigin}
              frameInset={layerFrameInset}
              showSelectionBox={false}
              liveScale={liveScale}
              liveRotation={liveRotation}
              pinchActive={pinchActive}
              testID={`collage-photo-layer-${pl.id}`}
            >
              <Image
                source={{ uri: pl.url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            </InteractiveCanvasItem>
          </View>
        );
      }) : null}

      {/* Free-floating text layers */}
      {interactive ? (textLayers ?? []).map((tl) => (
        <TextLayer
          key={`text-layer-${tl.id}`}
          layer={tl}
          ratio={ratio}
          canvasSize={size}
          selected={selectedItemId === tl.id}
          exporting={exporting}
          onSelectLayer={onSelectLayer}
          onCommitLayer={onCommitLayer}
          liveScale={liveScale}
          liveRotation={liveRotation}
          pinchActive={pinchActive}
        />
      )) : null}

      {/* Static baked-in text — non-interactive renders only (template
       * thumbnails in the picker). The interactive editor renders the live,
       * editable copies above instead, so we never double-draw. */}
      {!interactive ? (template.defaultTextLayers ?? []).map((t, i) => {
        const fontFamily = resolveFontFamily(t.fontToken);
        const fontSize = s(t.fontSize);
        const hasPill = !!t.backgroundColor;
        const padV = hasPill ? Math.max(1, fontSize * 0.14) : 0;
        const padH = hasPill ? Math.max(2, fontSize * 0.4) : 0;
        return (
          <View
            key={`tpl-text-${i}`}
            style={{
              position: 'absolute',
              left: s(t.x - 400),
              top: s(t.y) - fontSize,
              width: s(800),
              alignItems: 'center',
              transform: t.rotation ? [{ rotate: `${t.rotation}deg` }] : undefined,
              zIndex: t.zIndex ?? 60 + i,
            }}
            pointerEvents="none"
          >
            <View
              style={hasPill ? {
                backgroundColor: t.backgroundColor,
                paddingVertical: padV,
                paddingHorizontal: padH,
                borderRadius: 999,
              } : undefined}
            >
              <Text
                style={{
                  fontFamily,
                  fontSize,
                  color: t.color,
                  textAlign: 'center',
                  letterSpacing: t.letterSpacing ? s(t.letterSpacing) : undefined,
                  opacity: t.opacity,
                }}
                numberOfLines={2}
              >
                {t.text}
              </Text>
            </View>
          </View>
        );
      }) : null}

      {/* Optional selfie circle */}
      {selfieUri && template.selfieSlot ? (
        <View
          style={{
            position: 'absolute',
            left: s(template.selfieSlot.x - template.selfieSlot.size / 2),
            top: s(template.selfieSlot.y - template.selfieSlot.size / 2),
            width: s(template.selfieSlot.size),
            height: s(template.selfieSlot.size),
            borderRadius: s(template.selfieSlot.size) / 2,
            overflow: 'hidden',
            borderWidth: 3,
            borderColor: '#FFFFFF',
            backgroundColor: '#FFFFFF',
          }}
          testID="collage-selfie"
        >
          <Image
            source={{ uri: selfieUri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        </View>
      ) : null}
    </View>
  );

  // Attach the canvas-level pinch/rotation recognizer only in interactive mode.
  // The gesture lives on a wrapper around the canvas (not the canvas View
  // itself) so the forwarded `ref` used for the export snapshot stays clean,
  // while the recognizer still contains every item's touch area.
  return interactive ? (
    <GestureDetector gesture={canvasManipGesture}>
      <View collapsable={false} style={{ width: size, height: size }}>
        {canvasNode}
      </View>
    </GestureDetector>
  ) : (
    canvasNode
  );
});

interface TextLayerProps {
  layer: TextLayerItem;
  ratio: number;
  canvasSize: number;
  selected: boolean;
  exporting?: boolean;
  onSelectLayer?: (id: string | null) => void;
  onCommitLayer?: (id: string, next: { x: number; y: number; scale: number; rotation: number }) => void;
  liveScale: SharedValue<number>;
  liveRotation: SharedValue<number>;
  pinchActive: SharedValue<boolean>;
}

/**
 * A free-floating text layer (incl. Dupe Drop price bubbles).
 *
 * The selectable/draggable frame AND the drawn selection box are sized to the
 * ACTUAL rendered pill — we measure the rendered content with `onLayout`,
 * convert the display-space size back to canvas-space units, and feed those as
 * `baseWidth`/`baseHeight` to `InteractiveCanvasItem`. Previously these were
 * hardcoded to 800×200 canvas units (≈266×66pt on a 360pt canvas), so a tiny
 * `$—` pill got a box roughly half the canvas wide that overlapped and stole
 * taps from neighboring bubbles/cutouts. `scale` still multiplies on top, but
 * now on a base that hugs the content.
 */
function TextLayer({
  layer: tl,
  ratio,
  canvasSize,
  selected,
  exporting,
  onSelectLayer,
  onCommitLayer,
  liveScale,
  liveRotation,
  pinchActive,
}: TextLayerProps) {
  const fontFamily = resolveFontFamily(tl.fontFamily);
  const displayFontSize = tl.fontSize * ratio;
  // Optional pill background (e.g. Dupe Drop price chips) — padding scales
  // with the font so the chip hugs the text at any size.
  const hasPill = !!tl.backgroundColor;
  const padV = hasPill ? Math.max(2, displayFontSize * 0.14) : 0;
  const padH = hasPill ? Math.max(4, displayFontSize * 0.4) : 0;

  // A few px of handle padding around the measured content so the border/
  // touch target isn't flush against the glyphs. Canvas-space (÷ratio below).
  const HANDLE_PAD_PT = 6;

  // Measured content size in canvas-space units. Seeded with a small estimate
  // from the font so the first frame (before onLayout fires) isn't oversized;
  // corrected to the real rendered bounds on layout.
  const estCanvasW = tl.fontSize * Math.max(1, tl.text.length) * 0.6 + padH * 2 / ratio;
  const estCanvasH = tl.fontSize * 1.4 + padV * 2 / ratio;
  const [measured, setMeasured] = React.useState<{ w: number; h: number } | null>(null);

  const baseWidth = (measured?.w ?? estCanvasW) + (HANDLE_PAD_PT * 2) / ratio;
  const baseHeight = (measured?.h ?? estCanvasH) + (HANDLE_PAD_PT * 2) / ratio;

  return (
    <View
      style={{ position: 'absolute', left: 0, top: 0, zIndex: tl.zIndex }}
      pointerEvents="box-none"
    >
      <InteractiveCanvasItem
        itemId={tl.id}
        x={tl.x}
        y={tl.y}
        scale={tl.scale}
        baseWidth={baseWidth}
        baseHeight={baseHeight}
        rotation={tl.rotation}
        canvasSize={canvasSize}
        selected={selected}
        exporting={exporting}
        onSelect={(id) => onSelectLayer?.(id)}
        onCommit={(id, next) => onCommitLayer?.(id, next)}
        liveScale={liveScale}
        liveRotation={liveRotation}
        pinchActive={pinchActive}
        testID={`collage-text-layer-${tl.id}`}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              // Convert measured display-space px back to canvas-space units.
              const w = width / ratio;
              const h = height / ratio;
              setMeasured((prev) =>
                prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5
                  ? prev
                  : { w, h }
              );
            }}
            style={hasPill ? {
              backgroundColor: tl.backgroundColor,
              paddingVertical: padV,
              paddingHorizontal: padH,
              borderRadius: 999,
            } : undefined}
          >
            <Text
              style={{
                fontFamily,
                fontSize: displayFontSize,
                color: tl.color,
                textAlign: 'center',
                letterSpacing: tl.letterSpacing ? tl.letterSpacing * ratio : undefined,
                opacity: tl.opacity,
              }}
              numberOfLines={3}
            >
              {tl.text}
            </Text>
          </View>
        </View>
      </InteractiveCanvasItem>
    </View>
  );
}

interface DecorationProps {
  decoration: TemplateDecoration;
  scale: (n: number) => number;
  /** Per-look override of the text. Only honored when `decoration.editable`. */
  override?: string;
  /** When provided, the decoration becomes tappable and fires this. */
  onPress?: () => void;
}

function Decoration({ decoration: d, scale: s, override, onPress }: DecorationProps) {
  if (d.type === 'text') {
    const fontSize = d.fontSize ? s(d.fontSize) : s(40);
    const letterSpacing = d.letterSpacing ? s(d.letterSpacing) : 0;
    const editable = !!d.editable;
    const trimmed = (override ?? '').trim();
    const showPlaceholder = editable && !trimmed && !(d.text && d.text.trim());
    const displayText = trimmed
      ? override!
      : showPlaceholder
        ? (d.placeholder ?? 'Tap to edit')
        : (d.text ?? '');
    const minHeight = d.minHeight ? s(d.minHeight) : undefined;
    const content = (
      <Text
        style={{
          fontFamily: d.fontFamily,
          fontSize,
          color: showPlaceholder ? '#A39A91' : (d.color ?? '#1A1210'),
          letterSpacing,
          textAlign: d.align ?? 'left',
          fontStyle: d.editable ? 'italic' : 'normal',
        }}
      >
        {displayText}
      </Text>
    );
    const containerStyle = {
      position: 'absolute' as const,
      left: s(d.x),
      top: s(d.y),
      width: d.w ? s(d.w) : undefined,
      minHeight,
      zIndex: d.z,
    };
    if (onPress) {
      return (
        <Pressable onPress={onPress} style={containerStyle} testID="collage-decoration-edit">
          {content}
        </Pressable>
      );
    }
    return (
      <View style={containerStyle} pointerEvents="none">
        {content}
      </View>
    );
  }
  if (d.type === 'line') {
    return (
      <View
        style={{
          position: 'absolute',
          left: s(d.x),
          top: s(d.y),
          width: d.w ? s(d.w) : 1,
          height: d.h ? s(d.h) : Math.max(1, s(d.thickness ?? 1)),
          backgroundColor: d.color ?? '#1A1210',
          zIndex: d.z,
        }}
        pointerEvents="none"
      />
    );
  }
  if (d.type === 'badge') {
    // Centered circular badge (e.g. Dupe Drop's "vs"). x/y are the center.
    const r = s(d.radius ?? 60);
    return (
      <View
        style={{
          position: 'absolute',
          left: s(d.x) - r,
          top: s(d.y) - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: d.fill ?? '#211C18',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: d.z ?? 100,
        }}
        pointerEvents="none"
      >
        <Text
          style={{
            fontFamily: d.fontFamily,
            fontSize: d.fontSize ? s(d.fontSize) : s(48),
            color: d.color ?? '#FFFFFF',
          }}
        >
          {d.text ?? ''}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  canvas: {
    position: 'relative',
    overflow: 'hidden',
  },
});
