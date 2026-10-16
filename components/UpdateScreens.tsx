import React from 'react';
import { Platform, StatusBar, StyleSheet, Text, View } from 'react-native';

import ActionButton from './ActionButton';
import LogoScreenLayout, { FooterSpinner } from './LogoScreenLayout';
import ProgressBar from './ProgressBar';
import SafeArea from './SafeArea';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import { STORE_LINKS } from '../constants/links';
import { openLink } from '../helpers/openLink';
import type { OtaScreen } from '../hooks/useOtaUpdate';
import loc from '../loc';

interface UpdateScreenLayoutProps {
  title: string;
  subtitle: string;
  /** Between the text and the buttons, e.g. the progress bar. */
  children?: React.ReactNode;
  /** The buttons pinned to the bottom. */
  footer?: React.ReactNode;
  testID: string;
}

const UpdateScreenLayout: React.FC<UpdateScreenLayoutProps> = ({ testID, ...layout }) => {
  const { dark } = useTheme();

  return (
    <SafeArea testID={testID}>
      {/*
        These screens take the navigator's place, and with it the status bar style its screens set. On
        Android the last style would stay, so it's set here. iOS needs nothing: without a screen to ask,
        it follows the window's appearance, which SettingsProvider sets from the theme. StatusBar can't be
        used there anyway, since the Info.plist leaves the style to view controllers.
      */}
      {Platform.OS === 'android' && <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />}
      <LogoScreenLayout announceTitle {...layout} />
    </SafeArea>
  );
};

/** Shown instead of the app when this build is below the update server's minimum (useUpdateRequired). */
export const UpdateRequiredScreen: React.FC = () => {
  const { colors } = useTheme();
  // The app ships to these two stores only.
  const store =
    Platform.OS === 'ios'
      ? { title: loc.updates.required_open_app_store, url: STORE_LINKS.ios }
      : { title: loc.updates.required_open_play_store, url: STORE_LINKS.android };

  return (
    <UpdateScreenLayout
      testID="UpdateRequiredScreen"
      title={loc.updates.required_title}
      subtitle={loc.updates.required_subtitle}
      footer={
        <ActionButton
          title={store.title}
          onPress={() => openLink(store.url)}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          testID="UpdateRequiredStoreButton"
        />
      }
    />
  );
};

/** The download's bar, with a percentage while there's a real one. */
const DownloadBar: React.FC<{ progress: number | null }> = ({ progress }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.progress}>
      {progress !== null && progress < 1 && (
        <Text style={[styles.percent, { color: colors.textMuted }]}>{`${Math.round(progress * 100)}%`}</Text>
      )}
      <ProgressBar progress={progress} testID="OtaProgressBar" />
    </View>
  );
};

interface OtaUpdateScreenProps {
  screen: Exclude<OtaScreen, { kind: 'hidden' }>;
  onRestart: () => void;
  onRetry: () => void;
  onContinue: () => void;
}

/** Shown instead of the app while an over-the-air update downloads and waits for a restart (useOtaUpdate). */
export const OtaUpdateScreen: React.FC<OtaUpdateScreenProps> = ({ screen, onRestart, onRetry, onContinue }) => {
  const { colors } = useTheme();

  const continueButton = (
    <ActionButton
      title={loc.updates.continue_current}
      onPress={onContinue}
      backgroundColor={colors.background}
      color={colors.textPrimary}
      borderColor={colors.borderDefault}
      testID="OtaContinueButton"
    />
  );

  switch (screen.kind) {
    case 'downloading':
      return (
        <UpdateScreenLayout
          testID="OtaUpdateScreen"
          title={loc.updates.downloading_title}
          subtitle={loc.updates.downloading_subtitle}
          footer={screen.slow ? continueButton : null}
        >
          <DownloadBar progress={screen.progress} />
        </UpdateScreenLayout>
      );
    case 'ready':
    case 'restarting': {
      const restartButton = (
        <ActionButton
          title={loc.updates.restart}
          onPress={onRestart}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          testID="OtaRestartButton"
        />
      );
      // The finished download stays on screen, full, so nothing moves when the button comes in.
      return (
        <UpdateScreenLayout
          testID="OtaUpdateScreen"
          title={loc.updates.ready_title}
          subtitle={loc.updates.ready_subtitle}
          footer={screen.kind === 'ready' ? restartButton : <FooterSpinner testID="OtaRestartingIndicator" />}
        >
          <DownloadBar progress={1} />
        </UpdateScreenLayout>
      );
    }
    case 'error':
      return (
        <UpdateScreenLayout
          testID="OtaUpdateScreen"
          title={loc.updates.error_title}
          subtitle={loc.updates.error_subtitle}
          footer={
            <>
              <ActionButton
                title={loc.updates.try_again}
                onPress={onRetry}
                backgroundColor={colors.brandPrimary}
                color={colors.white}
                testID="OtaRetryButton"
              />
              {continueButton}
            </>
          }
        />
      );
  }
};

const styles = StyleSheet.create({
  progress: { width: '100%', marginTop: 32, alignItems: 'center', gap: 8 },
  percent: { fontFamily: ClashFont.medium, fontSize: 15, lineHeight: 22 },
});
