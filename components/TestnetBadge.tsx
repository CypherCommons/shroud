import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import { getNetwork } from '../modules/network';
import { useStorage } from '../hooks/context/useStorage';

/**
 * Marks the UI when the wallet is not on mainnet.
 *
 * Test-chain coins have no value, and the app is otherwise pixel-identical across networks — so
 * anywhere a balance or an outgoing payment is shown, the chain has to be visible too. Renders
 * nothing on mainnet.
 *
 * Both the chain and the data come from the storage context's `activeNetworkId`, so a runtime
 * network switch re-renders it and it never depends on the module-level network having been
 * updated in step with the React state.
 */
const TestnetBadge: React.FC<{ style?: object }> = ({ style }) => {
  const { colors } = useTheme();
  const { activeNetworkId } = useStorage();
  const network = getNetwork(activeNetworkId);

  if (!network.isTestnet) return null;

  return (
    <View
      style={[styles.badge, { backgroundColor: colors.surfaceSubtle, borderColor: colors.brandPrimary }, style]}
      accessibilityRole="text"
      accessibilityLabel={`${network.displayName} — test coins with no value`}
      testID={`TestnetBadge-${activeNetworkId}`}
    >
      <Text style={[styles.badgeText, { color: colors.brandPrimary }]}>{network.displayName.toUpperCase()}</Text>
    </View>
  );
};

export default TestnetBadge;

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: ClashFont.regular,
    letterSpacing: 0.8,
  },
});
