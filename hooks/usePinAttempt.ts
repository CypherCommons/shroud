import { useCallback, useEffect, useRef, useState } from 'react';
import presentAlert from '../components/Alert';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import { attemptPin, getPinLockout } from '../helpers/pinLock';
import loc from '../loc';

interface Lockout {
  /** Epoch ms the countdown runs to, or null when not locked out. Display only: attemptPin() decides. */
  lockedUntil: number | null;
  canOfferReset: boolean;
}

const NOT_LOCKED: Lockout = { lockedUntil: null, canOfferReset: false };

const toDisplayLockout = ({ retryInMs, canOfferReset }: { retryInMs: number | null; canOfferReset: boolean }): Lockout => ({
  lockedUntil: retryInMs === null ? null : Date.now() + retryInMs,
  canOfferReset,
});

const formatWait = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * PIN entry for any screen with a PinKeypad: checks the PIN through the shared wrong-attempt limiter
 * and tracks the lockout countdown. `onSuccess` runs once the PIN is right.
 */
export const usePinAttempt = (onSuccess: () => void | Promise<void>) => {
  const [lockout, setLockout] = useState<Lockout>(NOT_LOCKED);
  const [now, setNow] = useState(Date.now());
  const [pinError, setPinError] = useState(false);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  // Re-read when the keypad is shown later than the screen mounts (a lock overlay, an in-screen
  // prompt), since another screen may have added failures in between.
  const refreshLockout = useCallback(() => {
    getPinLockout()
      .then(l => setLockout(toDisplayLockout(l)))
      .catch(e => console.warn('getPinLockout failed:', e));
  }, []);

  useEffect(() => {
    refreshLockout();
  }, [refreshLockout]);

  useEffect(() => {
    if (!lockout.lockedUntil) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockout.lockedUntil]);

  const secondsLeft = lockout.lockedUntil ? Math.max(0, Math.ceil((lockout.lockedUntil - now) / 1000)) : 0;

  const submitPin = useCallback(async (pin: string) => {
    let result;
    try {
      result = await attemptPin(pin);
    } catch (e) {
      console.warn('attemptPin failed:', e);
      presentAlert({ message: loc.settings.pin_storage_error });
      return;
    }
    if (result.ok) {
      setLockout(NOT_LOCKED);
      await onSuccessRef.current();
      return;
    }
    triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
    setLockout(toDisplayLockout(result));
    setPinError(true);
  }, []);

  const clearPinError = useCallback(() => setPinError(false), []);

  return {
    submitPin,
    pinError,
    clearPinError,
    isLockedOut: secondsLeft > 0,
    /** Localized "try again in m:ss" line while locked out, else null. */
    lockoutMessage: secondsLeft > 0 ? loc.formatString(loc.settings.pin_locked_out, { time: formatWait(secondsLeft) }) : null,
    canOfferReset: lockout.canOfferReset,
    refreshLockout,
  };
};
