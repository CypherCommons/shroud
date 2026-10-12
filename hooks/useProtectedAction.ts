import { useCallback, useEffect, useRef, useState } from 'react';
import { hasPinSet } from '../helpers/pinLock';
import { unlockWithBiometrics, useBiometrics } from './useBiometrics';
import { usePinAttempt } from './usePinAttempt';

/**
 * Guards anything that exposes the seed: biometrics if enabled, else the PIN if one is set, else the
 * action runs straight away. While the PIN is asked for, `isPinPromptVisible` is true and the screen
 * shows a <PinPrompt> with `pinAttempt`.
 */
export const useProtectedAction = () => {
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isPinPromptVisible, setIsPinPromptVisible] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const pinAttempt = usePinAttempt(() => {
    setIsPinPromptVisible(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  });
  const { refreshLockout } = pinAttempt;

  useEffect(() => {
    if (isPinPromptVisible) refreshLockout();
  }, [isPinPromptVisible, refreshLockout]);

  /** `onDenied` runs when biometrics are refused; a PIN prompt is left with `cancelPinPrompt`. */
  const runProtected = useCallback(
    async (onGranted: () => void, onDenied?: () => void) => {
      setIsAuthenticating(true);
      try {
        if (await isBiometricUseCapableAndEnabled()) {
          if (await unlockWithBiometrics()) onGranted();
          else onDenied?.();
        } else if (await hasPinSet().catch(() => true)) {
          pendingActionRef.current = onGranted;
          setIsPinPromptVisible(true);
        } else {
          onGranted();
        }
      } finally {
        setIsAuthenticating(false);
      }
    },
    [isBiometricUseCapableAndEnabled],
  );

  const cancelPinPrompt = useCallback(() => {
    pendingActionRef.current = null;
    setIsPinPromptVisible(false);
  }, []);

  return { runProtected, isAuthenticating, isPinPromptVisible, cancelPinPrompt, pinAttempt };
};
