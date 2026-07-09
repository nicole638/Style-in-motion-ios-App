import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Check } from 'lucide-react-native';

export type FilterOption = { id: string; name: string };

type CommonProps = {
  label: string;
  options: FilterOption[];
  allLabel?: string;
  testID?: string;
};

type SingleProps = CommonProps & {
  mode: 'single';
  selected: string;
  onChange: (next: string) => void;
};

type MultiProps = CommonProps & {
  mode: 'multi';
  selected: string[];
  onChange: (next: string[]) => void;
};

export type FilterDropdownProps = SingleProps | MultiProps;

const ALL_SENTINEL = 'all';

export function FilterDropdown(props: FilterDropdownProps) {
  const { label, options, allLabel, testID } = props;
  const [open, setOpen] = useState<boolean>(false);
  const insets = useSafeAreaInsets();

  const hasSelection =
    props.mode === 'single'
      ? !!props.selected && props.selected !== ALL_SENTINEL
      : props.selected.length > 0;

  const displayText = useMemo(() => {
    if (!hasSelection) return label;
    if (props.mode === 'single') {
      const match = options.find((o) => o.id === props.selected);
      return match?.name ?? label;
    }
    const first = options.find((o) => o.id === props.selected[0]);
    const firstName = first?.name ?? props.selected[0];
    return props.selected.length > 1
      ? `${firstName} +${props.selected.length - 1}`
      : firstName;
  }, [hasSelection, label, options, props]);

  const isSelected = (id: string): boolean => {
    if (props.mode === 'single') return props.selected === id;
    return props.selected.includes(id);
  };

  const handleToggle = (id: string) => {
    if (props.mode === 'single') {
      // Single mode: pick and auto-dismiss
      props.onChange(id);
      setOpen(false);
      return;
    }
    // Multi mode: toggle in place, sheet stays open
    const cur = props.selected;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    props.onChange(next);
  };

  const handleClear = () => {
    if (props.mode === 'single') {
      props.onChange(ALL_SENTINEL);
      setOpen(false);
      return;
    }
    // Multi: clear but keep open
    props.onChange([]);
  };

  const handleDone = () => setOpen(false);

  const triggerTestID = testID ?? `filter-dropdown-${label.toLowerCase()}`;
  const clearActionLabel =
    props.mode === 'single' ? (allLabel ?? 'All') : 'Clear';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        testID={triggerTestID}
        style={[styles.triggerPill, hasSelection && styles.triggerPillActive]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.triggerPillText,
            hasSelection && styles.triggerPillTextActive,
          ]}
        >
          {displayText}
        </Text>
        <ChevronDown
          size={14}
          color={hasSelection ? '#FFFFFF' : '#6B5E58'}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          testID={`${triggerTestID}-backdrop`}
        >
          <View style={styles.sheetContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.dragHandle} />

            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>{label}</Text>
              <Pressable
                onPress={handleClear}
                hitSlop={8}
                testID={`${triggerTestID}-clear`}
              >
                <Text style={styles.clearAction}>{clearActionLabel}</Text>
              </Pressable>
            </View>

            <View style={styles.headerDivider} />

            <ScrollView
              style={styles.optionList}
              contentContainerStyle={styles.optionListContent}
              bounces
              showsVerticalScrollIndicator={false}
            >
              {options.map((option, index) => {
                const sel = isSelected(option.id);
                const isLast = index === options.length - 1;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => handleToggle(option.id)}
                    testID={`${triggerTestID}-option-${option.id}`}
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.optionRow,
                      sel && styles.optionRowSelected,
                      isLast && styles.lastOptionRow,
                      pressed && styles.optionRowPressed,
                    ]}
                  >
                    <View style={styles.optionInner} pointerEvents="none">
                      <Text
                        style={[
                          styles.optionLabel,
                          sel && styles.optionLabelSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {option.name}
                      </Text>
                      {sel ? (
                        <View style={styles.checkCircle}>
                          <Check size={13} color="#FFFFFF" strokeWidth={2.75} />
                        </View>
                      ) : (
                        <View style={styles.uncheckCircle} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {props.mode === 'multi' ? (
              <View
                style={[
                  styles.doneButtonContainer,
                  { paddingBottom: 16 + insets.bottom },
                ]}
              >
                <Pressable
                  onPress={handleDone}
                  style={({ pressed }) => [
                    styles.doneButton,
                    pressed && styles.doneButtonPressed,
                  ]}
                  testID={`${triggerTestID}-done`}
                >
                  <Text style={styles.doneButtonText}>Done</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Trigger pill (closed state)
  triggerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D4C8C2',
    backgroundColor: '#FFFFFF',
    minHeight: 36,
    maxWidth: 180,
    gap: 4,
  },
  triggerPillActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  triggerPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
    flexShrink: 1,
    textTransform: 'capitalize',
  },
  triggerPillTextActive: {
    color: '#FFFFFF',
  },

  // Sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingBottom: 0,
    maxHeight: '75%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4C8C2',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    letterSpacing: 0.2,
  },
  clearAction: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#B87063',
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D8',
  },

  // Option list
  optionList: {
    flexGrow: 0,
  },
  optionListContent: {
    paddingBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E0D8',
    backgroundColor: '#FFFFFF',
  },
  optionInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  lastOptionRow: {
    borderBottomWidth: 0,
  },
  optionRowSelected: {
    backgroundColor: '#FDF5F3',
  },
  optionRowPressed: {
    backgroundColor: '#F7F4F0',
  },
  optionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 17,
    color: '#1A1210',
    flex: 1,
    paddingRight: 12,
    textTransform: 'capitalize',
    letterSpacing: 0.1,
  },
  optionLabelSelected: {
    color: '#B87063',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uncheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D4C8C2',
  },

  // Done button (multi mode only)
  doneButtonContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E0D8',
  },
  doneButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonPressed: {
    opacity: 0.85,
  },
  doneButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});

export default FilterDropdown;
