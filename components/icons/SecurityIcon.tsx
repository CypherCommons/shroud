import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';

const SecurityIcon: React.FC<IconProps> = ({ size = 24, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 20.962C9.99067 20.3654 8.32167 19.1484 6.993 17.311C5.66433 15.4737 5 13.4034 5 11.1V5.69203L12 3.07703L19 5.69203V11.1C19 13.4027 18.3357 15.4727 17.007 17.31C15.6783 19.1474 14.0093 20.364 12 20.962ZM12 19.901C13.6167 19.401 14.9667 18.4137 16.05 16.939C17.1333 15.4644 17.7667 13.818 17.95 12H12V4.14403L6 6.37503V11.531C6 11.6604 6.01667 11.8167 6.05 12H12V19.901Z"
      fill={color}
    />
  </Svg>
);

export default SecurityIcon;
