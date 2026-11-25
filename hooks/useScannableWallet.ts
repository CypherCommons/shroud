import { useMemo } from 'react';
import { useStorage } from './context/useStorage';
import { isScannable, type IScannableWallet } from '../helpers/silent-payments';

/**
 * Returns the first wallet that supports background scanning (silent payments), or null.
 * Centralises the `wallets.find(isScannable)` lookup shared across the scan UI.
 */
export const useScannableWallet = (): IScannableWallet | null => {
  const { wallets } = useStorage();
  return useMemo(() => (wallets.find(isScannable) ?? null) as IScannableWallet | null, [wallets]);
};

/**
 * Memoised scan controls for a scannable wallet, so every screen driving the scan shares one
 * definition of what each control does (and doesn't allocate a new callback per render). Checking
 * again is useCheckForPayments, which also tells the screens while a check runs.
 */
export const useScanActions = (wallet: IScannableWallet | null) =>
  useMemo(
    () => ({
      pause: () => wallet?.pauseScan(),
      resume: () => wallet?.resumeScan(),
    }),
    [wallet],
  );
