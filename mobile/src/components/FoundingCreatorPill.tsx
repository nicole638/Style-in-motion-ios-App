// Small inline pill that labels a creator as a Founding Creator. Designed to
// sit next to a display name (with a ~6pt left spacer in the caller). The
// existing `FoundingCreatorBadge` in this folder is the large circular
// medallion used on the profile hero — this pill is the lightweight inline
// label requested for headers/rows where the medallion is too heavy.
//
// Render rule (caller controls — keep it dumb here):
//   - If `is_founding_creator = true` → render this pill.
//   - If only `is_beta_creator` → caller renders the beta badge instead, not this.
//   - If both → caller still renders only this (Founding wins).
import React from 'react';
import { View, Text } from 'react-native';

export type FoundingCreatorPillProps = {
  testID?: string;
};

export function FoundingCreatorPill({ testID }: FoundingCreatorPillProps) {
  return (
    <View
      testID={testID ?? 'founding-creator-pill'}
      style={{
        backgroundColor: '#FBF6EF',
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontFamily: 'DMSans_500Medium',
          fontSize: 11,
          color: '#B87063',
          letterSpacing: 0.2,
        }}
      >
        Founding Creator
      </Text>
    </View>
  );
}

export default FoundingCreatorPill;
