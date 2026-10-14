import React from 'react';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon } from 'react-native-svg';
import { IconProps } from './types';

/** EyeIcon struck through. The eye is clipped away along the stroke, leaving a gap on either side of it. */
const EyeOffIcon: React.FC<IconProps> = ({ size = 20, color = 'white' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Defs>
      <ClipPath id="eye_off_gap">
        <Polygon points="0,2.6 0,20 17.4,20" />
        <Polygon points="2.6,0 20,0 20,17.4" />
      </ClipPath>
    </Defs>
    <G clipPath="url(#eye_off_gap)">
      <Path
        d="M10 5.83496C12.0776 5.83496 13.9186 6.36337 15.2139 7.17285C16.5209 7.98975 17.165 9.01107 17.165 10C17.165 10.9889 16.5209 12.0103 15.2139 12.8271C13.9186 13.6366 12.0776 14.165 10 14.165C7.92242 14.165 6.08139 13.6366 4.78613 12.8271C3.4791 12.0103 2.83496 10.9889 2.83496 10C2.83496 9.01107 3.4791 7.98975 4.78613 7.17285C6.08139 6.36337 7.92242 5.83496 10 5.83496Z"
        stroke={color}
        strokeWidth={1.67}
      />
      <Circle cx={10} cy={10} r={2.165} stroke={color} strokeWidth={1.67} />
    </G>
    <Line x1={3.5} y1={3.5} x2={16.5} y2={16.5} stroke={color} strokeWidth={1.67} strokeLinecap="round" />
  </Svg>
);

export default EyeOffIcon;
