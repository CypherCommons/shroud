import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ScanStateContext, ScanStatusContext } from '../../components/Context/StorageProvider';
import ScanProgressBar from '../../components/ScanProgressBar';
import { IDLE_SCAN_STATE, type IScannableWallet, type ScanStateInfo } from '../../helpers/silent-payments';
import * as paymentCheck from '../../hooks/useCheckForPayments';
import { CHECK_MIN_BUSY_MS } from '../../hooks/useCheckForPayments';
import loc from '../../loc';
import { defer } from '../helpers/defer';

// @rneui's Icon can't render under jest (its icon font isn't installed)
jest.mock('@rneui/themed', () => ({ ...jest.requireActual('@rneui/themed'), Icon: () => null }));

const TIP = 900_000;
const idle: ScanStateInfo = { ...IDLE_SCAN_STATE, lastScannedBlock: TIP };
const failed: ScanStateInfo = { ...idle, status: 'error', error: 'indexer down' };
const scanning = (percentComplete: number): ScanStateInfo => ({
  ...idle,
  status: 'scanning',
  progress: { currentBlock: TIP + 10, tipHeight: TIP + 20, totalBlocks: 20, blocksScanned: 10, percentComplete, utxosFound: 0 },
});

/** The banner under scan contexts a test can change. */
const renderBanner = (initial: ScanStateInfo, wallet = {} as IScannableWallet) => {
  let setState!: (state: ScanStateInfo) => void;
  // as in the app, the banner's parent doesn't re-render with the scan: only the contexts change
  const Contexts: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, set] = React.useState(initial);
    setState = set;
    return (
      <ScanStatusContext.Provider value={state.status}>
        <ScanStateContext.Provider value={state}>{children}</ScanStateContext.Provider>
      </ScanStatusContext.Provider>
    );
  };
  render(
    <NavigationContainer>
      <Contexts>
        <ScanProgressBar wallet={wallet} />
      </Contexts>
    </NavigationContainer>,
  );
  return { emit: (state: ScanStateInfo) => act(() => setState(state)) };
};

describe('unit - ScanProgressBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('answers a Retry tap, saying it’s checking until the check is over', async () => {
    const answer = defer<number>();
    const wallet = { checkForPayments: jest.fn(() => answer.promise) } as unknown as IScannableWallet;
    renderBanner(failed, wallet);

    fireEvent.press(screen.getByTestId('ScanBannerRetry'));
    expect(screen.getByText(loc.sync.btn_checking)).toBeTruthy();
    expect(screen.getByTestId('ScanBannerRetry')).toBeBusy();

    // fails again: the banner reads as it did, but the tap had its answer
    await act(async () => answer.reject(new Error('indexer down')));
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS));
    expect(screen.getByText(loc.sync.btn_retry)).toBeTruthy();
    expect(wallet.checkForPayments).toHaveBeenCalledTimes(1);
  });

  it('doesn’t re-render for a running scan’s progress reports, which it doesn’t show', () => {
    // the banner runs this once a render: a count of its renders
    const renders = jest.spyOn(paymentCheck, 'useCheckForPayments');
    const { emit } = renderBanner(scanning(10));
    expect(screen.getByText(loc.sync.banner_scanning)).toBeTruthy();
    renders.mockClear();

    emit(scanning(20));
    emit(scanning(30));

    expect(renders).not.toHaveBeenCalled();
  });

  it('never shows the scan a new block brings, when it’s over within 400ms', () => {
    const { emit } = renderBanner(idle);

    emit(scanning(0));
    act(() => jest.advanceTimersByTime(300));
    expect(screen.queryByText(loc.sync.banner_scanning)).toBeNull();
    emit({ ...idle, lastScannedBlock: TIP + 1 });
    act(() => jest.advanceTimersByTime(1000));

    expect(screen.queryByText(loc.sync.banner_scanning)).toBeNull();
    expect(screen.getByText(loc.formatString(loc.sync.banner_synced, { blockHeight: (TIP + 1).toLocaleString() }) as string)).toBeTruthy();
  });
});
