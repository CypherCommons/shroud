import React from 'react';

import ActionButton from './ActionButton';
import LogoScreenLayout, { FooterSpinner } from './LogoScreenLayout';
import { useTheme } from './themes';

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

  let footer: React.ReactNode = null;
  if (isAuthenticating) {
    footer = <FooterSpinner />;
  } else if (unlockTitle && onUnlock) {
    footer = (
      <ActionButton
        title={unlockTitle}
        onPress={onUnlock}
        backgroundColor={colors.brandPrimary}
        color={colors.white}
        testID="UnlockButton"
      />
    );
  }

  return <LogoScreenLayout title={title} subtitle={subtitle} footer={footer} />;
};

export default LockScreen;
