import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

/**
 * Self-contained Amazon wordmark. We can't reach the Wikimedia CDN
 * reliably (HTTP 400 from Varnish) and bundled SVGs need extra setup,
 * so we draw a simplified mark inline: "amazon" wordmark + the orange
 * smile/arrow curving from the 'a' to the 'z'.
 *
 * Width/height are configurable; the viewBox keeps the proportions
 * roughly matching the real wordmark so it sits nicely in a square
 * logo slot.
 */
export function AmazonWordmark({
  width = 120,
  color = '#111111',
  smileColor = '#FF9900',
}: {
  width?: number;
  color?: string;
  smileColor?: string;
}) {
  // The real wordmark is roughly 600x180 (≈10:3). The smile sits below
  // the word and curves up at the right with an arrowhead.
  const height = width * 0.33;
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={width} height={height} viewBox="0 0 600 180" fill="none">
        <SvgText
          x="0"
          y="120"
          fontSize="150"
          fontWeight="700"
          fontFamily="System"
          fill={color}
          letterSpacing="-6"
        >
          amazon
        </SvgText>
        {/* Smile: a sweeping arc from under 'a' to past 'n' with an arrowhead */}
        <Path
          d="M40 150 Q 290 210 540 150"
          stroke={smileColor}
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrowhead at the right end of the smile */}
        <Path
          d="M540 150 L 520 138 M 540 150 L 530 168"
          stroke={smileColor}
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

export default AmazonWordmark;
