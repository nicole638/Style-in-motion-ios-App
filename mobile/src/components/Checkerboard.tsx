import React from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * Lightweight transparency checkerboard, drawn purely with Views (no image
 * assets). Used behind transparent-PNG results (e.g. the "No background"
 * virtual-model output) so the transparency reads as transparency instead of
 * looking like a solid card.
 */
interface CheckerboardProps {
  /** Square tile size in px. */
  cell?: number;
  /** Light square color. */
  light?: string;
  /** Dark square color. */
  dark?: string;
  style?: any;
  testID?: string;
}

export function Checkerboard({
  cell = 16,
  light = '#FFFFFF',
  dark = '#E4DED7',
  style,
  testID,
}: CheckerboardProps) {
  return (
    <View
      style={[styles.wrap, { backgroundColor: light }, style]}
      pointerEvents="none"
      testID={testID}
    >
      {/* A repeating row of offset dark squares is enough to read as a
       *  checkerboard; we tile via flex-wrap so it fills any container. */}
      <View style={styles.tiles}>
        {Array.from({ length: 400 }).map((_, i) => {
          const col = i % 20;
          const rowIdx = Math.floor(i / 20);
          const isDark = (col + rowIdx) % 2 === 1;
          return (
            <View
              key={i}
              style={{
                width: cell,
                height: cell,
                backgroundColor: isDark ? dark : 'transparent',
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
