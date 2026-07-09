import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

// Tag values match the SQL function output exactly.
// Group A is algorithmic / primary; Group B is creator self-tag / secondary.
type Tag = { value: string; label: string };

const GROUP_A: Tag[] = [
  { value: 'petite', label: 'Petite' },
  { value: 'tall', label: 'Tall' },
  { value: 'average-height', label: 'Average' },
  { value: 'plus', label: 'Plus' },
  { value: 'midsize', label: 'Midsize' },
  { value: 'straight', label: 'Straight' },
];

const GROUP_B: Tag[] = [
  { value: 'curvy', label: 'Curvy' },
  { value: 'athletic', label: 'Athletic' },
  { value: 'hourglass', label: 'Hourglass' },
  { value: 'pear', label: 'Pear' },
  { value: 'apple', label: 'Apple' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'modest', label: 'Modest' },
  { value: 'tomboy', label: 'Tomboy' },
  { value: 'feminine', label: 'Feminine' },
  { value: 'edgy', label: 'Edgy' },
  { value: 'classic', label: 'Classic' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'bohemian', label: 'Bohemian' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'streetwear', label: 'Streetwear' },
];

interface PillProps {
  tag: Tag;
  selected: boolean;
  onPress: () => void;
}

// Style-source-of-truth: feed.tsx filterTab / filterTabActive / filterTabText /
// filterTabTextActive (the All/Following pills). Body-type pills are rebuilt
// here in StyleSheet — not NativeWind, not inline lineHeight — so they
// inherit iOS's native vertical centering for DMSans_500Medium and don't clip.
function Pill({ tag, selected, onPress }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, selected && styles.pillActive]}
      testID={`body-type-filter-${tag.value}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        allowFontScaling={false}
        style={[styles.pillText, selected && styles.pillTextActive]}
      >
        {tag.label}
      </Text>
    </Pressable>
  );
}

export interface BodyTypeFilterPillsProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

export default function BodyTypeFilterPills({ selected, onChange }: BodyTypeFilterPillsProps) {
  const toggle = useCallback(
    (value: string) => {
      Haptics.selectionAsync().catch(() => {});
      if (selected.includes(value)) {
        onChange(selected.filter((v) => v !== value));
      } else {
        onChange([...selected, value]);
      }
    },
    [selected, onChange]
  );

  const handleClear = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange([]);
  }, [onChange]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      testID="body-type-filter-row"
    >
      {GROUP_A.map((tag) => (
        <Pill
          key={tag.value}
          tag={tag}
          selected={selected.includes(tag.value)}
          onPress={() => toggle(tag.value)}
        />
      ))}

      {/* Subtle vertical divider between primary (algorithmic) and secondary (self-tag) groups */}
      <View style={styles.divider} />

      {GROUP_B.map((tag) => (
        <Pill
          key={tag.value}
          tag={tag}
          selected={selected.includes(tag.value)}
          onPress={() => toggle(tag.value)}
        />
      ))}

      {selected.length > 0 ? (
        <Pressable
          onPress={handleClear}
          style={styles.clearButton}
          testID="body-type-filter-clear"
          accessibilityRole="button"
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// Mirrors feed.tsx filterTab/filterTabActive/filterTabText/filterTabTextActive
// exactly. If those change, change here too — they need to look identical.
const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  pillActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  pillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#A0938D',
    // iOS Text on single-line content reports just ~12px (font ascent only),
    // so descenders extend OUTSIDE the Text element's layout box. The
    // Pressable's borderRadius:20 implies CALayer masksToBounds on iOS,
    // which clips anything outside the Text's box. Adding paddingVertical
    // grows the Text's reported layout box so descenders fit inside it
    // and survive the clip.
    paddingTop: 4,
    paddingBottom: 8,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: '#E8E0D8',
    marginHorizontal: 4,
    alignSelf: 'center',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  clearText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
  },
});
