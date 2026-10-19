import { act, renderHook } from '@testing-library/react-native';

import type { IScannableWallet } from '../../helpers/silent-payments';
import {
  CHECK_FEEDBACK_MS,
  CHECK_MIN_BUSY_MS,
  type CheckOutcome,
  useCheckFeedback,
  useCheckForPayments,
} from '../../hooks/useCheckForPayments';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';

jest.mock('../../modules/hapticFeedback');

const defer = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
};

const walletChecking = (checkForPayments: () => Promise<number>) =>
  ({ checkForPayments: jest.fn(checkForPayments) }) as unknown as IScannableWallet;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  (triggerHapticFeedback as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useCheckForPayments', () => {
  it('stays busy for at least 600ms, even when the check answers at once', async () => {
    const answer = defer<number>();
    const { result } = renderHook(() => useCheckForPayments(walletChecking(() => answer.promise)));

    act(() => result.current.check());
    expect(result.current.checking).toBe(true);

    await act(async () => answer.resolve(0));
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS - 1));
    expect(result.current.checking).toBe(true);

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toMatchObject({ checking: false, outcome: { id: 1, ok: true, found: 0 } });
  });

  it('stays busy for as long as a slow check takes', async () => {
    const answer = defer<number>();
    const { result } = renderHook(() => useCheckForPayments(walletChecking(() => answer.promise)));

    act(() => result.current.check());
    act(() => jest.advanceTimersByTime(2000));
    expect(result.current.checking).toBe(true);

    await act(async () => answer.resolve(2));
    act(() => jest.advanceTimersByTime(0));
    expect(result.current).toMatchObject({ checking: false, outcome: { ok: true, found: 2 } });
  });

  it('reports a check that failed', async () => {
    const answer = defer<number>();
    const { result } = renderHook(() => useCheckForPayments(walletChecking(() => answer.promise)));

    act(() => result.current.check());
    await act(async () => answer.reject(new Error('indexer down')));
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS));

    expect(result.current.outcome).toMatchObject({ ok: false });
  });

  it('runs one check for a double tap, and a new one once it is over', async () => {
    const wallet = walletChecking(() => Promise.resolve(0));
    const { result } = renderHook(() => useCheckForPayments(wallet));

    act(() => {
      result.current.check();
      result.current.check();
    });
    await act(async () => {});
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS));
    expect(wallet.checkForPayments).toHaveBeenCalledTimes(1);

    act(() => result.current.check());
    await act(async () => {});
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS));
    expect(wallet.checkForPayments).toHaveBeenCalledTimes(2);
    expect(result.current.outcome?.id).toBe(2);
  });

  it('leaves nothing running once the screen has gone', async () => {
    const answer = defer<number>();
    const { result, unmount } = renderHook(() => useCheckForPayments(walletChecking(() => answer.promise)));

    act(() => result.current.check());
    unmount();
    const timers = jest.getTimerCount();
    // outside act, whose async form leaves a timer of its own
    answer.resolve(0);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // no timer left to settle a check nobody is waiting for
    expect(jest.getTimerCount()).toBe(timers);
  });

  it('does nothing without a wallet', () => {
    const { result } = renderHook(() => useCheckForPayments(null));

    act(() => result.current.check());

    expect(result.current.checking).toBe(false);
  });
});

describe('useCheckFeedback', () => {
  const outcome = (id: number, ok = true): CheckOutcome => ({ id, ok, found: 0 });
  const mount = (initial: CheckOutcome | null, landedOn: 'done' | 'error' | null) =>
    renderHook(
      (props: { outcome: CheckOutcome | null; landedOn: 'done' | 'error' | null }) => useCheckFeedback(props.outcome, props.landedOn),
      {
        initialProps: { outcome: initial, landedOn },
      },
    );

  it('waits for the screen to land before showing an outcome', () => {
    const { result, rerender } = mount(outcome(1), null);
    expect(result.current).toEqual({ feedback: null, pending: true });
    expect(triggerHapticFeedback).not.toHaveBeenCalled();

    rerender({ outcome: outcome(1), landedOn: 'done' });
    expect(result.current).toEqual({ feedback: 'checked', pending: false });
    expect(triggerHapticFeedback).toHaveBeenCalledWith(HapticFeedbackTypes.NotificationSuccess);
  });

  it('shows a confirmation for 3s', () => {
    const { result } = mount(outcome(1), 'done');

    act(() => jest.advanceTimersByTime(CHECK_FEEDBACK_MS - 1));
    expect(result.current.feedback).toBe('checked');

    act(() => jest.advanceTimersByTime(1));
    expect(result.current.feedback).toBeNull();
  });

  it.each<[string, CheckOutcome, 'done' | 'error']>([
    ['a check that failed', outcome(1, false), 'done'],
    ['a check that ended on an error', outcome(1, true), 'error'],
  ])('reports %s with a warning haptic', (_label, failed, landedOn) => {
    const { result } = mount(failed, landedOn);

    expect(result.current.feedback).toBe('failed');
    expect(triggerHapticFeedback).toHaveBeenCalledWith(HapticFeedbackTypes.NotificationWarning);
  });

  it('shows each outcome once', () => {
    const { result, rerender } = mount(outcome(1), 'done');
    act(() => jest.advanceTimersByTime(CHECK_FEEDBACK_MS));

    rerender({ outcome: outcome(1), landedOn: 'done' });

    expect(result.current.feedback).toBeNull();
    expect(triggerHapticFeedback).toHaveBeenCalledTimes(1);
  });
});
