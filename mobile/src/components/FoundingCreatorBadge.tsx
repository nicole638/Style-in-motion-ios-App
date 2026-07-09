import React from 'react';
import { Pressable } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Path,
  Text as SvgText,
  TextPath,
} from 'react-native-svg';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  size?: Size;
  photoUri?: string | null;
  firstInitial?: string;
  testID?: string;
  onPress?: () => void;
};

const CREAM = '#F5EFE3';
const GOLD = '#B89968';
const INK = '#1A1210';
const FALLBACK_INITIAL_INK = '#8B7355';

const SIZE_PX: Record<Size, number> = { sm: 80, md: 200, lg: 400 };

// Star path centered at (0, 0); 18 viewBox px tip-to-tip.
const STAR_PATH = 'M 0,-9 L 2,-2 L 9,0 L 2,2 L 0,9 L -2,2 L -9,0 L -2,-2 Z';

// Per-size config. ViewBox stays 0 0 400 400 at every size; the SVG scales
// to render at SIZE_PX[size] (or 100% for lg). Smaller render sizes get
// LARGER viewBox-space fontSize so the on-screen letters stay legible.
//
// Effective on-screen size = viewBox_fontSize × (render_px / 400).
//   sm 80px:  fontSize 30 → ~6px  (small but visible brand mark)
//   md 200px: fontSize 26 → 13px  (clear)
//   lg 400px: fontSize 22 → 22px  (display sized)
//
// Both top and bottom text use the SAME fontSize within a size variant —
// per Nicole's request that "FOUNDING" and "CREATOR'S BADGE" feel like
// equal-weight brand lockup, not display-and-tagline.
//
// At sm only, the top FOUNDING arc sweeps counter-clockwise (right-to-left
// over the top) so the small-badge lockup reads in the rotation Nicole
// asked for. md and lg keep the standard clockwise top arc.
const CONFIG: Record<
  Size,
  {
    fontSize: number;
    letterSpacing: number;
    arcRadius: number;
    topArcCounterClockwise: boolean;
  }
> = {
  sm: { fontSize: 30, letterSpacing: 1, arcRadius: 140, topArcCounterClockwise: true },
  md: { fontSize: 26, letterSpacing: 2, arcRadius: 140, topArcCounterClockwise: false },
  lg: { fontSize: 22, letterSpacing: 2.5, arcRadius: 140, topArcCounterClockwise: false },
};

function Star({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <G transform={`translate(${x}, ${y}) scale(${scale})`} fill={GOLD}>
      <Path d={STAR_PATH} />
    </G>
  );
}

export default function FoundingCreatorBadge({
  size = 'md',
  photoUri,
  firstInitial,
  testID,
  onPress,
}: Props) {
  const px = SIZE_PX[size];
  const initial = (firstInitial ?? '').trim().charAt(0).toUpperCase();
  const cfg = CONFIG[size];
  const showDecorativeArcs = size === 'lg';

  const sideStarScale = size === 'lg' ? 1 : size === 'md' ? 24 / 18 : 0;
  const topStarScale = size === 'sm' ? 28 / 18 : 0;

  const svgWidth: number | string = size === 'lg' ? '100%' : px;
  const svgHeight: number | string = size === 'lg' ? '100%' : px;

  const r = cfg.arcRadius;
  // Top arc — clockwise (left→right over top) by default; counter-clockwise
  // (right→left over top) at sm per spec.
  const topArcD = cfg.topArcCounterClockwise
    ? `M ${200 + r},200 A ${r},${r} 0 0,0 ${200 - r},200`
    : `M ${200 - r},200 A ${r},${r} 0 0,1 ${200 + r},200`;
  // Bottom arc — counter-clockwise (left→right under bottom) so text reads
  // upright when viewed.
  const bottomArcD = `M ${200 - r},200 A ${r},${r} 0 0,0 ${200 + r},200`;

  const Body = (
    <Svg
      width={svgWidth as number}
      height={svgHeight as number}
      viewBox="0 0 400 400"
      testID={testID}
    >
      <Defs>
        <Path id="fcb-top-arc" d={topArcD} fill="none" />
        <Path id="fcb-bottom-arc" d={bottomArcD} fill="none" />
        <ClipPath id="fcb-photo-clip">
          <Circle cx="200" cy="200" r="112" />
        </ClipPath>
      </Defs>

      {/* Cream parchment field */}
      <Circle cx="200" cy="200" r="196" fill={CREAM} />

      {/* Double gold border (outer + inner edge) */}
      <Circle cx="200" cy="200" r="194" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <Circle cx="200" cy="200" r="180" fill="none" stroke={GOLD} strokeWidth="1" />

      {/* Curved brand text — same font size top + bottom for equal weight */}
      <SvgText
        fontFamily="Georgia"
        fontSize={cfg.fontSize}
        fontWeight="700"
        fill={INK}
        letterSpacing={cfg.letterSpacing}
      >
        <TextPath href="#fcb-top-arc" startOffset="50%" textAnchor="middle">
          FOUNDING
        </TextPath>
      </SvgText>
      <SvgText
        fontFamily="Georgia"
        fontSize={cfg.fontSize}
        fontWeight="700"
        fill={INK}
        letterSpacing={cfg.letterSpacing}
      >
        <TextPath href="#fcb-bottom-arc" startOffset="50%" textAnchor="middle">
          {"CREATOR’S BADGE"}
        </TextPath>
      </SvgText>

      {/* Side star ornaments at 9 / 3 o'clock — md/lg only */}
      {sideStarScale > 0 ? (
        <>
          <Star x={50} y={200} scale={sideStarScale} />
          <Star x={350} y={200} scale={sideStarScale} />
        </>
      ) : null}

      {/* Single top-center star — sm-only "list item" treatment */}
      {topStarScale > 0 ? <Star x={200} y={26} scale={topStarScale} /> : null}

      {/* Decorative thin gold arcs framing the inner well — lg only */}
      {showDecorativeArcs ? (
        <>
          <Path
            d="M 105,180 A 130,130 0 0,1 295,180"
            fill="none"
            stroke={GOLD}
            strokeWidth="0.75"
          />
          <Path
            d="M 105,220 A 130,130 0 0,0 295,220"
            fill="none"
            stroke={GOLD}
            strokeWidth="0.75"
          />
        </>
      ) : null}

      {/* Inner well: profile photo if provided, otherwise serif initial. */}
      {photoUri ? (
        <SvgImage
          href={photoUri}
          x="88"
          y="88"
          width="224"
          height="224"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#fcb-photo-clip)"
        />
      ) : (
        <>
          <Circle cx="200" cy="200" r="112" fill={CREAM} />
          {initial ? (
            // y=239 puts the visual center of the cap-height letter at y=200
            // (geometric center of the photo well).
            <SvgText
              x="200"
              y="239"
              textAnchor="middle"
              fontFamily="Georgia"
              fontSize="110"
              fontWeight="600"
              fill={FALLBACK_INITIAL_INK}
            >
              {initial}
            </SvgText>
          ) : null}
        </>
      )}

      {/* Gold ring around the photo well */}
      <Circle cx="200" cy="200" r="112" fill="none" stroke={GOLD} strokeWidth="1.5" />
    </Svg>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID ? `${testID}-press` : undefined}
        hitSlop={8}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
      >
        {Body}
      </Pressable>
    );
  }
  return Body;
}
