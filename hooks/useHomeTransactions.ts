import { useMemo } from 'react';

import { splitSelfTransfer } from '../utils/transactionHelpers';
import { useStorage } from './context/useStorage';

/**
 * The home screen's transactions, rebuilt only when the wallets change: every change to a wallet's
 * transactions comes with a new `wallets`, while the screen re-renders for much else.
 */
export const useHomeTransactions = () => {
  const { wallets, getTransactions } = useStorage();
  // `wallets` is the signal, not an input: getTransactions reads the same wallets from the app itself
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getTransactions(undefined, Infinity).flatMap(splitSelfTransfer), [wallets, getTransactions]);
};
