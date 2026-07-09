// Storefront context switcher — top-of-Home chip that says
// "Posting as [Personal | Brand Name] ▾" and opens an ActionSheet on tap.
//
// Renders NULL for normal creators (zero memberships). Single-brand stylists
// see only [Personal, <Brand>]. Multi-brand stylists see all options. The
// chip itself uses the app's rounded-card visual language; the active brand
// shows its logo so the surface is obviously "you are acting as this brand".
//
// IMPORTANT: tap target is a <Pressable> styled via NativeWind `className`
// string literals (NOT StyleSheet) per the project-wide pill-button gotcha.

import React, { useCallback } from 'react';
import { View, Text, Pressable, Image, ActionSheetIOS, Alert, Platform } from 'react-native';
import { COLORS } from '@/constants/theme';
import useContextStore from '@/lib/state/contextStore';

export default function StorefrontSwitcher() {
  const memberships = useContextStore((s) => s.memberships);
  const mode = useContextStore((s) => s.mode);
  const activeBrandId = useContextStore((s) => s.activeBrandId);
  const switchToBrand = useContextStore((s) => s.switchToBrand);
  const switchToPersonal = useContextStore((s) => s.switchToPersonal);

  const handlePress = useCallback(() => {
    // Build options list: Personal first (default), then brands sorted by name
    // with the test brand visually flagged but not hidden — stylists need to
    // be able to test the QA storefront from the same affordance.
    const brandOptions = [...memberships].sort((a, b) => a.brandName.localeCompare(b.brandName));
    const labels = [
      'Posting as you',
      ...brandOptions.map((m) => (m.isTest ? `${m.brandName} (test)` : m.brandName)),
      'Cancel',
    ];
    const cancelIndex = labels.length - 1;

    const choose = (idx: number) => {
      if (idx === 0) {
        switchToPersonal();
      } else if (idx > 0 && idx < cancelIndex) {
        const picked = brandOptions[idx - 1];
        if (picked) switchToBrand(picked.brandId);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Posting as',
          message:
            'Choose whose closet new looks + items save to. Switch back to "you" anytime.',
          options: labels,
          cancelButtonIndex: cancelIndex,
        },
        choose,
      );
    } else {
      // Android fallback — same options via Alert for now. The iOS-only
      // mobile build is the launch target, so this is just defense.
      Alert.alert('Posting as', undefined, [
        { text: 'Posting as you', onPress: () => choose(0) },
        ...brandOptions.map((m, i) => ({
          text: m.isTest ? `${m.brandName} (test)` : m.brandName,
          onPress: () => choose(i + 1),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [memberships, switchToBrand, switchToPersonal]);

  // Zero-impact for normal creators.
  if (memberships.length === 0) return null;

  const active = mode === 'storefront'
    ? memberships.find((m) => m.brandId === activeBrandId) ?? null
    : null;

  const label = active ? active.brandName : 'Posting as you';
  const logoUrl = active?.brandLogoUrl ?? null;

  return (
    <Pressable
      onPress={handlePress}
      className="mx-4 mb-3 flex-row items-center bg-white border border-border rounded-2xl px-3 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`Posting as ${label}. Tap to switch.`}
      testID="storefront-switcher"
    >
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          className="w-8 h-8 rounded-full mr-2.5"
          style={{ backgroundColor: COLORS.bgAlt }}
        />
      ) : (
        <View
          className="w-8 h-8 rounded-full mr-2.5 items-center justify-center"
          style={{ backgroundColor: COLORS.bgAlt }}
        >
          <Text style={{ color: COLORS.inkMid, fontSize: 14, fontWeight: '600' }}>
            {active ? active.brandName.slice(0, 1).toUpperCase() : '·'}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text style={{ color: COLORS.inkMuted, fontSize: 11 }}>Posting as</Text>
        <Text
          style={{ color: COLORS.ink, fontSize: 15, fontWeight: '600' }}
          numberOfLines={1}
        >
          {label}
          {active?.isTest ? '  ·  test' : ''}
        </Text>
      </View>
      <Text style={{ color: COLORS.inkMid, fontSize: 18, marginLeft: 8 }}>▾</Text>
    </Pressable>
  );
}
