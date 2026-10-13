import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import SafeArea from '../components/SafeArea';
import PinEntry from '../components/PinEntry';
import LockScreen from '../components/LockScreen';
import { BiometricType, getBiometricUnlockTitle, unlockWithBiometrics, useBiometrics } from '../hooks/useBiometrics';
import loc from '../loc';
import { useStorage } from '../hooks/context/useStorage';
import { hasPinSet } from '../helpers/pinLock';
import { usePinAttempt } from '../hooks/usePinAttempt';
import { useResetApp } from '../hooks/useResetApp';

enum AuthType {
  Encrypted,
  Biometrics,
  Pin,
  None,
  BiometricsUnavailable,
}

type State = {
  auth: {
    type: AuthType;
    detail: keyof typeof BiometricType | undefined;
  };
  isAuthenticating: boolean;
};

const SET_AUTH = 'SET_AUTH';
const SET_IS_AUTHENTICATING = 'SET_IS_AUTHENTICATING';

type Action =
  | { type: typeof SET_AUTH; payload: { type: AuthType; detail: keyof typeof BiometricType | undefined } }
  | { type: typeof SET_IS_AUTHENTICATING; payload: boolean };

const initialState: State = {
  auth: {
    type: AuthType.None,
    detail: undefined,
  },
  isAuthenticating: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case SET_AUTH:
      return { ...state, auth: action.payload };
    case SET_IS_AUTHENTICATING:
      return { ...state, isAuthenticating: action.payload };
    default:
      return state;
  }
}

const UnlockWith: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const isUnlockingWallets = useRef(false);
  const { setWalletsInitialized, isStorageEncrypted, startAndDecrypt } = useStorage();
  const { deviceBiometricType, isBiometricUseCapableAndEnabled, isBiometricUseEnabled } = useBiometrics();

  useEffect(() => {
    setWalletsInitialized(false);
  }, [setWalletsInitialized]);

  const successfullyAuthenticated = useCallback(() => {
    setWalletsInitialized(true);
    isUnlockingWallets.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlockUsingBiometrics = useCallback(async () => {
    if (isUnlockingWallets.current || state.isAuthenticating) return;
    isUnlockingWallets.current = true;
    dispatch({ type: SET_IS_AUTHENTICATING, payload: true });

    if ((await unlockWithBiometrics()) && (await startAndDecrypt())) {
      successfullyAuthenticated();
    }

    dispatch({ type: SET_IS_AUTHENTICATING, payload: false });
    isUnlockingWallets.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isAuthenticating]);

  const unlockWithKey = useCallback(async () => {
    if (isUnlockingWallets.current || state.isAuthenticating) return;
    isUnlockingWallets.current = true;
    dispatch({ type: SET_IS_AUTHENTICATING, payload: true });

    if (await startAndDecrypt()) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      successfullyAuthenticated();
    } else {
      dispatch({ type: SET_IS_AUTHENTICATING, payload: false });
      isUnlockingWallets.current = false;
    }
  }, [state.isAuthenticating, startAndDecrypt, successfullyAuthenticated]);

  useEffect(() => {
    const startUnlock = async () => {
      const storageIsEncrypted = await isStorageEncrypted();
      const biometricUseCapableAndEnabled = await isBiometricUseCapableAndEnabled();
      const biometricsUseEnabled = await isBiometricUseEnabled();
      const biometricType = biometricUseCapableAndEnabled ? deviceBiometricType : undefined;
      // A keychain read error fails closed: show the PIN keypad rather than unlocking unchecked.
      const pinIsSet = await hasPinSet().catch(() => true);

      // Encrypted storage is gated by its own password, which the PIN and biometrics can't stand in for.
      if (storageIsEncrypted) {
        dispatch({ type: SET_AUTH, payload: { type: AuthType.Encrypted, detail: undefined } });
        unlockWithKey();
      } else if (biometricUseCapableAndEnabled) {
        dispatch({ type: SET_AUTH, payload: { type: AuthType.Biometrics, detail: biometricType } });
        unlockUsingBiometrics();
      } else if (pinIsSet) {
        dispatch({ type: SET_AUTH, payload: { type: AuthType.Pin, detail: undefined } });
      } else if (biometricsUseEnabled && biometricType === undefined) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        dispatch({ type: SET_AUTH, payload: { type: AuthType.BiometricsUnavailable, detail: undefined } });
      } else {
        dispatch({ type: SET_AUTH, payload: { type: AuthType.None, detail: undefined } });
        unlockWithKey();
      }
    };

    startUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUnlockPressed = () => {
    if (state.auth.type === AuthType.Biometrics) {
      unlockUsingBiometrics();
    } else {
      unlockWithKey();
    }
  };

  const unlockAfterPin = useCallback(async () => {
    isUnlockingWallets.current = true;
    if (await startAndDecrypt()) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      successfullyAuthenticated();
    } else {
      isUnlockingWallets.current = false;
    }
  }, [startAndDecrypt, successfullyAuthenticated]);

  const pinAttempt = usePinAttempt(unlockAfterPin);

  // After a reset there's no PIN or wallet left: unlock as a fresh install, which lands on onboarding.
  const resetApp = useResetApp(unlockWithKey);

  // What the lock screen asks for. No lock at all (AuthType.None) leaves just the logo, as a splash.
  const lockScreenProps = (): React.ComponentProps<typeof LockScreen> => {
    switch (state.auth.type) {
      case AuthType.Biometrics:
        return {
          title: loc.settings.lock_title,
          subtitle: loc.settings.lock_subtitle,
          unlockTitle: getBiometricUnlockTitle(deviceBiometricType),
          onUnlock: onUnlockPressed,
        };
      case AuthType.Encrypted:
        return {
          title: loc.settings.lock_title,
          subtitle: loc._.storage_is_encrypted,
          unlockTitle: loc._.unlock,
          onUnlock: onUnlockPressed,
        };
      case AuthType.BiometricsUnavailable:
        return { title: loc.settings.lock_title, subtitle: loc.settings.biometrics_no_longer_available };
      default:
        return {};
    }
  };

  if (state.auth.type === AuthType.Pin) {
    return (
      <SafeArea style={styles.root}>
        <View style={styles.container}>
          <Image source={require('../img/logo.png')} style={styles.logoImage} resizeMode="contain" />
        </View>
        <View style={styles.pinRow}>
          <PinEntry pinAttempt={pinAttempt} onForgotPin={resetApp} forgotPinTestID="ForgotPinButton" />
        </View>
      </SafeArea>
    );
  }

  return (
    <SafeArea style={styles.root}>
      <LockScreen {...lockScreenProps()} isAuthenticating={state.isAuthenticating} />
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinRow: {
    alignSelf: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 100,
    height: 75,
    alignSelf: 'center',
  },
});

export default UnlockWith;
