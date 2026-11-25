import { useEffect, useState, useSyncExternalStore } from 'react';

import type { IScannableWallet } from '../helpers/silent-payments';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

// The button stays busy at least this long, so a check that answers at once still reads as one.
export const CHECK_MIN_BUSY_MS = 600;
// How long a check's outcome stands in for the subtitle.
export const CHECK_FEEDBACK_MS = 3000;

export type CheckOutcome = { id: number; ok: boolean };
export type CheckFeedback = 'checked' | 'failed';

type CheckState = { checking: boolean; outcome: CheckOutcome | null };

const IDLE: CheckState = { checking: false, outcome: null };

/**
 * A wallet's payment check as every screen sees it: one started from the home banner shows as running on the
 * Sync screen too, and outlives the screen that started it.
 */
class PaymentCheck {
  private state: CheckState = IDLE;
  private listeners = new Set<() => void>();
  private lastId = 0;

  constructor(private readonly wallet: IScannableWallet) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  /** Busy from now until the check is over, and at least CHECK_MIN_BUSY_MS. A call while one runs does nothing. */
  run = () => {
    if (this.state.checking) return;
    this.setState({ ...this.state, checking: true });

    // Over once both the check and its minimum time are: whichever ends last settles it.
    let ok: boolean | null = null;
    let minBusyOver = false;
    const settle = () => {
      if (ok === null || !minBusyOver) return;
      this.lastId += 1;
      this.setState({ checking: false, outcome: { id: this.lastId, ok } });
    };

    // a timer from the tap rather than a reading of the clock, which a clock change mid-check would throw off
    setTimeout(() => {
      minBusyOver = true;
      settle();
    }, CHECK_MIN_BUSY_MS);
    this.wallet.checkForPayments().then(
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
  };

  private setState(state: CheckState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
}

const checks = new WeakMap<IScannableWallet, PaymentCheck>();

const checkFor = (wallet: IScannableWallet): PaymentCheck => {
  let check = checks.get(wallet);
  if (check === undefined) {
    check = new PaymentCheck(wallet);
    checks.set(wallet, check);
  }
  return check;
};

const noListeners = () => () => {};
const idle = () => IDLE;
const nothing = () => {};

/**
 * Runs the wallet's payment check for a button: `checking` from the tap until the check is over (at
 * least CHECK_MIN_BUSY_MS), then the check's `outcome`. A tap while a check runs does nothing. Every
 * screen using it for the same wallet sees the same check.
 */
export function useCheckForPayments(wallet: IScannableWallet | null): {
  check: () => void;
  checking: boolean;
  outcome: CheckOutcome | null;
} {
  const paymentCheck = wallet ? checkFor(wallet) : null;
  const { checking, outcome } = useSyncExternalStore(paymentCheck?.subscribe ?? noListeners, paymentCheck?.getState ?? idle);
  return { check: paymentCheck?.run ?? nothing, checking, outcome };
}

/**
 * Shows each check's outcome once, with its haptic, for CHECK_FEEDBACK_MS. It waits until the screen
 * has `landedOn` the layout the check ended in, so a confirmation never shows over a scan still on
 * screen; `pending` is true while an outcome waits. An outcome already in when the screen opened is
 * an earlier check's, which it never showed, and isn't shown.
 */
export function useCheckFeedback(
  outcome: CheckOutcome | null,
  landedOn: 'done' | 'error' | null,
): { feedback: CheckFeedback | null; pending: boolean } {
  const [presentedId, setPresentedId] = useState(() => outcome?.id ?? 0);
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
