/**
 * Styled in Motion — design tokens (single source of truth).
 *
 * Values below are the canonical palette/typography already in use across the
 * app (derived from the most-frequent hex/font values in the codebase).
 * Prefer importing from here instead of hardcoding hex strings or font names.
 *
 * In StyleSheet:   color: COLORS.ink, fontFamily: FONTS.serif
 * In NativeWind:   className="bg-bg text-ink border-border font-serif"
 */

export const COLORS = {
  // Surfaces / backgrounds
  bg: '#F7F4F0', // app background (warm cream)
  bgAlt: '#F0EBE5', // alternate warm surface
  card: '#FFFFFF', // cards, sheets
  roseSoft: '#FBF4EE', // soft rose-tinted surface

  // Ink / text (darkest → lightest)
  ink: '#1A1210', // primary text
  inkSoft: '#3D3330', // strong secondary text
  inkMid: '#6B5E58', // secondary text
  inkMuted: '#8C8580', // muted text
  inkLight: '#A0938D', // tertiary text / placeholders

  // Borders / dividers
  border: '#E8E0D8', // default border (app-wide canonical)
  borderSoft: '#EDE6DF', // softer border
  borderLight: '#E0D8D0', // lightest divider

  // Accents
  rose: '#B87063', // primary accent (terracotta)
  tan: '#C4A882', // secondary accent (gold/tan)

  // Status / feedback
  success: '#2E7D52',
  warning: '#A67C30',
  danger: '#C0392B',
} as const;

export type ColorToken = keyof typeof COLORS;

/**
 * Font family names. These must match the keys registered with `useFonts`
 * (see @expo-google-fonts/cormorant-garamond and @expo-google-fonts/dm-sans).
 */
export const FONTS = {
  serif: 'CormorantGaramond_600SemiBold', // display / headings
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemiBold: 'DMSans_600SemiBold',
  bodyBold: 'DMSans_700Bold',
} as const;

export type FontToken = keyof typeof FONTS;

/** Corner radius scale (reflects the values most used across the app). */
export const RADIUS = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  '2xl': 16,
  '3xl': 20,
  full: 999,
} as const;

export type RadiusToken = keyof typeof RADIUS;
