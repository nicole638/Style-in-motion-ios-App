import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  TextInput,
  StyleSheet,
  Dimensions,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, Search, X } from 'lucide-react-native';
import useLookStore, { ClothingItem } from '@/lib/state/lookStore';
import { decodeHtmlEntities } from '@/lib/decode-entities';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRID_GAP = 12;
const GRID_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

const TIP_STORAGE_KEY = 'closet-picker-tip-seen';

interface ClosetPickerSheetProps {
  visible: boolean;
  existingItemIds: string[];
  onClose: () => void;
  onItemsSelected: (items: ClothingItem[]) => void;
}

export function ClosetPickerSheet({
  visible,
  existingItemIds,
  onClose,
  onItemsSelected,
}: ClosetPickerSheetProps) {
  const closetItems = useLookStore((s) => s.closetItems);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showTip, setShowTip] = useState<boolean>(false);

  const existingSet = useMemo(() => new Set(existingItemIds), [existingItemIds]);

  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set());
      setSearchQuery('');
      AsyncStorage.getItem(TIP_STORAGE_KEY).then((val) => {
        if (val !== 'true') setShowTip(true);
      });
    }
  }, [visible]);

  const dismissTip = useCallback(() => {
    setShowTip(false);
    AsyncStorage.setItem(TIP_STORAGE_KEY, 'true');
  }, []);

  const filteredItems = useMemo(() => {
    const nonArchived = closetItems.filter((i) => !i.archived);
    if (!searchQuery.trim()) return nonArchived;
    const q = searchQuery.toLowerCase().trim();
    return nonArchived.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.brand?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q),
    );
  }, [closetItems, searchQuery]);

  const translateY = useSharedValue(0);
  const dismissSheet = useCallback(() => {
    onClose();
  }, [onClose]);

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

  const toggleItem = useCallback(
    (id: string) => {
      if (existingSet.has(id)) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [existingSet],
  );

  const handleConfirm = useCallback(() => {
    const picked = closetItems.filter((i) => selectedIds.has(i.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onItemsSelected(picked);
    if (showTip) {
      setShowTip(false);
      AsyncStorage.setItem(TIP_STORAGE_KEY, 'true');
    }
  }, [closetItems, selectedIds, onItemsSelected, showTip]);

  const selectedCount = selectedIds.size;

  const renderItem = useCallback(
    ({ item }: { item: ClothingItem }) => {
      const isSelected = selectedIds.has(item.id);
      const isAlreadyInDraft = existingSet.has(item.id);

      return (
        <Pressable
          style={({ pressed }) => [
            styles.card,
            pressed && !isAlreadyInDraft && { opacity: 0.85 },
            isAlreadyInDraft && styles.cardDisabled,
          ]}
          onPress={() => toggleItem(item.id)}
          testID={`closet-picker-card-${item.id}`}
        >
          {item.photoUri ? (
            <Image
              source={{ uri: item.photoUri }}
              style={styles.cardImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.cardImage, styles.cardPlaceholder]}>
              <Text style={{ fontSize: 32 }}>{item.emoji}</Text>
            </View>
          )}

          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>
              {decodeHtmlEntities(item.name) || item.category}
            </Text>
            {item.brand ? (
              <Text style={styles.cardBrand} numberOfLines={1}>
                {decodeHtmlEntities(item.brand)}
              </Text>
            ) : null}
            {item.price ? (
              <Text style={styles.cardPrice}>${item.price}</Text>
            ) : null}
          </View>

          {isAlreadyInDraft ? (
            <View style={styles.alreadyAddedBadge}>
              <Text style={styles.alreadyAddedText}>Added</Text>
            </View>
          ) : isSelected ? (
            <View style={styles.checkboxSelected}>
              <Check size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          ) : (
            <View style={styles.checkboxEmpty} />
          )}
        </Pressable>
      );
    },
    [selectedIds, existingSet, toggleItem],
  );

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="closet-picker-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />

        <Animated.View style={[styles.sheet, sheetAnimatedStyle]}>
          <GestureDetector gesture={panGesture}>
            <Animated.View>
              <View style={styles.dragHandle} />
            </Animated.View>
          </GestureDetector>

          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={styles.heading}>Add from Closet</Text>
              <Pressable
                onPress={onClose}
                style={styles.headerClose}
                testID="closet-picker-close-x"
              >
                <X size={20} color="#6B5E58" />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              Select items to include in this look
            </Text>
          </View>

          {showTip ? (
            <View style={styles.tipBanner}>
              <Text style={styles.tipText}>
                You can also add items one-by-one from the item detail screen
              </Text>
              <Pressable onPress={dismissTip} testID="closet-picker-dismiss-tip">
                <X size={14} color="#8C8580" />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.searchContainer}>
            <Search size={16} color="#8C8580" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search closet..."
              placeholderTextColor="#B0A8A0"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              testID="closet-picker-search"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} testID="closet-picker-clear-search">
                <X size={16} color="#8C8580" />
              </Pressable>
            ) : null}
          </View>

          {filteredItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {searchQuery.trim()
                  ? 'No items match your search'
                  : 'Nothing in your closet yet. Add items to start building looks.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              showsVerticalScrollIndicator={false}
              testID="closet-picker-grid"
            />
          )}

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.confirmButton,
                selectedCount === 0 && styles.confirmButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={selectedCount === 0}
              testID="closet-picker-confirm"
            >
              <Text
                style={[
                  styles.confirmButtonText,
                  selectedCount === 0 && styles.confirmButtonTextDisabled,
                ]}
              >
                {selectedCount === 0
                  ? 'Select items to add'
                  : `Add ${selectedCount} Item${selectedCount > 1 ? 's' : ''} to Look`}
              </Text>
            </Pressable>

            <Pressable
              style={styles.cancelButton}
              onPress={onClose}
              testID="closet-picker-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
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
    maxHeight: SCREEN_HEIGHT * 0.82,
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
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginTop: 2,
  },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F4F0',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    lineHeight: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F4F0',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    padding: 0,
  },
  gridRow: {
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
  },
  gridContent: {
    paddingBottom: 8,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    marginBottom: GRID_GAP,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardImage: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
  },
  cardPlaceholder: {
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    width: CARD_WIDTH,
    padding: 8,
    gap: 1,
  },
  cardName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  cardBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
  },
  cardPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
    marginTop: 1,
  },
  checkboxSelected: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  checkboxEmpty: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.45)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  alreadyAddedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  alreadyAddedText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#FFFFFF',
  },
  emptyState: {
    paddingHorizontal: 20,
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  confirmButton: {
    backgroundColor: '#1A1210',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#E8E0D8',
  },
  confirmButtonText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  confirmButtonTextDisabled: {
    color: '#8C8580',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
});
