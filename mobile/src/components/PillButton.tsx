import React from 'react';
import { Pressable, Text, ActivityIndicator, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Shared pill button for Styled in Motion.
 *
 * IMPORTANT: interactive elements are styled with NativeWind `className` (string
 * literals), NOT StyleSheet. StyleSheet / function-form `style={({pressed}) => ...}`
 * on <Pressable> does not render reliably in this build and produces invisible
 * buttons (see mobile/CLAUDE.md). Inline `style` is used only for shadow / opacity.
 *
 * variant: 'primary' (coral fill) | 'dark' (ink fill) | 'outline' (white w/ coral border,
 *          coral text — the "add" pill) | 'secondary' (white w/ ink border) | 'tertiary' (text-only)
 * size:    'md' (default) | 'sm' (compact, for inline rows)
 */
export type PillVariant = 'primary' | 'dark' | 'outline' | 'secondary' | 'tertiary';
export type PillSize = 'md' | 'sm';

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: PillVariant;
  size?: PillSize;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  haptic?: boolean;
  testID?: string;
}

const SHADOW: ViewStyle = {
  shadowColor: '#1A1210',
  shadowOpacity: 0.1,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

export default function PillButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  haptic = true,
  testID,
}: PillButtonProps) {
  const handlePress = () => {
    if (disabled || loading) return;
    if (haptic) Haptics.selectionAsync();
    onPress();
  };

  const stateStyle: ViewStyle[] = [];
  if (fullWidth) stateStyle.push({ alignSelf: 'stretch' });
  if (disabled) stateStyle.push({ opacity: 0.5 });

  const gap = icon || loading ? (size === 'sm' ? 6 : 8) : 0;
  const textSize = size === 'sm' ? 'text-sm' : 'text-[15px]';

  if (variant === 'tertiary') {
    return (
      <Pressable
        onPress={handlePress}
        disabled={disabled || loading}
        testID={testID}
        style={stateStyle}
        className="flex-row items-center justify-center py-2.5 px-3 active:opacity-70"
      >
        {loading ? <ActivityIndicator size="small" color="#6B5E58" /> : icon}
        <Text className={`text-[#6B5E58] ${textSize}`} style={{ fontFamily: 'DMSans_500Medium', marginLeft: gap }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  // NativeWind needs the class strings present as literals — keep every branch literal.
  let pillClass: string;
  if (variant === 'primary') {
    pillClass =
      size === 'sm'
        ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
        : 'bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85';
  } else if (variant === 'dark') {
    pillClass =
      size === 'sm'
        ? 'bg-[#1A1210] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
        : 'bg-[#1A1210] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85';
  } else if (variant === 'outline') {
    pillClass =
      size === 'sm'
        ? 'bg-white border-[1.5px] border-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
        : 'bg-white border-[1.5px] border-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85';
  } else {
    pillClass =
      size === 'sm'
        ? 'bg-white border-[1.5px] border-[#1A1210] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
        : 'bg-white border-[1.5px] border-[#1A1210] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85';
  }
  const onDark = variant === 'primary' || variant === 'dark';
  const textColor = onDark ? 'text-white' : variant === 'outline' ? 'text-[#B87063]' : 'text-[#1A1210]';
  const spinnerColor = onDark ? '#FFFFFF' : variant === 'outline' ? '#B87063' : '#1A1210';

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      testID={testID}
      style={[SHADOW, ...stateStyle]}
      className={pillClass}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : icon}
      <Text className={`${textColor} ${textSize}`} style={{ fontFamily: 'DMSans_500Medium', marginLeft: gap }}>
        {label}
      </Text>
    </Pressable>
  );
}
