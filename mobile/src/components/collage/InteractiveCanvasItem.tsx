import React, { useEffect } from 'react';
import { View, Image } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { CANVAS_SIZE } from '@/lib/constants/collageSlots';
import { CANVAS_DISPLAY_SIZE } from './canvasShared';

/** Scale clamps for pinch.
 *
 * Loosened from the original 0.3–2.5 range so items in small slots
 * (280×280 in canvas coords) can grow large enough to anchor the
 * composition (×4.5 = 1260×1260, > full canvas), and so accessories /
 * jewelry can shrink to a true satellite size (×0.15 of a 280×280 slot
 * = 42×42, perfect for a watch or earring detail near a larger piece).
 * The tight original range made items feel stuck at a fixed scale.
 *
 * Exported so the canvas-level pinch/rotation handler (BaseCanvas) clamps
 * to the same bounds. */
export const MIN_SCALE = 0.15;
export const MAX_SCALE = 4.5;

export interface InteractiveCanvasItemProps {
  itemId: string;
  photoUri?: string;               // optional — rendered only when children is absent
  children?: React.ReactNode;      // rendered instead of <Image> when present
  /** Canvas-space center X (0–1080). */
  x: number;
  /** Canvas-space center Y (0–1080). */
  y: number;
  /** Multiplicative scale on top of base width/height. */
  scale: number;
  /** Base item dimensions in canvas space. */
  baseWidth: number;
  baseHeight: number;
  /** Item rotation in degrees — user-modifiable via two-finger gesture. */
  rotation: number;
  /** Display size of the canvas in points (defaults to CANVAS_DISPLAY_SIZE). */
  canvasSize?: number;
  /**
   * Canvas-space height in 1080-units. Defaults to CANVAS_SIZE (1080 = square,
   * the collage canvas). Portrait surfaces (Style-a-Look hero, 1080×1440) pass
   * 1440 so the pan clamp lets text travel the full height instead of snapping
   * back at the square boundary.
   */
  canvasHeightUnits?: number;
  selected: boolean;
  exporting?: boolean;
  onSelect: (itemId: string) => void;
  /** Called when pan/pinch/rotation finalizes. */
  onCommit: (
    itemId: string,
    next: { x: number; y: number; scale: number; rotation: number }
  ) => void;
  /**
   * Shape-accurate TAP routing (cutouts only). When provided, a tap resolves the
   * topmost-OPAQUE piece under the finger across ALL items instead of always
   * selecting this one — so a tap on this cutout's transparent margin falls
   * through to the piece behind. Selection ONLY; pan/pinch/rotation and their
   * scale clamps are unchanged. When absent, tap selects self (legacy path).
   */
  onResolveTapSelect?: (absX: number, absY: number) => void;
  /** Fired on JS at the very start of a tap so the canvas can refresh its
   *  window origin before the tap resolves to canvas coords. */
  onGestureBegin?: () => void;
  /**
   * Normalized (0..1 box fractions) inset for the SELECTION FRAME only, so the
   * drawn border hugs the garment's opaque pixels instead of the full PNG rect.
   * Does not affect the gesture/hit box, image layout, or transforms.
   */
  frameInset?: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * Whether to draw a visible selection outline when this item is selected.
   * Text/price bubbles keep their box (default true). Image layers (cutouts /
   * photo layers) pass false — selection still works via the alpha-mask
   * hit-test, but no rectangle is drawn (and never in the export). Cosmetic
   * only: does not affect the gesture/hit box, transforms, or scale clamps.
   */
  showSelectionBox?: boolean;
  /**
   * Canvas-level live pinch/rotation feedback. Pinch & rotation are handled on
   * the canvas root (so a second finger landing off this item still works) and
   * write to these shared values. When `pinchActive` is true AND this item is
   * `selected`, we render from these instead of our own committed scale/rotation.
   */
  liveScale?: SharedValue<number>;
  liveRotation?: SharedValue<number>;
  pinchActive?: SharedValue<boolean>;
  testID?: string;
}

export function InteractiveCanvasItem({
  itemId,
  photoUri,
  children,
  x,
  y,
  scale,
  baseWidth,
  baseHeight,
  rotation,
  canvasSize = CANVAS_DISPLAY_SIZE,
  canvasHeightUnits = CANVAS_SIZE,
  selected,
  exporting,
  onSelect,
  onCommit,
  onResolveTapSelect,
  onGestureBegin,
  frameInset,
  showSelectionBox = true,
  liveScale,
  liveRotation,
  pinchActive,
  testID,
}: InteractiveCanvasItemProps) {
  const ratio = canvasSize / CANVAS_SIZE;

  // All shared values are in canvas-space so the math stays consistent
  // with what we save back to the DB.
  const cx = useSharedValue(x);
  const cy = useSharedValue(y);
  const s = useSharedValue(scale);
  const r = useSharedValue(rotation);
  const startCx = useSharedValue(x);
  const startCy = useSharedValue(y);
  const startS = useSharedValue(scale);
  const startR = useSharedValue(rotation);

  // Sync shared values when props change (e.g. Reset layout, edit reopen).
  useEffect(() => {
    cx.value = x;
    cy.value = y;
    s.value = scale;
    r.value = rotation;
    startCx.value = x;
    startCy.value = y;
    startS.value = scale;
    startR.value = rotation;
  }, [x, y, scale, rotation, cx, cy, s, r, startCx, startCy, startS, startR]);

  const handleSelect = () => onSelect(itemId);
  const handleCommit = (nx: number, ny: number, nScale: number, nRotation: number) => {
    onCommit(itemId, { x: nx, y: ny, scale: nScale, rotation: nRotation });
  };
  // Tap resolution: route to the topmost-opaque piece under the finger when the
  // canvas wired up alpha routing; otherwise select self (legacy). JS-thread.
  const handleTapAt = (absX: number, absY: number) => {
    if (onResolveTapSelect) onResolveTapSelect(absX, absY);
    else onSelect(itemId);
  };

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onBegin(() => {
      'worklet';
      // Refresh the canvas window origin so the tap maps to correct canvas
      // coords even on first load / after scroll. Async, lands before onEnd.
      if (onGestureBegin) runOnJS(onGestureBegin)();
    })
    .onEnd((e) => {
      'worklet';
      // e.absoluteX/Y are window coords; the canvas converts them to canvas
      // units and picks the topmost-opaque target (transparent taps fall
      // through). Falls back to self-select when routing isn't wired.
      runOnJS(handleTapAt)(e.absoluteX, e.absoluteY);
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      'worklet';
      startCx.value = cx.value;
      startCy.value = cy.value;
      runOnJS(handleSelect)();
    })
    .onUpdate((e) => {
      'worklet';
      // Convert display-space delta back to canvas-space.
      cx.value = startCx.value + e.translationX / ratio;
      cy.value = startCy.value + e.translationY / ratio;
    })
    .onEnd(() => {
      'worklet';
      // Clamp center within the canvas so items never disappear off-screen.
      const halfW = (baseWidth * s.value) / 2;
      const halfH = (baseHeight * s.value) / 2;
      const minX = halfW * 0.25;
      const maxX = CANVAS_SIZE - halfW * 0.25;
      const minY = halfH * 0.25;
      const maxY = canvasHeightUnits - halfH * 0.25;
      cx.value = Math.min(maxX, Math.max(minX, cx.value));
      cy.value = Math.min(maxY, Math.max(minY, cy.value));
      runOnJS(handleCommit)(cx.value, cy.value, s.value, r.value);
    });

  // Pinch & rotation are handled at the canvas level (see BaseCanvas) so the
  // second finger can land anywhere — not just on this item's view. Here we
  // keep tap (select) and pan (move), which only need a single pointer.
  const composed = Gesture.Race(tap, pan);

  const animatedStyle = useAnimatedStyle(() => {
    const left = (cx.value - baseWidth / 2) * ratio;
    const top = (cy.value - baseHeight / 2) * ratio;
    // While a canvas-level pinch/rotation is in flight on THIS (selected) item,
    // render from the live shared values for immediate feedback; otherwise use
    // our own committed scale/rotation.
    const live = selected && pinchActive ? pinchActive.value : false;
    const sc = live && liveScale ? liveScale.value : s.value;
    const rot = live && liveRotation ? liveRotation.value : r.value;
    return {
      position: 'absolute',
      left,
      top,
      width: baseWidth * ratio,
      height: baseHeight * ratio,
      transform: [
        { scale: sc },
        { rotate: `${rot}deg` },
      ],
    };
  });

  // When the canvas supplies a `frameInset` (cutouts / photo layers with a
  // decoded alpha mask) draw the selection border as a separate inset overlay so
  // it hugs the garment's opaque pixels instead of the full PNG rect. The image
  // container itself stays borderless and full-box so the garment is never
  // clipped and the gesture/hit box is unchanged. Items without an inset (text
  // bubbles, or a cutout whose mask hasn't decoded yet) keep the original
  // border-on-box behavior byte-for-byte.
  const showBorder = selected && !exporting && showSelectionBox;
  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={animatedStyle} testID={testID}>
        <View
          style={{
            flex: 1,
            borderWidth: showBorder && !frameInset ? 2 : 0,
            borderColor: '#B89968',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {children ? (
            children
          ) : photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          ) : null}
        </View>
        {showBorder && frameInset ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${frameInset.left * 100}%`,
              top: `${frameInset.top * 100}%`,
              right: `${frameInset.right * 100}%`,
              bottom: `${frameInset.bottom * 100}%`,
              borderWidth: 2,
              borderColor: '#B89968',
              borderRadius: 4,
            }}
            testID={`${testID}-frame`}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}
