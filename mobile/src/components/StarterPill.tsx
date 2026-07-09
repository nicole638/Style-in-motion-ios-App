import React from 'react';
import { View, Text } from 'react-native';

/**
 * Tiny pearl-grey "Starter" pill rendered on closet items that came from the
 * `seed_starter_pack` RPC (i.e. creator_items.from_starter_pack === true).
 *
 * Wired in `src/app/(tabs)/shop.tsx`'s `renderItemCard` (closet view only —
 * never in Items / Archives, and never on Discover/Feed which renders looks
 * instead of items). Also used by `/onboarding/pick-three` implicitly (every
 * tile there is starter-pack by definition).
 */
export default function StarterPill() {
  return (
    <View
      className="bg-[#E8E2DD] rounded-full px-2 py-0.5"
      testID="starter-pill"
    >
      <Text
        className="text-[#6B5E58] text-[10px]"
        style={{ fontFamily: 'DMSans_500Medium' }}
      >
        Starter
      </Text>
    </View>
  );
}
