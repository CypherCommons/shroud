import React, { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { actionButtonStyles } from './ActionButton';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface LogoScreenLayoutProps {
  /** Left out while there's nothing to say yet, so the screen reads as a splash. */
  title?: string;
  subtitle?: string;
  /** Under the text, e.g. a progress bar. */
  children?: React.ReactNode;
  /** Pinned to the bottom, usually one ActionButton. Its height is kept while empty, so the logo above doesn't move. */
  footer?: React.ReactNode;
  /** Reads out each new title, for a screen whose state changes while someone waits on it. */
  announceTitle?: boolean;
}

/**
 * The logo, title and subtitle in the middle and the call to action at the bottom: the unlock screen
 * (LockScreen) and the update screens (UpdateScreens). The middle scrolls, so nothing is cut off at the
 * largest text sizes.
 */
const LogoScreenLayout: React.FC<LogoScreenLayoutProps> = ({ title, subtitle, children, footer, announceTitle }) => {
  const { colors } = useTheme();

  // Android reads out a live region's changes by itself; iOS has to be told.
  useEffect(() => {
    if (announceTitle && title && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(title);
  }, [announceTitle, title]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical={false}>
        <Image source={require('../img/icon.png')} style={styles.logo} resizeMode="contain" />
        {/* The title's scaling is capped so the display size doesn't break words across lines. */}
        {title ? (
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion={announceTitle ? 'polite' : undefined}
            maxFontSizeMultiplier={1.5}
            style={[styles.title, { color: colors.textPrimary }]}
          >
            {title}
          </Text>
        ) : null}
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </View>
  );
};

/** A spinner in the footer's place, at its button's height. */
export const FooterSpinner: React.FC<{ testID?: string }> = ({ testID }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.spinner}>
      <ActivityIndicator color={colors.brandPrimary} testID={testID} />
    </View>
  );
};

export default LogoScreenLayout;

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 24 },
  logo: { width: 88, height: 88, marginBottom: 24 },
  title: { fontFamily: ClashFont.medium, fontSize: 32, lineHeight: 40, letterSpacing: -1.2, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingBottom: 24, gap: 12, minHeight: actionButtonStyles.button.height + 24 },
  spinner: { height: actionButtonStyles.button.height, justifyContent: 'center' },
});
