import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import ActionButton, { actionButtonStyles } from './ActionButton';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface LockScreenProps {
  /** Left out while there's nothing to ask for yet (a cold start with no lock), so it reads as a splash. */
  title?: string;
  subtitle?: string;
  /** The call to action pinned to the bottom; without both, the bottom stays empty. */
  unlockTitle?: string;
  onUnlock?: () => void;
  /** A prompt is up: a spinner takes the button's place, at its height so the logo above doesn't jump. */
  isAuthenticating?: boolean;
}

/**
 * The locked-app screen the biometrics prompt sits on, and what's left once it's cancelled or fails.
 * Shared by the cold-start unlock (UnlockWith) and the re-lock on return from background (AppLock).
 */
const LockScreen: React.FC<LockScreenProps> = ({ title, subtitle, unlockTitle, onUnlock, isAuthenticating }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <Image source={require('../img/icon.png')} style={styles.logo} resizeMode="contain" />
        {title && <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>}
        {subtitle && <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>}
      </View>
      <View style={styles.footer}>
        {isAuthenticating ? (
          <View style={styles.spinner}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          unlockTitle &&
          onUnlock && (
            <ActionButton
              title={unlockTitle}
              onPress={onUnlock}
              backgroundColor={colors.brandPrimary}
              color={colors.white}
              testID="UnlockButton"
            />
          )
        )}
      </View>
    </View>
  );
};

export default LockScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  logo: { width: 88, height: 88, marginBottom: 24 },
  title: { fontFamily: ClashFont.medium, fontSize: 32, lineHeight: 40, letterSpacing: -1.2, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  // Always the button's height, so the logo above doesn't shift as the button comes and goes.
  footer: { paddingHorizontal: 24, paddingBottom: 24, minHeight: actionButtonStyles.button.height + 24 },
  spinner: { height: actionButtonStyles.button.height, justifyContent: 'center' },
});
