import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Check, Search } from 'lucide-react-native';
import PillButton from '@/components/PillButton';
import * as Haptics from 'expo-haptics';
import useBrandStore from '@/lib/state/brandStore';

const { height: screenHeight } = Dimensions.get('window');

interface BrandSelectorProps {
  selectedBrand: string | null;
  onBrandSelect: (brand: string | null) => void;
}

export default function BrandSelector({
  selectedBrand,
  onBrandSelect,
}: BrandSelectorProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [customBrandInput, setCustomBrandInput] = useState<string>('');
  const insets = useSafeAreaInsets();

  const getAllBrands = useBrandStore((s) => s.getAllBrands);
  const addCustomBrand = useBrandStore((s) => s.addCustomBrand);

  const allBrands = getAllBrands();
  const filteredBrands = searchText.trim()
    ? allBrands.filter((b) =>
        b.toLowerCase().includes(searchText.trim().toLowerCase())
      )
    : allBrands;

  const handleSelectBrand = (brand: string) => {
    onBrandSelect(brand);
    setIsExpanded(false);
    setSearchText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddFromSearch = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    addCustomBrand(trimmed);
    onBrandSelect(trimmed);
    setIsExpanded(false);
    setSearchText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddCustom = () => {
    const trimmed = customBrandInput.trim();
    if (!trimmed) return;
    addCustomBrand(trimmed);
    onBrandSelect(trimmed);
    setIsExpanded(false);
    setCustomBrandInput('');
    setSearchText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={styles.wrapper}>
      {/* Collapsed state */}
      <Pressable
        style={styles.collapsedRow}
        onPress={() => setIsExpanded(true)}
        testID="brand-selector-collapsed"
      >
        <Text
          style={[
            styles.collapsedText,
            selectedBrand ? styles.collapsedTextSelected : null,
          ]}
        >
          {selectedBrand ?? 'Select a brand (optional)'}
        </Text>
        <ChevronDown size={16} color="#6B5E58" />
      </Pressable>

      {selectedBrand ? (
        <Pressable
          onPress={() => onBrandSelect(null)}
          testID="clear-brand-btn"
        >
          <Text style={styles.clearLink}>Clear</Text>
        </Pressable>
      ) : null}

      {/* Expanded modal */}
      <Modal
        visible={isExpanded}
        transparent
        animationType="slide"
        onRequestClose={() => setIsExpanded(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={() => {
              setIsExpanded(false);
              setSearchText('');
            }}
          />
          <View
            style={[
              styles.modalSheet,
              {
                height: screenHeight * 0.75,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            {/* Search bar */}
            <View style={styles.searchSection}>
              <Text style={styles.sheetTitle}>Select Brand</Text>
              <View style={styles.searchBarContainer}>
                <Search
                  size={16}
                  color="#6B5E58"
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search brands…"
                  placeholderTextColor="#6B5E58"
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  autoFocus
                  value={searchText}
                  onChangeText={setSearchText}
                  testID="brand-search-input"
                />
              </View>
            </View>

            {/* Add custom brand row — above the list so keyboard doesn't cover it */}
            <View style={styles.customBrandRow}>
              <Text style={styles.customBrandLabel}>Or add your own:</Text>
              <View style={styles.customBrandInputRow}>
                <TextInput
                  style={styles.customBrandInput}
                  placeholder="Add a brand not in the list…"
                  placeholderTextColor="#6B5E58"
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  value={customBrandInput}
                  onChangeText={setCustomBrandInput}
                  autoCapitalize="words"
                  testID="custom-brand-input"
                />
                <PillButton
                  label="Add"
                  variant="primary"
                  size="sm"
                  disabled={!customBrandInput.trim()}
                  onPress={handleAddCustom}
                  testID="add-custom-brand-btn"
                />
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Brand list */}
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {filteredBrands.length === 0 && searchText.trim().length > 0 ? (
                <Pressable
                  style={styles.addFromSearchRow}
                  onPress={handleAddFromSearch}
                  testID="add-brand-from-search"
                >
                  <Text style={styles.addFromSearchText}>
                    {`"${searchText.trim()}" \u2014 tap to add`}
                  </Text>
                </Pressable>
              ) : null}

              {filteredBrands.map((brand) => {
                const isSelected = selectedBrand === brand;
                return (
                  <Pressable
                    key={brand}
                    style={styles.brandRow}
                    onPress={() => handleSelectBrand(brand)}
                    testID={`brand-option-${brand}`}
                  >
                    <Text
                      style={[
                        styles.brandName,
                        isSelected && styles.brandNameSelected,
                      ]}
                    >
                      {brand}
                    </Text>
                    {isSelected ? (
                      <Check size={18} color="#B87063" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
  },
  collapsedRow: {
    backgroundColor: '#F0EBE5',
    borderRadius: 10,
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsedText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
  },
  collapsedTextSelected: {
    color: '#1A1210',
    fontFamily: 'DMSans_500Medium',
    fontWeight: '500',
  },
  clearLink: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
    marginTop: 4,
  },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sheetTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 14,
  },
  searchBarContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  searchInput: {
    backgroundColor: '#F0EBE5',
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 14,
    paddingLeft: 40,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
  addFromSearchRow: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  addFromSearchText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#B87063',
  },
  brandRow: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandName: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#1A1210',
  },
  brandNameSelected: {
    color: '#B87063',
    fontFamily: 'DMSans_500Medium',
    fontWeight: '600',
  },
  customBrandRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  customBrandLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    marginBottom: 6,
  },
  customBrandInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  divider: {
    height: 0.5,
    backgroundColor: '#E8E0D8',
    marginHorizontal: 16,
    marginBottom: 4,
  },
  customBrandInput: {
    flex: 1,
    backgroundColor: '#F0EBE5',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
  customBrandAddBtn: {
    backgroundColor: '#B87063',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBrandAddText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
