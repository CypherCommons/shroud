import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';

const KeyIcon: React.FC<IconProps> = ({ size = 24, color = '#754CE8' }) => (
  // A 24-unit frame with the 20-unit key centred in it (the artwork spans 21..43 of the original 64 canvas).
  <Svg width={size} height={size} viewBox="18.8 18.8 26.4 26.4" fill="none">
    <Path
      d="M28 38L30 36H32L33.36 34.64C34.7502 35.1243 36.2636 35.1224 37.6525 34.6346C39.0414 34.1467 40.2236 33.2018 41.0056 31.9546C41.7876 30.7073 42.123 29.2316 41.957 27.7688C41.791 26.3061 41.1334 24.9431 40.0918 23.9028C39.0502 22.8625 37.6863 22.2066 36.2234 22.0424C34.7604 21.8782 33.2851 22.2155 32.0388 22.999C30.7926 23.7826 29.8492 24.9659 29.3631 26.3555C28.877 27.745 28.8769 29.2584 29.363 30.648L22 38V42H26L28 40V38Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M37 28C37.5523 28 38 27.5523 38 27C38 26.4477 37.5523 26 37 26C36.4477 26 36 26.4477 36 27C36 27.5523 36.4477 28 37 28Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default KeyIcon;
