import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';
import { useTheme } from '../themes';

const ChevronDownIcon: React.FC<IconProps> = ({ size = 20, color }) => {
  const { colors } = useTheme();
  const stroke = color ?? colors.iconSecondary;
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M4.99805 7.50438L9.99627 12.5026L14.9945 7.50438"
        stroke={stroke}
        strokeWidth={1.66607}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

export default ChevronDownIcon;
