import React from 'react';
import { StyleSheet } from 'react-native';
import HeaderBarButton from './HeaderBarButton';
import EyeIcon from './icons/EyeIcon';
import EyeOffIcon from './icons/EyeOffIcon';
import { useTheme } from './themes';
import { useSettings } from '../hooks/context/useSettings';
import loc from '../loc';

/**
 * The home screen's eye: hides or shows the balance and transaction amounts until the app goes to
 * the background, leaving the "Hide balance on home" setting as it is. The glyph shows the current
 * state, struck through while hidden.
 */
const BalanceVisibilityButton: React.FC = () => {
  const { colors } = useTheme();
  const { isBalanceHidden, toggleBalanceHidden } = useSettings();

  return (
    <HeaderBarButton
      accessibilityLabel={isBalanceHidden ? loc.wallets.show_balance : loc.wallets.hide_balance}
      testID="BalanceVisibilityButton"
      onPress={toggleBalanceHidden}
      backgroundStyle={[styles.circle, { backgroundColor: colors.fieldBackground }]}
    >
      {isBalanceHidden ? <EyeOffIcon size={24} color={colors.iconPrimary} /> : <EyeIcon size={24} color={colors.iconPrimary} />}
    </HeaderBarButton>
  );
};

export default BalanceVisibilityButton;

const styles = StyleSheet.create({
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: 8,
  },
});
