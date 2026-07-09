import React from 'react';
import { ScrollView, View, Pressable, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { ItemCategory } from '@/lib/state/lookStore';
import { CATEGORIES } from '@/lib/constants/categories';

export interface CategoryChipsProps {
  /** Currently selected category value, or null for the "All" chip. */
  selected: ItemCategory | null;
  /** Called with the chosen value, or null when "All" is tapped. */
  onSelect: (value: ItemCategory | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Horizontal row of category filter chips: an "All" chip followed by the
 * canonical taxonomy (see lib/constants/categories.ts). Labels differ from the
 * stored value only for "Dresses & Skirts" (value `Dress`).
 *
 * PARENT-PROOF (Rule 54, made durable 2026-06-29 — clipped 3×):
 *  - This component owns its OWN horizontal ScrollView; callers just render
 *    <CategoryChips/> and CANNOT constrain it.
 *  - The ScrollView is pinned to `width: '100%'` + `flexShrink: 0`, applied
 *    AFTER any caller `style`, so OUR sizing always wins. A horizontal
 *    ScrollView with no explicit width collapses to ~0 inside a
 *    `flexDirection: 'row'` parent (Yoga gives it no intrinsic main-axis
 *    size) — that collapse is what kept clipping the labels. `width: '100%'`
 *    fills the parent in BOTH row and column contexts; `flexShrink: 0` stops a
 *    row sibling from squeezing it. Callers may still pass margins via `style`
 *    (no width/flex conflict) but cannot shrink it.
 *  - Each chip is a plain <View> with STATIC padding + `flexShrink: 0`; the
 *    Pressable carries touch + opacity ONLY (never layout / function-form
 *    layout style — the Rule 54 trap). Do NOT move layout onto the Pressable.
 */
export function CategoryChips({ selected, onSelect, style }: CategoryChipsProps) {
  const choose = (value: ItemCategory | null) => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(value);
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Caller style first so margins apply; our width/flex pins come LAST and
      // win — no parent or caller can clip this row.
      style={[style, { flexGrow: 0, flexShrink: 0, width: '100%' }]}
      contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 }}
      testID="category-chips"
    >
      <Pressable
        onPress={() => choose(null)}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        testID="category-chip-all"
      >
        <View style={chipStyle(selected === null)}>
          <Text numberOfLines={1} style={chipTextStyle(selected === null)}>All</Text>
        </View>
      </Pressable>
      {CATEGORIES.map((cat) => {
        const active = selected === cat.value;
        return (
          <Pressable
            key={cat.value}
            onPress={() => choose(cat.value)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            testID={`category-chip-${cat.value.toLowerCase()}`}
          >
            <View style={chipStyle(active)}>
              <Text numberOfLines={1} style={chipTextStyle(active)}>{cat.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default CategoryChips;

// Inline-object style builders. This build does NOT reliably apply
// StyleSheet.create refs through Pressable styles (padding/bg dropped → chips
// collapse and clip their labels), so we return plain objects instead.
const chipStyle = (active: boolean): ViewStyle => ({
  flexShrink: 0,
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: active ? '#1A1210' : '#F0EBE5',
});

const chipTextStyle = (active: boolean): TextStyle => ({
  fontFamily: 'DMSans_500Medium',
  fontSize: 13,
  color: active ? '#FFFFFF' : '#6B5E58',
});
