import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Trash2 } from 'lucide-react-native';
import PillButton from '@/components/PillButton';
import useHashtagStore from '@/lib/state/hashtagStore';

interface HashtagEditorProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  onHashtagsSaved: () => void;
}

export default function HashtagEditor({
  selectedTags,
  onTagsChange,
  onHashtagsSaved,
}: HashtagEditorProps) {
  const [customTagInput, setCustomTagInput] = useState<string>('');
  const [showManager, setShowManager] = useState<boolean>(false);
  const [managerInput, setManagerInput] = useState<string>('');
  const insets = useSafeAreaInsets();

  const savedHashtags = useHashtagStore((s) => s.savedHashtags);
  const addHashtag = useHashtagStore((s) => s.addHashtag);
  const removeHashtag = useHashtagStore((s) => s.removeHashtag);

  const normalizeTag = (tag: string): string => {
    let normalized = tag.trim().toLowerCase().replace(/\s+/g, '');
    if (normalized.length === 0) return '';
    if (!normalized.startsWith('#')) {
      normalized = '#' + normalized;
    }
    return normalized;
  };

  const handleAddCustomTag = () => {
    if (!customTagInput.trim()) return;
    const normalized = normalizeTag(customTagInput);
    if (!normalized || normalized === '#') return;
    addHashtag(normalized);
    if (!selectedTags.includes(normalized)) {
      onTagsChange([...selectedTags, normalized]);
    }
    setCustomTagInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleManagerAdd = () => {
    if (!managerInput.trim()) return;
    const normalized = normalizeTag(managerInput);
    if (!normalized || normalized === '#') return;
    addHashtag(normalized);
    setManagerInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleToggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleRemoveSelected = (tag: string) => {
    onTagsChange(selectedTags.filter((t) => t !== tag));
  };

  const handleManagerRemove = (tag: string) => {
    removeHashtag(tag);
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleChipLongPress = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Delete Hashtag',
      `Remove ${tag} from your saved hashtags?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeHashtag(tag);
            if (selectedTags.includes(tag)) {
              onTagsChange(selectedTags.filter((t) => t !== tag));
            }
          },
        },
      ]
    );
  };

  return (
    <View>
      {/* Selected tags row */}
      <Text style={styles.sectionLabel}>Hashtags</Text>

      {selectedTags.length === 0 ? (
        <Text style={styles.emptyText}>No hashtags selected</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginBottom: 8 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {selectedTags.map((tag) => (
            <View key={tag} style={styles.selectedChip}>
              <Text style={styles.selectedChipText}>{tag}</Text>
              <Pressable
                onPress={() => handleRemoveSelected(tag)}
                hitSlop={6}
                testID={`remove-selected-tag-${tag}`}
              >
                <Text style={styles.selectedChipRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Saved tags picker */}
      <View style={styles.savedLabelRow}>
        <Text style={styles.savedLabel}>Your saved hashtags</Text>
        <Pressable onPress={() => setShowManager(true)} testID="manage-hashtags-btn">
          <Text style={styles.manageLink}>Manage</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.tagGridScroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        testID="tag-grid-scroll"
      >
        <View style={styles.tagGrid}>
          {savedHashtags.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <Pressable
                key={tag}
                style={[
                  styles.tagChip,
                  isSelected ? styles.tagChipSelected : styles.tagChipUnselected,
                ]}
                onPress={() => handleToggleTag(tag)}
                onLongPress={() => handleChipLongPress(tag)}
                testID={`tag-chip-${tag}`}
              >
                <Text
                  style={[
                    styles.tagChipText,
                    isSelected ? styles.tagChipTextSelected : styles.tagChipTextUnselected,
                  ]}
                >
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Add custom hashtag */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="Add a hashtag…"
          placeholderTextColor="#6B5E58"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          value={customTagInput}
          onChangeText={setCustomTagInput}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleAddCustomTag}
          testID="custom-hashtag-input"
        />
        <PillButton
          label="Add"
          variant="primary"
          size="sm"
          onPress={handleAddCustomTag}
          testID="add-custom-hashtag-btn"
        />
      </View>

      {/* Manage hashtags modal — full screen */}
      <Modal
        visible={showManager}
        animationType="slide"
        onRequestClose={() => setShowManager(false)}
      >
        <View
          style={[
            styles.managerScreen,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
          testID="manage-hashtags-screen"
        >
          {/* Header */}
          <View style={styles.managerHeader}>
            <Text style={styles.managerTitle}>Manage Hashtags</Text>
            <Pressable
              onPress={() => setShowManager(false)}
              testID="manager-done-btn"
            >
              <Text style={styles.managerDoneText}>Done</Text>
            </Pressable>
          </View>

          {/* Add new tag row — above the list */}
          <View style={styles.managerAddRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Add a hashtag..."
              placeholderTextColor="#6B5E58"
              cursorColor="#2C2C2C"
              selectionColor="rgba(44, 44, 44, 0.3)"
              value={managerInput}
              onChangeText={setManagerInput}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleManagerAdd}
              testID="manager-add-input"
            />
            <PillButton
              label="Add"
              variant="primary"
              size="sm"
              onPress={handleManagerAdd}
              testID="manager-add-btn"
            />
          </View>

          {/* List */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {savedHashtags.map((tag) => (
              <View key={tag} style={styles.managerRow}>
                <Text style={styles.managerTagText}>{tag}</Text>
                <Pressable
                  onPress={() => handleManagerRemove(tag)}
                  hitSlop={8}
                  testID={`manager-remove-${tag}`}
                >
                  <Trash2 size={18} color="#B87063" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600',
    color: '#3D3330',
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B87063',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 12,
    gap: 6,
  },
  selectedChipText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#FFFFFF',
  },
  selectedChipRemove: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  savedLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  savedLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    fontWeight: '600',
    color: '#3D3330',
  },
  manageLink: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
  },
  tagGridScroll: {
    maxHeight: 120,
    flexGrow: 0,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tagChipSelected: {
    backgroundColor: '#B87063',
  },
  tagChipUnselected: {
    backgroundColor: '#F0EBE5',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  tagChipText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  tagChipTextSelected: {
    color: '#FFFFFF',
  },
  tagChipTextUnselected: {
    color: '#3D3330',
  },
  addRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  addInput: {
    flex: 1,
    backgroundColor: '#F0EBE5',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
  addButton: {
    backgroundColor: '#B87063',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1210',
  },
  // Manager modal — full screen
  managerScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  managerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  managerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    flex: 1,
  },
  managerDoneText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#B87063',
  },
  managerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  managerTagText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#1A1210',
  },
  managerAddRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 8,
  },
});
