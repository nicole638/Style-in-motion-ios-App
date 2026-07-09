import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Shuffle } from 'lucide-react-native';
import { LayoutTemplate, LayoutItemCount, getAllLayouts } from '@/lib/collage/layouts';

const THUMB_SIZE = 80;
const ITEM_WIDTH = THUMB_SIZE + 8; // thumb + label area width
const ROSE_FILL = 'rgba(184,112,99,0.18)';
const ROSE_STROKE = '#B87063';
const SELECTED_BORDER = '#B87063';

interface LayoutThumbProps {
  layout: LayoutTemplate;
  selected: boolean;
  onPress: () => void;
}

function LayoutThumb({ layout, selected, onPress }: LayoutThumbProps) {
  const scale = THUMB_SIZE; // cells are normalized [0,1], multiply by THUMB_SIZE for pixels
  return (
    <Pressable
      onPress={onPress}
      style={[styles.thumbWrap, selected && styles.thumbSelected]}
      testID={`layout-thumb-${layout.id}`}
    >
      <View
        style={[
          styles.thumbCanvas,
          selected && { borderColor: SELECTED_BORDER, borderWidth: 2 },
        ]}
      >
        <Svg width={THUMB_SIZE} height={THUMB_SIZE}>
          {layout.cells.map((cell, i) => {
            const cx = cell.x * scale + (cell.w * scale) / 2;
            const cy = cell.y * scale + (cell.h * scale) / 2;
            const rotation = cell.rotation ?? 0;
            return (
              <Rect
                key={i}
                x={cell.x * scale}
                y={cell.y * scale}
                width={cell.w * scale}
                height={cell.h * scale}
                rx={2}
                fill={ROSE_FILL}
                stroke={ROSE_STROKE}
                strokeWidth={selected ? 1 : 0.5}
                origin={`${cx}, ${cy}`}
                rotation={rotation}
              />
            );
          })}
        </Svg>
      </View>
      <Text style={styles.thumbLabel} numberOfLines={1}>
        {layout.name}
      </Text>
    </Pressable>
  );
}

interface ShufflePillProps {
  onPress: () => void;
}

function ShufflePill({ onPress }: ShufflePillProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.shufflePill}
      testID="layout-carousel-shuffle"
    >
      <Shuffle size={14} color="#6B5E58" />
      <Text style={styles.shuffleText}>Shuffle</Text>
    </Pressable>
  );
}

interface LayoutCarouselProps {
  itemCount: number;
  selectedLayoutId: string | null;
  layoutSeed: number;
  onSelectLayout: (layout: LayoutTemplate) => void;
  onShuffle: () => void;
}

export default function LayoutCarousel({
  itemCount,
  selectedLayoutId,
  layoutSeed,
  onSelectLayout,
  onShuffle,
}: LayoutCarouselProps) {
  const count = Math.min(Math.max(itemCount, 1), 6) as LayoutItemCount;
  const layouts = getAllLayouts(count, layoutSeed);

  const handleSelect = useCallback(
    (layout: LayoutTemplate) => {
      Haptics.selectionAsync().catch(() => {});
      onSelectLayout(layout);
    },
    [onSelectLayout],
  );

  const handleShuffle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onShuffle();
  }, [onShuffle]);

  // Hide carousel outside supported range
  if (itemCount < 1 || itemCount > 6) return null;

  return (
    <View style={styles.container} testID="layout-carousel">
      <FlatList<LayoutTemplate>
        data={layouts}
        keyExtractor={item => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        style={{ flexGrow: 0 }}
        renderItem={({ item }) => (
          <LayoutThumb
            layout={item}
            selected={item.id === selectedLayoutId}
            onPress={() => handleSelect(item)}
          />
        )}
        ListFooterComponent={<ShufflePill onPress={handleShuffle} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FAF7F4',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#EDE8E3',
    paddingVertical: 10,
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  thumbWrap: {
    alignItems: 'center',
    width: ITEM_WIDTH,
    gap: 4,
  },
  thumbCanvas: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F0EBE5',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  thumbSelected: {
    // outer ring handled on thumbCanvas
  },
  thumbLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: '#6B5E58',
    maxWidth: ITEM_WIDTH,
    textAlign: 'center',
  },
  shufflePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#EDE8E3',
    alignSelf: 'center',
    marginLeft: 4,
  },
  shuffleText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
  },
});
