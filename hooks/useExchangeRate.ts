import { useSyncExternalStore } from 'react';

import { getExchangeRate, subscribeToExchangeRate } from '../modules/currency';

/**
 * The price of 1 BTC in the preferred currency, or undefined until a rate has loaded. Reading the currency
 * module during render alone misses a rate that arrives later; this re-renders the caller when it does.
 */
export const useExchangeRate = (): number | undefined => useSyncExternalStore(subscribeToExchangeRate, getExchangeRate);
