import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Check, Scissors, Search, X } from 'lucide-react-native';
import { router } from 'expo-router';
import useLookStore, { ClothingItem, ItemCategory } from '@/lib/state/lookStore';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { CATEGORIES, categoryLabel } from '@/lib/constants/categories';
import CategoryChips from '@/components/CategoryChips';
import { filterClosetItems } from '@/lib/utils/filterClosetItems';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 12;
const GRID_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

export const COLLAGE_MIN_ITEMS = 2;
export const COLLAGE_MAX_ITEMS = 12;

export interface CollageItemPickerProps {
  onConfirm: (items: ClothingItem[]) => void;
  initialSelectedIds?: string[];
}

interface PickerSection {
  key: ItemCategory;
  label: string;
  data: ClothingItem[];
}

/** Newest-first within a section, so a freshly (re-)added piece surfaces at the
 *  top of its category instead of getting buried. Items with no createdAt keep
 *  their relative order at the end. */
function sortNewestFirst(items: ClothingItem[]): ClothingItem[] {
  return [...items].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });
}

/**
 * Resolve a ClothingItem to the variant the creator chose (or the default).
 * Reads candidatePhotoUrls[i] and candidateCutoutUrls[i] for the chosen index.
 * Falls back to the item's own photoUri/cutout_photo_url if no override is set.
 */
function applyPhotoOverride(
  item: ClothingItem,
  overrideIndex: number | undefined
): ClothingItem {
  if (overrideIndex === undefined || overrideIndex < 0) return item;
  const photo = item.candidatePhotoUrls?.[overrideIndex];
  if (!photo) return item;
  const cutout = item.candidateCutoutUrls?.[overrideIndex] ?? null;
  return {
    ...item,
    photoUri: photo,
    // Use the cutout if Photoroom has finished. Else null — collage canvas
    // will fall back to the raw photo.
    cutout_photo_url: cutout ?? undefined,
  };
}

export function CollageItemPicker({
  onConfirm,
  initialSelectedIds,
}: CollageItemPickerProps) {
  const closetItems = useLookStore(s => s.closetItems);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? [])
  );
  // Per-item chosen photo variant (index into candidatePhotoUrls).
  const [photoOverrides, setPhotoOverrides] = useState<Record<string, number>>({});
  // Sub-picker state: item currently being chosen
  const [subPickerItem, setSubPickerItem] = useState<ClothingItem | null>(null);
  // Search + category-chip filters (mirror the Closet tab).
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ItemCategory | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  // Everything non-archived with a usable image (cutout OR raw photo). No
  // category whitelist — every closet piece is stylable. The collage canvas
  // falls back to the raw photo when an item's cutout isn't ready yet.
  const items = useMemo(
    () => closetItems.filter(i => !i.archived && (!!i.cutout_photo_url || !!i.photoUri)),
    [closetItems]
  );

  // Apply the search box + category chip (they AND together).
  const visibleItems = useMemo(
    () => filterClosetItems(items, debouncedSearch, categoryFilter),
    [items, debouncedSearch, categoryFilter]
  );

  // Group into ordered category sections. Canonical taxonomy order first, then
  // any free-text DB categories we don't recognize (defensive) appended last.
  const sections = useMemo<PickerSection[]>(() => {
    const byCat = new Map<string, ClothingItem[]>();
    for (const it of visibleItems) {
      const key = it.category ?? 'Other';
      const bucket = byCat.get(key);
      if (bucket) bucket.push(it);
      else byCat.set(key, [it]);
    }
    const out: PickerSection[] = [];
    const seen = new Set<string>();
    for (const def of CATEGORIES) {
      const data = byCat.get(def.value);
      if (data && data.length) {
        out.push({ key: def.value, label: def.label, data: sortNewestFirst(data) });
        seen.add(def.value);
      }
    }
    for (const [key, data] of byCat) {
      if (!seen.has(key) && data.length) {
        out.push({ key: key as ItemCategory, label: categoryLabel(key as ItemCategory), data: sortNewestFirst(data) });
      }
    }
    return out;
  }, [visibleItems]);

  const commitSelection = useCallback((id: string, overrideIndex?: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (overrideIndex !== undefined) {
      setPhotoOverrides(prev => ({ ...prev, [id]: overrideIndex }));
    }
  }, []);

  const removeSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setPhotoOverrides(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const toggleItem = useCallback(
    (item: ClothingItem) => {
      if (selectedIds.has(item.id)) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        removeSelection(item.id);
        return;
      }
      if (selectedIds.size >= COLLAGE_MAX_ITEMS) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      const candidateCount = item.candidatePhotoUrls?.length ?? 0;
      // If there are multiple photo variants, open the sub-picker first so the
      // creator can choose which photo (and cutout) to use.
      if (candidateCount > 1) {
        Haptics.selectionAsync().catch(() => {});
        setSubPickerItem(item);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      commitSelection(item.id);
    },
    [selectedIds, commitSelection, removeSelection]
  );

  const handleSubPickerChoose = useCallback(
    (index: number) => {
      if (!subPickerItem) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // index === -1 is the sentinel for "keep current cutout" — commit
      // without an override so applyPhotoOverride leaves photoUri/cutout alone.
      if (index < 0) {
        commitSelection(subPickerItem.id);
      } else {
        commitSelection(subPickerItem.id, index);
      }
      setSubPickerItem(null);
    },
    [subPickerItem, commitSelection]
  );

  const handleConfirm = useCallback(() => {
    if (selectedIds.size < COLLAGE_MIN_ITEMS) return;
    const ordered: ClothingItem[] = [];
    const idArray = Array.from(selectedIds);
    for (const id of idArray) {
      const found = items.find(i => i.id === id);
      if (found) ordered.push(applyPhotoOverride(found, photoOverrides[id]));
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm(ordered);
  }, [selectedIds, items, onConfirm, photoOverrides]);

  const renderCard = useCallback(
    (item: ClothingItem) => {
      const isSelected = selectedIds.has(item.id);
      const idx = isSelected
        ? Array.from(selectedIds).indexOf(item.id) + 1
        : 0;
      const atCap = !isSelected && selectedIds.size >= COLLAGE_MAX_ITEMS;
      // Show whichever variant the creator chose for the card preview.
      const overrideIndex = photoOverrides[item.id];
      const previewUri =
        overrideIndex !== undefined
          ? item.candidatePhotoUrls?.[overrideIndex] ?? item.photoUri
          : item.photoUri;
      return (
        <Pressable
          key={item.id}
          style={({ pressed }) => [
            styles.card,
            pressed && !atCap && { opacity: 0.85 },
            atCap && styles.cardDisabled,
          ]}
          onPress={() => toggleItem(item)}
          disabled={atCap}
          testID={`collage-picker-card-${item.id}`}
        >
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
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
          </View>

          {isSelected ? (
            <View style={styles.numberBadge}>
              <Text style={styles.numberBadgeText}>{idx}</Text>
            </View>
          ) : (
            <View style={styles.checkboxEmpty}>
              <Check size={12} color="#FFFFFF" strokeWidth={3} opacity={0.6} />
            </View>
          )}

          {(item.candidatePhotoUrls?.length ?? 0) > 1 ? (
            <View style={styles.variantsHint}>
              <Text style={styles.variantsHintText}>
                {item.candidatePhotoUrls?.length} photos
              </Text>
            </View>
          ) : null}
        </Pressable>
      );
    },
    [selectedIds, toggleItem, photoOverrides]
  );

  const count = selectedIds.size;

  return (
    <View style={styles.root} testID="collage-item-picker">
      <View style={styles.header}>
        <Text style={styles.heading}>Pick 2–12 items</Text>
        <Text style={styles.sub}>
          {count} / {COLLAGE_MAX_ITEMS} selected
        </Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Your closet is empty — add a few pieces from a brand to start styling.
          </Text>
          <Pressable
            onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/(tabs)/brands'); }}
            style={{ marginTop: 16, backgroundColor: '#B87063', borderRadius: 22, paddingHorizontal: 20, paddingVertical: 12 }}
            testID="collage-picker-browse-brands"
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>Browse brands to add pieces</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Search box (name / brand / category) */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBar}>
              <Search size={18} color="#8C8580" strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search items, brands..."
                placeholderTextColor="#8C8580"
                cursorColor="#1A1210"
                selectionColor="rgba(26,18,16,0.3)"
                returnKeyType="search"
                testID="collage-picker-search"
              />
              {search.length > 0 ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8} testID="collage-picker-search-clear">
                  <X size={18} color="#8C8580" strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Category chips */}
          <CategoryChips selected={categoryFilter} onSelect={setCategoryFilter} style={styles.chips} />

          {visibleItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No items match your search.</Text>
              <Pressable
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setSearch(''); setCategoryFilter(null); }}
                style={{ marginTop: 16, backgroundColor: '#1A1210', borderRadius: 22, paddingHorizontal: 20, paddingVertical: 12 }}
                testID="collage-picker-clear-filters"
              >
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>Clear filters</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.gridContent}
              showsVerticalScrollIndicator={false}
              testID="collage-picker-grid"
            >
              {sections.map(section => (
                <View key={section.key} testID={`collage-picker-section-${section.key.toLowerCase()}`}>
                  <Text style={styles.sectionHeader}>
                    {section.label} · {section.data.length}
                  </Text>
                  <View style={styles.sectionGrid}>
                    {section.data.map(item => renderCard(item))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      <View style={styles.footer}>
        <Pressable
          style={[
            styles.confirmButton,
            count < COLLAGE_MIN_ITEMS && styles.confirmButtonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={count < COLLAGE_MIN_ITEMS}
          testID="collage-picker-confirm"
        >
          <Text
            style={[
              styles.confirmButtonText,
              count < COLLAGE_MIN_ITEMS && styles.confirmButtonTextDisabled,
            ]}
          >
            {count < COLLAGE_MIN_ITEMS
              ? `Pick ${COLLAGE_MIN_ITEMS - count} more to continue`
              : `Continue with ${count} item${count > 1 ? 's' : ''} →`}
          </Text>
        </Pressable>
      </View>

      {/* Sub-picker — choose a specific candidate photo for the item. */}
      <Modal
        visible={subPickerItem !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSubPickerItem(null)}
      >
        {subPickerItem ? (
          <PhotoSubPicker
            item={subPickerItem}
            onChoose={handleSubPickerChoose}
            onClose={() => setSubPickerItem(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

// ─── Sub-picker ────────────────────────────────────────────────────────────

interface PhotoSubPickerProps {
  item: ClothingItem;
  onChoose: (index: number) => void;
  onClose: () => void;
}

function PhotoSubPicker({ item, onChoose, onClose }: PhotoSubPickerProps) {
  const photos = item.candidatePhotoUrls ?? [];
  const cutouts = item.candidateCutoutUrls ?? [];

  return (
    <View style={subStyles.root} testID="collage-picker-sub">
      <View style={subStyles.header}>
        <Pressable
          onPress={onClose}
          style={subStyles.closeBtn}
          testID="collage-picker-sub-close"
          hitSlop={10}
        >
          <X size={20} color="#1A1210" />
        </Pressable>
        <Text style={subStyles.title} numberOfLines={1}>
          Choose a photo
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <Text style={subStyles.subtitle}>
        Pick the angle you want in your collage.
        {item.cutout_photo_url ? ' The starred ★ option is the cutout you saved earlier.' : ''}
        {cutouts.some(c => c) ? ' Scissors mean that angle has its own background-removed cutout.' : ''}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={subStyles.row}
        style={{ flexGrow: 0 }}
      >
        {/* Current cutout — only shown when the item has a primary
            cutout_photo_url that isn't already represented by one of the
            per-candidate cutouts. Tapping it commits the item without a
            candidate override, so applyPhotoOverride leaves photoUri and
            cutout_photo_url untouched (preserving the creator's earlier
            cutout work). */}
        {item.cutout_photo_url && !cutouts.includes(item.cutout_photo_url) ? (
          <Pressable
            key="current-cutout"
            onPress={() => onChoose(-1)}
            style={[subStyles.thumb, { borderColor: '#B87063', borderWidth: 2 }]}
            testID="collage-picker-current-cutout"
          >
            <Image
              source={{ uri: item.cutout_photo_url }}
              style={subStyles.thumbImage}
              contentFit="cover"
            />
            <View style={subStyles.cutoutBadge} testID="collage-picker-current-cutout-badge">
              <Scissors size={12} color="#FFFFFF" />
            </View>
            <View style={[subStyles.indexBadge, { backgroundColor: '#B87063' }]}>
              <Text style={[subStyles.indexBadgeText, { color: '#FFFFFF' }]}>★</Text>
            </View>
          </Pressable>
        ) : null}
        {photos.map((photoUri, i) => {
          const hasCutout = !!cutouts[i];
          // If the cutout is ready, preview it (the creator sees what'll
          // actually land on the canvas). Else preview the raw photo.
          const previewUri = hasCutout ? cutouts[i] : photoUri;
          return (
            <Pressable
              key={`${photoUri}-${i}`}
              onPress={() => onChoose(i)}
              style={subStyles.thumb}
              testID={`collage-picker-photo-option-${i}`}
            >
              <Image
                source={{ uri: previewUri ?? photoUri }}
                style={subStyles.thumbImage}
                contentFit="cover"
              />
              {hasCutout ? (
                <View
                  style={subStyles.cutoutBadge}
                  testID={`collage-picker-has-cutout-${i}`}
                >
                  <Scissors size={12} color="#FFFFFF" />
                </View>
              ) : null}
              <View style={subStyles.indexBadge}>
                <Text style={subStyles.indexBadgeText}>{i + 1}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={subStyles.tip}>
        <Text style={subStyles.tipText}>
          The collage will use the cutout when available, otherwise the raw photo.
        </Text>
      </View>
    </View>
  );
}

export default CollageItemPicker;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E0D8',
  },
  heading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
  },
  sub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginTop: 2,
  },
  searchBarContainer: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    height: 44,
  },
  chips: {
    marginTop: 10,
  },
  gridContent: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  sectionHeader: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#8C8580',
    paddingHorizontal: GRID_PADDING,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
    columnGap: GRID_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    marginBottom: GRID_GAP,
  },
  cardDisabled: { opacity: 0.4 },
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
  numberBadge: {
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
  numberBadgeText: {
    color: '#FFFFFF',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantsHint: {
    position: 'absolute',
    bottom: 56,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  variantsHintText: {
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
  },
  emptyState: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
});

const subStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    paddingHorizontal: 16,
    paddingBottom: 12,
    lineHeight: 19,
  },
  row: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 8,
  },
  thumb: {
    width: 140,
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F0EBE5',
    position: 'relative',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  cutoutBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#B87063',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexBadgeText: {
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  tip: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tipText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    lineHeight: 18,
  },
});
