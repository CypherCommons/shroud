import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsRow from '../../components/SettingsRow';
import PinPrompt from '../../components/PinPrompt';
import GeneralIcon from '../../components/icons/GeneralIcon';
import CurrencyIcon from '../../components/icons/CurrencyIcon';
import ContactIcon from '../../components/icons/ContactIcon';
import SecurityIcon from '../../components/icons/SecurityIcon';
import NetworkIcon from '../../components/icons/NetworkIcon';
import AboutIcon from '../../components/icons/AboutIcon';
import { Theme, useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useDeleteWallet } from '../../hooks/useDeleteWallet';
import { useStorage } from '../../hooks/context/useStorage';
import loc from '../../loc';
import { getAppVersionLabel } from '../../helpers/appVersion';
import { ClashFont } from '../../constants/fonts';
import { IconProps } from '../../components/icons/types';

type SettingsRoute = 'General' | 'Currency' | 'Contacts' | 'Security' | 'NetworkSettings' | 'About';

interface RowConfig {
  Icon: React.FC<IconProps>;
  colorToken: keyof Theme['colors'];
  title: string;
  subtitle: string;
  route: SettingsRoute;
  testID: string;
}

const MAIN_ROWS: RowConfig[] = [
  {
    Icon: GeneralIcon,
    colorToken: 'brandPrimary',
    title: loc.settings.general,
    subtitle: loc.settings.general_subtitle,
    route: 'General',
    testID: 'GeneralButton',
  },
  {
    Icon: CurrencyIcon,
    colorToken: 'textBitcoin',
    title: loc.settings.currency,
    subtitle: loc.settings.currency_subtitle,
    route: 'Currency',
    testID: 'CurrencyButton',
  },
  {
    Icon: ContactIcon,
    colorToken: 'brandPrimary',
    title: loc.contacts.header,
    subtitle: loc.contacts.settings_subtitle,
    route: 'Contacts',
    testID: 'ContactsButton',
  },
  {
    Icon: SecurityIcon,
    colorToken: 'statusError',
    title: loc.settings.security_title,
    subtitle: loc.settings.security_subtitle,
    route: 'Security',
    testID: 'SecurityButton',
  },
  {
    Icon: NetworkIcon,
    colorToken: 'statusSuccess',
    title: loc.settings.network,
    subtitle: loc.settings.network_subtitle,
    route: 'NetworkSettings',
    testID: 'NetworkButton',
  },
];

const SECONDARY_ROWS: RowConfig[] = [
  {
    Icon: AboutIcon,
    colorToken: 'statusError',
    title: loc.settings.about,
    subtitle: getAppVersionLabel(),
    route: 'About',
    testID: 'AboutButton',
  },
];

const Settings: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { wallets } = useStorage();
  const { deleteWallet, isPinPromptVisible, pinAttempt } = useDeleteWallet();

  const cardStyle = [styles.card, { borderColor: colors.borderDefault, backgroundColor: colors.fieldBackground }];

  if (isPinPromptVisible) return <PinPrompt subtitle={loc.wallets.details_delete_pin_subtitle} pinAttempt={pinAttempt} />;

  return (
    <SafeAreaScrollView
      contentContainerStyle={styles.content}
      floatingButtonHeight={24}
      showsVerticalScrollIndicator={false}
      testID="SettingsScrollView"
    >
      <View style={cardStyle}>
        {MAIN_ROWS.map((row, index) => (
          <SettingsRow
            key={row.route}
            icon={<row.Icon color={colors[row.colorToken]} />}
            title={row.title}
            subtitle={row.subtitle}
            onPress={() => navigation.navigate(row.route)}
            testID={row.testID}
            showSeparator={index < MAIN_ROWS.length - 1}
          />
        ))}
      </View>

      <View style={[cardStyle, styles.cardGap]}>
        {SECONDARY_ROWS.map((row, index) => (
          <SettingsRow
            key={row.route}
            icon={<row.Icon color={colors[row.colorToken]} />}
            title={row.title}
            subtitle={row.subtitle}
            onPress={() => navigation.navigate(row.route)}
            testID={row.testID}
            showSeparator={index < SECONDARY_ROWS.length - 1}
          />
        ))}
      </View>

      {wallets.length > 0 && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={loc.settings.delete_wallet}
          style={[styles.deleteWalletButton, styles.cardGap, { borderColor: colors.statusError, backgroundColor: colors.surfaceCaution }]}
          onPress={deleteWallet}
          testID="DeleteWalletButton"
          activeOpacity={0.7}
        >
          <Text style={[styles.deleteWalletText, { color: colors.statusError }]}>{loc.settings.delete_wallet}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaScrollView>
  );
};

export default Settings;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardGap: {
    marginTop: 16,
  },
  deleteWalletButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 20,
    alignItems: 'center',
  },
  deleteWalletText: {
    fontSize: 16,
    fontFamily: ClashFont.medium,
  },
});
