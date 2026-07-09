import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import type { TextLayerItem } from '@/lib/state/lookStore';
import { Checkerboard } from '@/components/Checkerboard';
import {
  InteractiveCanvasItem,
  MIN_SCALE,
  MAX_SCALE,
} from '@/components/collage/InteractiveCanvasItem';

/**
 * Canonical Style-a-Look canvas space. Portrait 1080×1440 (3:4). Text layer
 * x/y/fontSize are authored in this space and stored in StyleLayout, so a
 * different display size just rescales by `displayWidth / CANVAS_W`.
 *
 * NOTE: InteractiveCanvasItem internally uses CANVAS_SIZE (1080, the square
 * collage space) to compute its display ratio from the `canvasSize` prop. Since
 * pixels are square, X and Y share the same ratio (displayWidth / 1080). We
 * therefore pass `canvasSize={displayWidth}` so its ratio matches ours, and the
 * portrait height falls out of the container aspect ratio.
 */
export const CANVAS_W = 1080;
export const CANVAS_H = 1440;

/** Map a fontFamily token (TextLayerItem.fontFamily) to a real font family.
 *  Mirrors canvasShared.tsx so Style-a-Look text matches collage text. */
function resolveFontFamily(token: string): string {
  switch (token) {
    case 'display':
    case 'serif':
      return 'CormorantGaramond_600SemiBold';
    case 'serif-italic':
      return 'CormorantGaramond_400Regular_Italic';
    case 'sans-bold':
      return 'DMSans_700Bold';
    case 'body':
    case 'sans':
    default:
      return 'DMSans_400Regular';
  }
}

export interface StyleLookCanvasProps {
  /** Hero photo (https or local file URI). Rendered full-bleed, cover-fit. */
  photoUri: string;
  textLayers: TextLayerItem[];
  selectedId: string | null;
  /** Display width in points. Height derives from the 3:4 portrait ratio. */
  displayWidth: number;
  /** When false, gestures + selection box are disabled (static render). */
  editable?: boolean;
  /** Hide the selection box for an export snapshot. */
  exporting?: boolean;
  /** When true the hero is a transparent PNG (e.g. a "No background" virtual
   *  model). We draw a checkerboard behind it and cover-fit → contain-fit so
   *  the transparency reads as transparency rather than sitting on a solid card. */
  transparentBg?: boolean;
  onSelect?: (id: string | null) => void;
  onCommitLayer?: (
    id: string,
    next: { x: number; y: number; scale: number; rotation: number }
  ) => void;
}

/**
 * Lightweight portrait canvas for the Style-a-Look editor. Full-bleed hero photo
 * with movable/resizable/rotatable text layers on top. The root View ref is
 * forwarded so the parent can flatten it with exportCollage at 1080×1440.
 */
export const StyleLookCanvas = React.forwardRef<View, StyleLookCanvasProps>(
  function StyleLookCanvas(
    {
      photoUri,
      textLayers,
      selectedId,
      displayWidth,
      editable = false,
      exporting = false,
      transparentBg = false,
      onSelect,
      onCommitLayer,
    },
    ref
  ) {
    const displayHeight = (displayWidth * CANVAS_H) / CANVAS_W;
    const ratio = displayWidth / CANVAS_W;

    const interactive = editable && !!onCommitLayer;

    // Selected layer snapshot for the canvas-level pinch/rotation recognizer.
    const selected = React.useMemo(() => {
      if (!interactive || !selectedId) return null;
      const tl = textLayers.find((t) => t.id === selectedId);
      if (!tl) return null;
      return { id: tl.id, x: tl.x, y: tl.y, scale: tl.scale, rotation: tl.rotation };
    }, [interactive, selectedId, textLayers]);

    const liveScale = useSharedValue(1);
    const liveRotation = useSharedValue(0);
    const pinchActive = useSharedValue(false);
    const hasSelection = useSharedValue(false);
    const selScale = useSharedValue(1);
    const selRotation = useSharedValue(0);
    const startScale = useSharedValue(1);
    const startRotation = useSharedValue(0);

    React.useEffect(() => {
      selScale.value = selected?.scale ?? 1;
      selRotation.value = selected?.rotation ?? 0;
      hasSelection.value = !!selected;
    }, [selected, selScale, selRotation, hasSelection]);

    const commitSelected = React.useCallback(
      (nScale: number, nRotation: number) => {
        if (!selected) return;
        onCommitLayer?.(selected.id, {
          x: selected.x,
          y: selected.y,
          scale: nScale,
          rotation: nRotation,
        });
      },
      [selected, onCommitLayer]
    );

    // With nothing selected, a two-finger gesture targets the topmost layer.
    const selectTopAndSeed = React.useCallback(() => {
      if (!interactive) return;
      let top: { id: string; scale: number; rotation: number } | null = null;
      let topZ = -Infinity;
      for (const t of textLayers) {
        if (t.zIndex > topZ) {
          topZ = t.zIndex;
          top = { id: t.id, scale: t.scale, rotation: t.rotation };
        }
      }
      if (!top) return;
      onSelect?.(top.id);
      selScale.value = top.scale;
      selRotation.value = top.rotation;
      startScale.value = top.scale;
      startRotation.value = top.rotation;
      liveScale.value = top.scale;
      liveRotation.value = top.rotation;
      pinchActive.value = true;
    }, [
      interactive,
      textLayers,
      onSelect,
      selScale,
      selRotation,
      startScale,
      startRotation,
      liveScale,
      liveRotation,
      pinchActive,
    ]);

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
            runOnJS(selectTopAndSeed)();
          }
        })
        .onUpdate((e) => {
          'worklet';
          if (!pinchActive.value) return;
          liveScale.value = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, startScale.value * e.scale)
          );
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
          liveRotation.value = startRotation.value + (e.rotation * 180) / Math.PI;
        })
        .onEnd(() => {
          'worklet';
          pinchActive.value = false;
          runOnJS(commitSelected)(liveScale.value, liveRotation.value);
        });
      return Gesture.Simultaneous(pinch, rotate);
    }, [
      commitSelected,
      selectTopAndSeed,
      hasSelection,
      liveScale,
      liveRotation,
      pinchActive,
      selScale,
      selRotation,
      startScale,
      startRotation,
    ]);

    const sortedLayers = React.useMemo(
      () => [...textLayers].sort((a, b) => a.zIndex - b.zIndex),
      [textLayers]
    );

    const handleCanvasPress = () => {
      if (interactive) onSelect?.(null);
    };

    const canvasNode = (
      <View
        ref={ref}
        collapsable={false}
        style={[styles.canvas, { width: displayWidth, height: displayHeight }]}
        testID="style-look-canvas"
      >
        {/* Checkerboard sits under a transparent-PNG hero so its transparency
         *  is visible instead of blending into the solid canvas color. */}
        {transparentBg ? (
          <Checkerboard style={StyleSheet.absoluteFill} testID="style-look-checkerboard" />
        ) : null}

        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            // Transparent heroes contain-fit so the whole model stays visible
            // over the checkerboard; opaque heroes still cover-fit full-bleed.
            resizeMode={transparentBg ? 'contain' : 'cover'}
            testID="style-look-hero"
          />
        ) : null}

        {/* Empty-canvas tap deselects (interactive only). Rendered below layers. */}
        {interactive ? (
          <Pressable
            onPress={handleCanvasPress}
            style={StyleSheet.absoluteFill}
            testID="style-look-deselect"
          />
        ) : null}

        {sortedLayers.map((tl) => {
          const fontFamily = resolveFontFamily(tl.fontFamily);
          const displayFontSize = tl.fontSize * ratio;
          return (
            <View
              key={`text-layer-${tl.id}`}
              style={{ position: 'absolute', left: 0, top: 0, zIndex: tl.zIndex }}
              pointerEvents={interactive ? 'box-none' : 'none'}
            >
              <InteractiveCanvasItem
                itemId={tl.id}
                x={tl.x}
                y={tl.y}
                scale={tl.scale}
                baseWidth={800}
                baseHeight={200}
                rotation={tl.rotation}
                canvasSize={displayWidth}
                canvasHeightUnits={CANVAS_H}
                selected={interactive ? selectedId === tl.id : false}
                exporting={exporting || !interactive}
                onSelect={(id) => onSelect?.(id)}
                onCommit={(id, next) => onCommitLayer?.(id, next)}
                liveScale={liveScale}
                liveRotation={liveRotation}
                pinchActive={pinchActive}
                testID={`style-look-text-${tl.id}`}
              >
                <View
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontSize: displayFontSize,
                      color: tl.color,
                      textAlign: 'center',
                    }}
                    numberOfLines={3}
                  >
                    {tl.text}
                  </Text>
                </View>
              </InteractiveCanvasItem>
            </View>
          );
        })}
      </View>
    );

    // Attach the canvas-level pinch/rotation recognizer on a wrapper (not the
    // canvas View itself) so the forwarded export ref stays clean.
    return interactive ? (
      <GestureDetector gesture={canvasManipGesture}>
        <View collapsable={false} style={{ width: displayWidth, height: displayHeight }}>
          {canvasNode}
        </View>
      </GestureDetector>
    ) : (
      canvasNode
    );
  }
);

const styles = StyleSheet.create({
  canvas: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#F7F4F0',
  },
});
