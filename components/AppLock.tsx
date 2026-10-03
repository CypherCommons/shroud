import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, AppStateStatus, Image, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PinEntry from './PinEntry';
import Button from './Button';
import { useTheme } from './themes';
import { useStorage } from '../hooks/context/useStorage';
import { unlockWithBiometrics, useBiometrics } from '../hooks/useBiometrics';
import { hasPinSet } from '../helpers/pinLock';
import { usePinAttempt } from '../hooks/usePinAttempt';
import { useResetApp } from '../hooks/useResetApp';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import loc from '../loc';

type LockMethod = 'biometrics' | 'pin' | null;

/**
 * Re-locks an already-unlocked app when it comes back from the background, using the same method
 * as the cold-start unlock screen: biometrics if enabled, otherwise the PIN. Storage decryption only
 * happens on cold start, so this is an auth gate only. Rendered as a Modal so it covers native modal
 * screens and other Modals too.
 */
const AppLock: React.FC = () => {
  const { colors } = useTheme();
  const { walletsInitialized, setWalletsInitialized } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const [lockMethod, setLockMethod] = useState<LockMethod>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // Kept fresh while the app is in the foreground, so going to the background can lock synchronously
  // (JS may be suspended soon after, and an async check could land after the app is shown again).
  const nextLockMethodRef = useRef<LockMethod>(null);

  const resolveLockMethod = useCallback(async (): Promise<LockMethod> => {
    if (await isBiometricUseCapableAndEnabled()) return 'biometrics';
    // A keychain read error fails closed.
    if (await hasPinSet().catch(() => true)) return 'pin';
    return null;
  }, [isBiometricUseCapableAndEnabled]);

  const refreshNextLockMethod = useCallback(async () => {
    nextLockMethodRef.current = await resolveLockMethod();
  }, [resolveLockMethod]);

  useEffect(() => {
    if (!walletsInitialized) {
      setLockMethod(null);
      return;
    }
    refreshNextLockMethod();

    const subscription = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'background') {
        if (nextLockMethodRef.current) {
          setLockMethod(nextLockMethodRef.current);
        } else {
          // Covers a PIN or biometrics turned on since the last refresh.
          const method = await resolveLockMethod();
          if (method) setLockMethod(method);
        }
      } else {
        refreshNextLockMethod();
      }
    });
    return () => subscription.remove();
  }, [walletsInitialized, refreshNextLockMethod, resolveLockMethod]);

  const unlock = useCallback(() => setLockMethod(null), []);

  const isAuthenticatingRef = useRef(false);
  const unlockUsingBiometrics = useCallback(async () => {
    if (isAuthenticatingRef.current) return;
    isAuthenticatingRef.current = true;
    setIsAuthenticating(true);
    try {
      if (await unlockWithBiometrics()) unlock();
    } finally {
      isAuthenticatingRef.current = false;
      setIsAuthenticating(false);
    }
  }, [unlock]);

  // Prompt straight away on return from the background, like the cold-start screen does. Only on a
  // real background -> active return: iOS's Face ID prompt itself flips the app inactive -> active,
  // and prompting on that would re-prompt in a loop after a cancel.
  useEffect(() => {
    if (lockMethod !== 'biometrics') return;
    let wasBackgrounded = AppState.currentState === 'background';
    if (AppState.currentState === 'active') unlockUsingBiometrics();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        wasBackgrounded = true;
      } else if (state === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        unlockUsingBiometrics();
      }
    });
    return () => subscription.remove();
  }, [lockMethod, unlockUsingBiometrics]);

  const pinAttempt = usePinAttempt(() => {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    unlock();
  });
  const { refreshLockout } = pinAttempt;

  useEffect(() => {
    if (lockMethod === 'pin') refreshLockout();
  }, [lockMethod, refreshLockout]);

  // After a reset, go back through the cold-start unlock, which finds no wallet and lands on onboarding.
  const onReset = useCallback(() => setWalletsInitialized(false), [setWalletsInitialized]);
  const resetApp = useResetApp(onReset);

  if (!lockMethod) return null;

  return (
    // onRequestClose is a no-op: Android's back key must not dismiss the lock.
    <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} testID="AppLockScreen">
        <View style={styles.logoContainer}>
          <Image source={require('../img/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.unlockRow}>
          {lockMethod === 'pin' ? (
            <PinEntry pinAttempt={pinAttempt} onForgotPin={resetApp} forgotPinTestID="AppLockForgotPinButton" />
          ) : isAuthenticating ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button onPress={unlockUsingBiometrics} title={loc._.unlock} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

export default AppLock;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  logoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 100,
    height: 75,
  },
  unlockRow: {
    alignSelf: 'center',
    minHeight: 60,
    width: 300,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
});
