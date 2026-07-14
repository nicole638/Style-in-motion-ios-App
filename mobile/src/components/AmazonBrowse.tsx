import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ExternalLink, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import PillButton from '@/components/PillButton';
import {
  AMAZON_DEPARTMENTS,
  AMAZON_HOME_URL,
  type AmazonDepartment,
} from '@/lib/constants/amazonCategories';

/**
 * Browse-and-link header for the Amazon marketplace page.
 *
 * Every other brand page lets a creator (a) visit the brand's site in-app and
 * (b) filter by department. Amazon had neither — it opened straight into bonus
 * campaigns, so there was no way to go to Amazon and link a piece from there.
 *
 * Amazon has no catalog in our database, so these buttons navigate INTO Amazon
 * rather than filtering a local grid: each one opens amazon.com in the in-app
 * web shop, where the floating "Add to Closet" button pulls the piece into the
 * creator's closet. Tapping a department reveals its types (Clothing → Tops,
 * Dresses, Jeans …) — one level deeper, same as the other brand pages.
 */
export default function AmazonBrowse() {
  const [openDept, setOpenDept] = useState<string | null>(null);

  const openInWebShop = useCallback(async (url: string, label: string) => {
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    router.push({
      pathname: '/web-shop',
      params: { url, brand: label },
    });
  }, []);

  const toggleDept = useCallback(async (dept: AmazonDepartment) => {
    try { await Haptics.selectionAsync(); } catch {}
    setOpenDept((cur) => (cur === dept.label ? null : dept.label));
  }, []);

  const active = AMAZON_DEPARTMENTS.find((d) => d.label === openDept) ?? null;

  return (
    <View style={styles.wrap} testID="amazon-browse">
      <PillButton
        label="Shop amazon.com"
        icon={<ExternalLink size={16} color="#FFFFFF" />}
        fullWidth
        onPress={() => openInWebShop(AMAZON_HOME_URL, 'Amazon')}
        testID="amazon-shop-website"
      />
      <Text style={styles.hint}>
        Browse Amazon right here, then tap “Add to Closet” on anything you love.
      </Text>

      {/* Level 1 — departments */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
        testID="amazon-department-chips"
      >
        {AMAZON_DEPARTMENTS.map((dept) => {
          const isOpen = openDept === dept.label;
          return (
            <Pressable
              key={dept.label}
              onPress={() => toggleDept(dept)}
              style={[styles.chip, isOpen && styles.chipActive]}
              testID={`amazon-department-chip-${dept.label.toLowerCase()}`}
            >
              <Text style={[styles.chipText, isOpen && styles.chipTextActive]}>{dept.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Level 2 — the selected department's types */}
      {active ? (
        <View testID="amazon-type-row">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsContent}
          >
            <Pressable
              onPress={() => openInWebShop(active.url, `Amazon · ${active.label}`)}
              style={[styles.chip, styles.chipAll]}
              testID="amazon-type-chip-all"
            >
              <Text style={[styles.chipText, styles.chipAllText]}>{`All ${active.label}`}</Text>
              <ChevronRight size={13} color="#B87063" />
            </Pressable>
            {active.types.map((t) => (
              <Pressable
                key={t.label}
                onPress={() => openInWebShop(t.url, `Amazon · ${t.label}`)}
                style={styles.chip}
                testID={`amazon-type-chip-${t.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Text style={styles.chipText}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  hint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#6B5E58',
    marginTop: 10,
    marginBottom: 4,
  },
  chipsScroll: {
    flexGrow: 0,
    marginTop: 10,
    marginHorizontal: -16,
  },
  chipsContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  chipActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  chipAll: {
    borderColor: '#B87063',
  },
  chipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  chipAllText: {
    color: '#B87063',
  },
});
