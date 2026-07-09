/** @type {import('tailwindcss').Config} */
const plugin = require("tailwindcss/plugin");

module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./App.tsx", "./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  corePlugins: {
    space: false,
  },
  theme: {
    // NOTE to AI: You can extend the theme with custom colors or styles here.
    // Keep these in sync with src/constants/theme.ts (single source of truth).
    extend: {
      colors: {
        // Surfaces / backgrounds
        bg: "#F7F4F0",
        "bg-alt": "#F0EBE5",
        card: "#FFFFFF",
        "rose-soft": "#FBF4EE",
        // Ink / text
        ink: "#1A1210",
        "ink-soft": "#3D3330",
        "ink-mid": "#6B5E58",
        "ink-muted": "#8C8580",
        "ink-light": "#A0938D",
        // Borders / dividers
        border: "#E8E0D8",
        "border-soft": "#EDE6DF",
        "border-light": "#E0D8D0",
        // Accents
        rose: "#B87063",
        tan: "#C4A882",
        // Status
        success: "#2E7D52",
        warning: "#A67C30",
        danger: "#C0392B",
      },
      // Only `serif`/`sans` families are defined here; the font-weight
      // utilities (font-medium/semibold/bold) are intentionally left to
      // Tailwind so existing usages keep working.
      fontFamily: {
        serif: ["CormorantGaramond_600SemiBold"],
        sans: ["DMSans_400Regular"],
      },
      fontSize: {
        xs: "10px",
        sm: "12px",
        base: "14px",
        lg: "18px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "32px",
        "4xl": "40px",
        "5xl": "48px",
        "6xl": "56px",
        "7xl": "64px",
        "8xl": "72px",
        "9xl": "80px",
      },
    },
  },
  darkMode: "class",
  plugins: [
    plugin(({ matchUtilities, theme }) => {
      const spacing = theme("spacing");

      // space-{n}  ->  gap: {n}
      matchUtilities(
        { space: (value) => ({ gap: value }) },
        { values: spacing, type: ["length", "number", "percentage"] }
      );

      // space-x-{n}  ->  column-gap: {n}
      matchUtilities(
        { "space-x": (value) => ({ columnGap: value }) },
        { values: spacing, type: ["length", "number", "percentage"] }
      );

      // space-y-{n}  ->  row-gap: {n}
      matchUtilities(
        { "space-y": (value) => ({ rowGap: value }) },
        { values: spacing, type: ["length", "number", "percentage"] }
      );
    }),
  ],
};

