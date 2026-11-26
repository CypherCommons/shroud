import { useCallback } from 'react';

import { useExtendedNavigation } from './useExtendedNavigation';
import { useStorage } from './context/useStorage';

/**
 * Opens the send flow on the first wallet, optionally with the recipient prefilled.
 *
 * SendDetails only sees params addressed to it by name; a flat payload reaches the nested
 * navigator and stops there, which silently drops the prefilled address. Every caller getting
 * that wrong the same way is what this hook is for.
 */
export type SendToAddressOptions = {
  /** Prefilled amount in sats. */
  amountSats?: number;
  /** Prefilled note. */
  memo?: string;
  /** The chat payment request this pays: the payment notice sent afterwards points back at it. */
  chatRequestId?: string;
};

export const useSendToAddress = () => {
  const navigation = useExtendedNavigation();
  const { wallets } = useStorage();

  return useCallback(
    (address?: string, options: SendToAddressOptions = {}) => {
      if (wallets.length === 0) return;
      navigation.navigate('SendDetailsRoot', {
        screen: 'SendDetails',
        params: {
          walletID: wallets[0].getID(),
          address,
          amountSats: options.amountSats,
          transactionMemo: options.memo,
          chatRequestId: options.chatRequestId,
        },
      });
    },
    [navigation, wallets],
  );
};
