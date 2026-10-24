import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsCard from '../../components/SettingsCard';
import SettingsSectionHeader from '../../components/SettingsSectionHeader';
import SettingsNavRow from '../../components/SettingsNavRow';
import SettingsRow from '../../components/SettingsRow';
import SettingsStatRow from '../../components/SettingsStatRow';
import InfoBanner from '../../components/InfoBanner';
import GithubIcon from '../../components/icons/GithubIcon';
import MailIcon from '../../components/icons/MailIcon';
import { Theme, useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';
import { CONTACT_EMAIL, LINKS, WEBSITE_DOMAIN } from '../../constants/links';
import { getAppVersionLabel } from '../../helpers/appVersion';
import { openLink } from '../../helpers/openLink';

const shroudLogo = require('../../img/icon.png');

interface LinkRowConfig {
  renderIcon: (colors: Theme['colors']) => React.ReactNode;
  title: string;
  subtitle: string;
  url: string;
  testID: string;
}

const LINK_ROWS: LinkRowConfig[] = [
  {
    renderIcon: colors => <MailIcon size={20} color={colors.bgInverse} />,
    title: loc.settings.about_sm_email,
    subtitle: CONTACT_EMAIL,
    url: LINKS.email,
    testID: 'EmailRow',
  },
  {
    renderIcon: colors => <GithubIcon size={20} color={colors.bgInverse} />,
    title: loc.settings.about_sm_github,
    subtitle: loc.settings.about_sm_github_subtitle,
    url: LINKS.github,
    testID: 'GithubRow',
  },
  {
    renderIcon: () => <Image source={shroudLogo} style={styles.linkRowLogo} resizeMode="contain" />,
    title: loc.settings.about_sm_website,
    subtitle: WEBSITE_DOMAIN,
    url: LINKS.website,
    testID: 'WebsiteRow',
  },
];

const About: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="AboutScrollView">
      <View style={styles.hero}>
        <Image source={shroudLogo} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.appName, { color: colors.brandPrimary }]}>{loc.onboarding.shroud}</Text>
        <Text style={[styles.description, { color: colors.textMuted }]}>{loc.settings.about_description}</Text>
      </View>

      <InfoBanner
        variant="caution"
        title={loc.settings.about_warning_title}
        text={loc.settings.about_warning}
        containerStyle={styles.warningBanner}
      />

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.about_community_header}</SettingsSectionHeader>
      <SettingsCard>
        {LINK_ROWS.map((row, index) => (
          <SettingsRow
            key={row.testID}
            icon={row.renderIcon(colors)}
            iconVariant="inline"
            external
            title={row.title}
            subtitle={row.subtitle}
            onPress={() => openLink(row.url)}
            showSeparator={index < LINK_ROWS.length - 1}
            testID={row.testID}
          />
        ))}
      </SettingsCard>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.about_app_info_header}</SettingsSectionHeader>
      <SettingsCard>
        <SettingsStatRow title={loc.settings.about_version} value={getAppVersionLabel()} />
        <SettingsNavRow
          title={loc.settings.license}
          onPress={() => navigation.navigate('Licensing')}
          showSeparator={false}
          testID="LicenseRow"
        />
      </SettingsCard>
    </SafeAreaScrollView>
  );
};

export default About;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  hero: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  logo: {
    width: 64,
    height: 64,
    marginBottom: 20,
  },
  appName: {
    fontSize: 22,
    fontFamily: ClashFont.semibold,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    maxWidth: 280,
    fontSize: 14,
    fontFamily: ClashFont.regular,
    lineHeight: 20,
    textAlign: 'center',
  },
  warningBanner: {
    marginTop: 20,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  linkRowLogo: {
    width: 20,
    height: 20,
  },
});
