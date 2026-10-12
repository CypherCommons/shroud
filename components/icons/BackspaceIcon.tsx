import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';

const BackspaceIcon: React.FC<IconProps> = ({ size = 22, color = '#1A1A1A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M9 4H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-7-8 7-8z" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    <Path d="M12.5 9.5l5 5M17.5 9.5l-5 5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
);

export default BackspaceIcon;
