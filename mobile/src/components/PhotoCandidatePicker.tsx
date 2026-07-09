import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

interface Props {
  candidates: string[];
  selected: string | null | undefined;
  onSelect: (url: string) => void | Promise<void>;
  loadingUrl?: string | null;
}

/**
 * 3-across thumbnail grid for swapping a closet item's primary photo between
 * candidates produced by the scrape pipeline. Hidden when fewer than 2
 * candidates exist (no choice to make). Mirrors the web equivalent at
 * creators-web/components/closet/PhotoCandidatePicker.tsx.
 */
export function PhotoCandidatePicker({ candidates, selected, onSelect, loadingUrl }: Props) {
  const [brokenSet, setBrokenSet] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const url of candidates ?? []) {
      if (!url || brokenSet.has(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      list.push(url);
    }
    return list;
  }, [candidates, brokenSet]);

  if (visible.length < 2) return null;

  const handleSelect = (url: string) => {
    if (url === selected || loadingUrl) return;
    Haptics.selectionAsync().catch(() => {});
    void onSelect(url);
  };

  return (
    <View style={styles.wrap} testID="photo-candidate-picker">
      <Text style={styles.label}>Other photos</Text>
      <View style={styles.grid}>
        {visible.map((url) => {
          const isSelected = url === selected;
          const isLoading = url === loadingUrl;
          return (
            <Pressable
              key={url}
              onPress={() => handleSelect(url)}
              disabled={!!loadingUrl}
              style={[styles.cell, isSelected && styles.cellSelected]}
              testID={`photo-candidate-${visible.indexOf(url)}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <Image
                source={{ uri: url }}
                style={styles.thumb}
                contentFit="contain"
                onError={() => {
                  setBrokenSet((prev) => {
                    if (prev.has(url)) return prev;
                    const next = new Set(prev);
                    next.add(url);
                    return next;
                  });
                }}
              />
              {isSelected ? (
                <View style={styles.checkBadge}>
                  <Check size={12} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : null}
              {isLoading ? (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const GAP = 8;

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  cell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F0EBE5',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    padding: 4,
  },
  cellSelected: {
    borderColor: '#B87063',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  checkBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26, 18, 16, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
