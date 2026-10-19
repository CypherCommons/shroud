import { useCallback, useEffect, useRef, useState } from 'react';

import type { IScannableWallet } from '../helpers/silent-payments';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

// The button stays busy at least this long, so a check that answers at once still reads as one.
export const CHECK_MIN_BUSY_MS = 600;
// How long a check's outcome stands in for the subtitle.
export const CHECK_FEEDBACK_MS = 3000;

export type CheckOutcome = { id: number; ok: boolean; found: number };
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
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  const check = useCallback(() => {
    // the ref, not `checking`: a second tap can land before the render that disables the button
    if (!wallet || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    const startedAt = Date.now();

    wallet
      .checkForPayments()
      .then(
        found => ({ ok: true, found }),
        (error: any) => {
          console.warn('[SyncScreen] Checking for payments failed:', error?.message ?? error);
          return { ok: false, found: 0 };
        },
      )
      .then(result => {
        if (!mounted.current) {
          inFlight.current = false;
          return;
        }
        settleTimer.current = setTimeout(
          () => {
            settleTimer.current = null;
            inFlight.current = false;
            lastId.current += 1;
            setChecking(false);
            setOutcome({ id: lastId.current, ...result });
          },
          Math.max(0, CHECK_MIN_BUSY_MS - (Date.now() - startedAt)),
        );
      });
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
  const [shown, setShown] = useState<{ id: number; kind: CheckFeedback } | null>(null);

  if (outcome !== null && landedOn !== null && outcome.id !== presentedId) {
    setPresentedId(outcome.id);
    setShown({ id: outcome.id, kind: outcome.ok && landedOn === 'done' ? 'checked' : 'failed' });
  }

  useEffect(() => {
    if (shown === null) return;
    triggerHapticFeedback(shown.kind === 'checked' ? HapticFeedbackTypes.NotificationSuccess : HapticFeedbackTypes.NotificationWarning);
    const timer = setTimeout(() => setShown(null), CHECK_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return { feedback: shown?.kind ?? null, pending: outcome !== null && outcome.id !== presentedId };
}
