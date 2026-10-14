import React from 'react';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useTheme } from '../themes';
import loc from '../../loc';
import HeaderBarButton from '../HeaderBarButton';
import VerticalDotsIcon from './VerticalDotsIcon';

const SettingsButton: React.FC = () => {
  const { navigate } = useExtendedNavigation();
  const { colors } = useTheme();

  return (
    <HeaderBarButton accessibilityLabel={loc.settings.default_title} testID="SettingsButton" onPress={() => navigate('Settings')}>
      <VerticalDotsIcon color={colors.iconPrimary} />
    </HeaderBarButton>
  );
};

export default SettingsButton;
