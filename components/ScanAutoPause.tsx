import React, { useEffect, useRef } from 'react';

import type { IScannableWallet } from '../helpers/silent-payments';
import { useScanStatus } from '../hooks/context/useScanState';
import useAppState from '../hooks/useAppState';

/**
 * Pauses a running scan while the app is in the background and resumes it on return, unless the user
 * paused it themselves. Renders nothing; a component of its own so that only it re-renders when the
 * scan's status or the app's state changes, not the screen it sits in.
 */
const ScanAutoPause: React.FC<{ wallet: IScannableWallet | null }> = ({ wallet }) => {
  const status = useScanStatus();
  const { currentAppState } = useAppState();
  const wasAutoPausedRef = useRef(false);

  useEffect(() => {
    if (!wallet) return;
    const isBackground = currentAppState === 'background' || currentAppState === 'inactive';
    if (isBackground && status === 'scanning') {
      wasAutoPausedRef.current = true;
      wallet.pauseScan();
    } else if (!isBackground && wasAutoPausedRef.current && status === 'paused') {
      wasAutoPausedRef.current = false;
      wallet.resumeScan();
    } else if (status !== 'paused' && status !== 'scanning') {
      // scan ended via another path (cancel/error/completion) — drop the stale flag so a
      // later manual pause isn't auto-resumed
      wasAutoPausedRef.current = false;
    }
  }, [currentAppState, status, wallet]);

  return null;
};

export default ScanAutoPause;
