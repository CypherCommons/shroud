import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';

const ChatIcon: React.FC<IconProps> = ({ size = 24, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M21 11.5C21 16.1944 16.9706 20 12 20C10.8 20 9.65 19.78 8.6 19.38L3.5 21L4.9 16.9C3.7 15.5 3 13.57 3 11.5C3 6.80558 7.02944 3 12 3C16.9706 3 21 6.80558 21 11.5Z"
      stroke={color}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default ChatIcon;
