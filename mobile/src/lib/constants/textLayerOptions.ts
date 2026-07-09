// Shared text-styling presets for movable text blocks (TextLayerItem.fontFamily).
// Tokens are written to TextLayerItem.fontFamily; canvasShared.tsx maps each token
// to a real font family at render time. Mirrors the collage builder's presets so
// Style-a-Look text looks identical to collage text.

export interface TextFontOption {
  token: string;
  family: string;
  label: string;
}

export const TEXT_FONT_OPTIONS: TextFontOption[] = [
  { token: 'serif', family: 'CormorantGaramond_600SemiBold', label: 'Editorial' },
  { token: 'serif-italic', family: 'CormorantGaramond_400Regular_Italic', label: 'Italic' },
  { token: 'sans', family: 'DMSans_400Regular', label: 'Clean' },
  { token: 'sans-bold', family: 'DMSans_700Bold', label: 'Bold' },
];

// Six colors: editorial black, off-white, brand rose, ink navy, gold, pure white.
export const TEXT_COLOR_OPTIONS: string[] = [
  '#1A1210', // black
  '#F1E9DB', // off-white
  '#B87063', // rose
  '#1F2A44', // navy
  '#B89968', // gold
  '#FFFFFF', // white
];

// Default for a freshly-added Style-a-Look text block. White reads well over most
// hero photos; 96 is the collage default in 1080-wide canvas space.
export const DEFAULT_TEXT_LAYER = {
  text: 'Tap to edit',
  fontSize: 96,
  color: '#FFFFFF',
  fontFamily: 'serif',
  scale: 1,
  rotation: 0,
};
