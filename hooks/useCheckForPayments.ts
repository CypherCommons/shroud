import { useCallback, useEffect, useRef, useState } from 'react';

import type { IScannableWallet } from '../helpers/silent-payments';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

// The button stays busy at least this long, so a check that answers at once still reads as one.
export const CHECK_MIN_BUSY_MS = 600;
// How long a check's outcome stands in for the subtitle.
export const CHECK_FEEDBACK_MS = 3000;

export type CheckOutcome = { id: number; ok: boolean };
export type CheckFeedback = 'checked' | 'failed';

/**
 * Runs the wallet's payment check for a button: `checking` from the tap until the check is over (at
 * least CHECK_MIN_BUSY_MS), then the check's `outcome`. A tap while a check runs does nothing.
 */
export function useCheckForPayments(wallet: IScannableWallet | null): {
  check: () => void;
  checking: boolean;
  outcome: CheckOutcome | null;
} {
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const minBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (minBusyTimer.current) clearTimeout(minBusyTimer.current);
    };
  }, []);

  const check = useCallback(() => {
    // the ref, not `checking`: a second tap can land before the render that disables the button
    if (!wallet || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);

    // Over once both the check and its minimum time are: whichever ends last settles it.
    let ok: boolean | null = null;
    let minBusyOver = false;
    const settle = () => {
      if (ok === null || !minBusyOver) return;
      inFlight.current = false;
      if (!mounted.current) return;
      lastId.current += 1;
      setChecking(false);
      setOutcome({ id: lastId.current, ok });
    };

    // a timer from the tap rather than a reading of the clock, which a clock change mid-check would throw off
    minBusyTimer.current = setTimeout(() => {
      minBusyOver = true;
      settle();
    }, CHECK_MIN_BUSY_MS);
    wallet.checkForPayments().then(
      () => {
        ok = true;
        settle();
      },
      (error: any) => {
        console.warn('[useCheckForPayments] Checking for payments failed:', error?.message ?? error);
        ok = false;
        settle();
      },
    );
  }, [wallet]);

  return { check, checking, outcome };
}

/**
 * Shows each check's outcome once, with its haptic, for CHECK_FEEDBACK_MS. It waits until the screen
 * has `landedOn` the layout the check ended in, so a confirmation never shows over a scan still on
 * screen; `pending` is true while an outcome waits.
 */
export function useCheckFeedback(
  outcome: CheckOutcome | null,
  landedOn: 'done' | 'error' | null,
): { feedback: CheckFeedback | null; pending: boolean } {
  const [presentedId, setPresentedId] = useState(0);
  // an object, so that the same feedback twice in a row is shown, with its haptic, the second time too
  const [shown, setShown] = useState<{ kind: CheckFeedback } | null>(null);

  if (outcome !== null && landedOn !== null && outcome.id !== presentedId) {
    setPresentedId(outcome.id);
    setShown({ kind: outcome.ok && landedOn === 'done' ? 'checked' : 'failed' });
  }

  useEffect(() => {
    if (shown === null) return;
    triggerHapticFeedback(shown.kind === 'checked' ? HapticFeedbackTypes.NotificationSuccess : HapticFeedbackTypes.NotificationWarning);
    const timer = setTimeout(() => setShown(null), CHECK_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return { feedback: shown?.kind ?? null, pending: outcome !== null && outcome.id !== presentedId };
}
