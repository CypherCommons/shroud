import React from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';

import ScanAutoPause from '../../components/ScanAutoPause';
import type { IScannableWallet, ScanStatus } from '../../helpers/silent-payments';
import { useScanStatus } from '../../hooks/context/useScanState';

jest.mock('../../hooks/context/useScanState');

const mockUseScanStatus = useScanStatus as jest.Mock;

describe('unit - ScanAutoPause', () => {
  // This test's live AppState listeners, so it can send the app to the background and back.
  let appStateListeners: Set<(state: AppStateStatus) => void>;
  const setAppState = (state: AppStateStatus) => act(() => appStateListeners.forEach(listener => listener(state)));

  let wallet: IScannableWallet;
  let rerenderWith: (status: ScanStatus) => void;

  const mount = (status: ScanStatus) => {
    mockUseScanStatus.mockReturnValue(status);
    const { rerender } = render(<ScanAutoPause wallet={wallet} />);
    rerenderWith = next => {
      mockUseScanStatus.mockReturnValue(next);
      rerender(<ScanAutoPause wallet={wallet} />);
    };
  };

  beforeEach(() => {
    appStateListeners = new Set();
    (AppState.addEventListener as jest.Mock).mockImplementation((_type: string, listener: (state: AppStateStatus) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    });
    wallet = { pauseScan: jest.fn(), resumeScan: jest.fn() } as unknown as IScannableWallet;
  });

  it('pauses a running scan in the background, and resumes it on return', () => {
    mount('scanning');

    setAppState('background');
    expect(wallet.pauseScan).toHaveBeenCalledTimes(1);

    rerenderWith('paused');
    setAppState('active');
    expect(wallet.resumeScan).toHaveBeenCalledTimes(1);
  });

  it('leaves a scan the user paused paused when the app comes back', () => {
    mount('paused');

    setAppState('background');
    setAppState('active');

    expect(wallet.pauseScan).not.toHaveBeenCalled();
    expect(wallet.resumeScan).not.toHaveBeenCalled();
  });
});
