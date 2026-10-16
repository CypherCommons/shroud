import React from 'react';
import Svg, { Path, Circle, ClipPath, Defs, G, Line, Polygon } from 'react-native-svg';
import { IconProps } from './types';

const BOX = 20;
const STROKE_WIDTH = 1.67;
// The slash runs along y = x. The eye is clipped away within this distance of it, measured along an
// axis: the slash's half width plus a 1-unit gap, times √2.
const SLASH_GAP = (STROKE_WIDTH / 2 + 1) * Math.SQRT2;

interface EyeIconProps extends IconProps {
  /** Struck through, for a hidden state, with the eye cut away either side of the stroke. */
  slashed?: boolean;
}

const EyeIcon: React.FC<EyeIconProps> = ({ size = 20, color = 'white', slashed = false }) => (
  // A 24-unit frame with the eye 20 units wide and centred; it is 12.5 tall, the shape isn't square.
  <Svg width={size} height={size} viewBox="0.4 0.4 19.2 19.2" fill="none">
    {slashed && (
      <Defs>
        <ClipPath id="eye_slash_gap">
          <Polygon points={`0,${SLASH_GAP} 0,${BOX} ${BOX - SLASH_GAP},${BOX}`} />
          <Polygon points={`${SLASH_GAP},0 ${BOX},0 ${BOX},${BOX - SLASH_GAP}`} />
        </ClipPath>
      </Defs>
    )}
    <G clipPath={slashed ? 'url(#eye_slash_gap)' : undefined}>
      <Path
        d="M10 5.83496C12.0776 5.83496 13.9186 6.36337 15.2139 7.17285C16.5209 7.98975 17.165 9.01107 17.165 10C17.165 10.9889 16.5209 12.0103 15.2139 12.8271C13.9186 13.6366 12.0776 14.165 10 14.165C7.92242 14.165 6.08139 13.6366 4.78613 12.8271C3.4791 12.0103 2.83496 10.9889 2.83496 10C2.83496 9.01107 3.4791 7.98975 4.78613 7.17285C6.08139 6.36337 7.92242 5.83496 10 5.83496Z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <Circle cx={10} cy={10} r={2.165} stroke={color} strokeWidth={STROKE_WIDTH} />
    </G>
    {slashed && <Line x1={3.5} y1={3.5} x2={16.5} y2={16.5} stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />}
  </Svg>
);

export default EyeIcon;
