import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import useLookStore, { Look } from '@/lib/state/lookStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface LookPickerSheetProps {
  visible: boolean;
  itemId: string;
  onClose: () => void;
  onResult: (result: 'added' | 'already_in_look', lookTitle: string) => void;
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function LookPickerSheet({ visible, itemId, onClose, onResult }: LookPickerSheetProps) {
  const looks = useLookStore((s) => s.looks);
  const addItemToLook = useLookStore((s) => s.addItemToLook);
  const [loading, setLoading] = useState<string | null>(null);

  const translateY = useSharedValue(0);
  const dismissSheet = useCallback(() => { onClose(); }, [onClose]);
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 800) {
        runOnJS(dismissSheet)();
      }
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    });
  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handlePickLook = useCallback(async (look: Look) => {
    if (loading) return;
    setLoading(look.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await addItemToLook(look.id, itemId);
    setLoading(null);
    if (result === 'added' || result === 'already_in_look') {
      onResult(result, look.title ?? 'Untitled Look');
    }
    onClose();
  }, [itemId, addItemToLook, loading, onResult, onClose]);

  const nonArchivedLooks = looks.filter(l => !l.archived);

  const renderLookRow = useCallback(({ item: look }: { item: Look }) => (
    <Pressable
      style={({ pressed }) => [styles.lookRow, pressed && { opacity: 0.7 }]}
      onPress={() => handlePickLook(look)}
      testID={`look-picker-row-${look.id}`}
    >
      {look.photoUri ? (
        <Image source={{ uri: look.photoUri }} style={styles.lookThumb} contentFit="cover" />
      ) : (
        <View style={[styles.lookThumb, styles.lookThumbPlaceholder]}>
          <Text style={{ fontSize: 24 }}>{'👗'}</Text>
        </View>
      )}
      <View style={styles.lookInfo}>
        <Text style={styles.lookTitle} numberOfLines={1}>{look.title ?? 'Untitled Look'}</Text>
        <Text style={styles.lookDate}>{formatRelativeDate(look.createdAt)}</Text>
      </View>
      {loading === look.id ? (
        <ActivityIndicator size="small" color="#B87063" />
      ) : null}
    </Pressable>
  ), [handlePickLook, loading]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} testID="look-picker-sheet">
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <Animated.View style={[styles.sheet, sheetAnimatedStyle]}>
          <GestureDetector gesture={panGesture}>
            <Animated.View>
              <View style={styles.dragHandle} />
            </Animated.View>
          </GestureDetector>

          <View style={styles.header}>
            <Text style={styles.heading}>Add to which look?</Text>
            <Text style={styles.sub}>This piece will appear in the look's item list.</Text>
          </View>

          {nonArchivedLooks.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {"You haven't created a look yet. Use \"Use in New Look\" instead."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={nonArchivedLooks}
              renderItem={renderLookRow}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              testID="look-picker-list"
            />
          )}

          <Pressable style={styles.closeButton} onPress={onClose} testID="look-picker-close">
            <Text style={styles.closeButtonText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  heading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    marginBottom: 4,
  },
  sub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  lookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
    gap: 12,
  },
  lookThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  lookThumbPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookInfo: {
    flex: 1,
  },
  lookTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  lookDate: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
    marginTop: 2,
  },
  emptyState: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
  },
  closeButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#F7F4F0',
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
});
