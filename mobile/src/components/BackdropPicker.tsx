import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { X, Eraser } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Backdrop, listBackdrops } from '@/lib/api/vto';

export type BackdropPick = string | 'remove';

interface BackdropPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (pick: BackdropPick) => void;
  testIDPrefix?: string;
}

export function BackdropPicker({
  visible,
  onClose,
  onSelect,
  testIDPrefix = 'backdrop-picker',
}: BackdropPickerProps) {
  const { data: backdrops = [], isLoading } = useQuery<Backdrop[]>({
    queryKey: ['creator-backdrops'],
    queryFn: listBackdrops,
    enabled: visible,
    staleTime: 1000 * 60 * 5,
  });

  const grouped = useMemo<Array<{ category: string; items: Backdrop[] }>>(() => {
    const map = new Map<string, Backdrop[]>();
    backdrops.forEach((b) => {
      const list = map.get(b.category) ?? [];
      list.push(b);
      map.set(b.category, list);
    });
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
  }, [backdrops]);

  const handlePick = (pick: BackdropPick) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(pick);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID={`${testIDPrefix}-modal`}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID={`${testIDPrefix}-backdrop`}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handleBar} />

          <View style={styles.header}>
            <Text style={styles.title}>Try a Backdrop</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton} testID={`${testIDPrefix}-close`}>
              <X size={20} color="#1A1210" strokeWidth={1.8} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingBox} testID={`${testIDPrefix}-loading`}>
              <ActivityIndicator size="small" color="#B87063" />
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>Effects</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
              style={{ flexGrow: 0 }}
            >
              <Pressable
                onPress={() => handlePick('remove')}
                style={({ pressed }) => [styles.tile, styles.removeTile, pressed && styles.pressed]}
                testID={`${testIDPrefix}-remove-bg`}
              >
                <View style={styles.removeTileInner}>
                  <Eraser size={28} color="#6B5E58" strokeWidth={1.75} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>Remove BG</Text>
              </Pressable>
            </ScrollView>

            {grouped.map(({ category, items }) => (
              <View key={category} style={{ marginTop: 18 }}>
                <Text style={styles.sectionLabel}>{category}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.row}
                  style={{ flexGrow: 0 }}
                >
                  {items.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => handlePick(b.id)}
                      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                      testID={`${testIDPrefix}-tile-${b.id}`}
                    >
                      <Image
                        source={{ uri: b.thumbnail_url }}
                        style={styles.tileImage}
                        contentFit="cover"
                      />
                      <Text style={styles.tileLabel} numberOfLines={1}>{b.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ))}

            {!isLoading && grouped.length === 0 ? (
              <View style={styles.emptyBox} testID={`${testIDPrefix}-empty`}>
                <Text style={styles.emptyText}>No backdrops available yet.</Text>
              </View>
            ) : null}

            <View style={{ height: 24 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#F7F4F0',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4C8C2',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#EDE6DF',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    gap: 10,
    paddingRight: 4,
    paddingBottom: 4,
  },
  tile: {
    width: 96,
    gap: 6,
  },
  tileImage: {
    width: 96,
    height: 128,
    borderRadius: 12,
    backgroundColor: '#EDE6DF',
  },
  removeTile: {},
  removeTileInner: {
    width: 96,
    height: 128,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D4C8C2',
    borderStyle: 'dashed',
    backgroundColor: '#FBF6EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#1A1210',
    textAlign: 'center',
  },
  pressed: { opacity: 0.85 },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
  },
});
