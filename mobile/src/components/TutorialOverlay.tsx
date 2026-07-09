import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Dimensions,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SW, height: SH } = Dimensions.get('window');
const BUBBLE_MARGIN = 24;
const BUBBLE_WIDTH = SW - BUBBLE_MARGIN * 2;
const ARROW_HALF = 14;
const ABOVE_TABS_BOTTOM = 96;

interface Step {
  title: string;
  body: string;
  placement: 'center' | 'above-tabs' | 'upper';
  arrowPercent: number | null;
}

const CREATOR_STEPS: Step[] = [
  {
    title: 'Tap + to create your first look!',
    body: 'Upload an outfit photo and start styling in seconds.',
    placement: 'above-tabs',
    arrowPercent: 38,
  },
  {
    title: 'Add items and tag your favorite brands',
    body: 'Link each clothing piece so your audience can shop directly.',
    placement: 'center',
    arrowPercent: null,
  },
  {
    title: 'Your audience will shop your looks here!',
    body: 'Every purchase earns you commission — watch it grow 💰',
    placement: 'above-tabs',
    arrowPercent: 62,
  },
];

const AUDIENCE_STEPS: Step[] = [
  {
    title: 'Swipe to discover looks from creators!',
    body: "Browse curated outfits from real creators you'll love.",
    placement: 'center',
    arrowPercent: null,
  },
  {
    title: 'Tap the bag icon to shop items',
    body: 'Every piece in the look is linked — buy it instantly.',
    placement: 'upper',
    arrowPercent: 72,
  },
  {
    title: 'Double-tap to like a look!',
    body: 'Save your favourites and find them in your Saved tab ❤️',
    placement: 'center',
    arrowPercent: null,
  },
];

interface Props {
  type: 'creator' | 'audience';
  userId?: string;
}

export default function TutorialOverlay({ type, userId }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  const steps = type === 'creator' ? CREATOR_STEPS : AUDIENCE_STEPS;
  const storageKey = userId
    ? `hasSeenTutorial_${type}_${userId}`
    : `hasSeenTutorial_${type}`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((val) => {
      if (!val) {
        setVisible(true);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [storageKey]);

  const advance = () => {
    if (step < steps.length - 1) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const dismiss = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      AsyncStorage.setItem(storageKey, 'true');
    });
  };

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const wrapperStyle: any =
    current.placement === 'above-tabs'
      ? {
          position: 'absolute',
          bottom: ABOVE_TABS_BOTTOM,
          left: BUBBLE_MARGIN,
          width: BUBBLE_WIDTH,
        }
      : current.placement === 'upper'
      ? {
          position: 'absolute',
          top: SH * 0.18,
          left: BUBBLE_MARGIN,
          width: BUBBLE_WIDTH,
        }
      : {
          position: 'absolute',
          top: SH * 0.32,
          left: BUBBLE_MARGIN,
          width: BUBBLE_WIDTH,
        };

  const arrowLeft =
    current.arrowPercent !== null
      ? (BUBBLE_WIDTH * current.arrowPercent) / 100 - ARROW_HALF
      : 0;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

        <View style={wrapperStyle} pointerEvents="box-none">
          <View style={styles.bubble} pointerEvents="auto">
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.body}>{current.body}</Text>

            <View style={styles.footer}>
              <View style={styles.dotsRow}>
                {steps.map((_, i) => (
                  <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
                ))}
              </View>

              <Pressable
                style={({ pressed }) => [styles.nextBtn, { opacity: pressed ? 0.75 : 1 }]}
                onPress={advance}
              >
                <Text style={styles.nextBtnText}>{isLast ? 'Got it!' : 'Next →'}</Text>
              </Pressable>
            </View>
          </View>

          {current.arrowPercent !== null && (
            <View style={[styles.arrowDown, { left: arrowLeft }]} />
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.60)',
  },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1210',
    marginBottom: 6,
    lineHeight: 21,
  },
  body: {
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 18,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#D4C8C2',
  },
  dotActive: {
    width: 20,
    backgroundColor: '#1A1210',
    borderRadius: 3.5,
  },
  nextBtn: {
    backgroundColor: '#F0EDE9',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
  },
  nextBtnText: {
    color: '#1A1210',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  arrowDown: {
    position: 'absolute',
    bottom: -ARROW_HALF,
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_HALF,
    borderRightWidth: ARROW_HALF,
    borderTopWidth: ARROW_HALF,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
  },
});
