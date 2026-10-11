import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import SettingsNavRow from '../../components/SettingsNavRow';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';

const GeneralSettings: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { wallets } = useStorage();
  const {
    isClipboardGetContentEnabled,
    setIsClipboardGetContentEnabledStorage,
    isScreenCaptureAllowed,
    setIsScreenCaptureAllowed,
    isDoNotTrackEnabled,
    setIsDoNotTrackEnabledStorage,
    themePreference,
  } = useSettings();

  const cardStyle = [styles.card, { borderColor: colors.borderDefault, backgroundColor: colors.fieldBackground }];

  const themeValueText = useMemo(() => {
    switch (themePreference) {
      case 'light':
        return loc.settings.theme_light;
      case 'dark':
        return loc.settings.theme_dark;
      default:
        return loc.settings.theme_system;
    }
  }, [themePreference]);

  const denominationValueText = useMemo(() => {
    const preferredUnit = wallets[0]?.getPreferredBalanceUnit() ?? BitcoinUnit.BTC;
    return preferredUnit === BitcoinUnit.SATS ? loc.units[BitcoinUnit.SATS] : loc.units[BitcoinUnit.BTC];
  }, [wallets]);

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="GeneralSettingsScrollView">
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{loc.settings.general_privacy_header}</Text>
      <View style={cardStyle}>
        <SettingsToggleRow
          title={loc.settings.general_read_clipboard_title}
          subtitle={loc.settings.general_read_clipboard_subtitle}
          value={isClipboardGetContentEnabled}
          onValueChange={setIsClipboardGetContentEnabledStorage}
          testID="ReadClipboardSwitch"
        />
        <SettingsToggleRow
          title={loc.settings.general_screen_capture_title}
          subtitle={loc.settings.general_screen_capture_subtitle}
          value={isScreenCaptureAllowed}
          onValueChange={setIsScreenCaptureAllowed}
          testID="AllowScreenCaptureSwitch"
        />
        <SettingsToggleRow
          title={loc.settings.general_crash_reports_title}
          subtitle={loc.settings.general_crash_reports_subtitle}
          value={!isDoNotTrackEnabled}
          onValueChange={value => setIsDoNotTrackEnabledStorage(!value)}
          showSeparator={false}
          testID="CrashReportsSwitch"
        />
      </View>

      <Text style={[styles.sectionHeader, styles.sectionHeaderGap, { color: colors.textMuted }]}>
        {loc.settings.general_display_header}
      </Text>
      <View style={cardStyle}>
        <SettingsNavRow
          title={loc.settings.theme}
          value={themeValueText}
          onPress={() => navigation.navigate('ThemeSettings')}
          testID="ThemeRow"
        />
        <SettingsNavRow
          title={loc.settings.denomination}
          value={denominationValueText}
          onPress={() => navigation.navigate('DenominationSettings')}
          showSeparator={false}
          testID="DenominationRow"
        />
      </View>
    </SafeAreaScrollView>
  );
};

export default GeneralSettings;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
});
