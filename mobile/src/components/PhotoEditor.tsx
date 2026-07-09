import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Dimensions,
  Animated as RNAnimated,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ActionResize, ActionCrop, ActionRotate } from 'expo-image-manipulator';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import ReAnimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STAGE_WIDTH = SCREEN_WIDTH;
const STAGE_HEIGHT = Math.round(SCREEN_HEIGHT * 0.55);

type Tool = 'crop' | 'rotate' | 'adjust';

interface PhotoEditorProps {
  visible: boolean;
  uri: string;
  aspectRatio?: [number, number];
  title?: string;
  helpText?: string;
  onSave: (editedUri: string) => void;
  onCancel: () => void;
}

export default function PhotoEditor({
  visible,
  uri,
  aspectRatio = [1, 1],
  title = 'Edit Photo',
  helpText,
  onSave,
  onCancel,
}: PhotoEditorProps) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new RNAnimated.Value(0)).current;

  const [ratioW, ratioH] = aspectRatio;

  // Crop window dimensions — fits inside the stage with padding
  const CROP_WINDOW_WIDTH = Math.min(STAGE_WIDTH - 48, (STAGE_HEIGHT - 48) * ratioW / ratioH);
  const CROP_WINDOW_HEIGHT = CROP_WINDOW_WIDTH * ratioH / ratioW;

  // Crop window position (centered in stage)
  const cropLeft = (STAGE_WIDTH - CROP_WINDOW_WIDTH) / 2;
  const cropTop = (STAGE_HEIGHT - CROP_WINDOW_HEIGHT) / 2;

  const [activeTool, setActiveTool] = useState<Tool>('crop');
  const [rotation, setRotation] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(0);
  const [saturation, setSaturation] = useState<number>(0);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Interactive crop gesture state
  const cropScale = useSharedValue(1);
  const savedCropScale = useSharedValue(1);
  const cropTranslateX = useSharedValue(0);
  const savedCropTranslateX = useSharedValue(0);
  const cropTranslateY = useSharedValue(0);
  const savedCropTranslateY = useSharedValue(0);
  const natW = useSharedValue(0);
  const natH = useSharedValue(0);

  const defaultHelp = 'Drag to position. Pinch to zoom. The outlined area is what will be saved.';

  const hasEdits = rotation !== 0 || brightness !== 0 || contrast !== 0 || saturation !== 0;

  useEffect(() => {
    if (uri) {
      RNImage.getSize(uri, (w, h) => {
        natW.value = w;
        natH.value = h;
      }, () => {});
    }
  }, [uri, natW, natH]);

  useEffect(() => {
    if (visible) {
      RNAnimated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(0);
      // Reset state when closing
      setActiveTool('crop');
      setRotation(0);
      setBrightness(0);
      setContrast(0);
      setSaturation(0);
      setSaving(false);
      setErrorMsg(null);
      // Reset crop gestures
      cropScale.value = 1;
      savedCropScale.value = 1;
      cropTranslateX.value = 0;
      savedCropTranslateX.value = 0;
      cropTranslateY.value = 0;
      savedCropTranslateY.value = 0;
    }
  }, [visible, slideAnim, cropScale, savedCropScale, cropTranslateX, savedCropTranslateX, cropTranslateY, savedCropTranslateY]);

  // Crop gestures — pinch to zoom, pan to reposition
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      savedCropScale.value = cropScale.value;
    })
    .onUpdate((e) => {
      'worklet';
      cropScale.value = Math.min(4, Math.max(1, savedCropScale.value * e.scale));
    })
    .onEnd(() => {
      'worklet';
      savedCropScale.value = cropScale.value;
      // Clamp pan so crop window stays inside effective image
      if (natW.value === 0 || natH.value === 0) return;
      const cs = Math.min(STAGE_WIDTH / natW.value, STAGE_HEIGHT / natH.value);
      const edw = natW.value * cs * cropScale.value;
      const edh = natH.value * cs * cropScale.value;
      const maxTx = Math.max(0, (edw - CROP_WINDOW_WIDTH) / 2);
      const maxTy = Math.max(0, (edh - CROP_WINDOW_HEIGHT) / 2);
      cropTranslateX.value = withTiming(Math.min(maxTx, Math.max(-maxTx, cropTranslateX.value)));
      cropTranslateY.value = withTiming(Math.min(maxTy, Math.max(-maxTy, cropTranslateY.value)));
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      'worklet';
      savedCropTranslateX.value = cropTranslateX.value;
      savedCropTranslateY.value = cropTranslateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      // No clamping during pan — free movement
      cropTranslateX.value = savedCropTranslateX.value + e.translationX;
      cropTranslateY.value = savedCropTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      // Clamp pan so crop window stays inside effective image
      if (natW.value === 0 || natH.value === 0) return;
      const cs = Math.min(STAGE_WIDTH / natW.value, STAGE_HEIGHT / natH.value);
      const edw = natW.value * cs * cropScale.value;
      const edh = natH.value * cs * cropScale.value;
      const maxTx = Math.max(0, (edw - CROP_WINDOW_WIDTH) / 2);
      const maxTy = Math.max(0, (edh - CROP_WINDOW_HEIGHT) / 2);
      cropTranslateX.value = withTiming(Math.min(maxTx, Math.max(-maxTx, cropTranslateX.value)));
      cropTranslateY.value = withTiming(Math.min(maxTy, Math.max(-maxTy, cropTranslateY.value)));
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const cropAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cropTranslateX.value },
      { translateY: cropTranslateY.value },
      { scale: cropScale.value },
    ],
  }));

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
    // Reset crop gestures after rotation
    cropScale.value = withTiming(1);
    cropTranslateX.value = withTiming(0);
    cropTranslateY.value = withTiming(0);
    savedCropScale.value = 1;
    savedCropTranslateX.value = 0;
    savedCropTranslateY.value = 0;
  }, [cropScale, savedCropScale, cropTranslateX, savedCropTranslateX, cropTranslateY, savedCropTranslateY]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      // manipulateAsync requires a local file URI — download remote URLs first.
      let localUri = uri;
      if (uri.startsWith('http://') || uri.startsWith('https://')) {
        const ext = /\.png(\?|$)/i.test(uri) ? '.png' : '.jpg';
        const tmpPath = `${cacheDirectory}photo_edit_${Date.now()}${ext}`;
        const dl = await downloadAsync(uri, tmpPath);
        localUri = dl.uri;
      }

      // Get natural image dimensions
      const { width: imgNatW, height: imgNatH } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          RNImage.getSize(localUri, (width, height) => resolve({ width, height }), (err) => reject(err));
        }
      );

      const actions: (ActionRotate | ActionResize | ActionCrop)[] = [];

      // Apply rotation first
      if (rotation > 0) {
        actions.push({ rotate: rotation });
      }

      // Natural dimensions after rotation
      const isRotated90or270 = rotation === 90 || rotation === 270;
      const naturalW = isRotated90or270 ? imgNatH : imgNatW;
      const naturalH = isRotated90or270 ? imgNatW : imgNatH;

      // Read gesture state
      const currentScale = cropScale.value;
      const currentTx = cropTranslateX.value;
      const currentTy = cropTranslateY.value;

      // Image display size at contain fit in the stage, at scale 1
      const containScale = Math.min(STAGE_WIDTH / naturalW, STAGE_HEIGHT / naturalH);
      const containedDisplayW = naturalW * containScale;
      const containedDisplayH = naturalH * containScale;

      // Effective display size after user zoom
      const effectiveDisplayW = containedDisplayW * currentScale;
      const effectiveDisplayH = containedDisplayH * currentScale;

      // Top-left of the effective image in stage coordinates
      const imageLeftInStage = (STAGE_WIDTH - effectiveDisplayW) / 2 + currentTx;
      const imageTopInStage = (STAGE_HEIGHT - effectiveDisplayH) / 2 + currentTy;

      // Crop window rect in stage coordinates
      const cropLeftInStage = (STAGE_WIDTH - CROP_WINDOW_WIDTH) / 2;
      const cropTopInStage = (STAGE_HEIGHT - CROP_WINDOW_HEIGHT) / 2;

      // Crop window rect relative to the effective image
      const cropLeftInEffective = cropLeftInStage - imageLeftInStage;
      const cropTopInEffective = cropTopInStage - imageTopInStage;

      // Convert from effective-display pixels to natural-image pixels
      const effectiveToNatural = naturalW / effectiveDisplayW;
      const cropXnatural = cropLeftInEffective * effectiveToNatural;
      const cropYnatural = cropTopInEffective * effectiveToNatural;
      const cropWnatural = CROP_WINDOW_WIDTH * effectiveToNatural;
      const cropHnatural = CROP_WINDOW_HEIGHT * effectiveToNatural;

      // Clamp to image bounds
      const finalOriginX = Math.max(0, Math.min(naturalW - 1, Math.round(cropXnatural)));
      const finalOriginY = Math.max(0, Math.min(naturalH - 1, Math.round(cropYnatural)));
      const finalWidth = Math.max(1, Math.min(naturalW - finalOriginX, Math.round(cropWnatural)));
      const finalHeight = Math.max(1, Math.min(naturalH - finalOriginY, Math.round(cropHnatural)));

      actions.push({
        crop: { originX: finalOriginX, originY: finalOriginY, width: finalWidth, height: finalHeight },
      });

      // Resize to final output dimensions
      let outputWidth: number;
      let outputHeight: number;
      if (ratioW === ratioH) {
        outputWidth = 800;
        outputHeight = 800;
      } else if (ratioW < ratioH) {
        outputWidth = 900;
        outputHeight = Math.round((900 * ratioH) / ratioW);
      } else {
        outputHeight = 900;
        outputWidth = Math.round((900 * ratioW) / ratioH);
      }

      actions.push({ resize: { width: outputWidth, height: outputHeight } });

      const result = await manipulateAsync(localUri, actions, {
        compress: 0.85,
        format: SaveFormat.JPEG,
      });

      onSave(result.uri);
    } catch (e) {
      console.error('[PhotoEditor] save error:', e);
      setErrorMsg('Failed to process photo. Please try again.');
      setSaving(false);
    }
  }, [uri, rotation, ratioW, ratioH, onSave, cropScale, cropTranslateX, cropTranslateY, CROP_WINDOW_WIDTH, CROP_WINDOW_HEIGHT]);

  // Compute filter overlay style for brightness/contrast/saturation preview
  const filterOverlayStyle = useCallback(() => {
    // Brightness: negative = darker overlay, positive = lighter overlay
    // Contrast: approximated with opacity
    // Saturation: approximated with grayscale overlay
    const overlays: React.ReactNode[] = [];

    if (brightness !== 0) {
      const bgColor = brightness > 0 ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
      const opacity = Math.abs(brightness) / 200;
      overlays.push(
        <View
          key="brightness"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `${bgColor}${opacity})` },
          ]}
          pointerEvents="none"
        />
      );
    }

    if (saturation < 0) {
      // Desaturation: overlay a semi-transparent gray
      const opacity = Math.abs(saturation) / 200;
      overlays.push(
        <View
          key="saturation"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(128,128,128,${opacity})` },
          ]}
          pointerEvents="none"
        />
      );
    }

    return overlays;
  }, [brightness, saturation]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RNAnimated.View
          style={[
            styles.container,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
            {
              opacity: slideAnim,
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [100, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={handleCancel} disabled={saving} testID="photo-editor-cancel">
              <Text style={[styles.headerCancel, saving && { opacity: 0.4 }]}>Cancel</Text>
            </Pressable>
            <Text style={styles.headerTitle}>{title}</Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              testID="photo-editor-save"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </Pressable>
          </View>

          {/* Error */}
          {errorMsg ? (
            <View style={styles.errorBar}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Stage — crop preview area */}
          <View style={[styles.stage, { width: STAGE_WIDTH, height: STAGE_HEIGHT }]}>
            {/* Image layer with gesture support */}
            <GestureDetector gesture={composedGesture}>
              <ReAnimated.View style={[{ width: STAGE_WIDTH, height: STAGE_HEIGHT }, cropAnimatedStyle]}>
                <Image
                  source={{ uri }}
                  style={[
                    { width: STAGE_WIDTH, height: STAGE_HEIGHT },
                    { transform: [{ rotate: `${rotation}deg` }] },
                  ]}
                  contentFit="contain"
                  testID="photo-editor-preview"
                />
                {filterOverlayStyle()}
              </ReAnimated.View>
            </GestureDetector>

            {/* Dim masks — darken area outside crop window */}
            <View style={[styles.dimMask, { top: 0, left: 0, right: 0, height: cropTop }]} pointerEvents="none" />
            <View style={[styles.dimMask, { top: cropTop + CROP_WINDOW_HEIGHT, left: 0, right: 0, bottom: 0 }]} pointerEvents="none" />
            <View style={[styles.dimMask, { top: cropTop, left: 0, width: cropLeft, height: CROP_WINDOW_HEIGHT }]} pointerEvents="none" />
            <View style={[styles.dimMask, { top: cropTop, right: 0, width: cropLeft, height: CROP_WINDOW_HEIGHT }]} pointerEvents="none" />

            {/* Crop window border */}
            <View
              style={[
                styles.cropBorder,
                {
                  top: cropTop,
                  left: cropLeft,
                  width: CROP_WINDOW_WIDTH,
                  height: CROP_WINDOW_HEIGHT,
                },
              ]}
              pointerEvents="none"
            />
          </View>

          {/* Tool Tabs */}
          <View style={styles.toolTabs}>
            {(['crop', 'rotate', 'adjust'] as Tool[]).map((tool) => (
              <Pressable
                key={tool}
                onPress={() => setActiveTool(tool)}
                style={[
                  styles.toolTab,
                  activeTool === tool && styles.toolTabActive,
                ]}
                testID={`tool-tab-${tool}`}
              >
                <Text
                  style={[
                    styles.toolTabText,
                    activeTool === tool && styles.toolTabTextActive,
                  ]}
                >
                  {tool === 'crop' ? 'Crop' : tool === 'rotate' ? 'Rotate' : 'Adjust'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Tool Content */}
          <View style={styles.toolContent}>
            {activeTool === 'crop' ? (
              <View style={styles.toolInfo}>
                <Text style={styles.toolInfoText}>
                  {helpText ?? defaultHelp}
                </Text>
              </View>
            ) : activeTool === 'rotate' ? (
              <View style={styles.rotateContainer}>
                <Pressable
                  onPress={handleRotate}
                  style={styles.rotateButton}
                  testID="rotate-button"
                >
                  <Text style={styles.rotateButtonText}>↻ Rotate 90°</Text>
                </Pressable>
                <Text style={styles.rotateInfo}>{rotation}° rotated</Text>
              </View>
            ) : (
              <View style={styles.slidersContainer}>
                <SliderRow
                  label="Brightness"
                  value={brightness}
                  onValueChange={setBrightness}
                  testID="slider-brightness"
                />
                <SliderRow
                  label="Contrast"
                  value={contrast}
                  onValueChange={setContrast}
                  testID="slider-contrast"
                />
                <SliderRow
                  label="Saturation"
                  value={saturation}
                  onValueChange={setSaturation}
                  testID="slider-saturation"
                />
              </View>
            )}
          </View>
        </RNAnimated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function SliderRow({
  label,
  value,
  onValueChange,
  testID,
}: {
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  testID: string;
}) {
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{Math.round(value)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={-100}
        maximumValue={100}
        value={value}
        onValueChange={onValueChange}
        minimumTrackTintColor="#B87063"
        maximumTrackTintColor="#6B5E58"
        thumbTintColor="#B87063"
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1210',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerCancel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 17,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#B87063',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 72,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  errorBar: {
    backgroundColor: 'rgba(184,112,99,0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#E8A090',
    textAlign: 'center',
  },
  stage: {
    overflow: 'hidden',
    backgroundColor: '#1A1210',
  },
  dimMask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cropBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#B87063',
    borderRadius: 4,
  },
  toolTabs: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 8,
    marginTop: 12,
  },
  toolTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(107,94,88,0.3)',
  },
  toolTabActive: {
    backgroundColor: '#B87063',
  },
  toolTabText: {
    fontSize: 14,
    color: '#6B5E58',
    fontWeight: '600',
  },
  toolTabTextActive: {
    color: '#FFFFFF',
  },
  toolContent: {
    minHeight: 160,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  toolInfo: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  toolInfoText: {
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
  },
  rotateContainer: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  rotateButton: {
    backgroundColor: '#B87063',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  rotateButtonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  rotateInfo: {
    fontSize: 13,
    color: '#8C8580',
  },
  slidersContainer: {
    gap: 12,
    paddingTop: 8,
  },
  sliderRow: {
    gap: 4,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  sliderLabel: {
    fontSize: 13,
    color: '#B0A8A3',
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 13,
    color: '#8C8580',
  },
  slider: {
    width: '100%',
    height: 32,
  },
});
