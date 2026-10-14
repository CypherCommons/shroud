import React, { useState } from 'react';
import { ImageSourcePropType, LayoutChangeEvent, StyleSheet, View } from 'react-native';

import QRCodeComponent from './QRCodeComponent';
import { useTheme } from './themes';

interface QRCardProps {
  value: string;
  /** Fixed code size. Omit it to have the card fill the space its parent gives it and fit the code to that. */
  size?: number;
  logo?: ImageSourcePropType;
  isMenuAvailable?: boolean;
  ecl?: 'H' | 'Q' | 'M' | 'L';
  onError?: () => void;
}

// Card kept clear around the code on every side.
const PADDING = 22;
// Smaller than this the code gets hard to scan, so a filling card stops shrinking and leaves its
// screen to scroll instead.
const MIN_FILL_SIZE = 150;
const MAX_FILL_SIZE = 500;

const QRCard: React.FC<QRCardProps> = ({ value, size, logo, isMenuAvailable, ecl, onError }) => {
  const { colors } = useTheme();
  const fills = size === undefined;
  // A filling card draws nothing until its first layout says how much room there is.
  const [fitSize, setFitSize] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const room = Math.min(width, height) - 2 * PADDING;
    setFitSize(Math.floor(Math.min(Math.max(room, 0), MAX_FILL_SIZE)));
  };

  const codeSize = size ?? fitSize;
  const code = codeSize > 0 && (
    <QRCodeComponent
      value={value}
      size={codeSize}
      isMenuAvailable={isMenuAvailable}
      ecl={ecl}
      onError={onError}
      {...(logo ? { logo, logoSize: codeSize * 0.19, logoBackgroundColor: colors.white, logoBorderRadius: 12 } : {})}
    />
  );

  return (
    <View
      style={[styles.card, fills ? styles.fill : styles.hug, { backgroundColor: colors.surfaceSubtle }]}
      onLayout={fills ? onLayout : undefined}
    >
      {fills ? <View style={styles.fillCode}>{code}</View> : code}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  hug: {
    paddingVertical: PADDING,
  },
  fill: {
    flex: 1,
    minHeight: MIN_FILL_SIZE + 2 * PADDING,
  },
  // Absolute, so the code never props the card open: the card's height comes only from the space
  // it is given, which lets it shrink again when that space does.
  fillCode: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default QRCard;
