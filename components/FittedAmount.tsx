import React from 'react';
import { Platform, StyleSheet, Text, TextProps } from 'react-native';

import { ClashFont } from '../constants/fonts';

/** A large amount on one line, shrunk to fit its row rather than wrapped or cut off. */
const FittedAmount: React.FC<TextProps> = ({ style, ...props }) => (
  <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.amount, style]} {...props} />
);

const styles = StyleSheet.create({
  amount: {
    fontFamily: ClashFont.medium,
    fontSize: 48,
    // Android only. On iOS, adjustsFontSizeToFit must also fit the frame's height, and a pinned line
    // height never shrinks with the font: when the frame comes out a hair short of it (as it does
    // under the network badge), nothing fits and the amount drops to the 4pt floor.
    lineHeight: Platform.select({ android: 48 }),
    letterSpacing: -1.2,
    textAlign: 'center',
    flexShrink: 1,
  },
});

export default FittedAmount;
