import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { IDLE_SCAN_STATE, type ScanStateInfo } from '../../helpers/silent-payments/types';
import { CHECK_FEEDBACK_MS, CHECK_MIN_BUSY_MS } from '../../hooks/useCheckForPayments';
import loc from '../../loc';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import SyncScreen from '../../screen/wallets/SyncScreen';

// What useStorage hands the screen, kept in a test's state so the wallet can change it under the screen.
const mockStorage = React.createContext<{ scanState: ScanStateInfo; wallets: unknown[] } | null>(null);

jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => require('react').useContext(mockStorage),
}));
jest.mock('../../modules/hapticFeedback');
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));

const TIP = 900_000;
const idle: ScanStateInfo = { ...IDLE_SCAN_STATE, lastScannedBlock: TIP };
const failed: ScanStateInfo = { ...idle, status: 'error', error: 'indexer down' };
const scanning = (percentComplete: number | null, eta: Partial<ScanStateInfo> = {}): ScanStateInfo => ({
  ...idle,
  status: 'scanning',
  progress:
    percentComplete === null
      ? null
      : { currentBlock: TIP + 10, tipHeight: TIP + 20, totalBlocks: 20, blocksScanned: 10, percentComplete, utxosFound: 0 },
  ...eta,
});

const defer = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(_resolve => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

/** The screen over a fake scannable wallet whose pause and resume emit at once, like the real one. */
const renderScreen = (initial: ScanStateInfo) => {
  const store: { state: ScanStateInfo; set?: (state: ScanStateInfo) => void } = { state: initial };
  const emit = (state: ScanStateInfo) => {
    store.state = state;
    store.set?.(state);
  };
  const wallet = {
    getScanState: () => store.state,
    setOnScanStateChangeCallback: jest.fn(),
    pauseScan: jest.fn(() => emit({ ...store.state, status: 'paused' })),
    resumeScan: jest.fn(() => emit({ ...store.state, status: 'scanning' })),
    cancelScan: jest.fn(),
    cancelScanAndWait: jest.fn(),
    isScanActive: jest.fn(() => false),
    fetchTransactions: jest.fn(),
    checkForPayments: jest.fn(() => Promise.resolve(0)),
  };

  const Harness = () => {
    const [scanState, setScanState] = React.useState(initial);
    store.set = setScanState;
    const value = React.useMemo(() => ({ scanState, wallets: [wallet] }), [scanState]);
    return (
      <mockStorage.Provider value={value}>
        <SyncScreen navigation={{} as never} route={{} as never} />
      </mockStorage.Provider>
    );
  };

  render(
    <NavigationContainer>
      <Harness />
    </NavigationContainer>,
  );
  return { wallet, emit: (state: ScanStateInfo) => act(() => emit(state)) };
};

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const settle = () => act(async () => {});

describe('unit - SyncScreen', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
    (triggerHapticFeedback as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens caught up with the bar already full', () => {
    renderScreen(idle);

    expect(screen.getByText(loc.sync.done)).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByTestId('SyncProgressBar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    expect(StyleSheet.flatten(screen.getByTestId('SyncProgressBarFill').props.style).width).toBe('100%');
    expect(screen.getByText(loc.sync.subtitle_watching)).toBeTruthy();
  });

  it('answers a tap at once, and ignores another while the check runs', () => {
    const { wallet } = renderScreen(idle);
    wallet.checkForPayments.mockReturnValue(new Promise(() => {}));

    fireEvent.press(screen.getByTestId('SyncCheckAgainButton'));

    expect(screen.getByTestId('SyncCheckAgainButton')).toBeBusy();
    expect(screen.getByTestId('SyncCheckAgainButtonSpinner')).toBeTruthy();
    expect(screen.getByText(loc.sync.btn_checking)).toBeTruthy();
    expect(screen.getByText(loc.sync.subtitle_checking)).toBeTruthy();

    fireEvent.press(screen.getByTestId('SyncCheckAgainButton'));
    expect(wallet.checkForPayments).toHaveBeenCalledTimes(1);
  });

  it('confirms a check that found the wallet caught up, then goes back to watching', async () => {
    renderScreen(idle);

    fireEvent.press(screen.getByTestId('SyncCheckAgainButton'));
    await settle();
    advance(CHECK_MIN_BUSY_MS);

    expect(screen.getByText(loc.sync.checked_just_now)).toBeTruthy();
    expect(screen.getByText(loc.sync.btn_check_again)).toBeTruthy();
    expect(screen.getByTestId('SyncCheckAgainButton')).not.toBeBusy();
    expect(triggerHapticFeedback).toHaveBeenCalledWith(HapticFeedbackTypes.NotificationSuccess);
    expect(announce).toHaveBeenCalledWith(loc.sync.checked_just_now, { queue: true });

    advance(CHECK_FEEDBACK_MS);
    expect(screen.getByText(loc.sync.subtitle_watching)).toBeTruthy();
  });

  it('never shows the progress layout for a scan shorter than 400ms', async () => {
    const answer = defer<number>();
    const { wallet, emit } = renderScreen(idle);
    wallet.checkForPayments.mockReturnValue(answer.promise);

    fireEvent.press(screen.getByTestId('SyncCheckAgainButton'));
    advance(50);
    emit(scanning(null));
    advance(250);
    expect(screen.queryByTestId('SyncPauseButton')).toBeNull();

    emit(idle);
    await act(async () => answer.resolve(1));
    advance(1000);

    expect(screen.queryByTestId('SyncPauseButton')).toBeNull();
    expect(screen.getByText(loc.sync.checked_just_now)).toBeTruthy();
  });

  it('shows a longer scan from 400ms, sweeping until its first numbers arrive', () => {
    const { emit } = renderScreen(idle);

    emit(scanning(null));
    advance(400);

    expect(screen.getByTestId('SyncPauseButton')).toBeTruthy();
    expect(screen.getByText(loc.sync.updating)).toBeTruthy();
    expect(screen.getByTestId('SyncProgressBar').props.accessibilityValue).toBeUndefined();
    // the percentage keeps its place, unseen, so nothing moves when it arrives
    expect(screen.getByTestId('SyncPercent', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });

    emit(scanning(42.6));
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByTestId('SyncPercent')).not.toHaveStyle({ opacity: 0 });
  });

  it('fades a new layout in, but not the one it opens on', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { emit } = renderScreen(idle);
    expect(screen.getByTestId('SyncLayout')).toHaveStyle({ opacity: 1 });

    emit(scanning(null));
    advance(400);

    expect(screen.getByTestId('SyncLayout')).toHaveStyle({ opacity: 0 });
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, useNativeDriver: true }));
  });

  it('pauses and continues with no delay', () => {
    const { wallet } = renderScreen(scanning(42));

    fireEvent.press(screen.getByTestId('SyncPauseButton'));
    expect(wallet.pauseScan).toHaveBeenCalledTimes(1);
    expect(screen.getByText(loc.sync.paused)).toBeTruthy();

    fireEvent.press(screen.getByTestId('SyncContinueButton'));
    expect(wallet.resumeScan).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('SyncPauseButton')).toBeTruthy();
  });

  it('says so when a retry fails too, and stays on the error', async () => {
    const { wallet } = renderScreen(failed);
    wallet.checkForPayments.mockRejectedValue(new Error('indexer down'));

    fireEvent.press(screen.getByTestId('SyncRetryButton'));
    expect(screen.getByTestId('SyncRetryButton')).toBeBusy();
    await settle();
    advance(CHECK_MIN_BUSY_MS);

    expect(screen.getByText(loc.sync.error_title)).toBeTruthy();
    expect(screen.getByText(loc.sync.check_failed)).toBeTruthy();
    expect(screen.getByTestId('SyncRetryButton')).not.toBeBusy();
    expect(triggerHapticFeedback).toHaveBeenCalledWith(HapticFeedbackTypes.NotificationWarning);

    advance(CHECK_FEEDBACK_MS);
    expect(screen.getByText(loc.sync.error_description)).toBeTruthy();
  });

  it('lands a retry that gets through on caught up, in step with its confirmation', async () => {
    const answer = defer<number>();
    const { wallet, emit } = renderScreen(failed);
    wallet.checkForPayments.mockReturnValue(answer.promise);

    fireEvent.press(screen.getByTestId('SyncRetryButton'));
    // the wallet clears its error as soon as the check gets through; the screen waits for the check
    emit(idle);
    advance(100);
    expect(screen.getByText(loc.sync.error_title)).toBeTruthy();
    expect(screen.getByTestId('SyncRetryButton')).toBeBusy();

    await act(async () => answer.resolve(0));
    advance(CHECK_MIN_BUSY_MS);
    advance(0);

    expect(screen.getByText(loc.sync.done)).toBeTruthy();
    expect(screen.getByText(loc.sync.checked_just_now)).toBeTruthy();
    expect(triggerHapticFeedback).toHaveBeenCalledWith(HapticFeedbackTypes.NotificationSuccess);
  });

  it('says nothing once the screen has gone', async () => {
    const answer = defer<number>();
    const { wallet } = renderScreen(idle);
    wallet.checkForPayments.mockReturnValue(answer.promise);

    fireEvent.press(screen.getByTestId('SyncCheckAgainButton'));
    screen.unmount();
    await act(async () => answer.resolve(0));
    advance(CHECK_FEEDBACK_MS);

    expect(triggerHapticFeedback).not.toHaveBeenCalled();
  });

  it('counts the time left down between the wallet’s estimates', () => {
    renderScreen(scanning(42, { eta: 65_000, etaComputedAt: Date.now() }));
    expect(screen.getByText('about 1m left')).toBeTruthy();

    advance(6000);
    expect(screen.getByText('about 59s left')).toBeTruthy();
  });
});
