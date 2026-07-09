import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

type ActionRowVariant = 'default' | 'accent' | 'destructive';

interface ActionRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  variant?: ActionRowVariant;
  testID?: string;
  isLast?: boolean;
}

const ICON_COLOR: Record<ActionRowVariant, string> = {
  default: '#6B5E58',
  accent: '#B87063',
  destructive: '#C0392B',
};

const LABEL_COLOR: Record<ActionRowVariant, string> = {
  default: '#1A1210',
  accent: '#B87063',
  destructive: '#C0392B',
};

export function ActionRow({
  icon: Icon,
  label,
  onPress,
  variant = 'default',
  testID,
  isLast = false,
}: ActionRowProps) {
  const iconColor = ICON_COLOR[variant];
  const labelColor = LABEL_COLOR[variant];
  return (
    <>
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        hitSlop={4}
      >
        <View style={styles.rowInner} pointerEvents="none">
          <View style={styles.rowLeft}>
            <Icon size={18} color={iconColor} strokeWidth={1.75} />
            <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
          </View>
        </View>
      </Pressable>
      {isLast ? null : <View style={styles.divider} />}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 56,
    backgroundColor: '#FFFFFF',
  },
  rowPressed: {
    backgroundColor: '#F7F4F0',
  },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    marginLeft: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D8',
    marginLeft: 16 + 18 + 12,
  },
});
