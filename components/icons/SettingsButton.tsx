import React from 'react';
import { StyleSheet } from 'react-native';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useTheme } from '../themes';
import loc from '../../loc';
import HeaderBarButton from '../HeaderBarButton';
import VerticalDotsIcon from './VerticalDotsIcon';

const SettingsButton: React.FC = () => {
  const { navigate } = useExtendedNavigation();
  const { colors } = useTheme();

  return (
    <HeaderBarButton
      accessibilityLabel={loc.settings.default_title}
      testID="SettingsButton"
      onPress={() => navigate('Settings')}
      backgroundStyle={[styles.circle, { backgroundColor: colors.fieldBackground }]}
    >
      <VerticalDotsIcon color={colors.iconPrimary} />
    </HeaderBarButton>
  );
};

export default SettingsButton;

const styles = StyleSheet.create({
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: 8,
  },
});
