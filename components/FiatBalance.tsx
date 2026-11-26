import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';

import { useExchangeRate } from '../hooks/useExchangeRate';
import { HIDDEN_AMOUNT } from '../loc';
import { satoshiToLocalCurrency } from '../modules/currency';

/**
 * A balance in the preferred currency, as "≈ $12.34". It follows the exchange rate itself, so a rate that
 * arrives after the screen has rendered, or a change of currency, shows without the screen re-rendering.
 */
const FiatBalance: React.FC<{ sats: number; hidden?: boolean; style?: StyleProp<TextStyle> }> = ({ sats, hidden = false, style }) => {
  useExchangeRate(); // for its re-render: satoshiToLocalCurrency reads the rate itself
  // No ≈ while hidden: it has nothing to qualify, and the dots alone center under the ones above.
  return <Text style={style}>{hidden ? HIDDEN_AMOUNT : `≈ ${satoshiToLocalCurrency(sats)}`}</Text>;
};

export default FiatBalance;
