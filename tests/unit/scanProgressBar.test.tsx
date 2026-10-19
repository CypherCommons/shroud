import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ScanStateContext } from '../../components/Context/StorageProvider';
import ScanProgressBar from '../../components/ScanProgressBar';
import { IDLE_SCAN_STATE, type IScannableWallet, type ScanStateInfo } from '../../helpers/silent-payments';
import { CHECK_MIN_BUSY_MS } from '../../hooks/useCheckForPayments';
import loc from '../../loc';
import { defer } from '../helpers/defer';

// @rneui's Icon can't render under jest (its icon font isn't installed)
jest.mock('@rneui/themed', () => ({ ...jest.requireActual('@rneui/themed'), Icon: () => null }));

const failed: ScanStateInfo = { ...IDLE_SCAN_STATE, status: 'error', error: 'indexer down', lastScannedBlock: 900_000 };

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
    const wallet = { checkForPayments: jest.fn(() => answer.promise), resumeScan: jest.fn() } as unknown as IScannableWallet;
    render(
      <NavigationContainer>
        <ScanStateContext.Provider value={failed}>
          <ScanProgressBar wallet={wallet} />
        </ScanStateContext.Provider>
      </NavigationContainer>,
    );

    fireEvent.press(screen.getByTestId('ScanBannerRetry'));
    expect(screen.getByText(loc.sync.btn_checking)).toBeTruthy();
    expect(screen.getByTestId('ScanBannerRetry')).toBeBusy();

    // fails again: the banner reads as it did, but the tap had its answer
    await act(async () => answer.reject(new Error('indexer down')));
    act(() => jest.advanceTimersByTime(CHECK_MIN_BUSY_MS));
    expect(screen.getByText(loc.sync.btn_retry)).toBeTruthy();
    expect(wallet.checkForPayments).toHaveBeenCalledTimes(1);
  });
});
