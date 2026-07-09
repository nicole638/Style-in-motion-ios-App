import React from 'react';
import { View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Path,
  Text as SvgText,
  TextPath,
} from 'react-native-svg';

type Props = {
  size: number;
  children?: React.ReactNode;
  testID?: string;
};

// Brand palette — must stay in sync with FoundingCreatorBadge.tsx.
const CREAM = '#F5EFE3';
const GOLD = '#B89968';
const INK = '#1A1210';

// Four-point star centered at (0,0); 18 units tip-to-tip in viewBox space.
const STAR_PATH = 'M 0,-9 L 2,-2 L 9,0 L 2,2 L 0,9 L -2,2 L -9,0 L -2,-2 Z';

/**
 * Decorative ring around an existing avatar — used in feed cards (52px) where
 * the avatar Image is already rendered. Visual treatment matches
 * FoundingCreatorBadge size="sm": cream parchment field, double gold borders,
 * a small gold star at top center, "FOUNDING" reading counter-clockwise on
 * the top arc, "CREATOR'S BADGE" reading along the bottom arc, and equal
 * font size for both texts.
 *
 * ViewBox is fixed at 0 0 400 400 (matching FoundingCreatorBadge) so all the
 * geometric coordinates are 1:1 with the badge spec.
 */
export default function FoundingCreatorRing({ size, children, testID }: Props) {
  const r = 140;
  // FOUNDING goes counter-clockwise (right→left over top) per spec.
  const topArcD = `M ${200 + r},200 A ${r},${r} 0 0,0 ${200 - r},200`;
  // CREATOR'S BADGE goes counter-clockwise under the bottom (left→right
  // under bottom = upright reading direction).
  const bottomArcD = `M ${200 - r},200 A ${r},${r} 0 0,0 ${200 + r},200`;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      testID={testID}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 400 400"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Defs>
          <Path id="fcr-top-arc" d={topArcD} fill="none" />
          <Path id="fcr-bottom-arc" d={bottomArcD} fill="none" />
        </Defs>

        {/* Cream parchment field */}
        <Circle cx="200" cy="200" r="196" fill={CREAM} />

        {/* Double gold border — strokes scaled up so they're present at 52px */}
        <Circle cx="200" cy="200" r="194" fill="none" stroke={GOLD} strokeWidth="6" />
        <Circle cx="200" cy="200" r="180" fill="none" stroke={GOLD} strokeWidth="3" />

        {/* Curved brand text — same fontSize top + bottom; bigger viewBox
            value than the badge sm because feed cards render at ~52px so
            text needs a bigger viewBox font to remain visible. */}
        <SvgText
          fontFamily="Georgia"
          fontSize="32"
          fontWeight="700"
          fill={INK}
          letterSpacing="0.5"
        >
          <TextPath href="#fcr-top-arc" startOffset="50%" textAnchor="middle">
            FOUNDING
          </TextPath>
        </SvgText>
        <SvgText
          fontFamily="Georgia"
          fontSize="32"
          fontWeight="700"
          fill={INK}
          letterSpacing="0.5"
        >
          <TextPath href="#fcr-bottom-arc" startOffset="50%" textAnchor="middle">
            {"CREATOR’S BADGE"}
          </TextPath>
        </SvgText>

        {/* Single small gold star at top-center marking founding status */}
        <G transform="translate(200, 26) scale(2.2)" fill={GOLD}>
          <Path d={STAR_PATH} />
        </G>
      </Svg>

      {/* Avatar/Image children render in the inner well. */}
      {children}
    </View>
  );
}
