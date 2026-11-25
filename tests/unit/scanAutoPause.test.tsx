import React from 'react';
import { AppStateStatus } from 'react-native';
import { render } from '@testing-library/react-native';

import ScanAutoPause from '../../components/ScanAutoPause';
import type { IScannableWallet, ScanStatus } from '../../helpers/silent-payments';
import { useScanStatus } from '../../hooks/context/useScanState';
import { fakeAppState } from '../helpers/appState';

jest.mock('../../hooks/context/useScanState');

const mockUseScanStatus = useScanStatus as jest.Mock;

describe('unit - ScanAutoPause', () => {
  let setAppState: (state: AppStateStatus) => void;

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
    ({ setAppState } = fakeAppState());
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
